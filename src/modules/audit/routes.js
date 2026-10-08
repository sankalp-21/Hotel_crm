const express = require('express');
const controller = require('./controller');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.get(
  '/',
  authenticate,
  resolvePropertyContext,
  requirePermission('audit:read'),
  asyncHandler(controller.list)
);

module.exports = router;
