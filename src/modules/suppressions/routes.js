const express = require('express');
const controller = require('./controller');
const { createSuppressionSchema, searchSuppressionSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

router.get(
  '/',
  validate(searchSuppressionSchema, 'query'),
  requirePermission(PERMISSIONS.SUPPRESSIONS_READ),
  asyncHandler(controller.search)
);

router.post(
  '/',
  validate(createSuppressionSchema),
  requirePermission(PERMISSIONS.SUPPRESSIONS_MANAGE),
  asyncHandler(controller.create)
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.SUPPRESSIONS_MANAGE),
  asyncHandler(controller.remove)
);

module.exports = router;
