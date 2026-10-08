const prisma = require('../../infrastructure/db/prisma');
const { filtersToWhere } = require('./filters');

function create(data) {
  return prisma.segment.create({ data });
}

function findById(id) {
  return prisma.segment.findUnique({ where: { id } });
}

function search({ propertyId, search, page, pageSize }) {
  const where = {
    propertyId,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.segment.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { campaigns: true } } },
    }),
    prisma.segment.count({ where }),
  ]);
}

function update(id, data) {
  return prisma.segment.update({ where: { id }, data });
}

function resolveContacts(propertyId, filters, { skip = 0, take = 1000 } = {}) {
  const where = filtersToWhere(propertyId, filters);
  return Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip,
      take,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        source: true,
        tags: true,
        companyId: true,
      },
    }),
    prisma.contact.count({ where }),
  ]);
}

module.exports = { create, findById, search, update, resolveContacts };
