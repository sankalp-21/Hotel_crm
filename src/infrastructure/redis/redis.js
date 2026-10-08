const Redis = require('ioredis');
const env = require('../../config/env');
const logger = require('../../config/logger');

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => logger.error({ err }, 'redis:error'));
redis.on('connect', () => logger.info('redis:connected'));

module.exports = redis;
