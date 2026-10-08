const express = require('express');
const controller = require('./controller');
const {
  createSegmentSchema,
  updateSegmentSchema,
  searchSegmentSchema,
  previewSegmentSchema,
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
  validate(createSegmentSchema),
  requirePermission(PERMISSIONS.SEGMENTS_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchSegmentSchema, 'query'),
  requirePermission(PERMISSIONS.SEGMENTS_READ),
  asyncHandler(controller.search)
);

router.get('/:id', requirePermission(PERMISSIONS.SEGMENTS_READ), asyncHandler(controller.getOne));

router.get(
  '/:id/preview',
  validate(previewSegmentSchema, 'query'),
  requirePermission(PERMISSIONS.SEGMENTS_READ),
  asyncHandler(controller.preview)
);

router.patch(
  '/:id',
  validate(updateSegmentSchema),
  requirePermission(PERMISSIONS.SEGMENTS_UPDATE),
  asyncHandler(controller.update)
);

module.exports = router;
