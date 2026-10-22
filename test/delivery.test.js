const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { db, fakePrisma } = require('./helpers/fakeDb');
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('../src/infrastructure/db/prisma', fakePrisma);
stub('../src/infrastructure/redis/redis', {
  call: async (...args) => (args[0] === 'SCRIPT' ? 'sha' : [1, 60000]),
  incr: async () => 1, expire: async () => 1, ping: async () => 'PONG', disconnect: () => {},
});

const sent = [];
let sendError = null;
let messageSeq = 0;
stub('../src/modules/notifications/channel', {
  globalFrom: () => ({ name: 'Platform', address: 'noreply@platform.test' }),
  send: async (m) => {
    const err = sendError?.(m);
    if (err) throw err;
    sent.push(m);
    return { success: true, messageId: `<m${++messageSeq}@x>` };
  },
});

const env = require('../src/config/env');
const sender = require('../src/modules/campaigns/sender');
const deliveries = require('../src/modules/deliveries/service');
const { classifySmtpError } = require('../src/modules/deliveries/classify');
const { signPropertyWebhook, verifyPropertyWebhook } = require('../src/modules/deliveries/signature');
const { resolveSender } = require('../src/modules/property/senderIdentity');
const senderSettings = require('../src/modules/property/senderSettings');
const { senderSettingsSchema } = require('../src/modules/property/validator');
const createApp = require('../src/app');

const P = 'p1';
const noSleep = async () => {};
const opts = (o = {}) => ({ owner: 'w', sleep: noSleep, redis: { incr: async () => 1, expire: async () => 1 }, ...o });
const smtpErr = (responseCode, response, message = response) => Object.assign(new Error(message), { responseCode, response });
const camp = (id = 'k1') => db.campaigns.find((c) => c.id === id);

function seed({ contacts = 3, prop = {} } = {}) {
  for (const k of ['campaigns', 'recipients', 'contacts', 'segments', 'properties', 'suppressions', 'notifications', 'outbox', 'audits']) db[k] = [];
  sent.length = 0;
  sendError = null;
  db.properties.push({ id: P, name: 'Grand Hotel', address: '1 Main St', campaignSendRatePerSec: null, emailFromName: null, emailFromAddress: null, emailReplyTo: null, ...prop });
  db.segments.push({ id: 's1', propertyId: P, filters: {} });
  for (let i = 0; i < contacts; i += 1) {
    db.contacts.push({ id: `c${i}`, propertyId: P, fullName: `N${i}`, email: `c${i}@x.com`, phone: null, status: 'lead', marketingConsent: true, unsubscribedAt: null, emailBounced: false });
  }
  addCampaign('k1');
}
function addCampaign(id, over = {}) {
  db.campaigns.push({
    id, propertyId: P, segmentId: 's1', name: 'C', channel: 'email', subject: 'Hi', body: 'Hello', status: 'sending',
    totalRecipients: 0, sentCount: 0, skippedCount: 0, failedCount: 0, bouncedCount: 0, complainedCount: 0,
    preparedAt: null, prepareCursor: null, leaseOwner: null, leaseUntil: null, lastProgressAt: new Date(0), ...over,
  });
}
const recipientOf = (contactId, campaignId = 'k1') => db.recipients.find((r) => r.contactId === contactId && r.campaignId === campaignId);
const contact = (id) => db.contacts.find((c) => c.id === id);

// ───────────── SMTP error classification ─────────────
test('classifySmtpError: only a dead address is a hard bounce; policy/reputation/outage never suppress', () => {
  const kind = (e) => classifySmtpError(e).kind;
  assert.strictEqual(kind(smtpErr(550, '550 5.1.1 <a@b.com>: User unknown')), 'hard_bounce');
  assert.strictEqual(kind(smtpErr(553, '553 mailbox name not allowed')), 'hard_bounce');
  assert.strictEqual(kind(smtpErr(550, '550 5.7.1 Message blocked by policy')), 'rejected');
  assert.strictEqual(kind(smtpErr(554, '554 Transaction failed')), 'rejected');
  assert.strictEqual(kind(smtpErr(552, '552 5.2.2 Mailbox full')), 'soft_bounce');
  assert.strictEqual(kind(smtpErr(451, '451 4.7.1 Greylisted, try later')), 'transient');
  assert.strictEqual(kind(new Error('connect ETIMEDOUT 10.0.0.1:587')), 'transient');
});

