const prisma = require('../../infrastructure/db/prisma');

function create(data) {
  return prisma.company.create({ data });
}

function findById(id) {
  return prisma.company.findUnique({
    where: { id },
    include: {
      contacts: {
        select: { id: true, fullName: true, email: true, phone: true, status: true },
        orderBy: { fullName: 'asc' },
      },
    },
  });
}

function search({ propertyId, search, type, page, pageSize }) {
  const where = {
    propertyId,
    ...(type && { type }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    }),
  };

  return Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { contacts: true } } },
    }),
    prisma.company.count({ where }),
  ]);
}

function update(id, data) {
  return prisma.company.update({ where: { id }, data });
}

module.exports = { create, findById, search, update };
