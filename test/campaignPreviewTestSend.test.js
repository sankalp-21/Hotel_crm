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
  call: async (...args) => (args[0] === 'SCRIPT' ? 'sha' : [1, 60000]), // limiter store: never trips here
  incr: async () => 1,
  expire: async () => 1,
});

// Mail transport: records every message; can be made to fail.
const sent = [];
let failSend = false;
stub('../src/modules/notifications/channel', {
  globalFrom: () => ({ name: 'Platform', address: 'noreply@platform.test' }),
  send: async (m) => {
    if (failSend) throw new Error('SMTP exploded: secret-host.internal:587 auth failed');
    sent.push(m);
    return { success: true };
  },
});

// Permission gate: tests decide which permission codes the caller holds.
const { ForbiddenError } = require('../src/shared/errors/AppError');
let granted = new Set();
const asked = [];
stub('../src/shared/middleware/rbac', {
  requirePermission: (code) => (req, res, next) => {
    asked.push(code);
    return granted.has(code) ? next() : next(new ForbiddenError(`Missing permission "${code}" for this property`));
  },
  requirePlatformAdmin: () => (req, res, next) => next(),
});
stub('../src/shared/middleware/authenticate', {
  authenticate: (req, res, next) => {
    req.user = { id: req.headers['x-user'] || 'u1' };
    next();
  },
});

const express = require('express');
const { MemoryStore } = require('express-rate-limit');
const service = require('../src/modules/campaigns/service');
const campaignRoutes = require('../src/modules/campaigns/routes');
const { errorHandler } = require('../src/shared/errors/errorHandler');
const { testSendRateLimiter } = require('../src/shared/middleware/rateLimit');
const { verifyUnsubscribeToken, signUnsubscribeToken } = require('../src/modules/unsubscribe/tokens');
const env = require('../src/config/env');

const P1 = 'p1';
const P2 = 'p2';
const C1 = '00000000-0000-4000-8000-0000000000c1'; // contact in P1
const C2 = '00000000-0000-4000-8000-0000000000c2'; // contact in P2
const ACTOR = { id: 'u1' };

function seed(campaignOver = {}) {
  for (const k of ['campaigns', 'recipients', 'contacts', 'segments', 'properties', 'suppressions', 'notifications', 'outbox', 'audits', 'users', 'userRoles']) db[k] = [];
  sent.length = 0;
  asked.length = 0;
  failSend = false;
  granted = new Set();
  db.properties.push({ id: P1, name: 'Grand', address: '1 Main St', emailFromName: null, emailFromAddress: null, emailReplyTo: 'desk@grand.test' });
  db.properties.push({ id: P2, name: 'Other', address: '2 Side St' });
  db.users.push(
    { id: 'u1', email: 'manager@grand.test', isActive: true },
    { id: 'u2', email: 'former@grand.test', isActive: false },
    { id: 'u3', email: 'someone@other.test', isActive: true }
  );
  db.userRoles.push({ id: 'r1', userId: 'u1', propertyId: P1 }, { id: 'r2', userId: 'u2', propertyId: P1 }, { id: 'r3', userId: 'u3', propertyId: P2 });
  db.contacts.push(
    { id: C1, propertyId: P1, fullName: 'Zoë <b>Bold</b>', email: 'zoe@guest.test', phone: '+1 555 0111', marketingConsent: true, unsubscribedAt: null, emailBounced: false, status: 'lead' },
    { id: C2, propertyId: P2, fullName: 'Other Tenant', email: 'o@guest.test', phone: null, marketingConsent: true, unsubscribedAt: null, emailBounced: false, status: 'lead' }
  );
  db.segments.push({ id: 's1', propertyId: P1, filters: {} });
  db.campaigns.push({
    id: 'k1', propertyId: P1, segmentId: 's1', name: 'Autumn', channel: 'email', subject: 'Hello {{ fullName }}', body: 'Hi {{fullName}}, we have your email {{email}}.',
    status: 'draft', totalRecipients: 0, sentCount: 0, skippedCount: 0, failedCount: 0, bouncedCount: 0, ...campaignOver,
  });
  db.campaigns.push({ id: 'k2', propertyId: P2, segmentId: 's2', name: 'Theirs', channel: 'email', subject: 'S', body: 'B', status: 'draft' });
}

/** Everything a preview / test send must leave untouched (audit is checked separately). */
const stateSnapshot = () =>
  JSON.stringify({ campaigns: db.campaigns, recipients: db.recipients, notifications: db.notifications, outbox: db.outbox, contacts: db.contacts, suppressions: db.suppressions });

