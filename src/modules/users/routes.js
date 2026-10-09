const express = require('express');
const controller = require('./controller');
const {
  memberIdParams,
  memberRoleParams,
  addRoleSchema,
  addMemberSchema,
  listMembersSchema,
} = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { authenticate } = require('../../shared/middleware/authenticate');
const { resolvePropertyContext } = require('../../shared/middleware/resolvePropertyContext');
const { requirePermission } = require('../../shared/middleware/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncHandler } = require('../../shared/errors/errorHandler');

const router = express.Router();
router.use(authenticate, resolvePropertyContext);

router.get('/', requirePermission(PERMISSIONS.USERS_READ), validate(listMembersSchema, 'query'), asyncHandler(controller.list));

// Declared before '/:id' so "members" is never read as an id.
router.post('/members', requirePermission(PERMISSIONS.USERS_UPDATE), validate(addMemberSchema), asyncHandler(controller.addMember));

router.get('/:id', requirePermission(PERMISSIONS.USERS_READ), validate(memberIdParams, 'params'), asyncHandler(controller.getOne));

router.post(
  '/:id/roles',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate(memberIdParams, 'params'),
  validate(addRoleSchema),
  asyncHandler(controller.addRole)
);

router.delete(
  '/:id/roles/:roleId',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate(memberRoleParams, 'params'),
  asyncHandler(controller.removeRole)
);

router.delete('/:id', requirePermission(PERMISSIONS.USERS_UPDATE), validate(memberIdParams, 'params'), asyncHandler(controller.removeMember));

module.exports = router;
