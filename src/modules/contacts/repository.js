const prisma = require('../../infrastructure/db/prisma');

const companySummary = {
  select: { id: true, name: true, type: true, email: true, phone: true },
};

function create(data) {
  return prisma.contact.create({
    data,
    include: { company: companySummary, documents: true },
  });
}

function findById(id) {
  return prisma.contact.findUnique({
    where: { id },
    include: { company: companySummary, documents: true },
  });
}

function search({ propertyId, search, status, source, companyId, tag, page, pageSize }) {
  const where = {
    propertyId,
    ...(status && { status }),
    ...(source && { source }),
    ...(companyId && { companyId }),
    ...(tag && { tags: { has: tag } }),
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    }),
  };

  return Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { company: companySummary },
    }),
    prisma.contact.count({ where }),
  ]);
}

function update(id, data) {
  return prisma.contact.update({
    where: { id },
    data,
    include: { company: companySummary, documents: true },
  });
}

module.exports = { create, findById, search, update };
