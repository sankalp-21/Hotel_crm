const prisma = require('../../infrastructure/db/prisma');

function create(data) {
  return prisma.property.create({ data });
}

/**
 * Create a property and give its creator the super_admin role there, in one
 * transaction. Without this the creator could create a tenant but had no
 * access to it.
 */
function createWithOwner(data, ownerUserId) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { name: 'super_admin' } });
    if (!role) throw new Error('super_admin role is not seeded; run npm run seed');
    const property = await tx.property.create({ data });
    await tx.userPropertyRole.create({
      data: { userId: ownerUserId, propertyId: property.id, roleId: role.id },
    });
    return property;
  });
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

module.exports = { create, createWithOwner, findById, findByIdForUser, list, listForUser, update };