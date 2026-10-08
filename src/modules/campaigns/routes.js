const express = require('express');
const controller = require('./controller');
const {
  createCampaignSchema,
  updateCampaignSchema,
  searchCampaignSchema,
} = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');
const { idempotent } = require('../../shared/middleware/idempotency');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

router.post(
  '/',
  validate(createCampaignSchema),
  requirePermission(PERMISSIONS.CAMPAIGNS_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchCampaignSchema, 'query'),
  requirePermission(PERMISSIONS.CAMPAIGNS_READ),
  asyncHandler(controller.search)
);

router.get('/:id', requirePermission(PERMISSIONS.CAMPAIGNS_READ), asyncHandler(controller.getOne));

router.patch(
  '/:id',
  validate(updateCampaignSchema),
  requirePermission(PERMISSIONS.CAMPAIGNS_UPDATE),
  asyncHandler(controller.update)
);

router.post(
  '/:id/send',
  requirePermission(PERMISSIONS.CAMPAIGNS_SEND),
  idempotent({ required: true }),
  asyncHandler(controller.send)
);

module.exports = router;
