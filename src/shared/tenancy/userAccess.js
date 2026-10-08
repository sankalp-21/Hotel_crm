const prisma = require('../../infrastructure/db/prisma');
const { ValidationError } = require('../errors/AppError');

/**
 * Ensure `userId` is an active user holding at least one role at `propertyId`.
 * Used wherever a request body names a user (e.g. activity assignee) so one
 * tenant can never point records — or the notifications they trigger — at
 * users who belong to another tenant.
 *
 * The same message is returned for "no such user" and "user in another
 * property" so the response can't be used to probe which user IDs exist.
 */
async function assertUserHasPropertyAccess(userId, propertyId, field = 'assignedTo') {
  if (!userId) return;
  const access = await prisma.userPropertyRole.findFirst({
    where: { userId, propertyId, user: { isActive: true } },
    select: { id: true },
  });
  if (!access) {
    throw new ValidationError(`${field} must be an active user with access to this property`);
  }
}

module.exports = { assertUserHasPropertyAccess };
