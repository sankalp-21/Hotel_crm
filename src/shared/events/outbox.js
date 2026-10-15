/**
 * Publishing side of the transactional outbox.
 *
 * `publish(tx, event)` inserts an outbox row using the SAME transaction client as the business
 * change, so both commit or neither does. The dispatcher (dispatcher.js) delivers the row to
 * its handlers afterwards, retrying until it succeeds or is dead-lettered.
 */

// Normalise to plain JSON (Dates, Prisma Decimals -> strings) so the Json column always accepts it.
const toJson = (value) => JSON.parse(JSON.stringify(value ?? {}));

function publish(db, { aggregateType, aggregateId, eventType, payload }) {
  return db.outboxEvent.create({
    data: { aggregateType, aggregateId, eventType, payload: toJson(payload) },
  });
}

module.exports = { publish };
