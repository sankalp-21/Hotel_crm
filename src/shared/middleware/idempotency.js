const crypto = require('crypto');
const prisma = require('../../infrastructure/db/prisma');
const { ConflictError, ValidationError } = require('../errors/AppError');

/**
 * Guards state-changing endpoints against duplicate execution on retry.
 * Client sends an `Idempotency-Key` header; if that key was already used for
 * a request with the same method/path/body, the stored response is replayed.
 *
 * @param {{ required?: boolean }} [options]
 */
function idempotent(options = {}) {
  const required = Boolean(options.required);

  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key) {
      if (required) {
        return next(new ValidationError('Idempotency-Key header is required'));
      }
      return next();
    }

    const requestHash = crypto
      .createHash('sha256')
      .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body || {})}`)
      .digest('hex');

    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return next(
          new ConflictError('Idempotency-Key was already used with a different request')
        );
      }
      if (existing.status === 'completed') {
        return res.status(existing.statusCode).json(existing.responseBody);
      }
      return next(new ConflictError('A request with this Idempotency-Key is already in progress'));
    }

    await prisma.idempotencyKey.create({
      data: { key, requestHash, status: 'in_progress' },
    });

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      prisma.idempotencyKey
        .update({
          where: { key },
          data: {
            status: 'completed',
            statusCode: res.statusCode,
            responseBody: body,
            completedAt: new Date(),
          },
        })
        .catch(() => {});
      return originalJson(body);
    };

    next();
  };
}

module.exports = { idempotent };
