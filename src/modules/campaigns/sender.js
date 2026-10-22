const os = require('os');
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');
const redis = require('../../infrastructure/redis/redis');
const repo = require('./repository');
const segmentsRepository = require('../segments/repository');
const propertyRepository = require('../property/repository');
const notificationsRepository = require('../notifications/repository');
const channel = require('../notifications/channel');
const { classifyContacts } = require('./eligibility');
const { renderCampaignMessage } = require('./message');
const { buildUnsubscribeUrl } = require('../unsubscribe/tokens');
const { waitForSlot } = require('./pacing');
const { classifySmtpError } = require('../deliveries/classify');
const { recordHardBounce } = require('../deliveries/service');
const { resolveSender, currentSenderPolicy } = require('../property/senderIdentity');
const { recordCampaignSent } = require('./events');
const { withTransaction } = require('../../shared/db/transaction');
const { logAudit } = require('../audit/service');

/**
 * Campaign sender. POST /campaigns/:id/send only flips draft -> sending; everything below runs in
 * background workers and keeps ALL its state in the database, so a crash, deploy or second worker
 * can never lose or duplicate work:
 *
 *  - A worker takes a campaign with a time-limited lease (compare-and-set), works on it for one
 *    slice, then yields. If it dies, the lease expires and another worker continues.
 *  - Preparation pages through the segment by id (no 5,000 cap) and writes recipient rows
 *    page by page; resuming continues from the saved cursor.
 *  - Sending takes queued recipients, re-checks eligibility RIGHT BEFORE each send (someone may have
 *    unsubscribed since preparation), claims each recipient individually (queued -> sending), and
 *    paces to the hotel's messages-per-second limit across all workers.
 *  - Delivery is at-most-once: a crash leaves at most one recipient in `sending`, which becomes
 *    failed/"interrupted" (retry-failed can resend it). We never risk emailing someone twice.
 */

const PREPARE_PAGE = 500;
const OWNER = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

function withDefaults(opts = {}) {
  return {
    owner: OWNER,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    redis,
    leaseMs: env.CAMPAIGN_LEASE_MS,
    sliceMs: env.CAMPAIGN_SLICE_MS,
    batchSize: env.CAMPAIGN_BATCH_SIZE,
    preparePage: PREPARE_PAGE,
    maxConsecutiveFailures: env.CAMPAIGN_MAX_CONSECUTIVE_FAILURES,
    defaultRatePerSec: env.CAMPAIGN_SEND_RATE_PER_SEC,
    stallMinutes: env.CAMPAIGN_STALL_MINUTES,
    ...opts,
  };
}

// Stop a few seconds before the lease runs out so a slow call can't outlive our ownership.
const LEASE_SAFETY_MS = 5_000;
const leaseSafe = (ctx) => ctx.deps.now() < ctx.leaseExpiresAt - LEASE_SAFETY_MS;
const outOfTime = (ctx) => ctx.deps.now() >= ctx.deadline;

async function keepLease(ctx) {
  const until = ctx.deps.now() + ctx.deps.leaseMs;
  const ok = await repo.renewLease(ctx.id, ctx.deps.owner, new Date(until));
  if (ok) ctx.leaseExpiresAt = until;
  return ok;
}

/** One pass: give every campaign that needs work (and has no live owner) one slice of time. */
async function runCampaignSends(opts = {}) {
  const deps = withDefaults(opts);
  const candidates = await repo.listClaimable(new Date(deps.now()));

  for (const { id } of candidates) {
    const leaseUntil = deps.now() + deps.leaseMs;
    const won = await repo.tryAcquireLease(id, deps.owner, new Date(leaseUntil), new Date(deps.now()));
    if (!won) continue; // another worker has it

    try {
      await processCampaign(id, deps, leaseUntil);
    } catch (err) {
      logger.error({ err, campaignId: id }, 'campaigns:slice_failed');
    } finally {
      await repo.releaseLease(id, deps.owner).catch(() => {});
    }
  }

  await warnStalled(deps);
}

async function processCampaign(id, deps, leaseExpiresAt) {
  const ctx = { id, deps, leaseExpiresAt, deadline: deps.now() + deps.sliceMs };

  let campaign = await repo.findForWorker(id);
  if (!campaign || campaign.status !== 'sending') return;

  // We hold the lease, so any recipient still in `sending` belongs to a dead worker.
  const interrupted = await repo.failInterruptedRecipients(id);
  if (interrupted.count > 0) {
    logger.warn({ campaignId: id, count: interrupted.count }, 'campaigns:interrupted_recipients_marked_failed');
    await repo.incrementCounts(id, { failed: interrupted.count });
  }

  try {
    if (!campaign.preparedAt) {
      const prepared = await prepare(ctx, campaign);
      if (!prepared) return;
      campaign = await repo.findForWorker(id);
      if (!campaign || campaign.status !== 'sending') return;
    }
    await sendPhase(ctx, campaign);
  } finally {
    await afterStop(ctx);
  }
}

