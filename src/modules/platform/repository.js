const prisma = require('../../infrastructure/db/prisma');

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  isPlatformAdmin: true,
  createdAt: true,
  _count: { select: { propertyRoles: true } },
};

function toUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    isActive: u.isActive,
    isPlatformAdmin: u.isPlatformAdmin,
    createdAt: u.createdAt,
    propertyCount: u._count.propertyRoles,
  };
}

async function listUsers({ search, page, pageSize }) {
  const where = search
    ? {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: userSelect,
    }),
    prisma.user.count({ where }),
  ]);
  return [rows.map(toUser), total];
}

async function findUser(id) {
  const row = await prisma.user.findUnique({ where: { id }, select: userSelect });
  return row ? toUser(row) : null;
}

async function setActive(id, isActive) {
  return toUser(await prisma.user.update({ where: { id }, data: { isActive }, select: userSelect }));
}

module.exports = { listUsers, findUser, setActive };
