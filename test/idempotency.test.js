const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- In-memory stand-in for the idempotency_keys table (honours the unique(scope,key) index).
let updateDelayMs = 0;
let failUpdates = false;
let rows = [];
let nextId = 0;
const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
const matches = (row, where) =>
  Object.entries(where).every(([field, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lte' in cond) return row[field] <= cond.lte;
      if ('lt' in cond) return row[field] < cond.lt;
    }
    return row[field] === cond;
  });

const fakePrisma = {
  idempotencyKey: {
    async create({ data }) {
      if (rows.some((r) => r.scope === data.scope && r.key === data.key)) throw uniqueViolation();
      const row = { id: String(++nextId), statusCode: null, responseBody: null, completedAt: null, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      const { scope, key } = where.scope_key;
      return rows.find((r) => r.scope === scope && r.key === key) || null;
    },
    async update({ where, data }) {
      await sleep(updateDelayMs);
      if (failUpdates) throw new Error('db down');
      const { scope, key } = where.scope_key;
      const row = rows.find((r) => r.scope === scope && r.key === key);
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(row, data);
      return row;
    },
    async deleteMany({ where }) {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
  },
};
const prismaPath = require.resolve('../src/infrastructure/db/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma };

const { idempotent, purgeExpiredKeys } = require('../src/shared/middleware/idempotency');
const { ConflictError, ValidationError, UnauthorizedError } = require('../src/shared/errors/AppError');

const reset = () => {
  rows = [];
  nextId = 0;
  updateDelayMs = 0;
  failUpdates = false;
};

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.done = new Promise((resolve) => (res._resolve = resolve));
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.json = (b) => {
    res.body = b;
    res._resolve();
    return res;
  };
  return res;
}

/** Run the middleware like Express would; `controller` stands in for the route handler. */
async function call(mw, { user, propertyId = 'prop-1', key, body = { n: 1 }, url = '/campaigns/1/send' }, controller) {
  const req = { method: 'POST', originalUrl: url, body, headers: key ? { 'idempotency-key': key } : {}, user, propertyId };
  const res = makeRes();
  let nextErr;
  await new Promise((resolve) => {
    res.done.then(resolve);
    mw(req, res, (err) => {
      if (err) {
        nextErr = err;
        return resolve();
      }
      return Promise.resolve(controller(req, res)).catch((e) => {
        nextErr = e;
        resolve();
      });
    });
  });
  return { res, nextErr };
}

const alice = { id: 'user-alice' };
const bob = { id: 'user-bob' };
const never = () => assert.fail('controller must not run');
const created = (payload) => async (_req, res) => res.status(201).json(payload);

test('RACE REGRESSION: an immediate retry replays instead of 409 "in progress"', async () => {
  reset();
  updateDelayMs = 40; // the bookkeeping write is slow; the old code sent the response without waiting for it
  const mw = idempotent({ required: true });
  let runs = 0;
  const ctl = async (_req, res) => {
    runs += 1;
    res.status(201).json({ id: 'camp-1' });
  };

  const first = await call(mw, { user: alice, key: 'k1' }, ctl);
  assert.strictEqual(first.res.statusCode, 201);

  const second = await call(mw, { user: alice, key: 'k1' }, never); // retry the instant the first response lands
  assert.strictEqual(second.nextErr, undefined, 'must not be an in-progress conflict');
  assert.strictEqual(second.res.statusCode, 201);
  assert.deepStrictEqual(second.res.body, { id: 'camp-1' });
  assert.strictEqual(second.res.headers['Idempotent-Replayed'], 'true');
  assert.strictEqual(runs, 1);
});

test('keys are private per user: same key + same request from two users both execute', async () => {
  reset();
  const mw = idempotent({ required: true });
  const a = await call(mw, { user: alice, key: 'shared' }, created({ owner: 'alice' }));
  const b = await call(mw, { user: bob, key: 'shared' }, created({ owner: 'bob' }));
  assert.deepStrictEqual(a.res.body, { owner: 'alice' });
  assert.deepStrictEqual(b.res.body, { owner: 'bob' });
  assert.strictEqual(b.res.headers['Idempotent-Replayed'], undefined);

  const bAgain = await call(mw, { user: bob, key: 'shared' }, never);
  assert.deepStrictEqual(bAgain.res.body, { owner: 'bob' }, "bob never sees alice's stored response");
});

test('different body, same key, different users: no cross-user 409', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, key: 'k', body: { a: 1 } }, created({ ok: 1 }));
  const b = await call(mw, { user: bob, key: 'k', body: { b: 2 } }, created({ ok: 2 }));
  assert.strictEqual(b.nextErr, undefined);
  assert.strictEqual(b.res.statusCode, 201);
});

test('keys are private per property for the same user', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, propertyId: 'p1', key: 'k' }, created({ p: 1 }));
  const other = await call(mw, { user: alice, propertyId: 'p2', key: 'k' }, created({ p: 2 }));
  assert.deepStrictEqual(other.res.body, { p: 2 });
});

