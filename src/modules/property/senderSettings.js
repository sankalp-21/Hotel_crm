const env = require('../../config/env');
const propertyRepository = require('./repository');
const { NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');
const { resolveSender } = require('./senderIdentity');
const { deliveryWebhookUrl } = require('../deliveries/signature');
const channel = require('../notifications/channel');

function domainOf(address) {
  return String(address).split('@')[1]?.toLowerCase() ?? '';
}

// The shared SMTP account can only vouch for domains the platform controls (SPF/DKIM). Letting a hotel
// type any from-address would let it impersonate someone else's domain through our server.
function assertFromAddressAllowed(address) {
  const allowed = env.emailAllowedFromDomains;
  const domain = domainOf(address);
  const permitted = allowed.length > 0 ? allowed.includes(domain) : env.NODE_ENV !== 'production';
  if (!permitted) {
    throw new ValidationError(
      allowed.length > 0
        ? `The domain "${domain}" is not verified for sending. Allowed domains: ${allowed.join(', ')}`
        : 'Custom from-addresses are not enabled on this server (EMAIL_ALLOWED_FROM_DOMAINS is empty)'
    );
  }
}

async function getSenderSettings(propertyId) {
  const property = await propertyRepository.findById(propertyId);
  if (!property) throw new NotFoundError('Property');
  const { from, replyTo } = resolveSender(property, channel.globalFrom());
  return {
    emailFromName: property.emailFromName,
    emailFromAddress: property.emailFromAddress,
    emailReplyTo: property.emailReplyTo,
    // What recipients will actually see, after fallbacks:
    effective: { fromName: from?.name ?? null, fromAddress: from?.address ?? null, replyTo: replyTo ?? null },
    allowedFromDomains: env.emailAllowedFromDomains,
    // Paste this into the email provider's bounce/complaint webhook settings. Treat it as a secret.
    deliveryWebhookUrl: deliveryWebhookUrl(property.id),
  };
}

async function updateSenderSettings(propertyId, data, actingUser) {
  const property = await propertyRepository.findById(propertyId);
  if (!property) throw new NotFoundError('Property');
  if (data.emailFromAddress) assertFromAddressAllowed(data.emailFromAddress);

  await propertyRepository.update(propertyId, data);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'property.sender_updated',
    entityType: 'Property',
    entityId: propertyId,
    metadata: { changedFields: Object.keys(data).filter((k) => data[k] !== undefined) }, // names only
  });
  return getSenderSettings(propertyId);
}

module.exports = { getSenderSettings, updateSenderSettings, assertFromAddressAllowed };
