const test = require('node:test');
const assert = require('node:assert');

const { ROLE_PERMISSION_DEFAULTS } = require('../src/modules/auth/permissions');
const {
  evaluateMemberManagement,
  assertCanManageMember,
  wouldLeaveNoAdmin,
} = require('../src/modules/auth/roleAssignment');
const { ForbiddenError } = require('../src/shared/errors/AppError');

const role = (name) => ({ id: `role-${name}`, name, permissionCodes: [...ROLE_PERMISSION_DEFAULTS[name]] });
const actorWith = (...names) => ({
  roleNames: new Set(names),
  permissionCodes: new Set(names.flatMap((n) => ROLE_PERMISSION_DEFAULTS[n])),
});

test('a manager can manage sales agents, auditors and other managers', () => {
  const actor = actorWith('property_manager');
  for (const name of ['sales_agent', 'auditor', 'property_manager']) {
    assert.strictEqual(evaluateMemberManagement(actor, [role(name)]).ok, true, name);
  }
});

test('a manager can never manage a super_admin (no removing, demoting or re-roling)', () => {
  const actor = actorWith('property_manager');
  assert.strictEqual(evaluateMemberManagement(actor, [role('super_admin')]).ok, false);
  assert.throws(() => assertCanManageMember({ actor, targetRoles: [role('super_admin')] }), ForbiddenError);
});

test('a member who holds several roles is protected by their most powerful one', () => {
  const actor = actorWith('property_manager');
  assert.strictEqual(evaluateMemberManagement(actor, [role('sales_agent'), role('super_admin')]).ok, false);
});

test('a super_admin can manage everyone, including other super_admins', () => {
  const actor = actorWith('super_admin');
  for (const name of Object.keys(ROLE_PERMISSION_DEFAULTS)) {
    assert.strictEqual(evaluateMemberManagement(actor, [role(name)]).ok, true, name);
  }
});

test('a sales agent cannot manage a manager', () => {
  assert.strictEqual(evaluateMemberManagement(actorWith('sales_agent'), [role('property_manager')]).ok, false);
});

const member = (userId, ...names) => ({ userId, roles: names.map(role) });

test('last-admin guard: removing the only user-manager is blocked', () => {
  const members = [member('boss', 'property_manager'), member('agent', 'sales_agent')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'boss' }), true);
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'boss', roleId: 'role-property_manager' }), true);
});

test('last-admin guard: allowed while another admin remains', () => {
  const members = [member('a', 'property_manager'), member('b', 'super_admin'), member('c', 'sales_agent')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'a' }), false);
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'b' }), false);
});

test('last-admin guard: removing a non-admin role from the only admin is fine', () => {
  const members = [member('boss', 'property_manager', 'sales_agent')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'boss', roleId: 'role-sales_agent' }), false);
});

test('last-admin guard: removing a non-admin member never matters', () => {
  const members = [member('boss', 'property_manager'), member('agent', 'sales_agent')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'agent' }), false);
});

test('last-admin guard: a property that already has no admin does not block cleanup', () => {
  const members = [member('agent', 'sales_agent')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'agent' }), false);
});

test('last-admin guard: a second role that still carries users:update keeps the member an admin', () => {
  const members = [member('x', 'property_manager', 'super_admin')];
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'x', roleId: 'role-property_manager' }), false);
  assert.strictEqual(wouldLeaveNoAdmin(members, { userId: 'x' }), true);
});