test('same key reused with a different request by the same user -> 409', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, key: 'k', body: { n: 1 } }, created({ ok: 1 }));
  const clash = await call(mw, { user: alice, key: 'k', body: { n: 2 } }, never);
  assert.ok(clash.nextErr instanceof ConflictError);
  assert.match(clash.nextErr.message, /different request/);
});

test('a duplicate while the first is still running -> 409 in progress; replays once it finishes', async () => {
  reset();
  const mw = idempotent({ required: true });
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = async (_req, res) => {
    await gate;
    res.status(201).json({ done: true });
  };

  const firstPromise = call(mw, { user: alice, key: 'k' }, slow);
  await sleep(20);
  const dup = await call(mw, { user: alice, key: 'k' }, never);
  assert.ok(dup.nextErr instanceof ConflictError);
  assert.match(dup.nextErr.message, /in progress/);

  release();
  await firstPromise;
  const replay = await call(mw, { user: alice, key: 'k' }, never);
  assert.deepStrictEqual(replay.res.body, { done: true });
});

test('5xx responses are not cached: the key is released and a retry re-runs the work', async () => {
  reset();
  const mw = idempotent({ required: true });
  let runs = 0;
  const flaky = async (_req, res) => {
    runs += 1;
    if (runs === 1) return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
    return res.status(201).json({ ok: true });
  };

  const first = await call(mw, { user: alice, key: 'k' }, flaky);
  assert.strictEqual(first.res.statusCode, 500);
  assert.strictEqual(rows.length, 0, 'the failed attempt must not hold the key');

  const retry = await call(mw, { user: alice, key: 'k' }, flaky);
  assert.strictEqual(retry.res.statusCode, 201);
  assert.strictEqual(runs, 2);

  const replay = await call(mw, { user: alice, key: 'k' }, never);
  assert.strictEqual(replay.res.statusCode, 201);
});

test('deterministic 4xx responses are cached and replayed', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, key: 'k' }, async (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
  const replay = await call(mw, { user: alice, key: 'k' }, never);
  assert.strictEqual(replay.res.statusCode, 404);
  assert.strictEqual(replay.res.headers['Idempotent-Replayed'], 'true');
});

test('an expired finished result is reclaimed and the request runs again', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, key: 'k' }, created({ v: 1 }));
  rows[0].expiresAt = new Date(Date.now() - 1000);
  const again = await call(mw, { user: alice, key: 'k' }, created({ v: 2 }));
  assert.deepStrictEqual(again.res.body, { v: 2 });
});

test('a request that died holding its lease unblocks itself after the lease lapses', async () => {
  reset();
  const mw = idempotent({ required: true });
  void call(mw, { user: alice, key: 'k' }, () => new Promise(() => {})); // process "crashed": never responds
  await sleep(20);
  assert.strictEqual(rows[0].status, 'in_progress');

  const blocked = await call(mw, { user: alice, key: 'k' }, never);
  assert.ok(blocked.nextErr instanceof ConflictError, 'still leased');

  rows[0].expiresAt = new Date(Date.now() - 1000); // lease lapsed
  const recovered = await call(mw, { user: alice, key: 'k' }, created({ ok: 'recovered' }));
  assert.deepStrictEqual(recovered.res.body, { ok: 'recovered' });
});

test('a failed bookkeeping write never breaks the response', async () => {
  reset();
  failUpdates = true;
  const mw = idempotent({ required: true });
  const r = await call(mw, { user: alice, key: 'k' }, created({ ok: true }));
  assert.strictEqual(r.res.statusCode, 201);
  assert.deepStrictEqual(r.res.body, { ok: true });
});

test('header validation: required, optional, oversized, and unauthenticated (fail closed)', async () => {
  reset();
  const required = idempotent({ required: true });
  const optional = idempotent();

  const missing = await call(required, { user: alice }, never);
  assert.ok(missing.nextErr instanceof ValidationError);

  let ran = false;
  await call(optional, { user: alice }, async (_q, res) => {
    ran = true;
    res.status(200).json({});
  });
  assert.ok(ran);
  assert.strictEqual(rows.length, 0, 'no key, nothing stored');

  const tooLong = await call(required, { user: alice, key: 'x'.repeat(256) }, never);
  assert.ok(tooLong.nextErr instanceof ValidationError);

  const anon = await call(required, { user: undefined, key: 'k' }, never);
  assert.ok(anon.nextErr instanceof UnauthorizedError);
  assert.strictEqual(rows.length, 0);
});

test('purgeExpiredKeys removes only expired rows', async () => {
  reset();
  const mw = idempotent({ required: true });
  await call(mw, { user: alice, key: 'old' }, created({ n: 1 }));
  await call(mw, { user: alice, key: 'fresh' }, created({ n: 2 }));
  rows.find((r) => r.key === 'old').expiresAt = new Date(Date.now() - 1000);

  const removed = await purgeExpiredKeys();
  assert.strictEqual(removed, 1);
  assert.deepStrictEqual(rows.map((r) => r.key), ['fresh']);
});
