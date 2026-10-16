const repository = require('./repository');
const logger = require('../../config/logger');
const { suppressAddress } = require('../suppressions/service');
const { normalizeAddress } = require('../suppressions/normalize');
const { unsubscribeContact } = require('../unsubscribe/service');

/**
 * A hard bounce means the address can't receive mail: suppress it for this hotel and flag the
 * contact so no campaign ever tries it again. Used both for synchronous SMTP rejections (sender.js)
 * and for provider bounce events (below). Idempotent.
 */
async function recordHardBounce(propertyId, address, { source }) {
  const normalized = normalizeAddress('email', address);
  if (!normalized) return { contacts: 0 };
  await suppressAddress({ propertyId, channel: 'email', address: normalized, reason: 'bounced' });
  const { count } = await repository.flagContactsBounced(propertyId, normalized);
  logger.info({ propertyId, source, contacts: count }, 'deliveries:hard_bounce_recorded'); // no address in logs
  return { contacts: count };
}

/** A spam complaint is an opt-out: unsubscribe every matching contact and suppress the address. */
async function recordComplaint(propertyId, address) {
  const normalized = normalizeAddress('email', address);
  if (!normalized) return;
  const contacts = await repository.findContactsByEmail(propertyId, normalized);
  for (const c of contacts) {
    await unsubscribeContact({ contactId: c.id, propertyId, via: 'spam_complaint', reason: 'complaint' });
  }
  await suppressAddress({ propertyId, channel: 'email', address: normalized, reason: 'complaint' });
}

/** Returns 'applied' or 'ignored' (nothing to do / nothing matched). Safe to run twice. */
async function applyEvent(propertyId, ev) {
  const recipient = await repository.findRecipient(propertyId, ev);
  const address = ev.address || recipient?.recipientEmail || null;

  if (ev.type === 'delivered') {
    if (!recipient) return 'ignored';
    await repository.markDelivered(recipient.id);
    return 'applied';
  }

  if (ev.type === 'bounce') {
    if (ev.bounceType === 'soft') {
      // Temporary trouble (mailbox full, greylisting): record it, keep the address.
      if (recipient) await repository.noteSoftBounce(recipient.id, ev.reason);
      return recipient ? 'applied' : 'ignored';
    }
    if (!address) return 'ignored';
    await recordHardBounce(propertyId, address, { source: 'provider_event' });
    if (recipient && (await repository.transitionToBounced(recipient.id, ev.reason))) {
      await repository.adjustCampaignCounts(recipient.campaignId, { sent: -1, bounced: 1 });
    }
    return 'applied';
  }

  if (ev.type === 'complaint') {
    if (!address) return 'ignored';
    await recordComplaint(propertyId, address);
    if (recipient && (await repository.markComplained(recipient.id))) {
      await repository.adjustCampaignCounts(recipient.campaignId, { complained: 1 });
    }
    return 'applied';
  }

  return 'ignored';
}

async function applyEvents(propertyId, events) {
  const summary = { received: events.length, applied: 0, ignored: 0 };
  for (const ev of events) {
    summary[await applyEvent(propertyId, ev)] += 1;
  }
  return summary;
}

module.exports = { applyEvents, applyEvent, recordHardBounce, recordComplaint };
