const crypto = require('crypto');
const env = require('../../config/env');

/**
 * Stateless, signed unsubscribe token: base64url(payload) + "." + base64url(HMAC-SHA256).
 * Payload carries only opaque ids (contact, property, optional campaign) and an expiry, never an
 * email address, so a leaked link reveals nothing and can only do one thing: unsubscribe that contact.
 */
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', env.unsubscribeSecret).update(data).digest();

function signUnsubscribeToken({ contactId, propertyId, campaignId = null }, now = Date.now()) {
  const exp = Math.floor(now / 1000) + env.UNSUBSCRIBE_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const payload = b64(JSON.stringify({ v: 1, c: contactId, p: propertyId, k: campaignId, e: exp }));
  return `${payload}.${b64(hmac(payload))}`;
}

/** Returns { contactId, propertyId, campaignId } or null for anything malformed, forged or expired. */
function verifyUnsubscribeToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const expected = hmac(payload);
  let given;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || typeof data.c !== 'string' || typeof data.p !== 'string') return null;
  if (typeof data.e !== 'number' || data.e * 1000 < now) return null;
  return { contactId: data.c, propertyId: data.p, campaignId: typeof data.k === 'string' ? data.k : null };
}

function buildUnsubscribeUrl(ids) {
  return `${env.publicBaseUrl}/public/unsubscribe?token=${signUnsubscribeToken(ids)}`;
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl };
