const express = require('express');
const controller = require('./controller');
const {
  createActivitySchema,
  updateActivitySchema,
  searchActivitySchema,
} = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

router.post(
  '/',
  validate(createActivitySchema),
  requirePermission(PERMISSIONS.ACTIVITIES_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchActivitySchema, 'query'),
  requirePermission(PERMISSIONS.ACTIVITIES_READ),
  asyncHandler(controller.search)
);

router.get('/:id', requirePermission(PERMISSIONS.ACTIVITIES_READ), asyncHandler(controller.getOne));

router.patch(
  '/:id',
  validate(updateActivitySchema),
  requirePermission(PERMISSIONS.ACTIVITIES_UPDATE),
  asyncHandler(controller.update)
);

router.post(
  '/:id/complete',
  requirePermission(PERMISSIONS.ACTIVITIES_UPDATE),
  asyncHandler(controller.complete)
);

module.exports = router;
