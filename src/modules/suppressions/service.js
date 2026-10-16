const repository = require('./repository');
const { normalizeAddress } = require('./normalize');
const { NotFoundError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

/**
 * Idempotent add used by staff (reason 'manual') and, in later steps, by the unsubscribe link and
 * bounce handling. Returns { entry, created }. Never downgrades an existing entry's reason.
 */
async function suppressAddress({ propertyId, channel, address, reason = 'manual', createdBy = null }) {
  const normalized = normalizeAddress(channel, address);
  const existing = await repository.findByAddress(propertyId, channel, normalized);
  if (existing) return { entry: existing, created: false };

  try {
    const entry = await repository.create({
      propertyId,
      channel,
      address: normalized,
      reason,
      createdBy,
    });
    return { entry, created: true };
  } catch (err) {
    // Lost a race with a concurrent insert of the same address: the unique index did its job.
    if (err.code === 'P2002') {
      const entry = await repository.findByAddress(propertyId, channel, normalized);
      if (entry) return { entry, created: false };
    }
    throw err;
  }
}

async function addSuppression(propertyId, data, actingUser) {
  const result = await suppressAddress({
    propertyId,
    channel: data.channel,
    address: data.address,
    reason: 'manual',
    createdBy: actingUser?.id ?? null,
  });

  if (result.created) {
    // Audit the entry id and channel only: the address itself is PII.
    await logAudit({
      propertyId,
      userId: actingUser?.id,
      action: 'suppression.added',
      entityType: 'SuppressionEntry',
      entityId: result.entry.id,
      metadata: { channel: data.channel, reason: 'manual' },
    });
  }
  return result;
}

async function searchSuppressions(query) {
  const [items, total] = await repository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function removeSuppression(id, propertyId, actingUser) {
  const entry = await repository.findById(id, propertyId);
  if (!entry) throw new NotFoundError('Suppression entry');

  // Opt-outs, bounces and complaints are legal/deliverability records: staff can't lift them.
  if (entry.reason !== 'manual') {
    throw new ConflictError(
      `Entries added because of "${entry.reason}" cannot be removed; only manual entries can`
    );
  }

  await repository.remove(id, propertyId);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'suppression.removed',
    entityType: 'SuppressionEntry',
    entityId: id,
    metadata: { channel: entry.channel, reason: entry.reason },
  });
}

module.exports = { suppressAddress, addSuppression, searchSuppressions, removeSuppression };
