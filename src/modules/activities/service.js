const activitiesRepository = require('./repository');
const contactsRepository = require('../contacts/repository');
const dealsRepository = require('../deals/repository');
const notificationsRepository = require('../notifications/repository');
const { NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { assertUserHasPropertyAccess } = require('../../shared/tenancy/userAccess');
const { logAudit } = require('../audit/service');
const {
  emitActivityCreated,
  emitActivityCompleted,
  emitActivityReminderDue,
} = require('./events');

async function assertContactInProperty(contactId, propertyId) {
  if (!contactId) return;
  const contact = await contactsRepository.findById(contactId, propertyId);
  if (!contact) throw new NotFoundError('Contact');
}

async function assertDealInProperty(dealId, propertyId) {
  if (!dealId) return;
  const deal = await dealsRepository.findById(dealId, propertyId);
  if (!deal) throw new NotFoundError('Deal');
  return deal;
}

async function createActivity(data, actingUser) {
  await assertContactInProperty(data.contactId, data.propertyId);
  const deal = await assertDealInProperty(data.dealId, data.propertyId);
  await assertUserHasPropertyAccess(data.assignedTo, data.propertyId);

  // If only a deal is provided, inherit its contact for timeline linkage.
  let contactId = data.contactId ?? null;
  if (!contactId && deal?.contactId) contactId = deal.contactId;

  if (!contactId && !data.dealId) {
    throw new ValidationError('At least one of contactId or dealId is required');
  }

  const activity = await activitiesRepository.create({
    ...data,
    contactId,
    assignedTo: data.assignedTo ?? actingUser?.id ?? null,
    createdBy: actingUser?.id ?? null,
  });

  await logAudit({
    propertyId: activity.propertyId,
    userId: actingUser?.id,
    action: 'activity.created',
    entityType: 'Activity',
    entityId: activity.id,
    metadata: { type: activity.type, subject: activity.subject },
  });

  emitActivityCreated(activity);
  return activity;
}

async function getActivity(id, propertyId) {
  const activity = await activitiesRepository.findById(id, propertyId);
  if (!activity) throw new NotFoundError('Activity');
  return activity;
}

async function searchActivities(query) {
  const [items, total] = await activitiesRepository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function updateActivity(id, propertyId, data, actingUser) {
  await getActivity(id, propertyId);
  if (data.contactId !== undefined) await assertContactInProperty(data.contactId, propertyId);
  if (data.dealId !== undefined) await assertDealInProperty(data.dealId, propertyId);
  await assertUserHasPropertyAccess(data.assignedTo, propertyId);

  const patch = { ...data };
  // Changing reminder time re-arms delivery.
  if (data.reminderAt !== undefined) {
    patch.reminderSentAt = null;
  }

  if (data.status === 'completed') {
    patch.completedAt = new Date();
  }
  if (data.status === 'open') {
    patch.completedAt = null;
  }
  if (data.status === 'cancelled') {
    patch.completedAt = null;
  }

  const activity = await activitiesRepository.update(id, propertyId, patch);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'activity.updated',
    entityType: 'Activity',
    entityId: id,
    metadata: data,
  });

  if (data.status === 'completed') {
    emitActivityCompleted(activity);
  }

  return activity;
}

async function completeActivity(id, propertyId, actingUser) {
  const current = await getActivity(id, propertyId);
  if (current.status === 'completed') return current;

  const activity = await activitiesRepository.update(id, propertyId, {
    status: 'completed',
    completedAt: new Date(),
  });

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'activity.completed',
    entityType: 'Activity',
    entityId: id,
  });

  emitActivityCompleted(activity);
  return activity;
}

/**
 * Sweep due reminders and emit one event per activity. Marks reminderSentAt
 * before emitting so a crash mid-batch won't double-send forever (at-most-once
 * for the stub channel is fine for Phase 3).
 */
async function processDueReminders(now = new Date()) {
  const due = await activitiesRepository.findDueReminders(now);
  const results = [];

  for (const activity of due) {
    await activitiesRepository.markReminderSent(activity.id, now);
    emitActivityReminderDue(activity);
    results.push(activity.id);
  }

  return { processed: results.length, activityIds: results };
}

/**
 * Chronological feed: activities + notifications tied to a contact.
 */
async function getContactTimeline(contactId, propertyId, { page = 1, pageSize = 50 } = {}) {
  await assertContactInProperty(contactId, propertyId);

  const [activities, notifications] = await Promise.all([
    activitiesRepository.listByContact(contactId, propertyId, { skip: 0, take: 500 }),
    notificationsRepository.listByContact(contactId, propertyId, { skip: 0, take: 500 }),
  ]);

  const items = [
    ...activities.map((a) => ({
      kind: 'activity',
      id: a.id,
      at: a.completedAt || a.createdAt,
      data: a,
    })),
    ...notifications.map((n) => ({
      kind: 'notification',
      id: n.id,
      at: n.sentAt || n.createdAt,
      data: n,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { items: pageItems, total: items.length, page, pageSize };
}

module.exports = {
  createActivity,
  getActivity,
  searchActivities,
  updateActivity,
  completeActivity,
  processDueReminders,
  getContactTimeline,
};
