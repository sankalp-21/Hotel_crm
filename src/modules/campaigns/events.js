const bus = require('../../shared/events/bus');

function emitCampaignSent(campaign, counts) {
  bus.emitEvent('campaign.sent', {
    campaignId: campaign.id,
    propertyId: campaign.propertyId,
    segmentId: campaign.segmentId,
    channel: campaign.channel,
    ...counts,
  });
}

module.exports = { emitCampaignSent };
