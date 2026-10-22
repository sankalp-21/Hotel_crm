const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// rateLimit.js imports the Redis client at load time; the tests inject in-memory stores instead.
const redisPath = require.resolve('../src/infrastructure/redis/redis');
require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: { call: async () => null } };

const express = require('express');
const { MemoryStore } = require('express-rate-limit');
const { globalRateLimiter, publicRateLimiter, unsubscribeTokenRateLimiter } = require('../src/shared/middleware/rateLimit');
const { signUnsubscribeToken } = require('../src/modules/unsubscribe/tokens');

const tokenFor = (contactId, now) => signUnsubscribeToken({ contactId, propertyId: 'p1' }, now);

/** Mirrors the real wiring: global limiter on the app, the two public limiters on the unsubscribe router. */
async function withApp({ globalMax, ipMax, tokenMax }, fn) {
  const app = express();
  app.use(globalRateLimiter({ store: new MemoryStore(), max: globalMax }));
  const unsub = express.Router();
  unsub.use(publicRateLimiter({ store: new MemoryStore(), max: ipMax }));
  unsub.use(unsubscribeTokenRateLimiter({ store: new MemoryStore(), max: tokenMax }));
  unsub.all('/', (req, res) => res.json({ ok: true }));
  app.use('/public/unsubscribe', unsub);
  app.all('/public/delivery-events/:id', (req, res) => res.json({ ok: true }));
  app.get('/contacts', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async (method, path) => (await fetch(base + path, { method })).status);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const statuses = async (call, method, paths) => {
  const out = [];
  for (const p of paths) out.push(await call(method, p));
  return out;
};

test('one-click unsubscribes from a shared mail-provider IP are not starved (valid tokens for different contacts)', async () => {
  await withApp({ globalMax: 3, ipMax: 3, tokenMax: 30 }, async (call) => {
    const paths = Array.from({ length: 12 }, (_, i) => `/public/unsubscribe?token=${tokenFor(`contact-${i}`)}`);
    const out = await statuses(call, 'POST', paths);
    assert.deepStrictEqual(out, Array(12).fill(200));
  });
});

test('one leaked valid token cannot hammer the endpoint: limited per contact', async () => {
  await withApp({ globalMax: 100, ipMax: 100, tokenMax: 4 }, async (call) => {
    const path = `/public/unsubscribe?token=${tokenFor('contact-A')}`;
    const out = await statuses(call, 'POST', Array(6).fill(path));
    assert.deepStrictEqual(out, [200, 200, 200, 200, 429, 429]);
    // A different contact from the same IP is unaffected.
    assert.strictEqual(await call('POST', `/public/unsubscribe?token=${tokenFor('contact-B')}`), 200);
  });
});

test('forged, garbage, missing and expired tokens stay under the tight per-IP limit', async () => {
  const expired = tokenFor('contact-X', Date.now() - 400 * 24 * 60 * 60 * 1000);
  const [payload] = tokenFor('contact-Y').split('.');
  const forged = `${payload}.${'A'.repeat(43)}`;
  for (const bad of [forged, 'garbage', expired, '']) {
    await withApp({ globalMax: 100, ipMax: 3, tokenMax: 100 }, async (call) => {
      const path = `/public/unsubscribe?token=${bad}`;
      const out = await statuses(call, 'POST', Array(5).fill(path));
      assert.deepStrictEqual(out, [200, 200, 200, 429, 429], `token "${bad.slice(0, 12)}" should be limited`);
    });
  }
});

test('delivery-event webhooks are not counted by the global per-IP limit (they have their own limiter)', async () => {
  await withApp({ globalMax: 3, ipMax: 3, tokenMax: 3 }, async (call) => {
    const out = await statuses(call, 'POST', Array(10).fill('/public/delivery-events/p1?sig=x'));
    assert.deepStrictEqual(out, Array(10).fill(200));
  });
});

test('ordinary routes are still limited by the global limit', async () => {
  await withApp({ globalMax: 3, ipMax: 3, tokenMax: 3 }, async (call) => {
    const out = await statuses(call, 'GET', Array(5).fill('/contacts'));
    assert.deepStrictEqual(out, [200, 200, 200, 429, 429]);
  });
});

test('a valid token sent to a NON-unsubscribe path does not buy an exemption', async () => {
  await withApp({ globalMax: 3, ipMax: 3, tokenMax: 3 }, async (call) => {
    const out = await statuses(call, 'GET', Array(5).fill(`/contacts?token=${tokenFor('contact-Z')}`));
    assert.deepStrictEqual(out, [200, 200, 200, 429, 429]);
  });
});
