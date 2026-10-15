const logger = require('../../config/logger');

/**
 * A recurring job that never overlaps itself: if a run is still going when the next tick fires,
 * that tick is skipped. Errors are logged, never thrown, so one bad run can't stop the schedule.
 * `stop()` resolves once any run in progress has finished (for graceful shutdown).
 */
function createJob({ name, intervalMs, run, initialDelayMs = 1_000, log = logger }) {
  let timer = null;
  let first = null;
  let current = null;

  const tick = () => {
    if (current) return current;
    current = (async () => {
      try {
        await run();
      } catch (err) {
        log.error({ err, job: name }, 'job:failed');
      } finally {
        current = null;
      }
    })();
    return current;
  };

  return {
    name,
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
      first = setTimeout(tick, initialDelayMs);
      first.unref?.();
      log.info({ job: name, intervalMs }, 'job:started');
    },
    async stop() {
      if (timer) clearInterval(timer);
      if (first) clearTimeout(first);
      timer = null;
      first = null;
      if (current) await current;
    },
    /** Run now (tests, manual triggers). Skips if already running. */
    runOnce: tick,
  };
}

module.exports = { createJob };
