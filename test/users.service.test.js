const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { ROLE_PERMISSION_DEFAULTS } = require('../src/modules/auth/permissions');
const { NotFoundError, ForbiddenError, ConflictError } = require('../src/shared/errors/AppError');

const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

// ---- in-memory property: memberships[userId] = [roleName]
const PROP = 'prop-1';
const roleOf = (name) => ({ id: `role-${name}`, name, description: null, permissionCodes: [...ROLE_PERMISSION_DEFAULTS[name]] });
let memberships;
let accounts;
let audits;
const reset = () => {
  memberships = { boss: ['super_admin'], mgr: ['property_manager'], agent: ['sales_agent'] };
  accounts = {
    'boss@x.com': { id: 'boss', email: 'boss@x.com', fullName: 'Boss', isActive: true },
    'mgr@x.com': { id: 'mgr', email: 'mgr@x.com', fullName: 'Mgr', isActive: true },
    'agent@x.com': { id: 'agent', email: 'agent@x.com', fullName: 'Agent', isActive: true },
    'outsider@x.com': { id: 'outsider', email: 'outsider@x.com', fullName: 'Out', isActive: true },
    'disabled@x.com': { id: 'disabled', email: 'disabled@x.com', fullName: 'Dis', isActive: false },
  };
  audits = [];
};
reset();
const memberView = (id) => {
  const names = memberships[id];
  if (!names || names.length === 0) return null;
  const acc = Object.values(accounts).find((a) => a.id === id);
  return { ...acc, createdAt: new Date(), roles: names.map(roleOf) };
};

stub('../src/modules/users/repository', {
  listMembers: async () => [[], 0],
  findMember: async (userId, propertyId) => (propertyId === PROP ? memberView(userId) : null),
  listMembersWithPermissions: async () =>
    Object.entries(memberships)
      .filter(([, names]) => names.length)
      .map(([userId, names]) => ({ userId, roles: names.map(roleOf) })),
  findUserByEmail: async (email) => accounts[email] || null,
  addRole: async ({ userId, roleId }) => {
    const name = roleId.replace('role-', '');
    memberships[userId] = memberships[userId] || [];
    if (memberships[userId].includes(name)) throw Object.assign(new Error('dup'), { code: 'P2002' });
    memberships[userId].push(name);
  },
  removeRole: async ({ userId, roleId }) => {
    memberships[userId] = memberships[userId].filter((n) => `role-${n}` !== roleId);
  },
  removeAllRoles: async ({ userId }) => {
    memberships[userId] = [];
  },
});
stub('../src/modules/auth/repository', {
  getRoleWithPermissions: async (roleId) => {
    const name = roleId.replace('role-', '');
    return ROLE_PERMISSION_DEFAULTS[name] ? roleOf(name) : null;
  },
  getActorAccess: async (userId) => {
    const names = memberships[userId] || [];
    return {
      roleNames: new Set(names),
      permissionCodes: new Set(names.flatMap((n) => ROLE_PERMISSION_DEFAULTS[n])),
    };
  },
});
stub('../src/modules/audit/service', { logAudit: async (e) => audits.push(e) });

const users = require('../src/modules/users/service');
const as = (id) => ({ id });
const names = (member) => member.roles.map((r) => r.name).sort();

test('a manager adds and then removes a role on a sales agent', async () => {
  reset();
  const added = await users.addRole('agent', PROP, 'role-auditor', as('mgr'));
  assert.deepStrictEqual(names(added), ['auditor', 'sales_agent']);
  const after = await users.removeRole('agent', PROP, 'role-auditor', as('mgr'));
  assert.deepStrictEqual(names(after), ['sales_agent']);
  assert.deepStrictEqual(audits.map((a) => a.action), ['user.role_added', 'user.role_removed']);
});

test('a manager cannot grant super_admin', async () => {
  reset();
  await assert.rejects(() => users.addRole('agent', PROP, 'role-super_admin', as('mgr')), ForbiddenError);
  assert.deepStrictEqual(memberships.agent, ['sales_agent']);
});

test('a manager cannot touch a super_admin: remove role, remove member, or add a role', async () => {
  reset();
  await assert.rejects(() => users.removeRole('boss', PROP, 'role-super_admin', as('mgr')), ForbiddenError);
  await assert.rejects(() => users.removeMember('boss', PROP, as('mgr')), ForbiddenError);
  await assert.rejects(() => users.addRole('boss', PROP, 'role-auditor', as('mgr')), ForbiddenError);
  assert.deepStrictEqual(memberships.boss, ['super_admin']);
});

