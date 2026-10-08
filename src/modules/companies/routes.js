const express = require('express');
const controller = require('./controller');
const { createCompanySchema, updateCompanySchema, searchCompanySchema } = require('./validator');
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
  validate(createCompanySchema),
  requirePermission(PERMISSIONS.COMPANIES_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchCompanySchema, 'query'),
  requirePermission(PERMISSIONS.COMPANIES_READ),
  asyncHandler(controller.search)
);

router.get('/:id', requirePermission(PERMISSIONS.COMPANIES_READ), asyncHandler(controller.getOne));

router.patch(
  '/:id',
  validate(updateCompanySchema),
  requirePermission(PERMISSIONS.COMPANIES_UPDATE),
  asyncHandler(controller.update)
);

module.exports = router;
