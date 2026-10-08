const { EventEmitter } = require('events');
const logger = require('../../config/logger');

/**
 * Phase 2 in-process event bus. Modules emit domain events after a mutation
 * commits (reservation.created, stay.checked_in, ...) and other modules
 * (notifications, reports, ...) can subscribe without a direct dependency.
 *
 * This is intentionally NOT the outbox pattern — an event emitted here is
 * lost if the process crashes before a listener finishes. That's fine for
 * Phase 2 (nothing subscribes yet). Phase 3 introduces `outbox_events` +
 * a transactional write for anything that must survive a crash (payments,
 * invoicing) — this bus is not replaced, just no longer sufficient on its
 * own for money-moving events.
 */
class DomainEventBus extends EventEmitter {
  emitEvent(name, payload) {
    logger.debug({ event: name, payload }, 'domain_event');
    this.emit(name, payload);
  }
}

module.exports = new DomainEventBus();