// ───────────── preview (service) ─────────────
test('PREVIEW with the sample contact: rendered subject, text with footer, escaped html, sender identity', async () => {
  seed();
  const p = await service.previewCampaign('k1', P1, {});
  assert.strictEqual(p.subject, 'Hello Alex Sample');
  assert.match(p.text, /^Hi Alex Sample, we have your email alex\.sample@example\.com\./);
  assert.match(p.text, /\n--\nGrand\n1 Main St\nUnsubscribe: /);
  assert.match(p.html, /Hi Alex Sample/);
  assert.deepStrictEqual(p.contact, { id: null, fullName: 'Alex Sample', sample: true });
  assert.deepStrictEqual(p.from, { name: 'Grand', address: 'noreply@platform.test' });
  assert.strictEqual(p.replyTo, 'desk@grand.test');
  assert.deepStrictEqual(p.warnings, { unknownPlaceholders: [], missingPostalAddress: false });
  assert.strictEqual(sent.length, 0, 'a preview sends nothing');
});

test('PREVIEW as a real contact of this hotel: values are rendered and HTML-escaped', async () => {
  seed();
  const p = await service.previewCampaign('k1', P1, { contactId: C1 });
  assert.strictEqual(p.subject, 'Hello Zoë <b>Bold</b>'); // subject is plain text
  assert.match(p.text, /we have your email zoe@guest\.test/);
  assert.ok(!p.html.includes('<b>Bold</b>'), 'markup in a contact name must not reach the html part');
  assert.match(p.html, /Zoë &lt;b&gt;Bold&lt;\/b&gt;/);
  assert.deepStrictEqual(p.contact, { id: C1, fullName: 'Zoë <b>Bold</b>', sample: false });
});

