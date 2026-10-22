const usersRepository = require('./repository');
const authRepository = require('../auth/repository');
const {
  assertCanAssignRole,
  assertCanManageMember,
  wouldLeaveNoAdmin,
} = require('../auth/roleAssignment');
const { NotFoundError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

const LAST_ADMIN_MESSAGE = 'A property must keep at least one user who can manage users';

/** What clients see: never expose permission lists or anything beyond identity + roles. */
function present(member) {
  return {
    id: member.id,
    email: member.email,
    fullName: member.fullName,
    isActive: member.isActive,
    createdAt: member.createdAt,
    roles: member.roles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
  };
}

async function listMembers(query) {
  const [items, total] = await usersRepository.listMembers(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function getMember(userId, propertyId) {
  // Scoped lookup: someone who isn't a member here is indistinguishable from a non-existent user.
  const member = await usersRepository.findMember(userId, propertyId);
  if (!member) throw new NotFoundError('User');
  return member;
}

async function viewMember(userId, propertyId) {
  return present(await getMember(userId, propertyId));
}

async function addRoleOrConflict(args) {
  try {
    await usersRepository.addRole(args);
  } catch (err) {
    if (err.code === 'P2002') throw new ConflictError('User already has this role at this property');
    throw err;
  }
}

/**
 * Give an existing account access to this property by email (e.g. a consultant who works
 * for several hotels). Never touches their password or profile.
 * Unknown and disabled accounts get the same 404.
 */
async function addMemberByEmail({ propertyId, email, roleId }, actingUser) {
  const user = await usersRepository.findUserByEmail(email);
  if (!user || !user.isActive) throw new NotFoundError('User');

  const [role, actor, existing] = await Promise.all([
    authRepository.getRoleWithPermissions(roleId),
    authRepository.getActorAccess(actingUser.id, propertyId),
    usersRepository.findMember(user.id, propertyId),
  ]);
  assertCanAssignRole({ actor, role });
  if (existing) assertCanManageMember({ actor, targetRoles: existing.roles });

  await addRoleOrConflict({ userId: user.id, propertyId, roleId });
  await logAudit({
    propertyId,
    userId: actingUser.id,
    action: 'user.member_added',
    entityType: 'User',
    entityId: user.id,
    metadata: { roleId, roleName: role.name },
  });
  return viewMember(user.id, propertyId);
}

async function addRole(userId, propertyId, roleId, actingUser) {
  const member = await getMember(userId, propertyId);
  const [role, actor] = await Promise.all([
    authRepository.getRoleWithPermissions(roleId),
    authRepository.getActorAccess(actingUser.id, propertyId),
  ]);
  assertCanAssignRole({ actor, role });
  assertCanManageMember({ actor, targetRoles: member.roles });

  await addRoleOrConflict({ userId, propertyId, roleId });
  await logAudit({
    propertyId,
    userId: actingUser.id,
    action: 'user.role_added',
    entityType: 'User',
    entityId: userId,
    metadata: { roleId, roleName: role.name },
  });
  return viewMember(userId, propertyId);
}

async function removeRole(userId, propertyId, roleId, actingUser) {
  const member = await getMember(userId, propertyId);
  const held = member.roles.find((r) => r.id === roleId);
  if (!held) throw new NotFoundError('Role assignment');

  const actor = await authRepository.getActorAccess(actingUser.id, propertyId);
  assertCanManageMember({ actor, targetRoles: member.roles });

  const members = await usersRepository.listMembersWithPermissions(propertyId);
  if (wouldLeaveNoAdmin(members, { userId, roleId })) throw new ConflictError(LAST_ADMIN_MESSAGE);

  await usersRepository.removeRole({ userId, propertyId, roleId });
  await logAudit({
    propertyId,
    userId: actingUser.id,
    action: 'user.role_removed',
    entityType: 'User',
    entityId: userId,
    metadata: { roleId, roleName: held.name },
  });

  // Removing the last role means the person no longer belongs to the property.
  return member.roles.length === 1 ? null : viewMember(userId, propertyId);
}

/**
 * Remove a person from THIS property only. Their account and their access to any other
 * property are untouched (disabling an account everywhere is a platform-admin action).
 */
async function removeMember(userId, propertyId, actingUser) {
  const member = await getMember(userId, propertyId);
  const actor = await authRepository.getActorAccess(actingUser.id, propertyId);
  assertCanManageMember({ actor, targetRoles: member.roles });

  const members = await usersRepository.listMembersWithPermissions(propertyId);
  if (wouldLeaveNoAdmin(members, { userId })) throw new ConflictError(LAST_ADMIN_MESSAGE);

  await usersRepository.removeAllRoles({ userId, propertyId });
  await logAudit({
    propertyId,
    userId: actingUser.id,
    action: 'user.member_removed',
    entityType: 'User',
    entityId: userId,
    metadata: { roles: member.roles.map((r) => r.name) },
  });
}

module.exports = { listMembers, viewMember, addMemberByEmail, addRole, removeRole, removeMember };
