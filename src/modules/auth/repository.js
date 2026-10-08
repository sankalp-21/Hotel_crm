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

function assignPropertyRole({ userId, propertyId, roleId }) {
  return prisma.userPropertyRole.create({ data: { userId, propertyId, roleId } });
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
  getPropertyRoles,
  storeRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
};
