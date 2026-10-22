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

/**
 * May `actor` modify an existing member who currently holds `targetRoles` at the property?
 * Only if the actor could have granted every one of those roles themselves — so a manager
 * can manage sales agents and other managers but can never touch (remove, demote,
 * re-role) a super_admin.
 */
function evaluateMemberManagement(actor, targetRoles) {
  for (const role of targetRoles) {
    if (!evaluateRoleAssignment(actor, role).ok) {
      return { ok: false, reason: `You cannot manage a member who holds the ${role.name} role` };
    }
  }
  return { ok: true };
}

function assertCanManageMember({ actor, targetRoles }) {
  const result = evaluateMemberManagement(actor, targetRoles);
  if (!result.ok) throw new ForbiddenError(result.reason);
}

/** The permission that lets a member administer the property's users. */
const ADMIN_PERMISSION = 'users:update';

/**
 * Would removing `roleId` (or ALL of the user's roles when roleId is omitted) from `userId`
 * leave the property with nobody able to manage users?
 *
 * members: [{ userId, roles: [{ id, permissionCodes: string[] }] }] — everyone at the property.
 * Only blocks a removal that takes the admin count from >0 to 0.
 */
function wouldLeaveNoAdmin(members, { userId, roleId }) {
  const isAdmin = (roles) => roles.some((r) => r.permissionCodes.includes(ADMIN_PERMISSION));
  const before = members.filter((m) => isAdmin(m.roles)).length;
  const after = members.filter((m) => {
    const roles =
      m.userId === userId ? (roleId ? m.roles.filter((r) => r.id !== roleId) : []) : m.roles;
    return isAdmin(roles);
  }).length;
  return before > 0 && after === 0;
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
  ADMIN_PERMISSION,
  evaluateRoleAssignment,
  evaluateMemberManagement,
  assertCanManageMember,
  wouldLeaveNoAdmin,
  assertCanAssignRole,
  filterAssignableRoles,
};
