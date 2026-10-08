const prisma = require('../../infrastructure/db/prisma');

/**
 * Every property implicitly has a policy (the schema defaults), but no row
 * needs to exist until someone either reads or edits it — this upserts a
 * default row on first read rather than requiring a separate provisioning
 * step, so a property never ends up in an undefined state.
 */
async function getOrCreatePolicy(propertyId) {
  const existing = await prisma.retentionPolicy.findUnique({ where: { propertyId } });
  if (existing) return existing;
  return prisma.retentionPolicy.create({ data: { propertyId } });
}

function updatePolicy(propertyId, data, updatedBy) {
  return prisma.retentionPolicy.upsert({
    where: { propertyId },
    create: { propertyId, ...data, updatedBy },
    update: { ...data, updatedBy },
  });
}

async function purgeAuditLogs(propertyId, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({
    where: { propertyId, createdAt: { lt: cutoff } },
  });
  return count;
}

async function purgeContactDocuments(propertyId, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.contactDocument.deleteMany({
    where: { contact: { propertyId }, createdAt: { lt: cutoff } },
  });
  return count;
}

module.exports = { getOrCreatePolicy, updatePolicy, purgeAuditLogs, purgeContactDocuments };
