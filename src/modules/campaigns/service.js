const campaignsRepository = require('./repository');
const segmentsRepository = require('../segments/repository');
const notificationsRepository = require('../notifications/repository');
const channel = require('../notifications/channel');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');
const { emitCampaignSent } = require('./events');
const logger = require('../../config/logger');

function renderTemplate(template, contact) {
  return String(template)
    .replaceAll('{{fullName}}', contact.fullName || '')
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '');
}

async function assertSegmentInProperty(segmentId, propertyId) {
  const segment = await segmentsRepository.findById(segmentId, propertyId);
  if (!segment) throw new NotFoundError('Segment');
  return segment;
}

async function createCampaign(data, actingUser) {
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
 * Resolve segment → create recipient rows → send via notifications channel →
 * write Notification + recipient status. Synchronous for Phase 4 (segment sizes
 * are expected small); a queue can replace the loop later.
 */
async function sendCampaign(id, propertyId, actingUser) {
  const campaign = await getCampaign(id, propertyId);
  if (campaign.status !== 'draft') {
    throw new ConflictError('Campaign has already been sent or is in progress');
  }
  if (campaign.channel === 'email' && !campaign.subject) {
    throw new ValidationError('Email campaigns require a subject');
  }

  const segment = await assertSegmentInProperty(campaign.segmentId, propertyId);
  const [contacts] = await segmentsRepository.resolveContacts(propertyId, segment.filters, {
    skip: 0,
    take: 5000,
  });

  await campaignsRepository.update(id, propertyId, {
    status: 'sending',
    totalRecipients: contacts.length,
  });

  if (contacts.length > 0) {
    await campaignsRepository.createRecipients(
      contacts.map((c) => ({
        campaignId: id,
        contactId: c.id,
        recipientEmail: c.email ?? null,
        recipientPhone: c.phone ?? null,
        status: 'queued',
      }))
    );
  }

  const recipients = await campaignsRepository.listRecipients(id);
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const contact = recipient.contact;
    const to = campaign.channel === 'email' ? contact.email : contact.phone;

    if (!to) {
      await campaignsRepository.updateRecipient(recipient.id, {
        status: 'skipped',
        failureReason: campaign.channel === 'email' ? 'Contact has no email' : 'Contact has no phone',
      });
      skippedCount += 1;
      continue;
    }

    const subject =
      campaign.channel === 'email' ? renderTemplate(campaign.subject, contact) : null;
    const body = renderTemplate(campaign.body, contact);

    try {
      await channel.send({
        to,
        subject: subject || campaign.name,
        body,
        channel: campaign.channel,
      });

      const notification = await notificationsRepository.createNotificationRecord({
        propertyId,
        eventType: 'campaign.sent',
        channel: campaign.channel,
        recipientEmail: campaign.channel === 'email' ? to : null,
        subject: subject || campaign.name,
        body,
        status: 'sent',
        failureReason: null,
        payload: {
          campaignId: id,
          contactId: contact.id,
          segmentId: campaign.segmentId,
          channel: campaign.channel,
        },
        sentAt: new Date(),
      });

      await campaignsRepository.updateRecipient(recipient.id, {
        status: 'sent',
        notificationId: notification.id,
        sentAt: new Date(),
      });
      sentCount += 1;
    } catch (err) {
      logger.error({ err, campaignId: id, contactId: contact.id }, 'campaigns:send_failed');
      await campaignsRepository.updateRecipient(recipient.id, {
        status: 'failed',
        failureReason: err.message,
      });
      failedCount += 1;
    }
  }

  const finalStatus = failedCount > 0 && sentCount === 0 ? 'failed' : 'sent';
  const updated = await campaignsRepository.update(id, propertyId, {
    status: finalStatus,
    sentAt: new Date(),
    sentCount,
    skippedCount,
    failedCount,
    totalRecipients: recipients.length,
  });

  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'campaign.sent',
    entityType: 'Campaign',
    entityId: id,
    metadata: { sentCount, skippedCount, failedCount, totalRecipients: recipients.length },
  });

  emitCampaignSent(updated, { sentCount, skippedCount, failedCount, totalRecipients: recipients.length });
  return getCampaign(id, propertyId);
}

module.exports = {
  createCampaign,
  getCampaign,
  searchCampaigns,
  updateCampaign,
  sendCampaign,
};
