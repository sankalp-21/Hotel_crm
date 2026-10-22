const campaignsRepository = require('./repository');
const segmentsRepository = require('../segments/repository');
const propertyRepository = require('../property/repository');
const env = require('../../config/env');
const logger = require('../../config/logger');
const channel = require('../notifications/channel');
const { renderCampaignMessage } = require('./message');
const { findUnknownPlaceholders, unknownPlaceholderMessage } = require('./template');
const { buildInertUnsubscribeUrl } = require('../unsubscribe/tokens');
const { resolveSender, currentSenderPolicy } = require('../property/senderIdentity');
const { isActiveMemberEmail } = require('../../shared/tenancy/userAccess');
const { AppError, NotFoundError, ValidationError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');
const { withTransaction } = require('../../shared/db/transaction');

// Until an SMS provider is integrated, refuse SMS campaigns up front (clear 422) instead of
// failing every recipient one by one.
function assertChannelSupported(channel) {
  if (channel === 'sms' && env.NODE_ENV === 'production') {
    throw new ValidationError('SMS campaigns are not available yet: no SMS provider is configured');
  }
}

// Used by preview and test-send when no real contact is chosen. Fixed, so output is reproducible.
const SAMPLE_CONTACT = Object.freeze({
  id: null,
  fullName: 'Alex Sample',
  email: 'alex.sample@example.com',
  phone: '+1 555 0100',
});

const TEST_SUBJECT_PREFIX = '[TEST] ';

/**
 * Drafts saved before placeholder validation existed may still contain unknown {{x}}. Refuse to send
 * them (instead of emailing the literal text to every recipient); the author fixes the draft first.
 */
function assertTemplateValid(campaign) {
  const checks = [['body', campaign.body]];
  if (campaign.channel === 'email') checks.unshift(['subject', campaign.subject]);
  const messages = checks.map(([field, text]) => unknownPlaceholderMessage(field, text)).filter(Boolean);
  if (messages.length === 0) return;
  throw new ValidationError(messages.join('; '), {
    unknownPlaceholders: findUnknownPlaceholders(campaign.subject, campaign.body),
  });
}

async function assertSegmentInProperty(segmentId, propertyId) {
  const segment = await segmentsRepository.findById(segmentId, propertyId);
  if (!segment) throw new NotFoundError('Segment');
  return segment;
}

async function createCampaign(data, actingUser) {
  assertChannelSupported(data.channel);
  await assertSegmentInProperty(data.segmentId, data.propertyId);

  const campaign = await campaignsRepository.create({
    ...data,
    createdBy: actingUser?.id ?? null,
  });

  await logAudit({
    propertyId: campaign.propertyId,
    userId: actingUser?.id,
    action: 'campaign.created',
    entityType: 'Campaign',
    entityId: campaign.id,
    metadata: { name: campaign.name, segmentId: campaign.segmentId },
  });

  return campaign;
}

async function getCampaign(id, propertyId) {
  const campaign = await campaignsRepository.findById(id, propertyId);
  if (!campaign) throw new NotFoundError('Campaign');
  return campaign;
}

async function searchCampaigns(query) {
  const [items, total] = await campaignsRepository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function updateCampaign(id, propertyId, data, actingUser) {
  const current = await getCampaign(id, propertyId);
  if (current.status !== 'draft') {
    throw new ConflictError('Only draft campaigns can be edited');
  }
  if (data.channel) assertChannelSupported(data.channel);
  if (data.segmentId) await assertSegmentInProperty(data.segmentId, propertyId);

  const campaign = await campaignsRepository.update(id, propertyId, data);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.updated',
    entityType: 'Campaign',
    entityId: id,
    metadata: data,
  });
  return campaign;
}

/**
 * Request a send: validates, flips draft -> sending (compare-and-set, so two requests can't both
 * start it) and returns immediately. Background workers do the actual work (see sender.js).
 */
async function sendCampaign(id, propertyId, actingUser) {
  const campaign = await getCampaign(id, propertyId);
  if (campaign.status !== 'draft') {
    throw new ConflictError('Campaign has already been sent or is in progress');
  }
  if (campaign.channel === 'email' && !campaign.subject) {
    throw new ValidationError('Email campaigns require a subject');
  }
  assertChannelSupported(campaign.channel);
  assertTemplateValid(campaign);

  // CAN-SPAM: every marketing email must carry the sender's physical postal address.
  if (campaign.channel === 'email') {
    const property = await propertyRepository.findById(propertyId);
    if (!property?.address?.trim()) {
      throw new ValidationError(
        'Set the hotel postal address (PATCH /properties/:id) before sending email campaigns; it is required in the footer'
      );
    }
  }
  await assertSegmentInProperty(campaign.segmentId, propertyId);

  const started = await campaignsRepository.startSending(id, propertyId);
  if (!started) throw new ConflictError('Campaign has already been sent or is in progress');

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.send_requested',
    entityType: 'Campaign',
    entityId: id,
  });
  return getCampaign(id, propertyId);
}

/** Stop a campaign that is sending. Messages already delivered stay delivered; the rest are skipped. */
async function cancelCampaign(id, propertyId, actingUser) {
  const campaign = await getCampaign(id, propertyId);
  if (campaign.status === 'cancelled') return campaign; // idempotent
  if (campaign.status !== 'sending') {
    throw new ConflictError('Only a campaign that is currently sending can be cancelled');
  }

  const cancelled = await withTransaction((tx) => campaignsRepository.cancelSending(id, propertyId, tx));
  if (!cancelled) {
    const latest = await getCampaign(id, propertyId);
    if (latest.status === 'cancelled') return latest;
    throw new ConflictError('Campaign is no longer sending');
  }

  // A worker may still be finishing the message it was on; counts are exact once it yields.
  await campaignsRepository.reconcileCounts(id, await campaignsRepository.recipientCounts(id));
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.cancelled',
    entityType: 'Campaign',
    entityId: id,
  });
  return getCampaign(id, propertyId);
}

