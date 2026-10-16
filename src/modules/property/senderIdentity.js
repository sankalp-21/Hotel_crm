/**
 * Who a campaign email appears to come from.
 *  - name:     the hotel's configured from-name, else the hotel name (guests recognise the hotel)
 *  - address:  the hotel's own from-address (only ever on an allow-listed domain), else the global one
 *  - replyTo:  the hotel's reply-to, so replies reach the hotel rather than a no-reply mailbox
 * Pure so it can be tested without a mail server.
 */
function resolveSender(property, globalFrom) {
  const address = property.emailFromAddress || globalFrom?.address || '';
  const name = property.emailFromName || property.name || globalFrom?.name || '';
  return {
    from: address ? { name, address } : undefined, // undefined => channel falls back to EMAIL_FROM
    replyTo: property.emailReplyTo || undefined,
  };
}

module.exports = { resolveSender };
