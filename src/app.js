const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./infrastructure/db/prisma');
const redis = require('./infrastructure/redis/redis');
const { errorHandler, notFoundHandler } = require('./shared/errors/errorHandler');
const { globalRateLimiter } = require('./shared/middleware/rateLimit');

const authRoutes = require('./modules/auth/routes');
const usersRoutes = require('./modules/users/routes');
const platformRoutes = require('./modules/platform/routes');
const propertyRoutes = require('./modules/property/routes');
const contactsRoutes = require('./modules/contacts/routes');
const companiesRoutes = require('./modules/companies/routes');
const pipelinesRoutes = require('./modules/pipelines/routes');
const dealsRoutes = require('./modules/deals/routes');
const activitiesRoutes = require('./modules/activities/routes');
const segmentsRoutes = require('./modules/segments/routes');
const campaignsRoutes = require('./modules/campaigns/routes');
const reportsRoutes = require('./modules/reports/routes');
const auditRoutes = require('./modules/audit/routes');
const notificationsRoutes = require('./modules/notifications/routes');
const retentionRoutes = require('./modules/retention/routes');

function createApp() {
  const app = express();

  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.use(helmet());

  const corsOptions =
    env.corsOrigins.length > 0
      ? {
          origin(origin, callback) {
            // Allow non-browser clients (no Origin header): curl, mobile apps, server-to-server.
            if (!origin || env.corsOrigins.includes(origin)) {
              return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
          },
          credentials: true,
        }
      : // Development default: open CORS. Production requires CORS_ORIGINS (env guard).
        undefined;
  app.use(cors(corsOptions));

  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' && existing ? existing : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    })
  );

  app.use(globalRateLimiter());

  app.get('/health', (req, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  );

  app.get('/ready', async (req, res) => {
    const checks = { database: false, redis: false };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }
    try {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG';
    } catch {
      checks.redis = false;
    }

    const ready = checks.database && checks.redis;
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/auth', authRoutes);
  app.use('/users', usersRoutes);
  app.use('/platform', platformRoutes);
  app.use('/properties', propertyRoutes);
  app.use('/contacts', contactsRoutes);
  app.use('/companies', companiesRoutes);
  app.use('/pipeline', pipelinesRoutes);
  app.use('/deals', dealsRoutes);
  app.use('/activities', activitiesRoutes);
  app.use('/segments', segmentsRoutes);
  app.use('/campaigns', campaignsRoutes);
  app.use('/reports', reportsRoutes);
  app.use('/audit-logs', auditRoutes);
  app.use('/notifications', notificationsRoutes);
  app.use('/retention', retentionRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
