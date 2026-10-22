const repository = require('./repository');
const { normalizeAddress } = require('./normalize');
const { NotFoundError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

/**
 * Idempotent add used by staff (reason 'manual'), by the unsubscribe link and by bounce handling.
 * Returns { entry, created }.
 *
 * Reasons only move one way. A system reason (unsubscribed / bounced / complaint) is a legal and
 * deliverability record and is never replaced. But a MANUAL entry is upgraded when the address later
 * unsubscribes, bounces or complains: staff may delete manual entries, and deleting one must not
 * erase the fact that the person opted out.
 */
async function suppressAddress({ propertyId, channel, address, reason = 'manual', createdBy = null }) {
  const normalized = normalizeAddress(channel, address);

  const settle = async (existing) => {
    if (existing.reason !== 'manual' || reason === 'manual') return { entry: existing, created: false };

    const { count } = await repository.upgradeManualReason(propertyId, channel, normalized, reason);
    if (count !== 1) {
      // Someone else upgraded it first (or it was just removed): use whatever is there now.
      const latest = await repository.findByAddress(propertyId, channel, normalized);
      return { entry: latest ?? existing, created: false };
    }
    await logAudit({
      propertyId,
      action: 'suppression.reason_upgraded',
      entityType: 'SuppressionEntry',
      entityId: existing.id,
      metadata: { channel, from: 'manual', to: reason }, // no address: it is PII
    });
    return { entry: { ...existing, reason }, created: false };
  };

  const existing = await repository.findByAddress(propertyId, channel, normalized);
  if (existing) return settle(existing);

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
      if (entry) return settle(entry);
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
