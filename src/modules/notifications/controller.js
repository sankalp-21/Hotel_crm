const prisma = require('../../infrastructure/db/prisma');

async function list(req, res) {
  const { status, eventType, page = 1, pageSize = 20 } = req.query;
  const where = {
    propertyId: req.propertyId,
    ...(status && { status }),
    ...(eventType && { eventType }),
  };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
    prisma.notification.count({ where }),
  ]);
  res.json({ items, total, page: Number(page), pageSize: Number(pageSize) });
}

module.exports = { list };
