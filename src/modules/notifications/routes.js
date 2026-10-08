const express = require('express');
const controller = require('./controller');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();
router.use(authenticate, resolvePropertyContext);

router.get('/', requirePermission(PERMISSIONS.NOTIFICATIONS_READ), asyncHandler(controller.list));

module.exports = router;
