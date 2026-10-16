const test = require('node:test');
const assert = require('node:assert');

const { syncPermissions } = require('../src/modules/auth/syncPermissions');
const { PERMISSIONS, ROLE_PERMISSION_DEFAULTS } = require('../src/modules/auth/permissions');

/** Minimal in-memory stand-in for the four Prisma calls the sync uses. */
function fakePrisma({ permissions = [], roles = [], grants = [] } = {}) {
  let seq = 0;
  const db = {
    permissions: permissions.map((code) => ({ id: `p${++seq}`, code })),
    roles: roles.map((name) => ({ id: `r${++seq}`, name })),
    grants: [],
  };
  for (const [role, code] of grants) {
    db.grants.push({ roleId: db.roles.find((r) => r.name === role).id, permissionId: db.permissions.find((p) => p.code === code).id });
  }
  const many = (rows, key, make) => async ({ data }) => {
    for (const d of data) if (!rows.some((r) => key(r, d))) rows.push(make(d));
    return { count: data.length };
  };
  return {
    db,
    permission: { findMany: async () => db.permissions.map((p) => ({ ...p })), createMany: many(db.permissions, (r, d) => r.code === d.code, (d) => ({ id: `p${++seq}`, ...d })) },
    role: { findMany: async () => db.roles.map((r) => ({ ...r })), createMany: many(db.roles, (r, d) => r.name === d.name, (d) => ({ id: `r${++seq}`, ...d })) },
    rolePermission: { findMany: async () => db.grants.map((g) => ({ ...g })), createMany: many(db.grants, (r, d) => r.roleId === d.roleId && r.permissionId === d.permissionId, (d) => ({ ...d })) },
  };
}

const totalGrants = Object.values(ROLE_PERMISSION_DEFAULTS).reduce((n, codes) => n + codes.length, 0);

test('every permission a role defaults to is a declared permission (typo guard)', () => {
  const known = new Set(Object.values(PERMISSIONS));
  for (const [role, codes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    for (const code of codes) assert.ok(known.has(code), `${role} -> ${code}`);
    assert.strictEqual(new Set(codes).size, codes.length, `${role} lists a permission twice`);
  }
});

test('empty database: creates every permission, role and grant', async () => {
  const p = fakePrisma();
  const r = await syncPermissions(p);
  assert.strictEqual(r.permissionsAdded.length, Object.values(PERMISSIONS).length);
  assert.deepStrictEqual(r.rolesAdded.sort(), Object.keys(ROLE_PERMISSION_DEFAULTS).sort());
  assert.strictEqual(r.grantsAdded.length, totalGrants);
  assert.strictEqual(p.db.grants.length, totalGrants);
});

test('THE BUG: a database seeded before new permissions existed gets them, and old grants are untouched', async () => {
  const oldCodes = Object.values(PERMISSIONS).filter((c) => !c.startsWith('suppressions:'));
  const oldGrants = [];
  for (const [role, codes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    for (const code of codes) if (oldCodes.includes(code)) oldGrants.push([role, code]);
  }
  const p = fakePrisma({ permissions: oldCodes, roles: Object.keys(ROLE_PERMISSION_DEFAULTS), grants: oldGrants });

  const r = await syncPermissions(p);

  assert.deepStrictEqual(r.permissionsAdded.sort(), ['suppressions:manage', 'suppressions:read']);
  assert.deepStrictEqual(r.rolesAdded, []);
  assert.ok(r.grantsAdded.every((g) => g.permission.startsWith('suppressions:')));
  assert.ok(r.grantsAdded.some((g) => g.role === 'property_manager' && g.permission === 'suppressions:manage'));
  assert.ok(!r.grantsAdded.some((g) => g.role === 'sales_agent' && g.permission === 'suppressions:manage'), 'sales_agent never gets manage');
  assert.strictEqual(p.db.grants.length, totalGrants);
});

test('idempotent: a second run changes nothing', async () => {
  const p = fakePrisma();
  await syncPermissions(p);
  const again = await syncPermissions(p);
  assert.deepStrictEqual([again.permissionsAdded, again.rolesAdded, again.grantsAdded], [[], [], []]);
  assert.strictEqual(p.db.grants.length, totalGrants);
});

test('additive only: an extra grant someone added by hand is never removed', async () => {
  const p = fakePrisma();
  await syncPermissions(p);
  p.db.permissions.push({ id: 'px', code: 'custom:thing' });
  p.db.grants.push({ roleId: p.db.roles.find((r) => r.name === 'auditor').id, permissionId: 'px' });
  const before = p.db.grants.length;
  await syncPermissions(p);
  assert.strictEqual(p.db.grants.length, before);
  assert.ok(p.db.grants.some((g) => g.permissionId === 'px'));
});

test('dry run reports what is missing and writes nothing', async () => {
  const p = fakePrisma();
  const r = await syncPermissions(p, { dryRun: true });
  assert.strictEqual(r.grantsAdded.length, totalGrants);
  assert.deepStrictEqual([p.db.permissions.length, p.db.roles.length, p.db.grants.length], [0, 0, 0]);
});
