const prisma = require('../../infrastructure/db/prisma');

function create(data) {
  return prisma.property.create({ data });
}

function findById(id) {
  return prisma.property.findUnique({ where: { id } });
}

function findByIdForUser(id, userId) {
  return prisma.property.findFirst({
    where: {
      id,
      userRoles: { some: { userId } },
    },
  });
}

function list() {
  return prisma.property.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
}

/**
 * Phase 5: `GET /properties` was an unscoped Phase 1 shortcut — every
 * authenticated user could list every active property in the system
 * regardless of whether they had any role there. This is the fix: only
 * properties the user has at least one UserPropertyRole assignment for,
 * which is exactly the query-layer change the schema's own Phase 1 comment
 * anticipated (see UserPropertyRole in schema.prisma) rather than a
 * rearchitecture.
 */
function listForUser(userId) {
  return prisma.property.findMany({
    where: {
      isActive: true,
      userRoles: { some: { userId } },
    },
    orderBy: { name: 'asc' },
  });
}

function update(id, data) {
  return prisma.property.update({ where: { id }, data });
}

module.exports = { create, findById, findByIdForUser, list, listForUser, update };