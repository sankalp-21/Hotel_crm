const bus = require('../../shared/events/bus');
const logger = require('../../config/logger');

let registered = false;

const CRM_NOTIFICATION_EVENTS = [
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'activity.created',
  'activity.completed',
  'activity.reminder_due',
  'campaign.sent',
];

function registerNotificationListeners() {
  if (registered) return;
  registered = true;

  for (const eventType of CRM_NOTIFICATION_EVENTS) {
    bus.on(eventType, async (payload) => {
      try {
        const notificationsService = require('./service');
        await notificationsService.handleEvent(eventType, payload);
      } catch (err) {
        logger.error({ err, eventType, payload }, 'notifications:handler_failed');
      }
    });
  }
}

module.exports = { registerNotificationListeners, CRM_NOTIFICATION_EVENTS };
