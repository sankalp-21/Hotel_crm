const platformRepository = require('./repository');
const authRepository = require('../auth/repository');
const outboxRepository = require('../../shared/events/outboxRepository');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function listUsers(query) {
  const [items, total] = await platformRepository.listUsers(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/**
 * Enable/disable an account everywhere. Disabling takes effect immediately (authenticate
 * checks the flag on every request) and revokes all refresh tokens.
 *
 * You can't change your own status. That also means the last platform admin can never be
 * disabled through the API: the caller is always an active platform admin themselves.
 */
async function setUserStatus(userId, { isActive }, actingUser) {
  if (userId === actingUser.id) {
    throw new ValidationError('You cannot change your own account status');
  }
  const user = await platformRepository.findUser(userId);
  if (!user) throw new NotFoundError('User');
  if (user.isActive === isActive) return user;

  const updated = await platformRepository.setActive(userId, isActive);
  if (!isActive) await authRepository.revokeAllRefreshTokensForUser(userId);

  await logAudit({
    userId: actingUser.id,
    action: isActive ? 'platform.user_reactivated' : 'platform.user_deactivated',
    entityType: 'User',
    entityId: userId,
  });
  return updated;
}

async function listOutbox(query) {
  const { items, total, counts } = await outboxRepository.list(query);
  return { items, total, counts, page: query.page, pageSize: query.pageSize };
}

/** Put a dead-lettered event back in the queue (after fixing whatever made it fail). */
async function retryOutboxEvent(id, actingUser) {
  const changed = await outboxRepository.retryFailed(id);
  if (changed === 0) {
    const event = await outboxRepository.findById(id);
    if (!event) throw new NotFoundError('Outbox event');
    throw new ConflictError(`Only failed events can be retried (this one is ${event.status})`);
  }
  await logAudit({
    userId: actingUser.id,
    action: 'platform.outbox_retried',
    entityType: 'OutboxEvent',
    entityId: id,
  });
  return { id, status: 'pending' };
}

module.exports = { listUsers, setUserStatus, listOutbox, retryOutboxEvent };
