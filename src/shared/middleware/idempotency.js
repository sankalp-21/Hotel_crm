const crypto = require('crypto');
const prisma = require('../../infrastructure/db/prisma');
const logger = require('../../config/logger');
const { ConflictError, ValidationError, UnauthorizedError } = require('../errors/AppError');

// A finished request is replayable for this long.
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
// A request still running holds its key for this long. If the process dies mid-request
// the lease lapses and the client can retry, instead of being blocked until the TTL.
// Keep this longer than the slowest idempotent endpoint (synchronous campaign send).
const IN_PROGRESS_LEASE_MS = 10 * 60 * 1000;
const MAX_KEY_LENGTH = 255;
const CLAIM_ATTEMPTS = 3;

/** Keys are private to the caller within a tenant: user A can never replay, or collide with, user B. */
function buildScope(req) {
  return `${req.user.id}:${req.propertyId || '-'}`;
}

function hashRequest(req) {
  return crypto
    .createHash('sha256')
    .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body || {})}`)
    .digest('hex');
}

/**
 * Atomically claim (scope, key). Resolves to one of:
 *   { action: 'execute' }            — this request owns the key and should run
 *   { action: 'replay', record }     — an identical request already finished
 *   { action: 'conflict', error }    — same key, different request / still in flight
 */
async function claim({ scope, key, requestHash }) {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const now = new Date();
    try {
      await prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          requestHash,
          status: 'in_progress',
          expiresAt: new Date(now.getTime() + IN_PROGRESS_LEASE_MS),
        },
      });
      return { action: 'execute' };
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }

    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) continue; // deleted between our insert and our read — try again

    if (existing.expiresAt <= now) {
      // Expired (old result, or a request that died holding its lease). The condition on
      // expiresAt makes this safe against someone else having just reclaimed the same row.
      await prisma.idempotencyKey.deleteMany({
        where: { id: existing.id, expiresAt: { lte: now } },
      });
      continue;
    }

    if (existing.requestHash !== requestHash) {
      return {
        action: 'conflict',
        error: new ConflictError('Idempotency-Key was already used with a different request'),
      };
    }
    if (existing.status === 'completed') {
      return { action: 'replay', record: existing };
    }
    return {
      action: 'conflict',
      error: new ConflictError('A request with this Idempotency-Key is already in progress'),
    };
  }

  return {
    action: 'conflict',
    error: new ConflictError('Could not acquire the Idempotency-Key; please retry'),
  };
}

/**
 * Record the outcome. Server errors are NOT cached: the row is removed so a retry
 * re-runs the work. Everything else (2xx and deterministic 4xx) is stored for replay.
 * Never throws — a failed bookkeeping write must not turn a finished request into an error.
 */
async function persistOutcome({ scope, key, statusCode, body }) {
  try {
    if (statusCode >= 500) {
      await prisma.idempotencyKey.deleteMany({ where: { scope, key } });
      return;
    }
    await prisma.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: {
        status: 'completed',
        statusCode,
        responseBody: body === undefined || body === null ? {} : body,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + COMPLETED_TTL_MS),
      },
    });
  } catch (err) {
    logger.error({ err, scope, key }, 'idempotency:persist_failed');
  }
}

/**
 * Guards state-changing endpoints against duplicate execution on retry.
 * The client sends an `Idempotency-Key` header; a repeat of the same request
 * (same method, URL and body, same user and property) replays the stored response.
 *
 * Must be mounted after authenticate + resolvePropertyContext.
 *
 * @param {{ required?: boolean }} [options]
 */
function idempotent(options = {}) {
  const required = Boolean(options.required);

  return async (req, res, next) => {
    try {
      const key = req.headers['idempotency-key'];
      if (!key) {
        if (required) return next(new ValidationError('Idempotency-Key header is required'));
        return next();
      }
      if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) {
        return next(
          new ValidationError(`Idempotency-Key must be a string of at most ${MAX_KEY_LENGTH} characters`)
        );
      }
      // Fail closed: a key with no owner could be replayed by anyone.
      if (!req.user) return next(new UnauthorizedError());

      const scope = buildScope(req);
      const requestHash = hashRequest(req);

      const outcome = await claim({ scope, key, requestHash });
      if (outcome.action === 'conflict') return next(outcome.error);
      if (outcome.action === 'replay') {
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(outcome.record.statusCode).json(outcome.record.responseBody);
      }

      // Persist the outcome BEFORE the response goes out. Previously this write was
      // fire-and-forget, so a client retrying immediately could still see "in progress".
      const originalJson = res.json.bind(res);
      let finished = false;
      res.json = (body) => {
        if (finished) return res;
        finished = true;
        const statusCode = res.statusCode;
        persistOutcome({ scope, key, statusCode, body }).then(() => originalJson(body));
        return res;
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Remove keys past their expiry (finished results older than the TTL, abandoned leases). */
async function purgeExpiredKeys(now = new Date()) {
  const result = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
}

let cleanupTimer = null;

function startIdempotencyCleanup({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (cleanupTimer) return;
  const run = () =>
    purgeExpiredKeys()
      .then((count) => {
        if (count > 0) logger.info({ count }, 'idempotency:purged_expired_keys');
      })
      .catch((err) => logger.error({ err }, 'idempotency:purge_failed'));
  run();
  cleanupTimer = setInterval(run, intervalMs);
  cleanupTimer.unref();
}

function stopIdempotencyCleanup() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

module.exports = {
  idempotent,
  purgeExpiredKeys,
  startIdempotencyCleanup,
  stopIdempotencyCleanup,
  COMPLETED_TTL_MS,
  IN_PROGRESS_LEASE_MS,
};
