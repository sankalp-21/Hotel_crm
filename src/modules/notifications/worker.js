const handlers = require('../../shared/events/handlers');

let registered = false;

/**
 * Subscribe notification handling to the outbox. Only events that actually produce a
 * notification are registered (those with a resolver); everything else needs no handler and is
 * simply marked published by the dispatcher.
 */
function registerNotificationHandlers() {
  if (registered) return;
  registered = true;

  const { RESOLVERS, handleEvent } = require('./service');
  for (const eventType of Object.keys(RESOLVERS)) {
    handlers.on(eventType, (payload, meta) => handleEvent(eventType, payload, meta));
  }
}

module.exports = { registerNotificationHandlers };
