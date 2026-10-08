const prisma = require('../../infrastructure/db/prisma');

const campaignInclude = {
  segment: { select: { id: true, name: true, filters: true } },
};

function create(data) {
  return prisma.campaign.create({ data, include: campaignInclude });
}

function findById(id) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      ...campaignInclude,
      recipients: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          contact: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      },
    },
  });
}

function search({ propertyId, search, status, page, pageSize }) {
  const where = {
    propertyId,
    ...(status && { status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: campaignInclude,
    }),
    prisma.campaign.count({ where }),
  ]);
}

function update(id, data) {
  return prisma.campaign.update({ where: { id }, data, include: campaignInclude });
}

function createRecipients(rows) {
  return prisma.campaignRecipient.createMany({ data: rows });
}

function updateRecipient(id, data) {
  return prisma.campaignRecipient.update({ where: { id }, data });
}

function listRecipients(campaignId) {
  return prisma.campaignRecipient.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'asc' },
    include: {
      contact: { select: { id: true, fullName: true, email: true, phone: true } },
    },
  });
}

module.exports = {
  create,
  findById,
  search,
  update,
  createRecipients,
  updateRecipient,
  listRecipients,
};
