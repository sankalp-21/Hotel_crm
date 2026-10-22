const prisma = require('../../infrastructure/db/prisma');
const { filtersToWhere } = require('./filters');

function create(data) {
  return prisma.segment.create({ data });
}

function findById(id, propertyId) {
  return prisma.segment.findFirst({ where: { id, propertyId } });
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

function update(id, propertyId, data) {
  return prisma.segment.update({ where: { id, propertyId }, data });
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
        // Needed by campaign eligibility (consent / unsubscribe / bounce checks).
        marketingConsent: true,
        unsubscribedAt: true,
        emailBounced: true,
      },
    }),
    prisma.contact.count({ where }),
  ]);
}

/**
 * Keyset page of a segment's contacts for campaign preparation: stable under inserts/deletes
 * (unlike skip/take) and cheap at any depth. Ordered by id; pass the last id as `afterId`.
 */
function resolveContactsPage(propertyId, filters, { afterId = null, take = 500 } = {}) {
  const where = { ...filtersToWhere(propertyId, filters), ...(afterId && { id: { gt: afterId } }) };
  return prisma.contact.findMany({
    where,
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true,
      marketingConsent: true,
      unsubscribedAt: true,
      emailBounced: true,
    },
  });
}

module.exports = { create, findById, search, update, resolveContacts, resolveContactsPage };
