const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { db, fakePrisma, uid } = require('./helpers/fakeDb');
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('../src/infrastructure/db/prisma', fakePrisma);
stub('../src/infrastructure/redis/redis', { incr: async () => 1, expire: async () => 1 });

const sent = [];
let sendHook = null;
let failSends = false;
stub('../src/modules/notifications/channel', {
  globalFrom: () => ({ name: 'Platform', address: 'noreply@platform.test' }),
  send: async (m) => {
    if (failSends) throw new Error('SMTP down');
    if (sendHook) await sendHook(m, sent.length);
    sent.push(m);
    return { success: true };
  },
});

const sender = require('../src/modules/campaigns/sender');
const service = require('../src/modules/campaigns/service');
const { waitForSlot } = require('../src/modules/campaigns/pacing');
const env = require('../src/config/env');

const P = 'p1';
const noSleep = async () => {};
const fastRedis = { incr: async () => 1, expire: async () => 1 };
// Fast defaults; each test overrides what it exercises.
const opts = (o = {}) => ({ owner: 'worker-A', sleep: noSleep, redis: fastRedis, batchSize: 100, preparePage: 500, sliceMs: 60_000, leaseMs: 120_000, ...o });

function seed({ contacts = 3, campaignOver = {}, contactOver = () => ({}) } = {}) {
  for (const k of ['campaigns', 'recipients', 'contacts', 'segments', 'properties', 'suppressions', 'notifications', 'outbox', 'audits']) db[k] = [];
  sent.length = 0;
  sendHook = null;
  failSends = false;
  db.properties.push({ id: P, name: 'Grand', address: '1 Main St', campaignSendRatePerSec: null });
  db.segments.push({ id: 's1', propertyId: P, filters: {} });
  for (let i = 0; i < contacts; i += 1) {
    const id = `c${String(i).padStart(5, '0')}`;
    db.contacts.push({ id, propertyId: P, fullName: `N${i}`, email: `${id}@x.com`, phone: null, status: 'lead', marketingConsent: true, unsubscribedAt: null, emailBounced: false, ...contactOver(i) });
  }
  db.campaigns.push({
    id: 'k1', propertyId: P, segmentId: 's1', name: 'C', channel: 'email', subject: 'Hi {{fullName}}', body: 'Hello {{fullName}}',
    status: 'sending', totalRecipients: 0, sentCount: 0, skippedCount: 0, failedCount: 0,
    preparedAt: null, prepareCursor: null, leaseOwner: null, leaseUntil: null, lastProgressAt: new Date(0), ...campaignOver,
  });
}
const camp = () => db.campaigns[0];
const statusOf = (s) => db.recipients.filter((r) => r.status === s).length;

