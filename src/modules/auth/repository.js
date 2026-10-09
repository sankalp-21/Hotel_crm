const prisma = require('../../infrastructure/db/prisma');

function findByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findById(id) {
  return prisma.user.findUnique({ where: { id } });
}

function createUser({ email, passwordHash, fullName }) {
  return prisma.user.create({ data: { email, passwordHash, fullName } });
}

function updatePasswordHash(userId, passwordHash) {
  return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

function assignPropertyRole({ userId, propertyId, roleId }) {
  return prisma.userPropertyRole.create({ data: { userId, propertyId, roleId } });
}

/**
 * Create the user and their first property role atomically. Previously these
 * were two separate writes, so a bad roleId left an orphan user that already
 * owned the email address.
 */
function createUserWithRole({ email, passwordHash, fullName, propertyId, roleId }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, fullName } });
    await tx.userPropertyRole.create({ data: { userId: user.id, propertyId, roleId } });
    return user;
  });
}

function toRoleShape(role) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissionCodes: role.permissions.map((rp) => rp.permission.code),
  };
}

const ROLE_INCLUDE = { permissions: { include: { permission: true } } };

async function getRoleWithPermissions(roleId) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, include: ROLE_INCLUDE });
  return role ? toRoleShape(role) : null;
}

async function listRolesWithPermissions() {
  const roles = await prisma.role.findMany({ include: ROLE_INCLUDE, orderBy: { name: 'asc' } });
  return roles.map(toRoleShape);
}

/** The acting user's roles and combined permissions at one property. */
async function getActorAccess(userId, propertyId) {
  const assignments = await prisma.userPropertyRole.findMany({
    where: { userId, propertyId },
    include: { role: { include: ROLE_INCLUDE } },
  });
  const roleNames = new Set();
  const permissionCodes = new Set();
  for (const a of assignments) {
    roleNames.add(a.role.name);
    for (const rp of a.role.permissions) permissionCodes.add(rp.permission.code);
  }
  return { roleNames, permissionCodes };
}

function getPropertyRoles(userId) {
  return prisma.userPropertyRole.findMany({
    where: { userId },
    include: { property: true, role: true },
  });
}

function storeRefreshToken({ userId, tokenHash, expiresAt }) {
  return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
}

function findRefreshToken(tokenHash) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

function revokeRefreshToken(tokenHash) {
  return prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
}

function revokeAllRefreshTokensForUser(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  assignPropertyRole,
  updatePasswordHash,
  createUserWithRole,
  getRoleWithPermissions,
  listRolesWithPermissions,
  getActorAccess,
  getPropertyRoles,
  storeRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
};
