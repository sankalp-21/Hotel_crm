const express = require('express');
const controller = require('./controller');
const {
  createCampaignSchema,
  updateCampaignSchema,
  searchCampaignSchema,
  recipientsQuerySchema,
  previewQuerySchema,
  testSendSchema,
} = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');
const { idempotent } = require('../../shared/middleware/idempotency');
const { testSendRateLimiter } = require('../../shared/middleware/rateLimit');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

// Previewing as a REAL contact shows that contact's name/email/phone, so it also needs contacts:read.
const requireContactsReadWhenContactChosen = (req, res, next) =>
  req.query.contactId ? requirePermission(PERMISSIONS.CONTACTS_READ)(req, res, next) : next();

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

router.post('/:id/cancel', requirePermission(PERMISSIONS.CAMPAIGNS_SEND), asyncHandler(controller.cancel));

router.post(
  '/:id/retry-failed',
  requirePermission(PERMISSIONS.CAMPAIGNS_SEND),
  idempotent({ required: true }),
  asyncHandler(controller.retryFailed)
);

router.get(
  '/:id/recipients',
  validate(recipientsQuerySchema, 'query'),
  requirePermission(PERMISSIONS.CAMPAIGNS_READ),
  asyncHandler(controller.recipients)
);

router.get(
  '/:id/preview',
  validate(previewQuerySchema, 'query'),
  requirePermission(PERMISSIONS.CAMPAIGNS_READ),
  requireContactsReadWhenContactChosen,
  asyncHandler(controller.preview)
);

// Sends real email (to staff only), so it needs the send permission and a per-user hourly limit.
router.post(
  '/:id/test-send',
  validate(testSendSchema),
  requirePermission(PERMISSIONS.CAMPAIGNS_SEND),
  testSendRateLimiter(),
  asyncHandler(controller.testSend)
);

module.exports = router;
