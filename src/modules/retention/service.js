const retentionRepository = require('./repository');
const { logAudit } = require('../audit/service');

function getPolicy(propertyId) {
  return retentionRepository.getOrCreatePolicy(propertyId);
}

async function updatePolicy(propertyId, data, actingUser) {
  const policy = await retentionRepository.updatePolicy(propertyId, data, actingUser?.id);

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'retention.policy_updated',
    entityType: 'RetentionPolicy',
    entityId: policy.id,
    metadata: data,
  });

  return policy;
}

async function runPurge(propertyId, actingUser) {
  const policy = await retentionRepository.getOrCreatePolicy(propertyId);

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'retention.purge_requested',
    entityType: 'RetentionPolicy',
    entityId: policy.id,
    metadata: {
      auditLogRetentionDays: policy.auditLogRetentionDays,
      contactDocumentRetentionDays: policy.contactDocumentRetentionDays,
    },
  });

  const [auditLogsPurged, contactDocumentsPurged] = await Promise.all([
    retentionRepository.purgeAuditLogs(propertyId, policy.auditLogRetentionDays),
    retentionRepository.purgeContactDocuments(propertyId, policy.contactDocumentRetentionDays),
  ]);

  return { auditLogsPurged, contactDocumentsPurged, policy };
}

module.exports = { getPolicy, updatePolicy, runPurge };
