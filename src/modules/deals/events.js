const { publish } = require('../../shared/events/outbox');

/**
 * Record domain events in the outbox using the caller's transaction client (`db`), so they
 * commit atomically with the change they describe.
 */
function recordDealCreated(db, deal) {
  return publish(db, {
    aggregateType: 'Deal',
    aggregateId: deal.id,
    eventType: 'deal.created',
    payload: {
      dealId: deal.id,
      propertyId: deal.propertyId,
      stageId: deal.stageId,
      contactId: deal.contactId,
      companyId: deal.companyId,
    },
  });
}

async function recordDealStageChanged(db, deal, previousStageId, stage) {
  const base = { aggregateType: 'Deal', aggregateId: deal.id };

  await publish(db, {
    ...base,
    eventType: 'deal.stage_changed',
    payload: {
      dealId: deal.id,
      propertyId: deal.propertyId,
      previousStageId,
      stageId: stage.id,
      stageName: stage.name,
    },
  });

  if (stage.isWon) {
    await publish(db, {
      ...base,
      eventType: 'deal.won',
      payload: {
        dealId: deal.id,
        propertyId: deal.propertyId,
        stageId: stage.id,
        contactId: deal.contactId,
        companyId: deal.companyId,
        value: deal.value?.toString?.() ?? deal.value ?? null,
      },
    });
  }

  if (stage.isLost) {
    await publish(db, {
      ...base,
      eventType: 'deal.lost',
      payload: {
        dealId: deal.id,
        propertyId: deal.propertyId,
        stageId: stage.id,
        contactId: deal.contactId,
        companyId: deal.companyId,
      },
    });
  }
}

module.exports = { recordDealCreated, recordDealStageChanged };