test('PREVIEW never carries a working unsubscribe token (safe to share), for the sample or a real contact', async () => {
  seed();
  for (const opts of [{}, { contactId: C1 }]) {
    const p = await service.previewCampaign('k1', P1, opts);
    const links = [...(p.text + p.html).matchAll(/token=([^\s"<&]+)/g)].map((m) => m[1]);
    assert.ok(links.length >= 2, 'text and html both carry the link');
    for (const token of links) assert.strictEqual(verifyUnsubscribeToken(token), null, 'preview link must be inert');
  }
  // sanity check of the test itself: a genuine token WOULD verify
  assert.ok(verifyUnsubscribeToken(signUnsubscribeToken({ contactId: C1, propertyId: P1 })));
});

test('PREVIEW is tenant-scoped: another hotel campaign, or another hotel contact, is a 404', async () => {
  seed();
  await assert.rejects(() => service.previewCampaign('k2', P1, {}), { statusCode: 404 });
  await assert.rejects(() => service.previewCampaign('k1', P1, { contactId: C2 }), { statusCode: 404 });
  await assert.rejects(() => service.previewCampaign('k1', P1, { contactId: '00000000-0000-4000-8000-00000000ffff' }), { statusCode: 404 });
  await assert.rejects(() => service.previewCampaign('k1', P2, {}), { statusCode: 404 }, 'P2 cannot see P1 campaign');
});

test('PREVIEW touches no campaign state', async () => {
  seed();
  const before = stateSnapshot();
  const auditsBefore = db.audits.length;
  await service.previewCampaign('k1', P1, {});
  await service.previewCampaign('k1', P1, { contactId: C1 });
  assert.strictEqual(stateSnapshot(), before);
  assert.strictEqual(db.audits.length, auditsBefore, 'reads are not audited');
});

test('PREVIEW works in any status and warns about unknown placeholders and a missing postal address', async () => {
  seed({ status: 'sent', subject: 'Hi {{nick}}', body: 'Body {{ city }} {{fullName}}' });
  db.properties[0].address = '  ';
  const p = await service.previewCampaign('k1', P1, {});
  assert.deepStrictEqual(p.warnings, { unknownPlaceholders: ['nick', 'city'], missingPostalAddress: true });
  assert.strictEqual(p.subject, 'Hi {{nick}}', 'unknown placeholders stay visible as written');
});

test('PREVIEW of an SMS campaign: plain text only, no subject, no html, no sender', async () => {
  seed({ channel: 'sms', subject: null, body: 'Hi {{fullName}}' });
  const p = await service.previewCampaign('k1', P1, {});
  assert.deepStrictEqual({ subject: p.subject, text: p.text, html: p.html, from: p.from }, { subject: null, text: 'Hi Alex Sample', html: null, from: null });
});

// ───────────── test send (service) ─────────────
test('TEST SEND to a staff member: one message, [TEST] subject, same sender and footer, inert unsubscribe, no List-Unsubscribe headers', async () => {
  seed();
  const out = await service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR);
  assert.deepStrictEqual(out, { sent: true, subject: '[TEST] Hello Alex Sample' });
  assert.strictEqual(sent.length, 1);
  const m = sent[0];
  assert.strictEqual(m.to, 'manager@grand.test');
  assert.strictEqual(m.subject, '[TEST] Hello Alex Sample');
  assert.deepStrictEqual(m.from, { name: 'Grand', address: 'noreply@platform.test' });
  assert.strictEqual(m.replyTo, 'desk@grand.test');
  assert.match(m.body, /\n--\nGrand\n1 Main St\nUnsubscribe: /);
  assert.match(m.html, /Unsubscribe<\/a>/);
  assert.strictEqual(m.headers, undefined, 'no one-click unsubscribe headers on a test');
  for (const token of [...(m.body + m.html).matchAll(/token=([^\s"<&]+)/g)].map((x) => x[1])) {
    assert.strictEqual(verifyUnsubscribeToken(token), null);
  }
});

test('TEST SEND matches the staff address case-insensitively', async () => {
  seed();
  await service.testSendCampaign('k1', P1, { to: 'Manager@Grand.TEST' }, ACTOR);
  assert.strictEqual(sent.length, 1);
});

test('TEST SEND changes no campaign state (status, counters, recipients, notifications, outbox); audit has actor + campaign, never the address', async () => {
  seed();
  const before = stateSnapshot();
  await service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR);
  assert.strictEqual(stateSnapshot(), before);
  assert.strictEqual(db.audits.length, 1);
  const [a] = db.audits;
  assert.strictEqual(a.action, 'campaign.test_sent');
  assert.strictEqual(a.userId, 'u1');
  assert.strictEqual(a.entityId, 'k1');
  assert.strictEqual(a.propertyId, P1);
  assert.ok(!JSON.stringify(a).includes('grand.test'), 'the recipient address is not audited');
});

test('TEST SEND is not an open relay: strangers, deactivated users and other hotels staff are all rejected the same way', async () => {
  seed();
  const messages = new Set();
  for (const to of ['friend@gmail.test', 'former@grand.test', 'someone@other.test', 'zoe@guest.test']) {
    await assert.rejects(
      () => service.testSendCampaign('k1', P1, { to }, ACTOR),
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        messages.add(err.message);
        return true;
      }
    );
  }
  assert.strictEqual(messages.size, 1, 'one message for every rejection (no probing which addresses exist)');
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db.audits.length, 0);
});

test("TEST SEND: another hotel's campaign is a 404 and nothing is sent", async () => {
  seed();
  await assert.rejects(() => service.testSendCampaign('k2', P1, { to: 'manager@grand.test' }, ACTOR), { statusCode: 404 });
  await assert.rejects(() => service.testSendCampaign('k1', P2, { to: 'someone@other.test' }, { id: 'u3' }), { statusCode: 404 });
  assert.strictEqual(sent.length, 0);
});

test('TEST SEND guards: SMS campaigns, unknown placeholders (listed), missing subject', async () => {
  seed({ channel: 'sms', subject: null });
  await assert.rejects(() => service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR), { statusCode: 422 });

  seed({ subject: 'Hi {{nick}}', body: 'B {{fullName}} {{city}}' });
  await assert.rejects(
    () => service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR),
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.deepStrictEqual(err.details.unknownPlaceholders, ['nick', 'city']);
      return true;
    }
  );

  seed({ subject: null });
  await assert.rejects(() => service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR), { statusCode: 422 });
  assert.strictEqual(sent.length, 0);
});

test('TEST SEND when the mail transport fails: a clean 502 without SMTP internals, nothing recorded', async () => {
  seed();
  failSend = true;
  const before = stateSnapshot();
  await assert.rejects(
    () => service.testSendCampaign('k1', P1, { to: 'manager@grand.test' }, ACTOR),
    (err) => {
      assert.strictEqual(err.statusCode, 502);
      assert.strictEqual(err.code, 'EMAIL_SEND_FAILED');
      assert.ok(!/secret-host|SMTP exploded/.test(err.message), 'transport details never reach the client');
      return true;
    }
  );
  assert.strictEqual(stateSnapshot(), before);
  assert.strictEqual(db.audits.length, 0, 'a send that did not happen is not audited');
});

// ───────────── real sends use the same parser (one source of truth) ─────────────
test('SEND: a draft saved with an unknown placeholder before validation existed is refused with a 422 (never emailed literally)', async () => {
  seed({ body: 'Hello {{nickname}}' });
  await assert.rejects(
    () => service.sendCampaign('k1', P1, ACTOR),
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.match(err.message, /\{\{nickname\}\}/);
      return true;
    }
  );
  assert.strictEqual(db.campaigns[0].status, 'draft', 'the campaign stays an editable draft');
});

