const prisma = require('../../infrastructure/db/prisma');

// Every lookup is scoped to the property named in the (signed) webhook URL, via the campaign's
// propertyId, so an event can never touch another hotel's recipients.

function findRecipient(propertyId, { recipientId, messageId, address }) {
  const scope = { campaign: { propertyId } };
  if (recipientId) return prisma.campaignRecipient.findFirst({ where: { id: recipientId, ...scope } });
  if (messageId) return prisma.campaignRecipient.findFirst({ where: { providerMessageId: messageId, ...scope } });
  if (address) {
    return prisma.campaignRecipient.findFirst({
      where: {
        recipientEmail: { equals: address, mode: 'insensitive' },
        status: { in: ['sent', 'bounced'] },
        ...scope,
      },
      orderBy: { sentAt: 'desc' },
    });
  }
  return null;
}

async function markDelivered(id) {
  const { count } = await prisma.campaignRecipient.updateMany({ where: { id, deliveredAt: null }, data: { deliveredAt: new Date() } });
  return count === 1;
}

/** sent -> bounced; true only for the call that made the transition (so counters move once). */
async function transitionToBounced(id, reason) {
  const { count } = await prisma.campaignRecipient.updateMany({
    where: { id, status: 'sent' },
    data: { status: 'bounced', bouncedAt: new Date(), failureReason: reason ?? 'bounced' },
  });
  return count === 1;
}

async function markComplained(id) {
  const { count } = await prisma.campaignRecipient.updateMany({ where: { id, complainedAt: null }, data: { complainedAt: new Date() } });
  return count === 1;
}

function noteSoftBounce(id, reason) {
  return prisma.campaignRecipient.updateMany({ where: { id, status: 'sent' }, data: { failureReason: `soft_bounce: ${reason ?? ''}`.trim() } });
}

function adjustCampaignCounts(campaignId, { sent = 0, bounced = 0, complained = 0 }) {
  return prisma.campaign.update({
    where: { id: campaignId },
    data: {
      sentCount: { increment: sent },
      bouncedCount: { increment: bounced },
      complainedCount: { increment: complained },
    },
  });
}

function findContactsByEmail(propertyId, address) {
  return prisma.contact.findMany({
    where: { propertyId, email: { equals: address, mode: 'insensitive' } },
    select: { id: true },
  });
}

function flagContactsBounced(propertyId, address) {
  return prisma.contact.updateMany({
    where: { propertyId, email: { equals: address, mode: 'insensitive' } },
    data: { emailBounced: true },
  });
}

module.exports = {
  findRecipient,
  markDelivered,
  transitionToBounced,
  markComplained,
  noteSoftBounce,
  adjustCampaignCounts,
  findContactsByEmail,
  flagContactsBounced,
};
