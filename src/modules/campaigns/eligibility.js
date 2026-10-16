const { normalizeAddress } = require('../suppressions/normalize');
const suppressionsRepository = require('../suppressions/repository');

/**
 * Why a contact is NOT sent a campaign, or null if eligible. Pure and ordered: the first matching
 * rule wins, so the recorded reason is stable. Reasons are stored on the CampaignRecipient row
 * (status 'skipped'), so staff can see exactly why someone was left out.
 */
const SKIP_REASONS = Object.freeze({
  NO_ADDRESS: 'no_address',
  UNSUBSCRIBED: 'unsubscribed',
  NO_CONSENT: 'no_consent',
  BOUNCED: 'bounced',
  SUPPRESSED: 'suppressed',
  INACTIVE: 'inactive',
});

function classifyContact(contact, channel, suppressedAddresses, { includeInactive = false } = {}) {
  const address = channel === 'email' ? contact.email : contact.phone;
  if (!address) return SKIP_REASONS.NO_ADDRESS;

  // Unsubscribe beats everything, including a later consent flag.
  if (contact.unsubscribedAt) return SKIP_REASONS.UNSUBSCRIBED;
  if (!contact.marketingConsent) return SKIP_REASONS.NO_CONSENT;
  if (channel === 'email' && contact.emailBounced) return SKIP_REASONS.BOUNCED;
  if (suppressedAddresses.has(normalizeAddress(channel, address))) return SKIP_REASONS.SUPPRESSED;
  if (!includeInactive && contact.status === 'inactive') return SKIP_REASONS.INACTIVE;
  return null;
}

/** Classify a batch of contacts with one chunked suppression lookup. Returns [{ contact, skipReason }]. */
async function classifyContacts(propertyId, channel, contacts, options) {
  const addresses = contacts
    .map((c) => (channel === 'email' ? c.email : c.phone))
    .filter(Boolean)
    .map((a) => normalizeAddress(channel, a));
  const suppressed = await suppressionsRepository.findSuppressedAddresses(
    propertyId,
    channel,
    addresses
  );
  return contacts.map((contact) => ({
    contact,
    skipReason: classifyContact(contact, channel, suppressed, options),
  }));
}

module.exports = { SKIP_REASONS, classifyContact, classifyContacts };
