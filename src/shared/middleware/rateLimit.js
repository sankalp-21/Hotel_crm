const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../../infrastructure/redis/redis');
const env = require('../../config/env');
const { verifyUnsubscribeToken } = require('../../modules/unsubscribe/tokens');

function createRedisStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: (...args) => redis.call(...args),
  });
}

/** True when the request carries a genuine, unexpired unsubscribe token that WE signed. */
function hasValidUnsubscribeToken(req) {
  return Boolean(verifyUnsubscribeToken(req.query && req.query.token));
}

/**
 * Requests that must not be starved by the per-IP global limit:
 *  - unsubscribe links/one-click POSTs with a valid signed token. Mail providers send one-click
 *    unsubscribes (RFC 8058) from a few shared IPs, so a per-IP cap would reject real opt-outs, and a
 *    failed opt-out is a compliance problem. They are limited per contact instead (see below).
 *  - provider delivery webhooks, which have their own (generous) limiter and a signature check.
 * Forged or missing tokens are NOT exempt: they stay under the per-IP limits.
 */
function isExemptFromGlobalLimit(req) {
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/public/delivery-events/')) return true;
  return (url === '/public/unsubscribe' || url.startsWith('/public/unsubscribe?')) && hasValidUnsubscribeToken(req);
}

function globalRateLimiter({ store, max } = {}) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: max ?? env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isExemptFromGlobalLimit,
    store: store ?? createRedisStore('rl:global:'),
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

/**
 * Unauthenticated unsubscribe endpoint, per IP. Applies only to requests WITHOUT a valid token
 * (forgery / probing attempts), so it can stay tight. Real links are limited per contact instead.
 */
function publicRateLimiter({ store, max = 60 } = {}) {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: hasValidUnsubscribeToken,
    store: store ?? createRedisStore('rl:public:'),
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  });
}

/**
 * Requests WITH a valid token, limited per contact (not per IP) so shared mail-provider IPs are not
 * penalised, while one leaked link still cannot be used to hammer the database.
 */
function unsubscribeTokenRateLimiter({ store, max = 30 } = {}) {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !hasValidUnsubscribeToken(req),
    keyGenerator: (req) => `unsub:${verifyUnsubscribeToken(req.query.token).contactId}`,
    store: store ?? createRedisStore('rl:unsub-token:'),
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

module.exports = {
  globalRateLimiter,
  authRateLimiter,
  publicRateLimiter,
  unsubscribeTokenRateLimiter,
  webhookRateLimiter,
};
