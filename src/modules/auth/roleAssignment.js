const { ForbiddenError, ValidationError } = require('../../shared/errors/AppError');

/**
 * Roles that can only be granted by someone who already holds that same role
 * at the same property. These are never delegable through a lower role, even
 * if that role were (mis)configured with a superset of permissions.
 */
const RESTRICTED_ROLES = new Set(['super_admin']);

/**
 * Pure policy: may `actor` grant `role`?
 *
 * actor: { roleNames: Iterable<string>, permissionCodes: Iterable<string> }
 *        — the actor's roles/permissions AT THE TARGET PROPERTY (union of all
 *        roles they hold there).
 * role:  { name: string, permissionCodes: string[] }
 *
 * Rule 1: restricted roles require the actor to hold that role already.
 * Rule 2: the actor must hold every permission the role grants (no
 *         privilege gain — you can only hand out access you already have).
 *
 * Returns { ok: true } or { ok: false, reason }.
 */
function evaluateRoleAssignment(actor, role) {
  const roleNames = new Set(actor.roleNames);
  const permissionCodes = new Set(actor.permissionCodes);

  if (RESTRICTED_ROLES.has(role.name) && !roleNames.has(role.name)) {
    return { ok: false, reason: `Only a ${role.name} can assign the ${role.name} role` };
  }

  const missing = role.permissionCodes.filter((code) => !permissionCodes.has(code));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `You cannot assign the ${role.name} role: it grants permissions you do not hold`,
    };
  }

  return { ok: true };
}

/** Throwing wrapper used by the service. */
function assertCanAssignRole({ actor, role }) {
  if (!role) throw new ValidationError('Unknown roleId');
  const result = evaluateRoleAssignment(actor, role);
  if (!result.ok) throw new ForbiddenError(result.reason);
}

/** Filter a role list down to the ones `actor` may assign. */
function filterAssignableRoles(actor, roles) {
  return roles.filter((role) => evaluateRoleAssignment(actor, role).ok);
}

module.exports = {
  RESTRICTED_ROLES,
  evaluateRoleAssignment,
  assertCanAssignRole,
  filterAssignableRoles,
};
