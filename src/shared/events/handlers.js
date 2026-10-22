/**
 * Registry of outbox event handlers. A handler is `async (payload, meta) => void`, with
 * meta = { eventId, eventType, attempt }.
 *
 * Delivery is AT LEAST ONCE: a handler can be called again for the same event (a crash after
 * it finished but before the event was marked published, or a retry after a sibling handler
 * failed). Handlers must therefore be idempotent — use meta.eventId as the dedupe key.
 * A handler that throws makes the whole event retry with backoff.
 */
const registry = new Map();

function on(eventType, handler) {
  if (typeof handler !== 'function') throw new TypeError('handler must be a function');
  if (!registry.has(eventType)) registry.set(eventType, []);
  registry.get(eventType).push(handler);
}

function handlersFor(eventType) {
  return registry.get(eventType) || [];
}

/** Test helper. */
function clear() {
  registry.clear();
}

module.exports = { on, handlersFor, clear };
