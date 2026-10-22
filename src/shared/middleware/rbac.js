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

/**
 * Platform-level gate (create properties, manage accounts across tenants). Uses the
 * user's isPlatformAdmin flag loaded by `authenticate`. A tenant-level super_admin role
 * deliberately does NOT pass this: it only ever grants power inside its own property.
 */
function requirePlatformAdmin() {
  return (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!req.user.isPlatformAdmin) {
      return next(new ForbiddenError('Platform administrator access required'));
    }
    return next();
  };
}

module.exports = { requirePermission, requirePlatformAdmin };