/** Re-queue failed recipients (and any never attempted after a halt) and resume sending. */
async function retryFailed(id, propertyId, actingUser) {
  const campaign = await getCampaign(id, propertyId);
  if (campaign.status !== 'sent' && campaign.status !== 'failed') {
    throw new ConflictError('Only a finished campaign (sent or failed) can be retried');
  }
  assertChannelSupported(campaign.channel);

  const requeued = await withTransaction(async (tx) => {
    const count = await campaignsRepository.requeueFailedRecipients(id, tx);
    const unsent = await campaignsRepository.countRecipients(id, 'queued', tx);
    if (count === 0 && unsent === 0) throw new ConflictError('No failed or unsent recipients to retry');
    const resumed = await campaignsRepository.resumeSending(id, propertyId, count, tx);
    if (!resumed) throw new ConflictError('Campaign is no longer in a retryable state');
    return count;
  });

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.retry_requested',
    entityType: 'Campaign',
    entityId: id,
    metadata: { requeued },
  });
  return getCampaign(id, propertyId);
}

async function listRecipients(id, propertyId, query) {
  await getCampaign(id, propertyId); // scoped lookup: another hotel's campaign is a 404
  const [items, total] = await campaignsRepository.listRecipientsPage({ campaignId: id, ...query });
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/**
 * Render the campaign for one contact (or a fixed sample) WITHOUT sending or changing anything.
 * The unsubscribe link is inert: a preview can be shared without leaking a working opt-out token.
 */
async function previewCampaign(id, propertyId, { contactId } = {}) {
  const campaign = await getCampaign(id, propertyId);
  const property = await propertyRepository.findById(propertyId);
  if (!property) throw new NotFoundError('Property');

  let contact = SAMPLE_CONTACT;
  if (contactId) {
    const [found] = await campaignsRepository.findContactsByIds(propertyId, [contactId]); // tenant-scoped
    if (!found) throw new NotFoundError('Contact');
    contact = found;
  }

  const isEmail = campaign.channel === 'email';
  const { subject, body, email } = renderCampaignMessage({
    campaign,
    contact,
    property,
    unsubscribeUrl: isEmail ? buildInertUnsubscribeUrl() : null,
  });
  const sender = isEmail ? resolveSender(property, channel.globalFrom?.(), currentSenderPolicy()) : null;

  return {
    campaignId: campaign.id,
    channel: campaign.channel,
    contact: { id: contactId ? contact.id : null, fullName: contact.fullName, sample: !contactId },
    subject,
    text: email ? email.text : body,
    html: email ? email.html : null,
    from: sender?.from ?? null,
    replyTo: sender?.replyTo ?? null,
    warnings: {
      unknownPlaceholders: findUnknownPlaceholders(campaign.subject, campaign.body),
      missingPostalAddress: isEmail && !property.address?.trim(),
    },
  };
}

/**
 * Send ONE rendered copy to a member of this hotel's staff, through the normal sender identity and
 * footer. Touches no campaign state: no status, counters, recipient rows, notification record or outbox
 * event. The unsubscribe link is inert and no List-Unsubscribe headers are added.
 */
async function testSendCampaign(id, propertyId, { to }, actingUser) {
  const campaign = await getCampaign(id, propertyId);
  if (campaign.channel !== 'email') {
    throw new ValidationError('Test sends are only available for email campaigns');
  }
  if (!campaign.subject) throw new ValidationError('Email campaigns require a subject');
  assertTemplateValid(campaign);

  // Not an open relay: only staff of THIS hotel. Same answer for "no such user" and "user elsewhere".
  if (!(await isActiveMemberEmail(to, propertyId))) {
    throw new ValidationError('to must be the email address of an active user with access to this property');
  }

  const property = await propertyRepository.findById(propertyId);
  if (!property) throw new NotFoundError('Property');

  const { subject, email } = renderCampaignMessage({
    campaign,
    contact: SAMPLE_CONTACT,
    property,
    unsubscribeUrl: buildInertUnsubscribeUrl(),
  });
  const sender = resolveSender(property, channel.globalFrom?.(), currentSenderPolicy());
  const testSubject = `${TEST_SUBJECT_PREFIX}${subject}`;

  try {
    await channel.send({
      to,
      subject: testSubject,
      body: email.text,
      html: email.html,
      from: sender.from,
      replyTo: sender.replyTo,
      channel: 'email',
    });
  } catch (err) {
    logger.error({ err, campaignId: id }, 'campaigns:test_send_failed');
    throw new AppError('The test email could not be sent. Check the mail configuration and try again.', {
      statusCode: 502,
      code: 'EMAIL_SEND_FAILED',
    });
  }

  // Who and which campaign, never the address.
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.test_sent',
    entityType: 'Campaign',
    entityId: id,
  });
  return { sent: true, subject: testSubject };
}

module.exports = {
  previewCampaign,
  testSendCampaign,
  createCampaign,
  getCampaign,
  searchCampaigns,
  updateCampaign,
  sendCampaign,
  cancelCampaign,
  retryFailed,
  listRecipients,
};
