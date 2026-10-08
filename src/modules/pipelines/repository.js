const prisma = require('../../infrastructure/db/prisma');
const { DEFAULT_PIPELINE_STAGES } = require('./defaults');

function listByProperty(propertyId) {
  return prisma.pipelineStage.findMany({
    where: { propertyId },
    orderBy: { position: 'asc' },
  });
}

function findById(id) {
  return prisma.pipelineStage.findUnique({ where: { id } });
}

function findDefault(propertyId) {
  return prisma.pipelineStage.findFirst({
    where: { propertyId, isDefault: true },
    orderBy: { position: 'asc' },
  });
}

function create(data) {
  return prisma.pipelineStage.create({ data });
}

function update(id, data) {
  return prisma.pipelineStage.update({ where: { id }, data });
}

/**
 * Idempotent: if the property already has stages, return them.
 * Otherwise create the standard Inquiry → … → Won/Lost set.
 */
async function ensureDefaults(propertyId) {
  const existing = await listByProperty(propertyId);
  if (existing.length > 0) return existing;

  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage) => ({ ...stage, propertyId })),
  });

  return listByProperty(propertyId);
}

module.exports = {
  listByProperty,
  findById,
  findDefault,
  create,
  update,
  ensureDefaults,
};
