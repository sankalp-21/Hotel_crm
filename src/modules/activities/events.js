const { publish } = require('../../shared/events/outbox');

/** Record activity events in the outbox using the caller's transaction client. */
const base = (activity) => ({
  activityId: activity.id,
  propertyId: activity.propertyId,
  contactId: activity.contactId,
  dealId: activity.dealId,
  type: activity.type,
});

function recordActivityCreated(db, activity) {
  return publish(db, {
    aggregateType: 'Activity',
    aggregateId: activity.id,
    eventType: 'activity.created',
    payload: base(activity),
  });
}

function recordActivityCompleted(db, activity) {
  return publish(db, {
    aggregateType: 'Activity',
    aggregateId: activity.id,
    eventType: 'activity.completed',
    payload: base(activity),
  });
}

function recordActivityReminderDue(db, activity) {
  return publish(db, {
    aggregateType: 'Activity',
    aggregateId: activity.id,
    eventType: 'activity.reminder_due',
    payload: {
      ...base(activity),
      subject: activity.subject,
      dueAt: activity.dueAt,
      reminderAt: activity.reminderAt,
      assignedTo: activity.assignedTo,
      createdBy: activity.createdBy,
    },
  });
}

module.exports = { recordActivityCreated, recordActivityCompleted, recordActivityReminderDue };