// ───────────── send-time bounce handling ─────────────
test('hard bounce at send time: recipient bounced, address suppressed, contact flagged, counted as bounced not failed', async () => {
  seed({ contacts: 3 });
  sendError = (m) => (m.to === 'c1@x.com' ? smtpErr(550, '550 5.1.1 User unknown') : null);
  await sender.runCampaignSends(opts());

  const r = recipientOf('c1');
  assert.strictEqual(r.status, 'bounced');
  assert.ok(r.bouncedAt);
  assert.strictEqual(contact('c1').emailBounced, true);
  assert.deepStrictEqual(db.suppressions.map((s) => [s.address, s.reason]), [['c1@x.com', 'bounced']]);
  assert.deepStrictEqual([camp().sentCount, camp().bouncedCount, camp().failedCount], [2, 1, 0]);
  assert.strictEqual(camp().status, 'sent');

  // the NEXT campaign never tries that address again
  addCampaign('k2');
  await sender.runCampaignSends(opts());
  const again = recipientOf('c1', 'k2');
  assert.deepStrictEqual([again.status, again.failureReason], ['skipped', 'bounced']);
});

test('bounces are not an outage: they never trip the circuit breaker; an all-bounce campaign ends failed (retryable)', async () => {
  seed({ contacts: 10 });
  sendError = () => smtpErr(550, '550 5.1.1 User unknown');
  await sender.runCampaignSends(opts({ maxConsecutiveFailures: 3 }));
  assert.strictEqual(camp().haltReason ?? null, null);
  assert.strictEqual(camp().bouncedCount, 10);
  assert.strictEqual(camp().status, 'failed');
});

test('policy rejections and transient errors are plain failures: nothing suppressed, nothing flagged', async () => {
  seed({ contacts: 2 });
  sendError = (m) => (m.to === 'c0@x.com' ? smtpErr(550, '550 5.7.1 blocked by policy') : smtpErr(451, '451 4.7.1 try later'));
  await sender.runCampaignSends(opts());
  assert.strictEqual(db.suppressions.length, 0);
  assert.ok(db.contacts.every((c) => c.emailBounced === false));
  assert.match(recipientOf('c0').failureReason, /^rejected:/);
  assert.match(recipientOf('c1').failureReason, /^transient:/);
  assert.strictEqual(camp().failedCount, 2);
});

test('provider message id is stored on the recipient for later matching', async () => {
  seed({ contacts: 1 });
  await sender.runCampaignSends(opts());
  assert.match(recipientOf('c0').providerMessageId, /^<m\d+@x>$/);
});

// ───────────── sender identity ─────────────
test('resolveSender: hotel name by default, hotel address/reply-to when configured, global fallback', () => {
  const g = { name: 'Platform', address: 'noreply@platform.test' };
  assert.deepStrictEqual(resolveSender({ name: 'Grand' }, g), { from: { name: 'Grand', address: 'noreply@platform.test' }, replyTo: undefined });
  assert.deepStrictEqual(
    resolveSender({ name: 'Grand', emailFromName: 'Grand Reservations', emailFromAddress: 'grand@platform.test', emailReplyTo: 'desk@grand.test' }, g),
    { from: { name: 'Grand Reservations', address: 'grand@platform.test' }, replyTo: 'desk@grand.test' }
  );
  assert.strictEqual(resolveSender({ name: 'Grand' }, { name: '', address: '' }).from, undefined);
});

test('campaign email goes out with the hotel identity and reply-to', async () => {
  seed({ contacts: 1, prop: { emailFromName: 'Grand Reservations', emailFromAddress: 'grand@platform.test', emailReplyTo: 'desk@grand.test' } });
  await sender.runCampaignSends(opts());
  assert.deepStrictEqual(sent[0].from, { name: 'Grand Reservations', address: 'grand@platform.test' });
  assert.strictEqual(sent[0].replyTo, 'desk@grand.test');
});

test('with no identity configured the hotel name is shown on the shared address', async () => {
  seed({ contacts: 1 });
  await sender.runCampaignSends(opts());
  assert.deepStrictEqual(sent[0].from, { name: 'Grand Hotel', address: 'noreply@platform.test' });
  assert.strictEqual(sent[0].replyTo, undefined);
});

// ───────────── sender settings (allow-list, validation, audit) ─────────────
test('from-address must be on an allowed domain; production with no allow-list refuses custom addresses', async () => {
  seed({ contacts: 0 });
  const prevDomains = env.emailAllowedFromDomains;
  const prevEnv = env.NODE_ENV;
  try {
    env.emailAllowedFromDomains = ['platform.test'];
    const ok = await senderSettings.updateSenderSettings(P, { emailFromAddress: 'grand@platform.test', emailFromName: 'Grand' }, { id: 'u1' });
    assert.strictEqual(ok.effective.fromAddress, 'grand@platform.test');
    await assert.rejects(() => senderSettings.updateSenderSettings(P, { emailFromAddress: 'ceo@bigbank.com' }, { id: 'u1' }), { statusCode: 422 });

    env.emailAllowedFromDomains = [];
    env.NODE_ENV = 'production';
    await assert.rejects(() => senderSettings.updateSenderSettings(P, { emailFromAddress: 'grand@platform.test' }, { id: 'u1' }), { statusCode: 422 });
    env.NODE_ENV = 'development';
    await senderSettings.updateSenderSettings(P, { emailFromAddress: 'grand@anything.test' }, { id: 'u1' });
  } finally {
    env.emailAllowedFromDomains = prevDomains;
    env.NODE_ENV = prevEnv;
  }
});