/** Turn the segment into recipient rows, one page at a time. Returns true once fully prepared. */
async function prepare(ctx, campaign) {
  const { deps } = ctx;
  const segment = await segmentsRepository.findById(campaign.segmentId, campaign.propertyId);
  if (!segment) {
    await repo.halt(ctx.id, deps.owner, 'segment_missing');
    return false;
  }

  let cursor = campaign.prepareCursor;
  for (;;) {
    if (!leaseSafe(ctx) || outOfTime(ctx)) return false;
    if (!(await keepLease(ctx))) return false; // lost the lease, or the campaign was cancelled

    const contacts = await segmentsRepository.resolveContactsPage(campaign.propertyId, segment.filters, {
      afterId: cursor,
      take: deps.preparePage,
    });
    if (contacts.length === 0) {
      await repo.markPrepared(ctx.id);
      return true;
    }

    // Consent gate: everyone gets a recipient row, only eligible contacts are queued.
    const classified = await classifyContacts(campaign.propertyId, campaign.channel, contacts);
    const rows = classified.map(({ contact, skipReason }) => ({
      campaignId: ctx.id,
      contactId: contact.id,
      recipientEmail: contact.email ?? null,
      recipientPhone: contact.phone ?? null,
      status: skipReason ? 'skipped' : 'queued',
      failureReason: skipReason,
    }));
    const done = contacts.length < deps.preparePage;
    cursor = contacts[contacts.length - 1].id;

    await repo.addRecipientPage(campaign, rows, {
      cursor,
      skipped: classified.filter((c) => c.skipReason).length,
      done,
    });
    if (done) return true;
  }
}

async function sendPhase(ctx, campaign) {
  const { deps } = ctx;
  const { propertyId } = campaign;
  const property = await propertyRepository.findById(propertyId);
  const ratePerSec = property?.campaignSendRatePerSec || deps.defaultRatePerSec;

  const tally = { sent: 0, failed: 0, skipped: 0, bounced: 0 };
  const flush = async () => {
    if (!tally.sent && !tally.failed && !tally.skipped && !tally.bounced) return;
    const delta = { ...tally };
    tally.sent = tally.failed = tally.skipped = tally.bounced = 0;
    await repo.incrementCounts(ctx.id, delta);
  };
  let consecutiveFailures = 0;

  try {
    for (;;) {
      if (!leaseSafe(ctx) || outOfTime(ctx)) return; // yield; unsent recipients simply stay queued
      if (!(await keepLease(ctx))) return;

      const batch = await repo.nextQueuedBatch(ctx.id, deps.batchSize);
      if (batch.length === 0) {
        await flush();
        await finalize(ctx, campaign);
        return;
      }

      const contacts = await repo.findContactsByIds(propertyId, batch.map((r) => r.contactId));
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const classified = await classifyContacts(propertyId, campaign.channel, contacts);
      const skipReasonById = new Map(classified.map((c) => [c.contact.id, c.skipReason]));

      for (const recipient of batch) {
        if (!leaseSafe(ctx) || outOfTime(ctx)) return;

        const contact = byId.get(recipient.contactId);
        const reason = contact ? skipReasonById.get(contact.id) : 'contact_missing';
        if (reason) {
          // Eligibility is re-checked at send time: unsubscribed/suppressed since preparation.
          const { count } = await repo.skipRecipient(recipient.id, reason);
          if (count) tally.skipped += 1;
          continue;
        }

        if (!(await repo.claimRecipient(recipient.id))) continue; // cancelled or taken meanwhile

        await waitForSlot(deps.redis, propertyId, ratePerSec, deps);
        const outcome = await deliver({ campaign, property, recipient, contact });
        if (outcome === 'sent') {
          tally.sent += 1;
          consecutiveFailures = 0;
        } else if (outcome === 'bounced') {
          // A dead address is the recipient's problem, not an outage: it neither trips nor resets the breaker.
          tally.bounced += 1;
        } else {
          tally.failed += 1;
          consecutiveFailures += 1;
          if (consecutiveFailures >= deps.maxConsecutiveFailures) {
            await flush();
            await repo.halt(ctx.id, deps.owner, `stopped after ${consecutiveFailures} consecutive send failures`);
            logger.error({ campaignId: ctx.id, consecutiveFailures }, 'campaigns:halted_consecutive_failures');
            return;
          }
        }
      }
      await flush();
    }
  } finally {
    await flush().catch((err) => logger.error({ err, campaignId: ctx.id }, 'campaigns:flush_failed'));
  }
}

