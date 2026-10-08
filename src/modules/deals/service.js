const dealsRepository = require('./repository');
const pipelinesRepository = require('../pipelines/repository');
const contactsRepository = require('../contacts/repository');
const companiesRepository = require('../companies/repository');
const { NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');
const { emitDealCreated, emitDealStageChanged } = require('./events');

async function assertContactInProperty(contactId, propertyId) {
  if (!contactId) return;
  const contact = await contactsRepository.findById(contactId, propertyId);
  if (!contact) throw new NotFoundError('Contact');
}

async function assertCompanyInProperty(companyId, propertyId) {
  if (!companyId) return;
  const company = await companiesRepository.findById(companyId, propertyId);
  if (!company) throw new NotFoundError('Company');
}

async function resolveStage(propertyId, stageId) {
  await pipelinesRepository.ensureDefaults(propertyId);

  if (stageId) {
    const stage = await pipelinesRepository.findById(stageId, propertyId);
    if (!stage) throw new NotFoundError('PipelineStage');
    return stage;
  }

  const stage = await pipelinesRepository.findDefault(propertyId);
  if (!stage) throw new ValidationError('No default pipeline stage configured for this property');
  return stage;
}

async function createDeal(data, actingUser) {
  await assertContactInProperty(data.contactId, data.propertyId);
  await assertCompanyInProperty(data.companyId, data.propertyId);

  const stage = await resolveStage(data.propertyId, data.stageId);
  const { stageId: _ignored, ...rest } = data;

  const deal = await dealsRepository.create({
    ...rest,
    stageId: stage.id,
    createdBy: actingUser?.id,
    closedAt: stage.isWon || stage.isLost ? new Date() : null,
  });

  await logAudit({
    propertyId: deal.propertyId,
    userId: actingUser?.id,
    action: 'deal.created',
    entityType: 'Deal',
    entityId: deal.id,
    metadata: { title: deal.title, stageId: deal.stageId },
  });

  emitDealCreated(deal);
  if (stage.isWon || stage.isLost) {
    emitDealStageChanged(deal, null, stage);
  }

  return deal;
}

async function getDeal(id, propertyId) {
  const deal = await dealsRepository.findById(id, propertyId);
  if (!deal) throw new NotFoundError('Deal');
  return deal;
}

async function searchDeals(query) {
  const [items, total] = await dealsRepository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function updateDeal(id, propertyId, data, actingUser) {
  await getDeal(id, propertyId);
  if (data.contactId !== undefined) await assertContactInProperty(data.contactId, propertyId);
  if (data.companyId !== undefined) await assertCompanyInProperty(data.companyId, propertyId);

  const deal = await dealsRepository.update(id, propertyId, data);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'deal.updated',
    entityType: 'Deal',
    entityId: id,
    metadata: data,
  });
  return deal;
}

async function transitionDeal(id, propertyId, { stageId }, actingUser) {
  const current = await getDeal(id, propertyId);
  const stage = await resolveStage(propertyId, stageId);

  if (stage.id === current.stageId) return current;

  const deal = await dealsRepository.update(id, propertyId, {
    stageId: stage.id,
    closedAt: stage.isWon || stage.isLost ? new Date() : null,
  });

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'deal.stage_changed',
    entityType: 'Deal',
    entityId: id,
    metadata: {
      previousStageId: current.stageId,
      stageId: stage.id,
      stageName: stage.name,
      isWon: stage.isWon,
      isLost: stage.isLost,
    },
  });

  emitDealStageChanged(deal, current.stageId, stage);
  return deal;
}

module.exports = {
  createDeal,
  getDeal,
  searchDeals,
  updateDeal,
  transitionDeal,
};
