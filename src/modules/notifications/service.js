const repository = require('./repository');
const templates = require('./templates');
const channel = require('./channel');
const logger = require('../../config/logger');

const RESOLVERS = {
  'activity.reminder_due': repository.resolveActivityReminderDue,
};

async function handleEvent(eventType, payload) {
  const resolve = RESOLVERS[eventType];
  if (!resolve) return;

  const context = await resolve(payload);
  if (!context) {
    logger.debug({ eventType, payload }, 'notifications:skipped_no_recipient');
    return;
  }

  const template = templates[eventType];
  if (!template) {
    logger.warn({ eventType }, 'notifications:missing_template');
    return;
  }

  const { subject, body } = template(context);

  let status = 'queued';
  let failureReason = null;
  try {
    await channel.send({ to: context.recipientEmail, subject, body });
    status = 'sent';
  } catch (err) {
    status = 'failed';
    failureReason = err.message;
    logger.error({ err, eventType }, 'notifications:send_failed');
  }

  return repository.createNotificationRecord({
    propertyId: context.propertyId,
    eventType,
    channel: 'email',
    recipientEmail: context.recipientEmail,
    subject,
    body,
    status,
    failureReason,
    payload: { ...payload, contactId: context.contactId ?? payload.contactId ?? null },
    sentAt: status === 'sent' ? new Date() : null,
  });
}

async function listNotifications(propertyId, query) {
  const [items, total] = await repository.listByProperty(propertyId, query);
  return { items, total, page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
}

module.exports = { handleEvent, listNotifications, RESOLVERS };
