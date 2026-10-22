const env = require('../../config/env');

/**
 * Who a campaign email appears to come from.
 *  - name:     the hotel's configured from-name, else the hotel name (guests recognise the hotel)
 *  - address:  the hotel's own from-address (only ever on an allow-listed domain), else the global one
 *  - replyTo:  the hotel's reply-to, so replies reach the hotel rather than a no-reply mailbox
 * resolveSender is pure so it can be tested without a mail server.
 */

function domainOf(address) {
  return String(address).split('@')[1]?.toLowerCase() ?? '';
}

/**
 * The shared SMTP account can only vouch for domains the platform controls (SPF/DKIM). With an empty
 * allow-list, custom from-addresses are refused in production and allowed elsewhere (dev convenience).
 */
function isFromAddressAllowed(address, { allowedDomains, nodeEnv }) {
  return allowedDomains.length > 0 ? allowedDomains.includes(domainOf(address)) : nodeEnv !== 'production';
}

/** The policy the running server enforces (read at call time, so tests and config reloads see the truth). */
function currentSenderPolicy() {
  return { allowedDomains: env.emailAllowedFromDomains, nodeEnv: env.NODE_ENV };
}

/**
 * `policy` (see currentSenderPolicy) is re-applied at SEND time, not only when the address is saved:
 * if the allow-list later shrinks (a domain's DNS lapses, config tightened), a stored custom address
 * on that domain stops being used and the global sender takes over, instead of impersonating on a
 * domain the platform can no longer vouch for.
 */
function resolveSender(property, globalFrom, policy) {
  const customAddress =
    property.emailFromAddress && (!policy || isFromAddressAllowed(property.emailFromAddress, policy))
      ? property.emailFromAddress
      : '';
  const address = customAddress || globalFrom?.address || '';
  const name = property.emailFromName || property.name || globalFrom?.name || '';
  return {
    from: address ? { name, address } : undefined, // undefined => channel falls back to EMAIL_FROM
    replyTo: property.emailReplyTo || undefined,
  };
}

module.exports = { resolveSender, isFromAddressAllowed, currentSenderPolicy, domainOf };
