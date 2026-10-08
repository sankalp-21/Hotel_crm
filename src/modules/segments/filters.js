/**
 * Turn a Segment.filters JSON object into a Prisma Contact where clause.
 * Supported keys: status, source, companyId, tags (hasSome), hasEmail,
 * search, createdBefore, createdAfter.
 */
function filtersToWhere(propertyId, filters = {}) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const where = {
    propertyId,
    ...(f.status && { status: f.status }),
    ...(f.source && { source: f.source }),
    ...(f.companyId && { companyId: f.companyId }),
    ...(Array.isArray(f.tags) && f.tags.length > 0 && { tags: { hasSome: f.tags } }),
    ...(f.hasEmail === true && { email: { not: null } }),
    ...(f.hasEmail === false && { email: null }),
    ...((f.createdBefore || f.createdAfter) && {
      createdAt: {
        ...(f.createdAfter && { gte: new Date(f.createdAfter) }),
        ...(f.createdBefore && { lte: new Date(f.createdBefore) }),
      },
    }),
    ...(f.search && {
      OR: [
        { fullName: { contains: f.search, mode: 'insensitive' } },
        { email: { contains: f.search, mode: 'insensitive' } },
        { phone: { contains: f.search } },
      ],
    }),
  };
  return where;
}

module.exports = { filtersToWhere };
