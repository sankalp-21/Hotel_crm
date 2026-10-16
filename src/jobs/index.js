const logger = require('../config/logger');
const { createJob } = require('../shared/jobs/scheduler');
const { dispatchPending } = require('../shared/events/dispatcher');
const outboxRepository = require('../shared/events/outboxRepository');
const { processDueReminders } = require('../modules/activities/service');
const { purgeExpiredKeys } = require('../shared/middleware/idempotency');
const { registerNotificationHandlers } = require('../modules/notifications/worker');

const PUBLISHED_OUTBOX_RETENTION_DAYS = 7;

/** Queue due reminders until none are left (bounded per run). */
async function sweepReminders() {
  for (let i = 0; i < 5; i += 1) {
    const result = await processDueReminders();
    if (result.processed > 0) {
      logger.info({ processed: result.processed, activityIds: result.activityIds }, 'activities:reminders_queued');
    }
    if (result.processed < result.batchSize) break;
  }
}

async function housekeeping() {
  const keys = await purgeExpiredKeys();
  const cutoff = new Date(Date.now() - PUBLISHED_OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const events = await outboxRepository.purgePublishedBefore(cutoff);
  if (keys > 0 || events > 0) {
    logger.info({ idempotencyKeys: keys, outboxEvents: events }, 'housekeeping:purged');
  }
}

async function drainOutbox() {
  const result = await dispatchPending();
  if (result.claimed > 0) logger.info(result, 'outbox:dispatched');
}

// Loaded lazily so the sender (and its DB/Redis clients) only comes into play when the job runs.
async function sendCampaigns() {
  await require('../modules/campaigns/sender').runCampaignSends();
}

const jobs = [
  createJob({ name: 'outbox-dispatch', intervalMs: 2_000, run: drainOutbox }),
  createJob({ name: 'reminder-sweep', intervalMs: 15_000, run: sweepReminders }),
  createJob({ name: 'campaign-send', intervalMs: 3_000, run: sendCampaigns }),
  createJob({ name: 'housekeeping', intervalMs: 60 * 60 * 1000, run: housekeeping }),
];

/**
 * Start the background jobs in this process. Safe to run in several processes at once: every
 * job claims its work with row locks, so instances never process the same row.
 */
function startBackgroundJobs() {
  registerNotificationHandlers();
  jobs.forEach((job) => job.start());
}

/** Stop scheduling and wait for any run in progress to finish. */
async function stopBackgroundJobs() {
  await Promise.all(jobs.map((job) => job.stop()));
}

module.exports = { startBackgroundJobs, stopBackgroundJobs, sweepReminders, housekeeping, drainOutbox, sendCampaigns };
