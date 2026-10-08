const express = require('express');
const controller = require('./controller');
const { createContactSchema, updateContactSchema, searchContactSchema } = require('./validator');
const { timelineQuerySchema } = require('../activities/validator');
const activitiesController = require('../activities/controller');
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
  validate(createContactSchema),
  requirePermission(PERMISSIONS.CONTACTS_CREATE),
  asyncHandler(controller.create)
);

router.get(
  '/',
  validate(searchContactSchema, 'query'),
  requirePermission(PERMISSIONS.CONTACTS_READ),
  asyncHandler(controller.search)
);

router.get(
  '/:id/timeline',
  validate(timelineQuerySchema, 'query'),
  requirePermission(PERMISSIONS.ACTIVITIES_READ),
  asyncHandler(activitiesController.timeline)
);

router.get('/:id', requirePermission(PERMISSIONS.CONTACTS_READ), asyncHandler(controller.getOne));

router.patch(
  '/:id',
  validate(updateContactSchema),
  requirePermission(PERMISSIONS.CONTACTS_UPDATE),
  asyncHandler(controller.update)
);

module.exports = router;