// ───────────── tests ─────────────
test('prepares recipients, sends only to eligible contacts, finishes with exact counts and one outbox event', async () => {
  seed({ contacts: 4, contactOver: (i) => (i === 1 ? { marketingConsent: false } : i === 2 ? { unsubscribedAt: new Date() } : {}) });
  db.suppressions.push({ propertyId: P, channel: 'email', address: 'c00003@x.com' });
  await sender.runCampaignSends(opts());

  assert.deepStrictEqual(sent.map((m) => m.to), ['c00000@x.com']);
  const reasons = Object.fromEntries(db.recipients.filter((r) => r.status === 'skipped').map((r) => [r.contactId, r.failureReason]));
  assert.deepStrictEqual(reasons, { c00001: 'no_consent', c00002: 'unsubscribed', c00003: 'suppressed' });
  assert.strictEqual(camp().status, 'sent');
  assert.deepStrictEqual([camp().totalRecipients, camp().sentCount, camp().skippedCount, camp().failedCount], [4, 1, 3, 0]);
  assert.strictEqual(db.outbox.filter((e) => e.eventType === 'campaign.sent').length, 1);
  assert.ok(camp().leaseOwner === null && camp().finishedAt);
  assert.match(sent[0].body, /Unsubscribe: http/);
  assert.strictEqual(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('no 5,000 cap: 5,200 contacts are paged through and each is emailed exactly once', async () => {
  seed({ contacts: 5200 });
  await sender.runCampaignSends(opts());
  assert.strictEqual(sent.length, 5200);
  assert.strictEqual(new Set(sent.map((m) => m.to)).size, 5200);
  assert.strictEqual(camp().totalRecipients, 5200);
  assert.strictEqual(camp().status, 'sent');
});

test('RESUME: work stops at the end of a slice and the next pass continues; nobody gets two emails', async () => {
  seed({ contacts: 250 });
  let clock = 1_000_000;
  const o = opts({ now: () => clock, sliceMs: 10_000, batchSize: 20 });
  // every delivered message "takes" 1s of the slice
  sendHook = async () => { clock += 1_000; };

  await sender.runCampaignSends(o);
  assert.strictEqual(camp().status, 'sending', 'first slice must yield, not finish');
  const afterFirst = sent.length;
  assert.ok(afterFirst > 0 && afterFirst < 250);
  assert.strictEqual(camp().leaseOwner, null, 'lease released when yielding');

  let guard = 0;
  while (camp().status === 'sending' && guard++ < 100) await sender.runCampaignSends(o);
  assert.strictEqual(camp().status, 'sent');
  assert.strictEqual(sent.length, 250);
  assert.strictEqual(new Set(sent.map((m) => m.to)).size, 250, 'no duplicates across slices');
});

test('CRASH: a recipient left in `sending` by a dead worker is marked failed "interrupted", never re-sent; the rest continue', async () => {
  seed({ contacts: 5, campaignOver: { preparedAt: new Date(), leaseOwner: 'dead-worker', leaseUntil: new Date(1) } });
  // as if worker "dead-worker" had prepared everything and crashed while delivering c00001
  db.contacts.forEach((c, i) => db.recipients.push({ id: `r${i}`, campaignId: 'k1', contactId: c.id, recipientEmail: c.email, status: i === 0 ? 'sent' : i === 1 ? 'sending' : 'queued' }));
  Object.assign(camp(), { totalRecipients: 5, sentCount: 1 });

  await sender.runCampaignSends(opts({ now: () => Date.now() }));

  assert.deepStrictEqual(sent.map((m) => m.to).sort(), ['c00002@x.com', 'c00003@x.com', 'c00004@x.com']);
  const r1 = db.recipients.find((r) => r.contactId === 'c00001');
  assert.deepStrictEqual([r1.status, r1.failureReason], ['failed', 'interrupted']);
  assert.strictEqual(camp().status, 'sent');
  assert.deepStrictEqual([camp().sentCount, camp().failedCount], [4, 1]);
});

test('LEASE: a campaign with a live lease held by another worker is left alone', async () => {
  seed({ contacts: 3, campaignOver: { leaseOwner: 'other', leaseUntil: new Date(Date.now() + 60_000) } });
  await sender.runCampaignSends(opts());
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(camp().leaseOwner, 'other');
});

test('LEASE: two workers racing for the same campaign send each message exactly once', async () => {
  seed({ contacts: 60 });
  await Promise.all([sender.runCampaignSends(opts({ owner: 'A' })), sender.runCampaignSends(opts({ owner: 'B' }))]);
  assert.strictEqual(sent.length, 60);
  assert.strictEqual(new Set(sent.map((m) => m.to)).size, 60);
});

test('CANCEL mid-send: delivered stays delivered, the rest are skipped, no further sends', async () => {
  seed({ contacts: 10 });
  sendHook = async (_m, n) => {
    if (n === 2) await service.cancelCampaign('k1', P, { id: 'u1' }); // 3rd message triggers the cancel
  };
  await sender.runCampaignSends(opts({ batchSize: 4 }));

  assert.strictEqual(camp().status, 'cancelled');
  assert.ok(sent.length >= 3 && sent.length <= 4, `sent ${sent.length}`);
  assert.strictEqual(statusOf('queued') + statusOf('sending'), 0);
  assert.strictEqual(camp().sentCount, sent.length);
  assert.strictEqual(camp().sentCount + camp().skippedCount, 10);
  const before = sent.length;
  await sender.runCampaignSends(opts());
  assert.strictEqual(sent.length, before, 'a cancelled campaign is never picked up again');
});

test('ELIGIBILITY IS RE-CHECKED AT SEND TIME: someone who unsubscribes mid-campaign is not emailed', async () => {
  seed({ contacts: 5 });
  sendHook = async (_m, n) => {
    if (n === 0) Object.assign(db.contacts.find((c) => c.id === 'c00003'), { unsubscribedAt: new Date(), marketingConsent: false });
  };
  await sender.runCampaignSends(opts({ batchSize: 1 }));
  assert.ok(!sent.some((m) => m.to === 'c00003@x.com'));
  const r = db.recipients.find((x) => x.contactId === 'c00003');
  assert.deepStrictEqual([r.status, r.failureReason], ['skipped', 'unsubscribed']);
  assert.strictEqual(sent.length, 4);
});

test('CIRCUIT BREAKER: consecutive failures halt the campaign (keeping the rest queued); retry-failed resumes it', async () => {
  seed({ contacts: 10 });
  failSends = true;
  await sender.runCampaignSends(opts({ maxConsecutiveFailures: 3 }));
  assert.strictEqual(camp().status, 'failed');
  assert.match(camp().haltReason, /3 consecutive/);
  assert.strictEqual(statusOf('failed'), 3);
  assert.strictEqual(statusOf('queued'), 7, 'unsent recipients stay queued instead of being burned as failed');

  failSends = false;
  const resumed = await service.retryFailed('k1', P, { id: 'u1' });
  assert.strictEqual(resumed.status, 'sending');
  await sender.runCampaignSends(opts());
  assert.strictEqual(camp().status, 'sent');
  assert.strictEqual(sent.length, 10);
  assert.deepStrictEqual([camp().sentCount, camp().failedCount], [10, 0]);
});

test('sendCampaign returns immediately: draft -> sending; second request is a 409; nothing is sent inline', async () => {
  seed({ contacts: 3, campaignOver: { status: 'draft' } });
  const c = await service.sendCampaign('k1', P, { id: 'u1' });
  assert.strictEqual(c.status, 'sending');
  assert.strictEqual(sent.length, 0);
  await assert.rejects(() => service.sendCampaign('k1', P, { id: 'u1' }), { statusCode: 409 });
});

test('sendCampaign: 422 without a postal address; 404 for another hotel; SMS refused in production', async () => {
  seed({ campaignOver: { status: 'draft' } });
  db.properties[0].address = '  ';
  await assert.rejects(() => service.sendCampaign('k1', P, { id: 'u1' }), { statusCode: 422 });
  assert.strictEqual(camp().status, 'draft');
  await assert.rejects(() => service.sendCampaign('k1', 'other', { id: 'u1' }), { statusCode: 404 });

  db.properties[0].address = '1 Main St';
  camp().channel = 'sms';
  const prev = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => service.sendCampaign('k1', P, { id: 'u1' }), { statusCode: 422 });
  } finally {
    env.NODE_ENV = prev;
  }
});

test('cancel / retry guards and idempotency; recipients list is tenant-scoped and paginated', async () => {
  seed({ contacts: 3, campaignOver: { status: 'draft' } });
  await assert.rejects(() => service.cancelCampaign('k1', P, { id: 'u1' }), { statusCode: 409 });
  await assert.rejects(() => service.retryFailed('k1', P, { id: 'u1' }), { statusCode: 409 });

  camp().status = 'sending';
  await service.cancelCampaign('k1', P, { id: 'u1' });
  const again = await service.cancelCampaign('k1', P, { id: 'u1' });
  assert.strictEqual(again.status, 'cancelled');
  await assert.rejects(() => service.retryFailed('k1', P, { id: 'u1' }), { statusCode: 409 }, 'cancelled campaigns are not retryable');

  db.recipients.push(...[1, 2, 3].map((n) => ({ id: `rr${n}`, campaignId: 'k1', contactId: `c0000${n - 1}`, status: 'sent', createdAt: n })));
  const page = await service.listRecipients('k1', P, { page: 1, pageSize: 2, status: 'sent' });
  assert.strictEqual(page.items.length, 2);
  assert.strictEqual(page.total, 3);
  await assert.rejects(() => service.listRecipients('k1', 'other', { page: 1, pageSize: 2 }), { statusCode: 404 });
});

test('retry-failed with nothing to retry is a 409', async () => {
  seed({ contacts: 2 });
  await sender.runCampaignSends(opts());
  assert.strictEqual(camp().status, 'sent');
  await assert.rejects(() => service.retryFailed('k1', P, { id: 'u1' }), { statusCode: 409 });
});

test('a hotel-specific send rate overrides the default (the limiter sees that rate)', async () => {
  seed({ contacts: 5 });
  db.properties[0].campaignSendRatePerSec = 2;
  const counts = {};
  const redis = { incr: async (k) => (counts[k] = (counts[k] || 0) + 1), expire: async () => 1 };
  const sleeps = [];
  let clock = 5_000_000;
  await sender.runCampaignSends(opts({ redis, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, defaultRatePerSec: 100 }));
  assert.strictEqual(sent.length, 5);
  assert.ok(sleeps.length >= 2, 'at 2/sec, 5 messages must have waited for later windows');
  assert.ok(Object.values(counts).every((n) => n <= 3), 'never more than rate+1 hits per window (the +1 is the rejected probe)');
});

// ───────────── pacing unit tests ─────────────
test('waitForSlot lets `perSecond` through per window, then waits for the next window', async () => {
  let clock = 10_000;
  const counts = {};
  const redis = { incr: async (k) => (counts[k] = (counts[k] || 0) + 1), expire: async () => 1 };
  const sleeps = [];
  const o = { now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } };
  await waitForSlot(redis, P, 2, o);
  await waitForSlot(redis, P, 2, o);
  assert.strictEqual(sleeps.length, 0);
  await waitForSlot(redis, P, 2, o);
  assert.strictEqual(sleeps.length, 1);
  assert.ok(sleeps[0] > 0 && sleeps[0] <= 1005);
});

