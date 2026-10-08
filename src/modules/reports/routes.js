const express = require('express');
const controller = require('./controller');
const { dateRangeSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.use(authenticate, resolvePropertyContext);

router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.REPORTS_READ),
  asyncHandler(controller.dashboard)
);

router.get(
  '/pipeline',
  validate(dateRangeSchema, 'query'),
  requirePermission(PERMISSIONS.REPORTS_READ),
  asyncHandler(controller.pipeline)
);

router.get(
  '/forecast',
  validate(dateRangeSchema, 'query'),
  requirePermission(PERMISSIONS.REPORTS_READ),
  asyncHandler(controller.forecast)
);

module.exports = router;
