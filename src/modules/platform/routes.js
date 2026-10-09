const express = require('express');
const controller = require('./controller');
const { userIdParams, statusSchema, listUsersSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { requirePlatformAdmin } = require('../../shared/middleware/rbac');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();
router.use(authenticate, requirePlatformAdmin());

router.get('/users', validate(listUsersSchema, 'query'), asyncHandler(controller.listUsers));
router.patch(
  '/users/:id/status',
  validate(userIdParams, 'params'),
  validate(statusSchema),
  asyncHandler(controller.setUserStatus)
);

module.exports = router;
