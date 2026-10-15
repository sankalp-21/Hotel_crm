const repository = require('./repository');
const templates = require('./templates');
const channel = require('./channel');
const logger = require('../../config/logger');

const RESOLVERS = {
  'activity.reminder_due': repository.resolveActivityReminderDue,
};

/**
 * Outbox handler for notification-producing events. Idempotent and retry-friendly:
 *  - `meta.eventId` keys the notification row, so a redelivered event never sends twice once it
 *    has succeeded;
 *  - a failed send is recorded AND rethrown, so the outbox retries it with backoff (and
 *    dead-letters it after OUTBOX_MAX_ATTEMPTS) instead of silently losing the notification.
 * Events with no recipient (user removed, no access) are skipped without error — not retryable.
 */
async function handleEvent(eventType, payload, meta = {}) {
  const resolve = RESOLVERS[eventType];
  if (!resolve) return null;

  const context = await resolve(payload);
  if (!context) {
    logger.debug({ eventType, payload }, 'notifications:skipped_no_recipient');
    return null;
  }

  const template = templates[eventType];
  if (!template) {
    logger.warn({ eventType }, 'notifications:missing_template');
    return null;
  }

  const dedupeKey = meta.eventId ? `${meta.eventId}:email` : null;
  if (dedupeKey) {
    const existing = await repository.findByDedupeKey(dedupeKey);
    if (existing && existing.status === 'sent') return existing;
  }

  const { subject, body } = template(context);
  const record = {
    propertyId: context.propertyId,
    eventType,
    channel: 'email',
    recipientEmail: context.recipientEmail,
    subject,
    body,
    payload: { ...payload, contactId: context.contactId ?? payload.contactId ?? null },
    dedupeKey,
  };

  try {
    await channel.send({ to: context.recipientEmail, subject, body });
  } catch (err) {
    logger.error({ err, eventType }, 'notifications:send_failed');
    await repository.saveNotification({ ...record, status: 'failed', failureReason: err.message, sentAt: null });
    throw err;
  }

  return repository.saveNotification({ ...record, status: 'sent', failureReason: null, sentAt: new Date() });
}

async function listNotifications(propertyId, query) {
  const [items, total] = await repository.listByProperty(propertyId, query);
  return { items, total, page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
}

module.exports = { handleEvent, listNotifications, RESOLVERS };
