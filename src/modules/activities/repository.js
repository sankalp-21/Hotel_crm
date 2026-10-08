const prisma = require('../../infrastructure/db/prisma');

const activityInclude = {
  contact: { select: { id: true, fullName: true, email: true, status: true } },
  deal: { select: { id: true, title: true, stageId: true } },
};

function create(data) {
  return prisma.activity.create({ data, include: activityInclude });
}

function findById(id, propertyId) {
  return prisma.activity.findFirst({ where: { id, propertyId }, include: activityInclude });
}

function search({
  propertyId,
  search,
  type,
  status,
  contactId,
  dealId,
  dueBefore,
  dueAfter,
  page,
  pageSize,
}) {
  const where = {
    propertyId,
    ...(type && { type }),
    ...(status && { status }),
    ...(contactId && { contactId }),
    ...(dealId && { dealId }),
    ...((dueBefore || dueAfter) && {
      dueAt: {
        ...(dueAfter && { gte: dueAfter }),
        ...(dueBefore && { lte: dueBefore }),
      },
    }),
    ...(search && {
      OR: [
        { subject: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: activityInclude,
    }),
    prisma.activity.count({ where }),
  ]);
}

function update(id, propertyId, data) {
  return prisma.activity.update({ where: { id, propertyId }, data, include: activityInclude });
}

/**
 * Due reminders: open activities with reminderAt in the past and not yet sent.
 */
function findDueReminders(now = new Date(), take = 50) {
  return prisma.activity.findMany({
    where: {
      status: 'open',
      reminderAt: { lte: now },
      reminderSentAt: null,
    },
    orderBy: { reminderAt: 'asc' },
    take,
    include: activityInclude,
  });
}

function markReminderSent(id, sentAt = new Date()) {
  return prisma.activity.update({
    where: { id },
    data: { reminderSentAt: sentAt },
  });
}

function listByContact(contactId, propertyId, { skip = 0, take = 50 } = {}) {
  return prisma.activity.findMany({
    where: { contactId, propertyId },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    include: activityInclude,
  });
}

module.exports = {
  create,
  findById,
  search,
  update,
  findDueReminders,
  markReminderSent,
  listByContact,
};