test('waitForSlot falls back to local pacing if Redis is down (slows down, never stops)', async () => {
  const sleeps = [];
  await waitForSlot({ incr: async () => { throw new Error('down'); } }, P, 4, { now: Date.now, sleep: async (ms) => sleeps.push(ms) });
  assert.deepStrictEqual(sleeps, [250]);
});

// ───────────── message-build failures (Phase 3 hardening) ─────────────
test('BUILD FAILURE: an error while composing the email is recorded as "build: ..." on the recipient, nothing is stuck in `sending`, and the breaker still trips', async () => {
  seed({ contacts: 4 });
  // A body that explodes when rendered stands in for any template / unsubscribe-link / footer bug.
  camp().body = { toString() { throw new Error('boom: bad template'); } };

  await sender.runCampaignSends(opts({ maxConsecutiveFailures: 3 }));

  assert.strictEqual(sent.length, 0, 'nothing reaches the mail transport');
  assert.strictEqual(statusOf('sending'), 0, 'no recipient is left in limbo to be mislabelled "interrupted"');
  const failed = db.recipients.filter((r) => r.status === 'failed');
  assert.strictEqual(failed.length, 3);
  assert.ok(failed.every((r) => /^build: boom: bad template/.test(r.failureReason)), failed.map((r) => r.failureReason).join('|'));
  assert.strictEqual(camp().status, 'failed');
  assert.match(camp().haltReason, /3 consecutive/);
  assert.strictEqual(statusOf('queued'), 1, 'the rest stay queued for retry-failed');
});

test('SEND TIME: a stored custom from-address on a domain that is no longer allowed is not used', async () => {
  const saved = env.emailAllowedFromDomains;
  try {
    env.emailAllowedFromDomains = ['platform.test'];
    seed({ contacts: 2 });
    db.properties[0].emailFromAddress = 'grand@lapsed.test';
    await sender.runCampaignSends(opts());
    assert.strictEqual(sent.length, 2);
    assert.ok(sent.every((m) => m.from.address === 'noreply@platform.test'), 'falls back to the platform sender');

    seed({ contacts: 1 });
    db.properties[0].emailFromAddress = 'grand@platform.test';
    await sender.runCampaignSends(opts());
    assert.strictEqual(sent[0].from.address, 'grand@platform.test', 'an allowed custom address is still used');
  } finally {
    env.emailAllowedFromDomains = saved;
  }
});
