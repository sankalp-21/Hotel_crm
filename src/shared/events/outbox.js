const prisma = require('../../infrastructure/db/prisma');
const bus = require('./bus');
const logger = require('../../config/logger');

/**
 * Publishes ONE already-committed outbox row: emits it on the bus, then
 * marks it published. If the process crashes between these two steps, the
 * row is still 'pending' and drainPendingOutboxEvents() below will pick it
 * up and re-emit — at-least-once delivery, which is why every subscriber
 * on the bus must itself be idempotent (see payments webhook handling).
 */
async function dispatchOutboxEvent(id) {
  const row = await prisma.outboxEvent.findUnique({ where: { id } });
  if (!row || row.status === 'published') return;

  bus.emitEvent(row.eventType, row.payload);

  await prisma.outboxEvent.update({ where: { id }, data: { status: 'published', publishedAt: new Date() } });
}

/**
 * Sweeps any rows still 'pending' (e.g. the process crashed right after
 * commit, before dispatchOutboxEvent ran). Not wired into a scheduler by
 * default in Phase 3 — call this from a cron/BullMQ repeatable job once
 * that infrastructure is actually needed, same as
 * reservations/holdExpiry.worker.js.
 */
async function drainPendingOutboxEvents() {
  const pending = await prisma.outboxEvent.findMany({ where: { status: 'pending' }, take: 100 });
  for (const row of pending) {
    await dispatchOutboxEvent(row.id);
  }
  if (pending.length > 0) {
    logger.info({ count: pending.length }, 'outbox:drained');
  }
  return pending.length;
}

module.exports = { dispatchOutboxEvent, drainPendingOutboxEvents };
