const auditRepository = require('./repository');
const logger = require('../../config/logger');

/**
 * Fire-and-log audit entry. Deliberately never throws — a broken audit
 * write should never fail the business operation it's recording. Any
 * module doing a critical mutation (contact, deal, campaign, …) calls this
 * after the mutation commits.
 *
 * Usage: await logAudit({ propertyId, userId: req.user.id, action: 'contact.created', entityType: 'Contact', entityId: contact.id })
 */
async function logAudit({ propertyId, userId, action, entityType, entityId, metadata }) {
  try {
    await auditRepository.create({ propertyId, userId, action, entityType, entityId, metadata });
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'audit_log_write_failed');
  }
}

async function listAuditLogs({ propertyId, entityType, entityId, page, pageSize }) {
  const [items, total] = await auditRepository.list({ propertyId, entityType, entityId, page, pageSize });
  return { items, total, page: page || 1, pageSize: pageSize || 50 };
}

module.exports = { logAudit, listAuditLogs };
