const express = require('express');
const controller = require('./controller');
const { loginSchema, refreshSchema, createUserSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { idempotent } = require('../../shared/middleware/idempotency');
const { authRateLimiter } = require('../../shared/middleware/rateLimit');
const { PERMISSIONS } = require('./permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();
const authLimiter = authRateLimiter();

router.post('/login', authLimiter, validate(loginSchema), asyncHandler(controller.login));
router.post('/refresh', authLimiter, validate(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

// Roles the caller is allowed to assign at the current property.
router.get(
  '/roles',
  authenticate,
  resolvePropertyContext,
  requirePermission(PERMISSIONS.USERS_CREATE),
  asyncHandler(controller.listRoles)
);

router.post(
  '/users',
  authenticate,
  validate(createUserSchema),
  resolvePropertyContext,
  requirePermission(PERMISSIONS.USERS_CREATE),
  idempotent({ required: true }),
  asyncHandler(controller.createUser)
);

module.exports = router;
