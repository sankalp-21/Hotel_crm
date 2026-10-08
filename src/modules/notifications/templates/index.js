/**
 * CRM notification templates keyed by event type.
 */
function formatWhen(d) {
  if (!d) return 'n/a';
  return new Date(d).toISOString();
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
      `Due: ${formatWhen(ctx.dueAt)}`,
      `Reminder time: ${formatWhen(ctx.reminderAt)}`,
      '',
      `Activity id: ${ctx.activityId}`,
    ]
      .filter(Boolean)
      .join('\n'),
  }),
};

module.exports = templates;