test('settings audit logs field names only; reply-to is free; null clears; webhook URL is signed for this property', async () => {
  seed({ contacts: 0 });
  const s = await senderSettings.updateSenderSettings(P, { emailReplyTo: 'desk@grand.test' }, { id: 'u1' });
  assert.strictEqual(s.emailReplyTo, 'desk@grand.test');
  const audit = db.audits.find((a) => a.action === 'property.sender_updated');
  assert.deepStrictEqual(audit.metadata, { changedFields: ['emailReplyTo'] });
  assert.ok(!JSON.stringify(audit).includes('grand.test'));

  const cleared = await senderSettings.updateSenderSettings(P, { emailReplyTo: null }, { id: 'u1' });
  assert.strictEqual(cleared.emailReplyTo, null);

  const sig = new URL(s.deliveryWebhookUrl).searchParams.get('sig');
  assert.ok(verifyPropertyWebhook(P, sig));
  assert.ok(!verifyPropertyWebhook('other', sig), 'a signature is only good for its own property');
});

test('validator rejects header-injection / spoofing characters in the from-name and bad addresses', () => {
  for (const bad of ['Evil\r\nBcc: x@y.com', 'Boss <ceo@bank.com>', 'say "hi"']) {
    assert.ok(!senderSettingsSchema.safeParse({ emailFromName: bad }).success, bad);
  }
  assert.ok(!senderSettingsSchema.safeParse({ emailFromAddress: 'not-an-email' }).success);
  assert.ok(!senderSettingsSchema.safeParse({}).success);
  assert.ok(senderSettingsSchema.safeParse({ emailFromName: 'Grand Hotel & Spa' }).success);
});

// ───────────── provider delivery events ─────────────
function seedSentCampaign() {
  seed({ contacts: 3 });
  Object.assign(camp(), { status: 'sent', preparedAt: new Date(), totalRecipients: 3, sentCount: 3 });
  db.contacts.forEach((c, i) =>
    db.recipients.push({ id: `r${i}`, campaignId: 'k1', contactId: c.id, recipientEmail: c.email, status: 'sent', sentAt: new Date(1000 + i), providerMessageId: `<pm${i}@x>`, createdAt: i })
  );
}

test('hard bounce event (matched by message id): recipient bounced, address suppressed, contact flagged, counts moved once', async () => {
  seedSentCampaign();
  const ev = { type: 'bounce', bounceType: 'hard', messageId: '<pm1@x>', reason: 'mailbox gone' };
  assert.deepStrictEqual(await deliveries.applyEvents(P, [ev]), { received: 1, applied: 1, ignored: 0 });
  await deliveries.applyEvents(P, [ev]); // provider retry: must be idempotent

  assert.strictEqual(recipientOf('c1').status, 'bounced');
  assert.strictEqual(contact('c1').emailBounced, true);
  assert.deepStrictEqual(db.suppressions.map((s) => [s.address, s.reason]), [['c1@x.com', 'bounced']]);
  assert.deepStrictEqual([camp().sentCount, camp().bouncedCount], [2, 1]);
});

test('bounce matched by address alone (case-insensitive) works the same', async () => {
  seedSentCampaign();
  await deliveries.applyEvents(P, [{ type: 'bounce', bounceType: 'hard', address: 'C2@X.COM' }]);
  assert.strictEqual(recipientOf('c2').status, 'bounced');
  assert.strictEqual(contact('c2').emailBounced, true);
});

test('complaint = opt-out: contact unsubscribed, address suppressed as complaint, counted once', async () => {
  seedSentCampaign();
  const ev = { type: 'complaint', address: 'c0@x.com' };
  await deliveries.applyEvents(P, [ev]);
  await deliveries.applyEvents(P, [ev]);
  const c = contact('c0');
  assert.ok(c.unsubscribedAt);
  assert.strictEqual(c.marketingConsent, false);
  assert.deepStrictEqual(db.suppressions.map((s) => s.reason), ['complaint']);
  assert.ok(recipientOf('c0').complainedAt);
  assert.strictEqual(camp().complainedCount, 1);
  assert.strictEqual(recipientOf('c0').status, 'sent', 'a complaint does not rewrite the delivery status');
});

