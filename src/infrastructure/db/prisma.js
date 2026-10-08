const { PrismaClient } = require('@prisma/client');
const env = require('../../config/env');
const logger = require('../../config/logger');

// One Prisma client for the whole process — Prisma manages its own
// connection pool internally, so re-instantiating per-request would
// exhaust connections under load.
const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
});

if (env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'prisma:query');
  });
}

module.exports = prisma;
