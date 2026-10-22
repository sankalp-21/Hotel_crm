const prisma = require('../../infrastructure/db/prisma');
const propertyRepository = require('../property/repository');
const { suppressAddress } = require('../suppressions/service');
const { logAudit } = require('../audit/service');

/**
 * Opt a contact out, as the contact's own action. Idempotent and safe to retry:
 * 1. the contact row is flagged first (that alone already excludes them from every campaign),
 * 2. then their address is added to the property's suppression list.
 * Returns { unsubscribed: boolean } and never reveals whether the contact exists.
 */
async function unsubscribeContact({
  contactId,
  propertyId,
  campaignId,
  via = 'unsubscribe_link', // or 'spam_complaint'
  reason = 'unsubscribed', // suppression reason: 'unsubscribed' | 'complaint'
}) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, propertyId } });
  if (!contact) return { unsubscribed: false };

  if (!contact.unsubscribedAt) {
    const now = new Date();
    await prisma.contact.update({
      where: { id: contactId, propertyId },
      data: {
        unsubscribedAt: now,
        marketingConsent: false,
        consentSource: via,
        consentUpdatedAt: now,
      },
    });
    await logAudit({
      propertyId,
      action: 'contact.unsubscribed',
      entityType: 'Contact',
      entityId: contactId,
      metadata: { via, campaignId: campaignId ?? null },
    });
  }

  if (contact.email) {
    await suppressAddress({
      propertyId,
      channel: 'email',
      address: contact.email,
      reason,
    });
  }
  return { unsubscribed: true };
}

async function getPropertyName(propertyId) {
  const property = await propertyRepository.findById(propertyId);
  return property?.name ?? null;
}

module.exports = { unsubscribeContact, getPropertyName };
