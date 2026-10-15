/**
 * Background worker entrypoint: `npm run worker`.
 * Runs the outbox dispatcher, reminder sweep and housekeeping without serving HTTP. Run it
 * alongside (or instead of) the in-API jobs; work is claimed with row locks so any number of
 * workers and API instances can run together without duplicating anything.
 */
const logger = require('./config/logger');
const prisma = require('./infrastructure/db/prisma');
const redis = require('./infrastructure/redis/redis');
const { startBackgroundJobs, stopBackgroundJobs } = require('./jobs');

startBackgroundJobs();
logger.info('worker started');

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, worker shutting down`);
  try {
    await stopBackgroundJobs();
    await prisma.$disconnect();
    redis.disconnect();
  } catch (err) {
    logger.error({ err }, 'worker_shutdown_error');
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled_rejection'));
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught_exception');
  shutdown('uncaughtException', 1);
});

// The job timers are unref'd (so they never block shutdown); this keeps the process alive between ticks.
setInterval(() => {}, 60 * 60 * 1000);
