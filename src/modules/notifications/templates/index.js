/**
 * CRM notification templates keyed by event type.
 */

/** Format an instant in the property's timezone (falls back to UTC if the zone is unknown). */
function formatWhen(value, timeZone = 'UTC') {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(date)} (${timeZone})`;
  } catch {
    return `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)} (UTC)`;
  }
}

const templates = {
  'activity.reminder_due': (ctx) => ({
    subject: `Reminder: ${ctx.subject}`,
    body: [
      `Hi ${ctx.recipientName},`,
      '',
      `This is a reminder for your ${ctx.type}: "${ctx.subject}".`,
      ctx.contactName ? `Contact: ${ctx.contactName}` : null,
      ctx.dealTitle ? `Deal: ${ctx.dealTitle}` : null,
      `Due: ${formatWhen(ctx.dueAt, ctx.timezone)}`,
      `Reminder time: ${formatWhen(ctx.reminderAt, ctx.timezone)}`,
      '',
      `Activity id: ${ctx.activityId}`,
    ]
      .filter(Boolean)
      .join('\n'),
  }),
};

module.exports = templates;
module.exports.formatWhen = formatWhen;
