const env = require('./config/env');
const logger = require('./config/logger');
const createApp = require('./app');
const prisma = require('./infrastructure/db/prisma');
const redis = require('./infrastructure/redis/redis');
const { registerNotificationListeners } = require('./modules/notifications/worker');
const { startReminderSweep, stopReminderSweep } = require('./modules/activities/reminder.worker');
const {
  startIdempotencyCleanup,
  stopIdempotencyCleanup,
} = require('./shared/middleware/idempotency');

registerNotificationListeners();
startReminderSweep({ intervalMs: 15_000 });
startIdempotencyCleanup();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`hotel-crm-backend listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  stopReminderSweep();
  stopIdempotencyCleanup();
  server.close(async () => {
    try {
      await prisma.$disconnect();
      redis.disconnect();
      logger.info('shutdown complete');
      process.exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'shutdown_error');
      process.exit(1);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled_rejection');
  if (env.NODE_ENV === 'production') {
    shutdown('unhandledRejection', 1);
  }
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught_exception');
  shutdown('uncaughtException', 1);
});
