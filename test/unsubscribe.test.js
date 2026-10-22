const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const db = { contacts: new Map(), suppressions: [], audits: [] };
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
const anyModel = new Proxy({}, { get: () => async () => null });
const models = {
  contact: {
    findFirst: async ({ where }) => {
      const c = db.contacts.get(where.id);
      return c && c.propertyId === where.propertyId ? c : null;
    },
    update: async ({ where, data }) => {
      const c = { ...db.contacts.get(where.id), ...data };
      db.contacts.set(where.id, c);
      return c;
    },
  },
  suppressionEntry: {
    findFirst: async ({ where }) =>
      db.suppressions.find((s) => s.propertyId === where.propertyId && s.channel === where.channel && s.address === where.address) || null,
    create: async ({ data }) => {
      const row = { id: `s${db.suppressions.length + 1}`, ...data };
      db.suppressions.push(row);
      return row;
    },
  },
  property: { findUnique: async () => ({ id: 'p1', name: 'Grand <b>Hotel</b>' }) },
  auditLog: { create: async ({ data }) => db.audits.push(data) },
};
stub('../src/infrastructure/db/prisma', new Proxy({}, { get: (_t, k) => (k === '$queryRaw' ? async () => 1 : models[k] || anyModel) }));
stub('../src/infrastructure/redis/redis', {
  call: async (...args) => (args[0] === 'SCRIPT' ? 'sha' : [1, 60000]),
  ping: async () => 'PONG', get: async () => null, incr: async () => 1, expire: async () => 1, del: async () => 1, disconnect: () => {},
});

const createApp = require('../src/app');
const { signUnsubscribeToken, verifyUnsubscribeToken } = require('../src/modules/unsubscribe/tokens');
const { buildMarketingEmail } = require('../src/modules/campaigns/message');

const ids = { contactId: 'c1', propertyId: 'p1', campaignId: 'k1' };

async function withServer(fn) {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test.beforeEach(() => {
  db.contacts.clear(); db.suppressions = []; db.audits = [];
  db.contacts.set('c1', { id: 'c1', propertyId: 'p1', email: 'Guest@Example.com', marketingConsent: true, unsubscribedAt: null });
});

// ---- tokens
test('token round-trips and carries no email address', () => {
  const t = signUnsubscribeToken(ids);
  assert.deepStrictEqual(verifyUnsubscribeToken(t), ids);
  assert.ok(!Buffer.from(t.split('.')[0], 'base64url').toString().includes('@'));
});

test('tampered payload, tampered signature, garbage and oversized tokens are rejected', () => {
  const [payload, sig] = signUnsubscribeToken(ids).split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, c: 'other', p: 'p1', k: null, e: 9999999999 })).toString('base64url');
  assert.strictEqual(verifyUnsubscribeToken(`${forged}.${sig}`), null);
  assert.strictEqual(verifyUnsubscribeToken(`${payload}.${sig.slice(0, -2)}AA`), null);
  assert.strictEqual(verifyUnsubscribeToken('nonsense'), null);
  assert.strictEqual(verifyUnsubscribeToken(undefined), null);
  assert.strictEqual(verifyUnsubscribeToken('a'.repeat(600)), null);
});

test('expired token is rejected, valid for at least 30 days', () => {
  const t = signUnsubscribeToken(ids, Date.now() - 400 * 24 * 3600 * 1000);
  assert.strictEqual(verifyUnsubscribeToken(t), null);
  const fresh = signUnsubscribeToken(ids);
  assert.ok(verifyUnsubscribeToken(fresh, Date.now() + 30 * 24 * 3600 * 1000));
});

// ---- email composition
test('marketing email has footer, link and one-click headers; HTML is escaped', () => {
  const m = buildMarketingEmail({
    renderedBody: 'Hi <script>alert(1)</script>',
    property: { name: 'Grand "Hotel"', address: '1 Main St' },
    unsubscribeUrl: 'https://api.x/public/unsubscribe?token=abc',
  });
  assert.match(m.text, /Grand "Hotel"\n1 Main St\nUnsubscribe: https:\/\/api\.x\/public\/unsubscribe\?token=abc/);
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('href="https://api.x/public/unsubscribe?token=abc"'));
  assert.strictEqual(m.headers['List-Unsubscribe'], '<https://api.x/public/unsubscribe?token=abc>');
  assert.strictEqual(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

// ---- HTTP
test('GET shows a confirmation page and does NOT unsubscribe (scanner-safe)', async () => {
  await withServer(async (base) => {
    const t = signUnsubscribeToken(ids);
    const res = await fetch(`${base}/public/unsubscribe?token=${t}`);
    const body = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(body, /<form method="post"/);
    assert.ok(body.includes('Grand &lt;b&gt;Hotel&lt;/b&gt;'), 'hotel name must be escaped');
    assert.strictEqual(db.contacts.get('c1').unsubscribedAt, null);
    assert.strictEqual(db.suppressions.length, 0);
  });
});

test('POST (one-click) unsubscribes, suppresses the address, audits without PII, and is idempotent', async () => {
  await withServer(async (base) => {
    const t = signUnsubscribeToken(ids);
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`${base}/public/unsubscribe?token=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      });
      assert.strictEqual(res.status, 200);
    }
    const c = db.contacts.get('c1');
    assert.ok(c.unsubscribedAt);
    assert.strictEqual(c.marketingConsent, false);
    assert.strictEqual(db.suppressions.length, 1);
    assert.deepStrictEqual(
      { address: db.suppressions[0].address, reason: db.suppressions[0].reason },
      { address: 'guest@example.com', reason: 'unsubscribed' }
    );
    assert.strictEqual(db.audits.filter((a) => a.action === 'contact.unsubscribed').length, 1);
    assert.ok(!JSON.stringify(db.audits).includes('example.com'));
  });
});

test('invalid token: 400 on GET and POST, nothing changes', async () => {
  await withServer(async (base) => {
    for (const method of ['GET', 'POST']) {
      const res = await fetch(`${base}/public/unsubscribe?token=bogus`, { method });
      assert.strictEqual(res.status, 400);
    }
    assert.strictEqual(db.contacts.get('c1').unsubscribedAt, null);
  });
});

test('token for another property cannot unsubscribe this contact; response does not reveal that', async () => {
  await withServer(async (base) => {
    const t = signUnsubscribeToken({ contactId: 'c1', propertyId: 'other' });
    const res = await fetch(`${base}/public/unsubscribe?token=${t}`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.contacts.get('c1').unsubscribedAt, null);
  });
});