test('SEND: a draft using spaced placeholders is accepted', async () => {
  seed({ subject: 'Hi {{ fullName }}', body: '{{ email }}' });
  const c = await service.sendCampaign('k1', P1, ACTOR);
  assert.strictEqual(c.status, 'sending');
});

// ───────────── HTTP: routes, permissions, validation ─────────────
async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/campaigns', campaignRoutes);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, property = P1, user = 'u1' } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-property-id': property, 'x-user': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await fn(call);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('HTTP preview: campaigns:read is enough for the sample; a real contact also needs contacts:read', async () => {
  seed();
  await withServer(async (call) => {
    granted = new Set();
    assert.strictEqual((await call('GET', '/campaigns/k1/preview')).status, 403);

    granted = new Set(['campaigns:read']);
    let r = await call('GET', '/campaigns/k1/preview');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.contact.sample, true);

    r = await call('GET', `/campaigns/k1/preview?contactId=${C1}`);
    assert.strictEqual(r.status, 403, 'campaigns:read alone must not expose a real contact');
    assert.match(r.json.error.message, /contacts:read/);

    granted = new Set(['campaigns:read', 'contacts:read']);
    r = await call('GET', `/campaigns/k1/preview?contactId=${C1}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.contact.id, C1);

    assert.strictEqual((await call('GET', '/campaigns/k1/preview?contactId=not-a-uuid')).status, 422);
    assert.strictEqual((await call('GET', `/campaigns/k1/preview?contactId=${C2}`)).status, 404, "another hotel's contact");
    assert.strictEqual((await call('GET', '/campaigns/k2/preview', { property: P1 })).status, 404, "another hotel's campaign");
  });
});

test('HTTP test-send: needs campaigns:send; validates the body; sends one email', async () => {
  seed();
  await withServer(async (call) => {
    granted = new Set(['campaigns:read']);
    let r = await call('POST', '/campaigns/k1/test-send', { body: { to: 'manager@grand.test' } });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(sent.length, 0);

    granted = new Set(['campaigns:send']);
    assert.strictEqual((await call('POST', '/campaigns/k1/test-send', { body: {} })).status, 422);
    assert.strictEqual((await call('POST', '/campaigns/k1/test-send', { body: { to: 'not-an-email' } })).status, 422);
    assert.strictEqual((await call('POST', '/campaigns/k1/test-send', { body: { to: ['a@b.co', 'c@d.co'] } })).status, 422, 'exactly one recipient');
    assert.strictEqual(sent.length, 0);

    r = await call('POST', '/campaigns/k1/test-send', { body: { to: 'manager@grand.test' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { sent: true, subject: '[TEST] Hello Alex Sample' });
    assert.strictEqual(sent.length, 1);

    r = await call('POST', '/campaigns/k1/test-send', { body: { to: 'friend@gmail.test' } });
    assert.strictEqual(r.status, 422);
    r = await call('POST', '/campaigns/k2/test-send', { body: { to: 'manager@grand.test' } });
    assert.strictEqual(r.status, 404, "another hotel's campaign");
    assert.strictEqual(sent.length, 1);
  });
});

test('HTTP test-send is wired with the send permission (and preview with read), nothing else', async () => {
  seed();
  await withServer(async (call) => {
    granted = new Set(['campaigns:send', 'campaigns:read']);
    asked.length = 0;
    await call('POST', '/campaigns/k1/test-send', { body: { to: 'manager@grand.test' } });
    assert.deepStrictEqual(asked, ['campaigns:send']);
    asked.length = 0;
    await call('GET', '/campaigns/k1/preview');
    assert.deepStrictEqual(asked, ['campaigns:read']);
  });
});

// ───────────── rate limit ─────────────
async function withLimited({ max }, fn) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: req.headers['x-user'] };
    next();
  });
  app.post('/t', testSendRateLimiter({ store: new MemoryStore(), max }), (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async (user) => (await fetch(`${base}/t`, { method: 'POST', headers: { 'x-user': user } })).status);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('RATE LIMIT: per user, not per IP: the limit trips for one user while another is unaffected', async () => {
  await withLimited({ max: 3 }, async (call) => {
    const a = [];
    for (let i = 0; i < 5; i += 1) a.push(await call('alice'));
    assert.deepStrictEqual(a, [200, 200, 200, 429, 429]);
    assert.strictEqual(await call('bob'), 200, 'same IP, different user');
  });
});

test('RATE LIMIT: defaults to 10 per hour', () => {
  assert.strictEqual(env.CAMPAIGN_TEST_SEND_MAX_PER_HOUR, 10);
});
