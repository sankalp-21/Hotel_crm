const prisma = require('../../infrastructure/db/prisma');

/**
 * Run `fn(tx)` in one database transaction. Repository functions accept the `tx` client as
 * their last argument, so a change and the outbox event describing it commit (or roll back)
 * together — the event can't be lost if the process dies between the two writes.
 */
function withTransaction(fn, options = {}) {
  return prisma.$transaction(fn, { maxWait: 5_000, timeout: 15_000, ...options });
}

module.exports = { withTransaction };
