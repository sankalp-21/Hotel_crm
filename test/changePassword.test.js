const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { TooManyRequestsError, ValidationError, UnauthorizedError } = require('../src/shared/errors/AppError');
const { changePasswordSchema } = require('../src/modules/auth/validator');
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

const counters = new Map();
stub('../src/infrastructure/redis/redis', {
  get: async (k) => counters.get(k) ?? null,
  incr: async (k) => {
    counters.set(k, Number(counters.get(k) || 0) + 1);
    return counters.get(k);
  },
  expire: async () => 1,
  del: async (k) => counters.delete(k),
});

let user;
let revoked;
let audits;
stub('../src/modules/auth/repository', {
  findById: async () => user,
  updatePasswordHash: async (_id, hash) => {
    user.passwordHash = hash;
  },
  revokeAllRefreshTokensForUser: async (id) => revoked.push(id),
});
stub('../src/modules/audit/service', { logAudit: async (e) => audits.push(e) });

const authService = require('../src/modules/auth/service');
const OLD = 'OldPassword-123';
const NEW = 'BrandNewPass-456';
const acting = { id: 'u-1', email: 'pat@example.com' };

test.before(async () => {
  user = { id: 'u-1', email: 'pat@example.com', isActive: true, passwordHash: await bcrypt.hash(OLD, 4) };
});
test.beforeEach(() => {
  counters.clear();
  revoked = [];
  audits = [];
});

test('wrong current password: 422, nothing changes, nothing revoked, counted toward lockout', async () => {
  const before = user.passwordHash;
  await assert.rejects(() => authService.changePassword(acting, { currentPassword: 'nope', newPassword: NEW }), ValidationError);
  assert.strictEqual(user.passwordHash, before);
  assert.deepStrictEqual(revoked, []);
  assert.strictEqual(counters.get('auth:lockout:pat@example.com'), 1);
});

test('repeated wrong attempts lock out, so the endpoint cannot be used to brute-force the password', async () => {
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() => authService.changePassword(acting, { currentPassword: `bad${i}`, newPassword: NEW }), ValidationError);
  }
  await assert.rejects(() => authService.changePassword(acting, { currentPassword: OLD, newPassword: NEW }), TooManyRequestsError);
});

test('success: password replaced by a hash, every refresh token revoked, audited, lockout cleared', async () => {
  counters.set('auth:lockout:pat@example.com', 2);
  await authService.changePassword(acting, { currentPassword: OLD, newPassword: NEW });
  assert.ok(await bcrypt.compare(NEW, user.passwordHash));
  assert.notStrictEqual(user.passwordHash, NEW);
  assert.deepStrictEqual(revoked, ['u-1']);
  assert.strictEqual(audits[0].action, 'auth.password_changed');
  assert.strictEqual(counters.has('auth:lockout:pat@example.com'), false);
  user.passwordHash = await bcrypt.hash(OLD, 4);
});

test('a disabled account cannot change a password', async () => {
  user.isActive = false;
  await assert.rejects(() => authService.changePassword(acting, { currentPassword: OLD, newPassword: NEW }), UnauthorizedError);
  user.isActive = true;
});

test('schema: new password must meet the policy and differ from the current one', () => {
  assert.ok(changePasswordSchema.safeParse({ currentPassword: OLD, newPassword: NEW }).success);
  assert.ok(!changePasswordSchema.safeParse({ currentPassword: OLD, newPassword: 'short1A' }).success);
  assert.ok(!changePasswordSchema.safeParse({ currentPassword: OLD, newPassword: 'alllowercase12345' }).success);
  assert.ok(!changePasswordSchema.safeParse({ currentPassword: NEW, newPassword: NEW }).success);
});
