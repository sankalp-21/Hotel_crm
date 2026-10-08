const express = require('express');
const controller = require('./controller');
const {
  createDealSchema,
  updateDealSchema,
  searchDealSchema,
  transitionDealSchema,
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
  validate(createDealSchema),
  requirePermission(PERMISSIONS.DEALS_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchDealSchema, 'query'),
  requirePermission(PERMISSIONS.DEALS_READ),
  asyncHandler(controller.search)
);

router.get('/:id', requirePermission(PERMISSIONS.DEALS_READ), asyncHandler(controller.getOne));

router.patch(
  '/:id',
  validate(updateDealSchema),
  requirePermission(PERMISSIONS.DEALS_UPDATE),
  asyncHandler(controller.update)
);

router.post(
  '/:id/transition',
  validate(transitionDealSchema),
  requirePermission(PERMISSIONS.DEALS_UPDATE),
  asyncHandler(controller.transition)
);

module.exports = router;
