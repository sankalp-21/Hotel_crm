const { ValidationError } = require('../errors/AppError');

/**
 * Every authenticated request in a multi-property system needs to know
 * which property it's operating on, before RBAC can check permissions.
 * Checked in order: route param -> body -> query string -> header (x-property-id).
 * Must run AFTER `authenticate` and BEFORE `requirePermission`.
 */
function resolvePropertyContext(req, res, next) {
  const propertyId =
    req.params.propertyId ||
    req.body?.propertyId ||
    req.query?.propertyId ||
    req.headers['x-property-id'];

  if (!propertyId) {
    return next(new ValidationError('propertyId is required (param, body, or x-property-id header)'));
  }

  req.propertyId = propertyId;
  next();
}

module.exports = { resolvePropertyContext };