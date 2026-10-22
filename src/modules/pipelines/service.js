const pipelinesRepository = require('./repository');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');
const prisma = require('../../infrastructure/db/prisma');

async function listStages(propertyId) {
  return pipelinesRepository.ensureDefaults(propertyId);
}

async function getStage(id, propertyId) {
  const stage = await pipelinesRepository.findById(id, propertyId);
  if (!stage) throw new NotFoundError('PipelineStage');
  return stage;
}

async function createStage(data, actingUser) {
  if (data.isWon && data.isLost) {
    throw new ValidationError('A stage cannot be both won and lost');
  }

  const existing = await pipelinesRepository.listByProperty(data.propertyId);
  const position =
    data.position !== undefined
      ? data.position
      : existing.length === 0
        ? 0
        : Math.max(...existing.map((s) => s.position)) + 1;

  try {
    const stage = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.pipelineStage.updateMany({
          where: { propertyId: data.propertyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.pipelineStage.create({
        data: {
          propertyId: data.propertyId,
          name: data.name,
          position,
          isWon: data.isWon ?? false,
          isLost: data.isLost ?? false,
          isDefault: data.isDefault ?? existing.length === 0,
        },
      });
    });

    await logAudit({
      propertyId: stage.propertyId,
      userId: actingUser?.id,
      action: 'pipeline_stage.created',
      entityType: 'PipelineStage',
      entityId: stage.id,
      metadata: { name: stage.name },
    });

    return stage;
  } catch (err) {
    if (err.code === 'P2002') throw new ConflictError('A stage with this name already exists');
    throw err;
  }
}

async function updateStage(id, propertyId, data, actingUser) {
  const current = await getStage(id, propertyId);
  const nextIsWon = data.isWon !== undefined ? data.isWon : current.isWon;
  const nextIsLost = data.isLost !== undefined ? data.isLost : current.isLost;
  if (nextIsWon && nextIsLost) {
    throw new ValidationError('A stage cannot be both won and lost');
  }

  try {
    const stage = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.pipelineStage.updateMany({
          where: { propertyId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.pipelineStage.update({
        where: { id, propertyId },
        data,
      });
    });

    await logAudit({
      propertyId,
      userId: actingUser?.id,
      action: 'pipeline_stage.updated',
      entityType: 'PipelineStage',
      entityId: id,
      metadata: data,
    });

    return stage;
  } catch (err) {
    if (err.code === 'P2002') throw new ConflictError('A stage with this name already exists');
    throw err;
  }
}

module.exports = { listStages, getStage, createStage, updateStage };
