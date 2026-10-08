const { verifyAccessToken } = require('../auth/tokens');
const { UnauthorizedError } = require('../errors/AppError');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

module.exports = { authenticate };
