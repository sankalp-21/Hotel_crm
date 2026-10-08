const logger = require('../../config/logger');
const { processDueReminders } = require('./service');

const DEFAULT_INTERVAL_MS = 30_000;
let timer = null;

/**
 * Polls for open activities whose reminderAt has passed and emits
 * activity.reminder_due (handled by the notifications worker). Same pattern
 * as the old PMS holdExpiry worker — not load-bearing until the process is
 * up, and safe to call repeatedly.
 */
function startReminderSweep({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return;

  const tick = async () => {
    try {
      const result = await processDueReminders();
      if (result.processed > 0) {
        logger.info({ processed: result.processed, activityIds: result.activityIds }, 'activities:reminders_sent');
      }
    } catch (err) {
      logger.error({ err }, 'activities:reminder_sweep_failed');
    }
  };

  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Run once shortly after boot so a just-due reminder isn't stuck until the
  // first full interval.
  setTimeout(tick, 1_000).unref?.();
  logger.info({ intervalMs }, 'activities:reminder_sweep_started');
}

function stopReminderSweep() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startReminderSweep, stopReminderSweep };
