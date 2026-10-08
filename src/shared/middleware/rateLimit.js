const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../../infrastructure/redis/redis');
const env = require('../../config/env');

function createRedisStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: (...args) => redis.call(...args),
  });
}

function globalRateLimiter() {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('rl:global:'),
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    },
  });
}

function authRateLimiter() {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('rl:auth:'),
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many auth attempts. Please try again later.',
      },
    },
  });
}

module.exports = { globalRateLimiter, authRateLimiter };
