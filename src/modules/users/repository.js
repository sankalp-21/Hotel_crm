const prisma = require('../../infrastructure/db/prisma');

const ROLE_WITH_PERMISSIONS = { include: { permissions: { include: { permission: true } } } };

// Never select passwordHash or platform flags: these rows are returned to tenant admins.
const memberSelect = (propertyId) => ({
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  propertyRoles: {
    where: { propertyId },
    select: { role: { select: { id: true, name: true, description: true } } },
  },
});

function toMember(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: user.propertyRoles.map((pr) => pr.role),
  };
}

async function listMembers({ propertyId, search, page, pageSize }) {
  const where = {
    propertyRoles: { some: { propertyId } },
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: memberSelect(propertyId),
    }),
    prisma.user.count({ where }),
  ]);
  return [rows.map(toMember), total];
}

/** The user as a member of THIS property, with each role's permissions (for policy checks). */
async function findMember(userId, propertyId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, propertyRoles: { some: { propertyId } } },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      createdAt: true,
      propertyRoles: {
        where: { propertyId },
        select: { role: { include: ROLE_WITH_PERMISSIONS.include } },
      },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: user.propertyRoles.map(({ role }) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissionCodes: role.permissions.map((rp) => rp.permission.code),
    })),
  };
}

/** Every member of the property with permissions — input for the last-admin guard. */
async function listMembersWithPermissions(propertyId) {
  const rows = await prisma.userPropertyRole.findMany({
    where: { propertyId },
    include: { role: ROLE_WITH_PERMISSIONS },
  });
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.userId)) byUser.set(row.userId, { userId: row.userId, roles: [] });
    byUser.get(row.userId).roles.push({
      id: row.role.id,
      name: row.role.name,
      permissionCodes: row.role.permissions.map((rp) => rp.permission.code),
    });
  }
  return [...byUser.values()];
}

function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, isActive: true },
  });
}

function addRole({ userId, propertyId, roleId }) {
  return prisma.userPropertyRole.create({ data: { userId, propertyId, roleId } });
}

function removeRole({ userId, propertyId, roleId }) {
  return prisma.userPropertyRole.deleteMany({ where: { userId, propertyId, roleId } });
}

function removeAllRoles({ userId, propertyId }) {
  return prisma.userPropertyRole.deleteMany({ where: { userId, propertyId } });
}

module.exports = {
  listMembers,
  findMember,
  listMembersWithPermissions,
  findUserByEmail,
  addRole,
  removeRole,
  removeAllRoles,
};
