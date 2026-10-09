const ms = require('ms');
const authRepository = require('./repository');
const { hashPassword, verifyPassword } = require('../../shared/auth/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../../shared/auth/tokens');
const {
  UnauthorizedError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
} = require('../../shared/errors/AppError');
const { assertCanAssignRole, filterAssignableRoles } = require('./roleAssignment');
const { logAudit } = require('../audit/service');
const env = require('../../config/env');
const redis = require('../../infrastructure/redis/redis');

function lockoutKey(email) {
  return `auth:lockout:${String(email).toLowerCase()}`;
}

async function assertNotLockedOut(email) {
  const failures = Number((await redis.get(lockoutKey(email))) || 0);
  if (failures >= env.LOGIN_MAX_FAILURES) {
    throw new TooManyRequestsError(
      'Too many failed login attempts. Please try again later.'
    );
  }
}

async function recordFailedLogin(email) {
  const key = lockoutKey(email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, env.LOGIN_LOCKOUT_SECONDS);
  }
}

async function clearFailedLogin(email) {
  await redis.del(lockoutKey(email));
}

async function login({ email, password }) {
  await assertNotLockedOut(email);

  const user = await authRepository.findByEmail(email);
  if (!user || !user.isActive) {
    await recordFailedLogin(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  await clearFailedLogin(email);

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await authRepository.storeRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + ms(env.JWT_REFRESH_EXPIRES_IN)),
  });

  await logAudit({ userId: user.id, action: 'auth.login' });

  const propertyRoles = await authRepository.getPropertyRoles(user.id);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.fullName },
    propertyRoles: propertyRoles.map((pr) => ({
      propertyId: pr.propertyId,
      propertyName: pr.property.name,
      role: pr.role.name,
    })),
  };
}

async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await authRepository.findRefreshToken(tokenHash);

  // Valid JWT but missing/revoked store entry usually means reuse after rotation
  // (stolen token). Revoke all sessions for that user.
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    if (payload?.sub) {
      await authRepository.revokeAllRefreshTokensForUser(payload.sub);
    }
    throw new UnauthorizedError('Refresh token is no longer valid');
  }

  const user = await authRepository.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User is no longer active');
  }

  await authRepository.revokeRefreshToken(tokenHash);

  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);

  await authRepository.storeRefreshToken({
    userId: user.id,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: new Date(Date.now() + ms(env.JWT_REFRESH_EXPIRES_IN)),
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function logout({ refreshToken }) {
  if (!refreshToken) return;
  try {
    await authRepository.revokeRefreshToken(hashToken(refreshToken));
  } catch {
    // Token already gone/invalid — logout is idempotent from the caller's view.
  }
}

/**
 * Admin-only: creates a user and assigns them a role for a property in one step.
 * (There's deliberately no public self-registration endpoint — staff accounts
 * are provisioned by a property manager/admin.)
 */
async function createUser({ email, password, fullName, propertyId, roleId }, actingUser) {
  if (!actingUser) throw new UnauthorizedError();

  // Authorization first: the acting user may only grant roles whose permissions
  // they already hold at this property (and never super_admin unless they are one).
  const [role, actor] = await Promise.all([
    authRepository.getRoleWithPermissions(roleId),
    authRepository.getActorAccess(actingUser.id, propertyId),
  ]);
  assertCanAssignRole({ actor, role });

  const existing = await authRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await authRepository.createUserWithRole({
      email,
      passwordHash,
      fullName,
      propertyId,
      roleId,
    });
  } catch (err) {
    // Lost a race with a concurrent create for the same email.
    if (err.code === 'P2002') throw new ConflictError('A user with this email already exists');
    throw err;
  }

  await logAudit({
    propertyId,
    userId: actingUser.id,
    action: 'auth.user_created',
    entityType: 'User',
    entityId: user.id,
    metadata: { roleId: role.id, roleName: role.name },
  });

  return { id: user.id, email: user.email, fullName: user.fullName };
}

/**
 * Change the signed-in user's own password. Wrong attempts count toward the same lockout as
 * login (so this can't be used to brute-force the current password), and success revokes every
 * refresh token so other devices must sign in again with the new password. (Access tokens
 * already issued stay valid until they expire, at most JWT_ACCESS_EXPIRES_IN.)
 *
 * A wrong current password is a 422, not a 401: clients commonly treat 401 as "session expired".
 */
async function changePassword(actingUser, { currentPassword, newPassword }) {
  await assertNotLockedOut(actingUser.email);

  const user = await authRepository.findById(actingUser.id);
  if (!user || !user.isActive) throw new UnauthorizedError();

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user.email);
    throw new ValidationError('Current password is incorrect');
  }

  await authRepository.updatePasswordHash(user.id, await hashPassword(newPassword));
  await authRepository.revokeAllRefreshTokensForUser(user.id);
  await clearFailedLogin(user.email);

  await logAudit({
    userId: user.id,
    action: 'auth.password_changed',
    entityType: 'User',
    entityId: user.id,
  });
}

/** Roles the acting user may assign at this property (used to populate pickers). */
async function listAssignableRoles(propertyId, actingUser) {
  const [roles, actor] = await Promise.all([
    authRepository.listRolesWithPermissions(),
    authRepository.getActorAccess(actingUser.id, propertyId),
  ]);
  return filterAssignableRoles(actor, roles).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: r.permissionCodes,
  }));
}

module.exports = { login, refresh, logout, createUser, changePassword, listAssignableRoles };
