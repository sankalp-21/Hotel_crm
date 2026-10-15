const { publish } = require('../../shared/events/outbox');

function recordCampaignSent(db, campaign, counts) {
  return publish(db, {
    aggregateType: 'Campaign',
    aggregateId: campaign.id,
    eventType: 'campaign.sent',
    payload: {
      campaignId: campaign.id,
      propertyId: campaign.propertyId,
      segmentId: campaign.segmentId,
      channel: campaign.channel,
      ...counts,
    },
  });
}

module.exports = { recordCampaignSent };
