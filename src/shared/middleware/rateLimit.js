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

/** Unauthenticated public endpoints (unsubscribe). Per-IP, deliberately tighter than the global limit. */
function publicRateLimiter() {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('rl:public:'),
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  });
}

/** Provider webhooks can burst (a big campaign's bounces arrive together), so this is generous. */
function webhookRateLimiter() {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('rl:webhook:'),
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  });
}

module.exports = { globalRateLimiter, authRateLimiter, publicRateLimiter, webhookRateLimiter };