test('a sales agent cannot manage anyone', async () => {
  reset();
  await assert.rejects(() => users.removeMember('mgr', PROP, as('agent')), ForbiddenError);
});

test('duplicate role -> 409; unknown role id -> validation error; role not held -> 404', async () => {
  reset();
  await assert.rejects(() => users.addRole('agent', PROP, 'role-sales_agent', as('mgr')), ConflictError);
  await assert.rejects(() => users.addRole('agent', PROP, 'role-nope', as('mgr')), /Unknown roleId/);
  await assert.rejects(() => users.removeRole('agent', PROP, 'role-auditor', as('mgr')), NotFoundError);
});

test("a user who isn't a member here looks non-existent (no cross-tenant probing)", async () => {
  reset();
  await assert.rejects(() => users.viewMember('outsider', PROP), NotFoundError);
  await assert.rejects(() => users.addRole('outsider', PROP, 'role-auditor', as('boss')), NotFoundError);
  await assert.rejects(() => users.removeMember('outsider', PROP, as('boss')), NotFoundError);
  await assert.rejects(() => users.viewMember('agent', 'some-other-property'), NotFoundError);
});

test('removing a member removes only access to this property and reports no body', async () => {
  reset();
  await users.removeMember('agent', PROP, as('mgr'));
  assert.deepStrictEqual(memberships.agent, []);
  await assert.rejects(() => users.viewMember('agent', PROP), NotFoundError);
  assert.strictEqual(accounts['agent@x.com'].isActive, true, 'the account itself is untouched');
});

test("removing a member's last role returns null (they are no longer a member)", async () => {
  reset();
  assert.strictEqual(await users.removeRole('agent', PROP, 'role-sales_agent', as('mgr')), null);
});

test('LAST ADMIN: the only user-manager cannot be removed or demoted, by anyone', async () => {
  reset();
  memberships = { boss: ['super_admin'], agent: ['sales_agent'] };
  await assert.rejects(() => users.removeMember('boss', PROP, as('boss')), ConflictError);
  await assert.rejects(() => users.removeRole('boss', PROP, 'role-super_admin', as('boss')), ConflictError);
  assert.deepStrictEqual(memberships.boss, ['super_admin']);
});

test('LAST ADMIN: once a second admin exists, the first can step down', async () => {
  reset();
  memberships = { boss: ['super_admin'], mgr: ['property_manager'] };
  await users.removeMember('boss', PROP, as('boss'));
  assert.deepStrictEqual(memberships.boss, []);
  await assert.rejects(() => users.removeMember('mgr', PROP, as('mgr')), ConflictError, 'now mgr is the last admin');
});

test('add an existing account by email: gets the role, never a new password', async () => {
  reset();
  const member = await users.addMemberByEmail({ propertyId: PROP, email: 'outsider@x.com', roleId: 'role-auditor' }, as('mgr'));
  assert.deepStrictEqual(names(member), ['auditor']);
  assert.strictEqual(member.passwordHash, undefined);
  assert.deepStrictEqual(audits.at(-1).action, 'user.member_added');
});

test('add by email: unknown and disabled accounts get the same 404', async () => {
  reset();
  await assert.rejects(() => users.addMemberByEmail({ propertyId: PROP, email: 'ghost@x.com', roleId: 'role-auditor' }, as('mgr')), NotFoundError);
  await assert.rejects(() => users.addMemberByEmail({ propertyId: PROP, email: 'disabled@x.com', roleId: 'role-auditor' }, as('mgr')), NotFoundError);
});

test('add by email: assignment rules still apply (manager cannot add a super_admin)', async () => {
  reset();
  await assert.rejects(() => users.addMemberByEmail({ propertyId: PROP, email: 'outsider@x.com', roleId: 'role-super_admin' }, as('mgr')), ForbiddenError);
  assert.strictEqual(memberships.outsider, undefined);
});

test('add by email: cannot use it to alter a more powerful existing member', async () => {
  reset();
  await assert.rejects(() => users.addMemberByEmail({ propertyId: PROP, email: 'boss@x.com', roleId: 'role-auditor' }, as('mgr')), ForbiddenError);
});

test('presented members never carry permission lists or credentials', async () => {
  reset();
  const view = await users.viewMember('mgr', PROP);
  assert.deepStrictEqual(Object.keys(view).sort(), ['createdAt', 'email', 'fullName', 'id', 'isActive', 'roles']);
  assert.deepStrictEqual(Object.keys(view.roles[0]).sort(), ['description', 'id', 'name']);
});
