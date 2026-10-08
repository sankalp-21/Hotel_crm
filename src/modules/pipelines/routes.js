const express = require('express');
const controller = require('./controller');
const { createStageSchema, updateStageSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

router.get('/stages', requirePermission(PERMISSIONS.PIPELINE_READ), asyncHandler(controller.list));

router.post(
  '/stages',
  validate(createStageSchema),
  requirePermission(PERMISSIONS.PIPELINE_MANAGE),
  asyncHandler(controller.create)
);

router.patch(
  '/stages/:id',
  validate(updateStageSchema),
  requirePermission(PERMISSIONS.PIPELINE_MANAGE),
  asyncHandler(controller.update)
);

module.exports = router;
