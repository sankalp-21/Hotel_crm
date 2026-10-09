const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { NotFoundError, ValidationError } = require('../src/shared/errors/AppError');
const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

let accounts;
let revoked;
let audits;
const reset = () => {
  accounts = {
    admin: { id: 'admin', email: 'admin@x.com', isActive: true, isPlatformAdmin: true },
    bob: { id: 'bob', email: 'bob@x.com', isActive: true, isPlatformAdmin: false },
  };
  revoked = [];
  audits = [];
};
reset();
stub('../src/modules/platform/repository', {
  listUsers: async () => [Object.values(accounts), Object.keys(accounts).length],
  findUser: async (id) => (accounts[id] ? { ...accounts[id] } : null),
  setActive: async (id, isActive) => {
    accounts[id].isActive = isActive;
    return { ...accounts[id] };
  },
});
stub('../src/modules/auth/repository', { revokeAllRefreshTokensForUser: async (id) => revoked.push(id) });
stub('../src/modules/audit/service', { logAudit: async (e) => audits.push(e) });

const platform = require('../src/modules/platform/service');

test('deactivating revokes every refresh token and is audited', async () => {
  reset();
  const result = await platform.setUserStatus('bob', { isActive: false }, { id: 'admin' });
  assert.strictEqual(result.isActive, false);
  assert.deepStrictEqual(revoked, ['bob']);
  assert.strictEqual(audits[0].action, 'platform.user_deactivated');
});

test('reactivating does not revoke anything', async () => {
  reset();
  accounts.bob.isActive = false;
  const result = await platform.setUserStatus('bob', { isActive: true }, { id: 'admin' });
  assert.strictEqual(result.isActive, true);
  assert.deepStrictEqual(revoked, []);
  assert.strictEqual(audits[0].action, 'platform.user_reactivated');
});

test('you cannot change your own status (so the last platform admin cannot lock everyone out)', async () => {
  reset();
  await assert.rejects(() => platform.setUserStatus('admin', { isActive: false }, { id: 'admin' }), ValidationError);
  assert.strictEqual(accounts.admin.isActive, true);
});

test('unknown account -> 404; no-op change does nothing', async () => {
  reset();
  await assert.rejects(() => platform.setUserStatus('ghost', { isActive: false }, { id: 'admin' }), NotFoundError);
  await platform.setUserStatus('bob', { isActive: true }, { id: 'admin' });
  assert.deepStrictEqual(revoked, []);
  assert.deepStrictEqual(audits, []);
});
