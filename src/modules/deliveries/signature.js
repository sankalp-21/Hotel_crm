const crypto = require('crypto');
const env = require('../../config/env');

/**
 * The webhook URL for a hotel carries an HMAC of its property id, so the URL itself is the credential
 * (providers differ in how they can authenticate, but all of them can call a URL). The signature only
 * authorises delivery events for THAT property.
 */
function signPropertyWebhook(propertyId) {
  return crypto.createHmac('sha256', env.deliveryWebhookSecret).update(`delivery-events:${propertyId}`).digest('hex');
}

function verifyPropertyWebhook(propertyId, sig) {
  if (typeof sig !== 'string' || sig.length !== 64) return false;
  const expected = Buffer.from(signPropertyWebhook(propertyId), 'hex');
  let given;
  try {
    given = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function deliveryWebhookUrl(propertyId) {
  return `${env.publicBaseUrl}/public/delivery-events/${propertyId}?sig=${signPropertyWebhook(propertyId)}`;
}

module.exports = { signPropertyWebhook, verifyPropertyWebhook, deliveryWebhookUrl };
