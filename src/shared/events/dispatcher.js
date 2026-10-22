const env = require('../../config/env');
const logger = require('../../config/logger');
const handlersRegistry = require('./handlers');
const outboxRepository = require('./outboxRepository');

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
// Longer than the slowest handler (SMTP has its own timeouts), so a live dispatcher never has its
// lease taken; short enough that a crashed one is recovered promptly.
const LEASE_SECONDS = 120;
const BATCH_SIZE = 50;

/** 5s, 10s, 20s, ... capped at 15 minutes. `attempts` is the number of deliveries tried so far. */
function computeBackoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Deliver one leased event to its handlers and record the outcome. Never throws.
 * Returns 'published' | 'retry' | 'failed'.
 */
async function processEvent(row, deps) {
  const { handlers, repo, now, maxAttempts, log } = deps;
  try {
    for (const handler of handlers.handlersFor(row.eventType)) {
      await handler(row.payload, { eventId: row.id, eventType: row.eventType, attempt: row.attempts });
    }
    await repo.markPublished(row.id);
    return 'published';
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 1000);
    try {
      if (row.attempts >= maxAttempts) {
        await repo.markFailed(row.id, message);
        log.error({ eventId: row.id, eventType: row.eventType, attempts: row.attempts, err }, 'outbox:dead_lettered');
        return 'failed';
      }
      await repo.markRetry(row.id, new Date(now().getTime() + computeBackoffMs(row.attempts)), message);
      log.warn({ eventId: row.id, eventType: row.eventType, attempts: row.attempts, err }, 'outbox:will_retry');
      return 'retry';
    } catch (bookkeepingErr) {
      // Leave the row leased; it becomes claimable again when the lease expires.
      log.error({ eventId: row.id, err: bookkeepingErr }, 'outbox:bookkeeping_failed');
      return 'retry';
    }
  }
}

/** Lease and deliver one batch. Dependencies are injectable so the logic is testable without a database. */
async function dispatchBatch({
  repo = outboxRepository,
  handlers = handlersRegistry,
  limit = BATCH_SIZE,
  leaseSeconds = LEASE_SECONDS,
  now = () => new Date(),
  maxAttempts = env.OUTBOX_MAX_ATTEMPTS,
  log = logger,
} = {}) {
  const rows = await repo.claim(limit, leaseSeconds);
  const summary = { claimed: rows.length, published: 0, retry: 0, failed: 0 };
  for (const row of rows) {
    const outcome = await processEvent(row, { handlers, repo, now, maxAttempts, log });
    summary[outcome] += 1;
  }
  return { ...summary, batchSize: limit };
}

/** Drain the queue, a bounded number of batches per call so one tick can't run forever. */
async function dispatchPending({ maxBatches = 5, ...options } = {}) {
  const total = { claimed: 0, published: 0, retry: 0, failed: 0 };
  for (let i = 0; i < maxBatches; i += 1) {
    const result = await dispatchBatch(options);
    for (const key of Object.keys(total)) total[key] += result[key];
    if (result.claimed < result.batchSize) break;
  }
  return total;
}

module.exports = {
  computeBackoffMs,
  processEvent,
  dispatchBatch,
  dispatchPending,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  LEASE_SECONDS,
};
