const prisma = require('../../infrastructure/db/prisma');

function create({ propertyId, userId, action, entityType, entityId, metadata }) {
  return prisma.auditLog.create({
    data: { propertyId, userId, action, entityType, entityId, metadata },
  });
}

function list({ propertyId, entityType, entityId, page = 1, pageSize = 50 }) {
  const where = {
    ...(propertyId && { propertyId }),
    ...(entityType && { entityType }),
    ...(entityId && { entityId }),
  };

  return Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
}

module.exports = { create, list };
