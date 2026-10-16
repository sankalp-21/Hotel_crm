const prisma = require('../../infrastructure/db/prisma');

const LOOKUP_CHUNK = 1000;

function create(data) {
  return prisma.suppressionEntry.create({ data });
}

function findByAddress(propertyId, channel, address) {
  return prisma.suppressionEntry.findFirst({ where: { propertyId, channel, address } });
}

function findById(id, propertyId) {
  return prisma.suppressionEntry.findFirst({ where: { id, propertyId } });
}

function search({ propertyId, channel, reason, search, page, pageSize }) {
  const where = {
    propertyId,
    ...(channel && { channel }),
    ...(reason && { reason }),
    ...(search && { address: { contains: search.trim().toLowerCase() } }),
  };
  return Promise.all([
    prisma.suppressionEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.suppressionEntry.count({ where }),
  ]);
}

function remove(id, propertyId) {
  return prisma.suppressionEntry.deleteMany({ where: { id, propertyId } });
}

/** Which of these (already normalised) addresses are suppressed? Chunked so big segments stay cheap. */
async function findSuppressedAddresses(propertyId, channel, addresses) {
  const found = new Set();
  const unique = [...new Set(addresses.filter(Boolean))];
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const rows = await prisma.suppressionEntry.findMany({
      where: { propertyId, channel, address: { in: unique.slice(i, i + LOOKUP_CHUNK) } },
      select: { address: true },
    });
    for (const r of rows) found.add(r.address);
  }
  return found;
}

module.exports = { create, findByAddress, findById, search, remove, findSuppressedAddresses };
