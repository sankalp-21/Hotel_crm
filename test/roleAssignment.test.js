const test = require('node:test');
const assert = require('node:assert');

const { ROLE_PERMISSION_DEFAULTS } = require('../src/modules/auth/permissions');
const {
  evaluateRoleAssignment,
  assertCanAssignRole,
  filterAssignableRoles,
} = require('../src/modules/auth/roleAssignment');
const { ForbiddenError, ValidationError } = require('../src/shared/errors/AppError');

// Build actor/role fixtures from the real seeded role definitions.
const role = (name) => ({ name, permissionCodes: [...ROLE_PERMISSION_DEFAULTS[name]] });
const actorWith = (...names) => ({
  roleNames: new Set(names),
  permissionCodes: new Set(names.flatMap((n) => ROLE_PERMISSION_DEFAULTS[n])),
});

test('REGRESSION: property_manager cannot assign super_admin (privilege escalation)', () => {
  const result = evaluateRoleAssignment(actorWith('property_manager'), role('super_admin'));
  assert.strictEqual(result.ok, false);
  assert.throws(
    () => assertCanAssignRole({ actor: actorWith('property_manager'), role: role('super_admin') }),
    ForbiddenError
  );
});

test('super_admin can assign every role', () => {
  const actor = actorWith('super_admin');
  for (const name of Object.keys(ROLE_PERMISSION_DEFAULTS)) {
    assert.strictEqual(evaluateRoleAssignment(actor, role(name)).ok, true, name);
  }
});

test('property_manager can assign roles at or below its own power', () => {
  const actor = actorWith('property_manager');
  for (const name of ['property_manager', 'sales_agent', 'auditor']) {
    assert.strictEqual(evaluateRoleAssignment(actor, role(name)).ok, true, name);
  }
});

test('lower roles cannot assign upward', () => {
  assert.strictEqual(evaluateRoleAssignment(actorWith('sales_agent'), role('property_manager')).ok, false);
  assert.strictEqual(evaluateRoleAssignment(actorWith('sales_agent'), role('super_admin')).ok, false);
  assert.strictEqual(evaluateRoleAssignment(actorWith('auditor'), role('sales_agent')).ok, false);
});

test('restricted role is blocked even if a lower role were misconfigured with every permission', () => {
  const overpowered = {
    roleNames: new Set(['property_manager']),
    permissionCodes: new Set(ROLE_PERMISSION_DEFAULTS.super_admin),
  };
  assert.strictEqual(evaluateRoleAssignment(overpowered, role('super_admin')).ok, false);
});

test('permissions combine across multiple roles at the property', () => {
  const actor = actorWith('sales_agent', 'auditor');
  // auditor + sales_agent together hold audit:read, which neither role grants alone to the other
  assert.strictEqual(evaluateRoleAssignment(actor, role('auditor')).ok, true);
  assert.strictEqual(evaluateRoleAssignment(actor, role('sales_agent')).ok, true);
  assert.strictEqual(evaluateRoleAssignment(actor, role('property_manager')).ok, false);
});

test('unknown role id is a validation error, not a 500', () => {
  assert.throws(() => assertCanAssignRole({ actor: actorWith('super_admin'), role: null }), ValidationError);
});

test('filterAssignableRoles lists only assignable roles per actor', () => {
  const all = Object.keys(ROLE_PERMISSION_DEFAULTS).map(role);
  const names = (actor) => filterAssignableRoles(actor, all).map((r) => r.name).sort();
  assert.deepStrictEqual(names(actorWith('super_admin')), ['auditor', 'property_manager', 'sales_agent', 'super_admin']);
  assert.deepStrictEqual(names(actorWith('property_manager')), ['auditor', 'property_manager', 'sales_agent']);
  assert.deepStrictEqual(names(actorWith('sales_agent')), ['sales_agent']);
});
