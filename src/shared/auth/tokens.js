const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../config/env');

function signAccessToken(user) {
  // Keep the access token payload minimal — property/role scoping is looked
  // up fresh per-request (see rbac.js), not trusted from an old token.
  return jwt.sign({ sub: user.id, email: user.email }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

function signRefreshToken(user) {
  // jti makes every refresh token unique. Without it, two tokens issued for the
  // same user within the same second are byte-identical, so storing the second
  // one violates the unique tokenHash constraint (500 on login/refresh).
  return jwt.sign({ sub: user.id }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    jwtid: crypto.randomUUID(),
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

// Refresh tokens are stored hashed (like passwords) — if the DB leaks, the
// tokens themselves shouldn't be directly usable.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
};
