const express = require('express');
const controller = require('./controller');
const { userIdParams, statusSchema, listUsersSchema, outboxIdParams, listOutboxSchema } = require('./validator');
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

router.get('/outbox', validate(listOutboxSchema, 'query'), asyncHandler(controller.listOutbox));
router.post('/outbox/:id/retry', validate(outboxIdParams, 'params'), asyncHandler(controller.retryOutboxEvent));

module.exports = router;