/** Send one message. Returns 'sent' | 'bounced' | 'failed'. Failures are recorded on the recipient, never thrown. */
async function deliver({ campaign, property, recipient, contact }) {
  const isEmail = campaign.channel === 'email';
  const to = isEmail ? contact.email : contact.phone;

  // Stage 1 — build the message. A failure here is OUR bug or misconfiguration (bad template data,
  // missing secret, ...), not an SMTP problem: record the real reason on the recipient instead of
  // throwing (which would leave it stuck in `sending` and later mislabelled "interrupted").
  // It counts as a failed send, so a systemic build error trips the circuit breaker quickly.
  let subject;
  let body;
  let email;
  let sender;
  try {
    ({ subject, body, email } = renderCampaignMessage({
      campaign,
      contact,
      property,
      unsubscribeUrl: isEmail
        ? buildUnsubscribeUrl({ contactId: contact.id, propertyId: campaign.propertyId, campaignId: campaign.id })
        : null,
    }));
    sender = isEmail ? resolveSender(property, channel.globalFrom?.(), currentSenderPolicy()) : {};
  } catch (err) {
    logger.error({ err, campaignId: campaign.id, contactId: contact.id }, 'campaigns:build_failed');
    await repo.updateRecipient(recipient.id, {
      status: 'failed',
      failureReason: `build: ${String(err.message)}`.slice(0, 500),
    });
    return 'failed';
  }

  // Stage 2 — hand it to the mail transport.
  let result;
  try {
    result = await channel.send({
      to,
      subject: subject || campaign.name,
      body: email ? email.text : body,
      html: email?.html,
      headers: email?.headers,
      from: sender.from,
      replyTo: sender.replyTo,
      channel: campaign.channel,
    });
  } catch (err) {
    const { kind } = isEmail ? classifySmtpError(err) : { kind: 'transient' };
    logger.error({ err, kind, campaignId: campaign.id, contactId: contact.id }, 'campaigns:send_failed');
    const reason = `${kind}: ${String(err.message)}`.slice(0, 500);

    if (kind === 'hard_bounce') {
      // The mailbox doesn't exist: suppress + flag it now so no other campaign tries it again.
      await recordHardBounce(campaign.propertyId, to, { source: 'smtp_rejection' });
      await repo.updateRecipient(recipient.id, { status: 'bounced', bouncedAt: new Date(), failureReason: reason });
      return 'bounced';
    }
    await repo.updateRecipient(recipient.id, { status: 'failed', failureReason: reason });
    return 'failed';
  }

  // Delivered. Bookkeeping errors below propagate (DB trouble); the recipient then stays `sending`
  // and is resolved as "interrupted" rather than risking a duplicate email.
  const notification = await notificationsRepository.createNotificationRecord({
    propertyId: campaign.propertyId,
    eventType: 'campaign.sent',
    channel: campaign.channel,
    recipientEmail: isEmail ? to : null,
    subject: subject || campaign.name,
    body,
    status: 'sent',
    failureReason: null,
    payload: {
      campaignId: campaign.id,
      contactId: contact.id,
      segmentId: campaign.segmentId,
      channel: campaign.channel,
    },
    sentAt: new Date(),
  });
  await repo.updateRecipient(recipient.id, {
    status: 'sent',
    notificationId: notification.id,
    sentAt: new Date(),
    providerMessageId: result?.messageId ?? null,
  });
  return 'sent';
}

/** Nothing left to send: make the counts exact, close the campaign and emit the outbox event. */
async function finalize(ctx, campaign) {
  const counts = await repo.recipientCounts(ctx.id);
  if (counts.open > 0) return; // something was requeued meanwhile; the next pass continues

  // Nothing delivered and something went wrong (failures or bounces) => failed, so it can be retried.
  const status = counts.sentCount === 0 && counts.failedCount + counts.bouncedCount > 0 ? 'failed' : 'sent';
  const finished = await withTransaction(async (tx) => {
    const ok = await repo.finish(ctx.id, ctx.deps.owner, status, counts, tx);
    if (!ok) return false;
    await recordCampaignSent(tx, campaign, {
      sentCount: counts.sentCount,
      skippedCount: counts.skippedCount,
      failedCount: counts.failedCount,
      bouncedCount: counts.bouncedCount,
      totalRecipients: counts.totalRecipients,
    });
    return true;
  });

  if (finished) {
    await logAudit({
      propertyId: campaign.propertyId,
      action: 'campaign.sent',
      entityType: 'Campaign',
      entityId: ctx.id,
      metadata: {
        sentCount: counts.sentCount,
        skippedCount: counts.skippedCount,
        failedCount: counts.failedCount,
        bouncedCount: counts.bouncedCount,
        totalRecipients: counts.totalRecipients,
      },
    });
  }
}

/** If the campaign was cancelled while we worked, leave it fully consistent. */
async function afterStop(ctx) {
  const current = await repo.findForWorker(ctx.id).catch(() => null);
  if (!current || current.status !== 'cancelled') return;
  await repo.skipQueued(ctx.id, 'campaign_cancelled');
  await repo.reconcileCounts(ctx.id, await repo.recipientCounts(ctx.id));
}

async function warnStalled(deps) {
  const before = new Date(deps.now() - deps.stallMinutes * 60_000);
  const stalled = await repo.listStalled(before).catch(() => []);
  for (const c of stalled) {
    logger.warn({ campaignId: c.id, propertyId: c.propertyId, lastProgressAt: c.lastProgressAt }, 'campaigns:stalled');
  }
}

module.exports = { runCampaignSends, processCampaign };
