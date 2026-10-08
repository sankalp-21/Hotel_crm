const prisma = require('../../infrastructure/db/prisma');
const { ForbiddenError, UnauthorizedError } = require('../errors/AppError');

/**
 * requirePermission('guests:create') -> middleware.
 * Looks up the user's role(s) for req.propertyId and checks whether any of
 * them grant the given permission code. Requires `authenticate` and
 * `resolvePropertyContext` to have run first.
 */
function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError());
      if (!req.propertyId) {
        return next(new ForbiddenError('No property context resolved for this request'));
      }

      const assignment = await prisma.userPropertyRole.findFirst({
        where: {
          userId: req.user.id,
          propertyId: req.propertyId,
          role: {
            permissions: {
              some: { permission: { code: permissionCode } },
            },
          },
        },
        select: { id: true },
      });

      if (!assignment) {
        return next(
          new ForbiddenError(`Missing permission "${permissionCode}" for this property`)
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Platform-level gate: user must hold super_admin on at least one property. */
function requireSuperAdmin() {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError());

      const assignment = await prisma.userPropertyRole.findFirst({
        where: {
          userId: req.user.id,
          role: { name: 'super_admin' },
        },
        select: { id: true },
      });

      if (!assignment) {
        return next(new ForbiddenError('Super admin role required'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission, requireSuperAdmin };
