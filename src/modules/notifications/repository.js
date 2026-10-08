const prisma = require('../../infrastructure/db/prisma');

function createNotificationRecord(data) {
  return prisma.notification.create({ data });
}

function listByProperty(propertyId, { page = 1, pageSize = 20 } = {}) {
  const where = { propertyId };
  return Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
}

/**
 * Notifications whose payload references this contact (deal/activity events
 * and reminders). Used by the contact communication timeline.
 */
function listByContact(contactId, propertyId, { skip = 0, take = 500 } = {}) {
  return prisma.notification.findMany({
    where: {
      propertyId,
      payload: { path: ['contactId'], equals: contactId },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
  });
}

async function resolveActivityReminderDue({ activityId, assignedTo, createdBy }) {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      contact: { select: { id: true, fullName: true, email: true } },
      deal: { select: { id: true, title: true } },
    },
  });
  if (!activity) return null;

  const recipientUserId = assignedTo || createdBy || activity.assignedTo || activity.createdBy;
  if (!recipientUserId) return null;

  const user = await prisma.user.findUnique({ where: { id: recipientUserId } });
  if (!user?.email || !user.isActive) return null;

  // Defence in depth: never email an activity's details to someone who has no
  // access to the activity's property, whatever the row says.
  const access = await prisma.userPropertyRole.findFirst({
    where: { userId: user.id, propertyId: activity.propertyId },
    select: { id: true },
  });
  if (!access) return null;

  return {
    propertyId: activity.propertyId,
    recipientEmail: user.email,
    recipientName: user.fullName,
    activityId: activity.id,
    contactId: activity.contactId,
    dealId: activity.dealId,
    type: activity.type,
    subject: activity.subject,
    dueAt: activity.dueAt,
    reminderAt: activity.reminderAt,
    contactName: activity.contact?.fullName ?? null,
    dealTitle: activity.deal?.title ?? null,
  };
}

module.exports = {
  createNotificationRecord,
  listByProperty,
  listByContact,
  resolveActivityReminderDue,
};
