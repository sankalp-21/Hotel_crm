const prisma = require('../../infrastructure/db/prisma');

const dealInclude = {
  stage: true,
  contact: { select: { id: true, fullName: true, email: true, status: true } },
  company: { select: { id: true, name: true, type: true, email: true } },
};

function create(data) {
  return prisma.deal.create({ data, include: dealInclude });
}

function findById(id) {
  return prisma.deal.findUnique({ where: { id }, include: dealInclude });
}

function search({ propertyId, search, stageId, contactId, companyId, outcome, page, pageSize }) {
  const where = {
    propertyId,
    ...(stageId && { stageId }),
    ...(contactId && { contactId }),
    ...(companyId && { companyId }),
    ...(outcome === 'open' && { stage: { isWon: false, isLost: false } }),
    ...(outcome === 'won' && { stage: { isWon: true } }),
    ...(outcome === 'lost' && { stage: { isLost: true } }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { source: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.deal.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: dealInclude,
    }),
    prisma.deal.count({ where }),
  ]);
}

function update(id, data) {
  return prisma.deal.update({ where: { id }, data, include: dealInclude });
}

module.exports = { create, findById, search, update };
