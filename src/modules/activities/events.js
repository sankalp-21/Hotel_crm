const bus = require('../../shared/events/bus');

function emitActivityCreated(activity) {
  bus.emitEvent('activity.created', {
    activityId: activity.id,
    propertyId: activity.propertyId,
    contactId: activity.contactId,
    dealId: activity.dealId,
    type: activity.type,
  });
}

function emitActivityCompleted(activity) {
  bus.emitEvent('activity.completed', {
    activityId: activity.id,
    propertyId: activity.propertyId,
    contactId: activity.contactId,
    dealId: activity.dealId,
    type: activity.type,
  });
}

function emitActivityReminderDue(activity) {
  bus.emitEvent('activity.reminder_due', {
    activityId: activity.id,
    propertyId: activity.propertyId,
    contactId: activity.contactId,
    dealId: activity.dealId,
    type: activity.type,
    subject: activity.subject,
    dueAt: activity.dueAt,
    reminderAt: activity.reminderAt,
    assignedTo: activity.assignedTo,
    createdBy: activity.createdBy,
  });
}

module.exports = {
  emitActivityCreated,
  emitActivityCompleted,
  emitActivityReminderDue,
};
