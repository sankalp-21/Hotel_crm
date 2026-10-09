const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Stub the two infrastructure clients so the whole app can be built without Postgres or Redis.
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
const anyModel = new Proxy({}, { get: () => async () => null });
stub('../src/infrastructure/db/prisma', new Proxy({}, { get: (_t, k) => (k === '$queryRaw' ? async () => 1 : anyModel) }));
stub('../src/infrastructure/redis/redis', {
  call: async (...args) => (args[0] === 'SCRIPT' ? 'sha' : [1, 60000]),
  ping: async () => 'PONG',
  get: async () => null,
  incr: async () => 1,
  expire: async () => 1,
  del: async () => 1,
  disconnect: () => {},
});

const createApp = require('../src/app');

async function withServer(fn) {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('the whole app builds (every route is wired to a real controller function)', () => {
  assert.doesNotThrow(() => createApp());
});

const ID = '11111111-1111-1111-1111-111111111111';
const PROTECTED = [
  ['GET', '/users'],
  ['GET', `/users/${ID}`],
  ['POST', '/users/members'],
  ['POST', `/users/${ID}/roles`],
  ['DELETE', `/users/${ID}/roles/${ID}`],
  ['DELETE', `/users/${ID}`],
  ['GET', '/platform/users'],
  ['PATCH', `/platform/users/${ID}/status`],
  ['POST', '/auth/change-password'],
  ['GET', '/auth/roles'],
  ['POST', '/properties'],
];

test('new endpoints are mounted and reject unauthenticated callers with 401 (not 404/500)', async () => {
  await withServer(async (base) => {
    for (const [method, path] of PROTECTED) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      });
      assert.strictEqual(res.status, 401, `${method} ${path} -> ${res.status}`);
    }
  });
});

test('unknown routes still 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/definitely-not-a-route`);
    assert.strictEqual(res.status, 404);
  });
});
