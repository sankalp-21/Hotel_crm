/**
 * Base class for all expected/operational errors thrown intentionally by
 * modules (validation failures, not-found, conflicts, auth failures).
 * Anything NOT an AppError that reaches the error handler is treated as an
 * unexpected bug and logged with full detail, not shown to the client.
 */
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

class NotFoundError extends AppError {
  constructor(entity = 'Resource') {
    super(`${entity} not found`, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict', details = null) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, { statusCode: 429, code: 'RATE_LIMITED' });
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  TooManyRequestsError,
};
