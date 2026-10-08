const express = require('express');
const controller = require('./controller');
const { updatePolicySchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();
router.use(authenticate, resolvePropertyContext);

router.get('/policy', requirePermission(PERMISSIONS.RETENTION_READ), asyncHandler(controller.getPolicy));

router.patch(
  '/policy',
  validate(updatePolicySchema),
  requirePermission(PERMISSIONS.RETENTION_MANAGE),
  asyncHandler(controller.updatePolicy)
);

router.post('/purge', requirePermission(PERMISSIONS.RETENTION_MANAGE), asyncHandler(controller.purge));

module.exports = router;