test('delivered sets deliveredAt; soft bounce keeps the address; unknown recipient is ignored', async () => {
  seedSentCampaign();
  const out = await deliveries.applyEvents(P, [
    { type: 'delivered', messageId: '<pm0@x>' },
    { type: 'bounce', bounceType: 'soft', messageId: '<pm1@x>', reason: 'mailbox full' },
    { type: 'delivered', messageId: '<nope@x>' },
  ]);
  assert.deepStrictEqual(out, { received: 3, applied: 2, ignored: 1 });
  assert.ok(recipientOf('c0').deliveredAt);
  assert.strictEqual(recipientOf('c1').status, 'sent');
  assert.match(recipientOf('c1').failureReason, /^soft_bounce/);
  assert.strictEqual(db.suppressions.length, 0);
  assert.strictEqual(contact('c1').emailBounced, false);
});

test('events are scoped to their property: another hotel\'s recipient id is not touched', async () => {
  seedSentCampaign();
  db.properties.push({ id: 'p2', name: 'Other' });
  await deliveries.applyEvents('p2', [{ type: 'bounce', bounceType: 'hard', recipientId: 'r0' }]);
  assert.strictEqual(recipientOf('c0').status, 'sent');
  assert.strictEqual(camp().bouncedCount, 0);
  assert.strictEqual(contact('c0').emailBounced, false);
});

// ───────────── the webhook over HTTP ─────────────
async function withServer(fn) {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bounceBody = { events: [{ type: 'bounce', bounceType: 'hard', address: 'c1@x.com' }] };

test('webhook: bad or foreign signature -> 401 and nothing changes', async () => {
  seedSentCampaign();
  await withServer(async (base) => {
    for (const sig of ['nope', signPropertyWebhook('some-other-property'), '']) {
      const res = await post(base, `/public/delivery-events/${P}?sig=${sig}`, bounceBody);
      assert.strictEqual(res.status, 401, `sig=${sig}`);
    }
    assert.strictEqual(contact('c1').emailBounced, false);
    assert.strictEqual(db.suppressions.length, 0);
  });
});

test('webhook: valid signature processes the batch and answers 200 with a summary', async () => {
  seedSentCampaign();
  await withServer(async (base) => {
    const res = await post(base, `/public/delivery-events/${P}?sig=${signPropertyWebhook(P)}`, bounceBody);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { received: 1, applied: 1, ignored: 0 });
    assert.strictEqual(recipientOf('c1').status, 'bounced');
  });
});

test('webhook: malformed payloads are 422 (the API\'s validation status); a signed URL for a deleted property is 404', async () => {
  seedSentCampaign();
  await withServer(async (base) => {
    const url = `/public/delivery-events/${P}?sig=${signPropertyWebhook(P)}`;
    assert.strictEqual((await post(base, url, { events: [] })).status, 422);
    assert.strictEqual((await post(base, url, { events: [{ type: 'bounce' }] })).status, 422, 'needs an identifier');
    assert.strictEqual((await post(base, url, { events: [{ type: 'explode', address: 'a@b.com' }] })).status, 422);
    assert.strictEqual((await post(base, url, { events: Array(501).fill({ type: 'delivered', address: 'a@b.com' }) })).status, 422);
    const gone = await post(base, `/public/delivery-events/ghost?sig=${signPropertyWebhook('ghost')}`, bounceBody);
    assert.strictEqual(gone.status, 404);
  });
});

// ---------- Phase 3 hardening: sender policy re-applied at send time ----------
const { isFromAddressAllowed } = require('../src/modules/property/senderIdentity');

test('resolveSender with a policy ignores a stored custom address whose domain is no longer allowed', () => {
  const g = { name: 'Platform', address: 'noreply@platform.test' };
  const property = { name: 'Grand', emailFromAddress: 'grand@gone.test', emailReplyTo: 'desk@grand.test' };
  const out = resolveSender(property, g, { allowedDomains: ['platform.test'], nodeEnv: 'production' });
  assert.deepStrictEqual(out, { from: { name: 'Grand', address: 'noreply@platform.test' }, replyTo: 'desk@grand.test' });

  const ok = resolveSender({ ...property, emailFromAddress: 'grand@platform.test' }, g, { allowedDomains: ['platform.test'], nodeEnv: 'production' });
  assert.strictEqual(ok.from.address, 'grand@platform.test');
});

test('isFromAddressAllowed: allow-list wins; empty list means "dev only"', () => {
  const p = (allowedDomains, nodeEnv) => ({ allowedDomains, nodeEnv });
  assert.strictEqual(isFromAddressAllowed('a@Platform.test', p(['platform.test'], 'production')), true);
  assert.strictEqual(isFromAddressAllowed('a@other.test', p(['platform.test'], 'development')), false);
  assert.strictEqual(isFromAddressAllowed('a@other.test', p([], 'production')), false);
  assert.strictEqual(isFromAddressAllowed('a@other.test', p([], 'development')), true);
});
