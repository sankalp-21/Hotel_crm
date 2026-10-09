const express = require('express');
const controller = require('./controller');
const { createPropertySchema, updatePropertySchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { requirePermission, requirePlatformAdmin } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();

router.post(
  '/',
  authenticate,
  requirePlatformAdmin(),
  validate(createPropertySchema),
  asyncHandler(controller.create)
);

router.get('/', authenticate, asyncHandler(controller.list));
router.get('/:id', authenticate, asyncHandler(controller.getOne));

router.patch(
  '/:id',
  authenticate,
  validate(updatePropertySchema),
  (req, res, next) => {
    req.propertyId = req.params.id;
    next();
  },
  requirePermission(PERMISSIONS.PROPERTY_MANAGE),
  asyncHandler(controller.update)
);

module.exports = router;
