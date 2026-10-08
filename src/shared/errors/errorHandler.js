const logger = require('../../config/logger');
const { AppError } = require('./AppError');

/**
 * Wrap async route handlers so thrown/rejected errors reach the error
 * handler instead of crashing the process or hanging the request.
 * Usage: router.post('/x', asyncHandler(controller.create))
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Must be registered LAST, after all routes, with 4 args (Express identifies
// error middleware by arity).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, 'operational_error_5xx');
    }
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details || undefined,
      },
    });
  }

  // Unexpected error — log full detail, never leak internals to the client.
  logger.error({ err, path: req.path }, 'unexpected_error');
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

module.exports = { asyncHandler, errorHandler, notFoundHandler };
