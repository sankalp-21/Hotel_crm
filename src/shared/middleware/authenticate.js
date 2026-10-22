const prisma = require('../../infrastructure/db/prisma');
const { verifyAccessToken } = require('../auth/tokens');
const { UnauthorizedError } = require('../errors/AppError');

/**
 * Verifies the access token AND that the account is still active. The token alone is
 * stateless and stays valid for its whole lifetime, so without the lookup a disabled user
 * would keep working until it expired. One primary-key read per request.
 *
 * A disabled or deleted account gets the same message as a bad token, so the response
 * doesn't reveal which accounts exist or their status.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, isPlatformAdmin: true },
    });
    if (!user || !user.isActive) {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
    req.user = { id: user.id, email: user.email, isPlatformAdmin: user.isPlatformAdmin };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticate };
