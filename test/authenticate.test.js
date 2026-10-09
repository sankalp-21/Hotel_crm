const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let dbUser = null;
let dbError = null;
let lookups = [];
const prismaPath = require.resolve('../src/infrastructure/db/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    user: {
      findUnique: async (args) => {
        lookups.push(args);
        if (dbError) throw dbError;
        return dbUser;
      },
    },
  },
};

const { authenticate } = require('../src/shared/middleware/authenticate');
const { requirePlatformAdmin } = require('../src/shared/middleware/rbac');
const { signAccessToken } = require('../src/shared/auth/tokens');
const { UnauthorizedError, ForbiddenError } = require('../src/shared/errors/AppError');

const USER = { id: 'u-1', email: 'a@example.com' };
const run = (headers) =>
  new Promise((resolve) => {
    const req = { headers };
    authenticate(req, {}, (err) => resolve({ req, err }));
  });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('active user: request proceeds with identity and platform flag from the database', async () => {
  dbUser = { id: 'u-1', email: 'a@example.com', isActive: true, isPlatformAdmin: false };
  lookups = [];
  const { req, err } = await run(bearer(signAccessToken(USER)));
  assert.strictEqual(err, undefined);
  assert.deepStrictEqual(req.user, { id: 'u-1', email: 'a@example.com', isPlatformAdmin: false });
  assert.strictEqual(lookups[0].where.id, 'u-1');
});

test('DEACTIVATION IS IMMEDIATE: a still-valid token for a disabled account is rejected', async () => {
  dbUser = { id: 'u-1', email: 'a@example.com', isActive: false, isPlatformAdmin: false };
  const { err } = await run(bearer(signAccessToken(USER)));
  assert.ok(err instanceof UnauthorizedError);
});

test('a token for a deleted account is rejected, with the same message as a bad token', async () => {
  dbUser = null;
  const deleted = await run(bearer(signAccessToken(USER)));
  const garbage = await run(bearer('not-a-jwt'));
  assert.ok(deleted.err instanceof UnauthorizedError);
  assert.strictEqual(deleted.err.message, garbage.err.message, 'must not reveal that the account exists/disabled');
});

test('missing or malformed header is rejected without touching the database', async () => {
  lookups = [];
  assert.ok((await run({})).err instanceof UnauthorizedError);
  assert.ok((await run({ authorization: 'Basic abc' })).err instanceof UnauthorizedError);
  assert.strictEqual(lookups.length, 0);
});

test('a database failure is passed on as an error, not treated as authenticated', async () => {
  dbUser = { id: 'u-1', email: 'a@example.com', isActive: true, isPlatformAdmin: false };
  dbError = new Error('db down');
  const { req, err } = await run(bearer(signAccessToken(USER)));
  dbError = null;
  assert.strictEqual(err.message, 'db down');
  assert.strictEqual(req.user, undefined);
});

test('requirePlatformAdmin: only the isPlatformAdmin flag passes; a tenant role never does', () => {
  const gate = requirePlatformAdmin();
  const check = (user) => new Promise((resolve) => gate({ user }, {}, (err) => resolve(err)));
  return Promise.all([check({ id: 'x', isPlatformAdmin: true }), check({ id: 'x', isPlatformAdmin: false }), check(undefined)]).then(
    ([yes, no, anon]) => {
      assert.strictEqual(yes, undefined);
      assert.ok(no instanceof ForbiddenError);
      assert.ok(anon instanceof UnauthorizedError);
    }
  );
});
