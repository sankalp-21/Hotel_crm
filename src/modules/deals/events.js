const bus = require('../../shared/events/bus');

function emitDealCreated(deal) {
  bus.emitEvent('deal.created', {
    dealId: deal.id,
    propertyId: deal.propertyId,
    stageId: deal.stageId,
    contactId: deal.contactId,
    companyId: deal.companyId,
  });
}

function emitDealStageChanged(deal, previousStageId, stage) {
  bus.emitEvent('deal.stage_changed', {
    dealId: deal.id,
    propertyId: deal.propertyId,
    previousStageId,
    stageId: stage.id,
    stageName: stage.name,
  });

  if (stage.isWon) {
    bus.emitEvent('deal.won', {
      dealId: deal.id,
      propertyId: deal.propertyId,
      stageId: stage.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      value: deal.value?.toString?.() ?? deal.value ?? null,
    });
  }

  if (stage.isLost) {
    bus.emitEvent('deal.lost', {
      dealId: deal.id,
      propertyId: deal.propertyId,
      stageId: stage.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
    });
  }
}

module.exports = { emitDealCreated, emitDealStageChanged };
