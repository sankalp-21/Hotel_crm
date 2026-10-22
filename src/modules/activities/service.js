const activitiesRepository = require('./repository');
const contactsRepository = require('../contacts/repository');
const dealsRepository = require('../deals/repository');
const notificationsRepository = require('../notifications/repository');
const { NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { assertUserHasPropertyAccess } = require('../../shared/tenancy/userAccess');
const { logAudit } = require('../audit/service');
const {
  recordActivityCreated,
  recordActivityCompleted,
  recordActivityReminderDue,
} = require('./events');
const { withTransaction } = require('../../shared/db/transaction');

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

  const activity = await withTransaction(async (tx) => {
    const created = await activitiesRepository.create(
      {
        ...data,
        contactId,
        assignedTo: data.assignedTo ?? actingUser?.id ?? null,
        createdBy: actingUser?.id ?? null,
      },
      tx
    );
    await recordActivityCreated(tx, created);
    return created;
  });

  await logAudit({
    propertyId: activity.propertyId,
    userId: actingUser?.id,
    action: 'activity.created',
    entityType: 'Activity',
    entityId: activity.id,
    metadata: { type: activity.type, subject: activity.subject },
  });

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

  const activity = await withTransaction(async (tx) => {
    const updated = await activitiesRepository.update(id, propertyId, patch, tx);
    if (data.status === 'completed') await recordActivityCompleted(tx, updated);
    return updated;
  });
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'activity.updated',
    entityType: 'Activity',
    entityId: id,
    metadata: data,
  });

  return activity;
}

async function completeActivity(id, propertyId, actingUser) {
  const current = await getActivity(id, propertyId);
  if (current.status === 'completed') return current;

  const activity = await withTransaction(async (tx) => {
    const updated = await activitiesRepository.update(
      id,
      propertyId,
      { status: 'completed', completedAt: new Date() },
      tx
    );
    await recordActivityCompleted(tx, updated);
    return updated;
  });

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'activity.completed',
    entityType: 'Activity',
    entityId: id,
  });

  return activity;
}

/**
 * Sweep due reminders and emit one event per activity. Marks reminderSentAt
 * before emitting so a crash mid-batch won't double-send forever (at-most-once
 * for the stub channel is fine for Phase 3).
 */
const REMINDER_BATCH_SIZE = 50;

/**
 * Queue due reminders. In ONE transaction: claim the rows (locked, skip-locked, flagged as
 * queued) and write their outbox events. Either every claimed reminder is queued or none is, and
 * concurrent sweeps never claim the same activity. Delivery (and retry on failure) is the outbox
 * dispatcher's job.
 */
async function processDueReminders() {
  const claimed = await withTransaction(async (tx) => {
    const rows = await activitiesRepository.claimDueReminders(tx, REMINDER_BATCH_SIZE);
    for (const activity of rows) {
      await recordActivityReminderDue(tx, activity);
    }
    return rows;
  });

  return {
    processed: claimed.length,
    activityIds: claimed.map((a) => a.id),
    batchSize: REMINDER_BATCH_SIZE,
  };
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
