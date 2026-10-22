const prisma = require('../../infrastructure/db/prisma');

const campaignInclude = {
  segment: { select: { id: true, name: true, filters: true } },
};

const contactSummary = { select: { id: true, fullName: true, email: true, phone: true } };

function create(data) {
  return prisma.campaign.create({ data, include: campaignInclude });
}

// Recipients are deliberately NOT embedded any more: a send can have tens of thousands.
// Use listRecipientsPage (GET /campaigns/:id/recipients).
function findById(id, propertyId) {
  return prisma.campaign.findFirst({ where: { id, propertyId }, include: campaignInclude });
}

function search({ propertyId, search, status, page, pageSize }) {
  const where = {
    propertyId,
    ...(status && { status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: campaignInclude,
    }),
    prisma.campaign.count({ where }),
  ]);
}

function update(id, propertyId, data, db = prisma) {
  return db.campaign.update({ where: { id, propertyId }, data, include: campaignInclude });
}

function listRecipientsPage({ campaignId, status, page, pageSize }) {
  const where = { campaignId, ...(status && { status }) };
  return Promise.all([
    prisma.campaignRecipient.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { contact: contactSummary },
    }),
    prisma.campaignRecipient.count({ where }),
  ]);
}

// ───────────── state transitions (all compare-and-set, so concurrent callers can't both win) ─────────────

/** draft -> sending. Returns true only for the caller that won the transition. */
async function startSending(id, propertyId, db = prisma) {
  const now = new Date();
  const { count } = await db.campaign.updateMany({
    where: { id, propertyId, status: 'draft' },
    data: { status: 'sending', startedAt: now, lastProgressAt: now },
  });
  return count === 1;
}

/** sending -> cancelled, and every not-yet-sent recipient becomes skipped. Returns true if it cancelled. */
async function cancelSending(id, propertyId, db = prisma) {
  const now = new Date();
  const { count } = await db.campaign.updateMany({
    where: { id, propertyId, status: 'sending' },
    data: { status: 'cancelled', cancelledAt: now, finishedAt: now, leaseOwner: null, leaseUntil: null },
  });
  if (count !== 1) return false;
  await db.campaignRecipient.updateMany({
    where: { campaignId: id, status: 'queued' },
    data: { status: 'skipped', failureReason: 'campaign_cancelled' },
  });
  return true;
}

/** failed recipients back to queued (campaign must be terminal). Returns how many were requeued. */
async function requeueFailedRecipients(campaignId, db = prisma) {
  const { count } = await db.campaignRecipient.updateMany({
    where: { campaignId, status: 'failed' },
    data: { status: 'queued', failureReason: null },
  });
  return count;
}

function countRecipients(campaignId, status, db = prisma) {
  return db.campaignRecipient.count({ where: { campaignId, status } });
}

/** sent|failed -> sending again (retry). Returns true if it resumed. */
async function resumeSending(id, propertyId, requeued = 0, db = prisma) {
  const { count } = await db.campaign.updateMany({
    where: { id, propertyId, status: { in: ['sent', 'failed'] } },
    data: {
      status: 'sending',
      haltReason: null,
      finishedAt: null,
      sentAt: null,
      lastProgressAt: new Date(),
      leaseOwner: null,
      leaseUntil: null,
      // requeued recipients are no longer "failed"; they will be counted again if they fail again
      ...(requeued > 0 && { failedCount: { decrement: requeued } }),
    },
  });
  return count === 1;
}

// ───────────── worker side (system actor: ids come from campaign rows, never from a request) ─────────────

function findForWorker(id) {
  return prisma.campaign.findUnique({ where: { id } });
}

function listClaimable(now) {
  return prisma.campaign.findMany({
    where: { status: 'sending', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    orderBy: { lastProgressAt: 'asc' }, // longest-waiting first: fair across hotels
    take: 10,
    select: { id: true },
  });
}

async function tryAcquireLease(id, owner, leaseUntil, now) {
  const { count } = await prisma.campaign.updateMany({
    where: { id, status: 'sending', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseOwner: owner, leaseUntil },
  });
  return count === 1;
}

async function renewLease(id, owner, leaseUntil) {
  const { count } = await prisma.campaign.updateMany({
    where: { id, leaseOwner: owner, status: 'sending' },
    data: { leaseUntil },
  });
  return count === 1;
}

function releaseLease(id, owner) {
  return prisma.campaign.updateMany({
    where: { id, leaseOwner: owner },
    data: { leaseOwner: null, leaseUntil: null },
  });
}

/** A previous owner died mid-send: its in-flight recipient may or may not have been delivered. */
function failInterruptedRecipients(campaignId) {
  return prisma.campaignRecipient.updateMany({
    where: { campaignId, status: 'sending' },
    data: { status: 'failed', failureReason: 'interrupted' },
  });
}

/** Insert one page of recipients and advance the cursor + counters in ONE transaction. */
function addRecipientPage(campaign, rows, { cursor, skipped, done }) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.campaignRecipient.createMany({ data: rows, skipDuplicates: true });
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        totalRecipients: { increment: count },
        skippedCount: { increment: Math.min(skipped, count) },
        prepareCursor: cursor,
        lastProgressAt: new Date(),
        ...(done && { preparedAt: new Date() }),
      },
    });
  });
}

function markPrepared(id) {
  return prisma.campaign.update({ where: { id }, data: { preparedAt: new Date(), lastProgressAt: new Date() } });
}

function nextQueuedBatch(campaignId, take) {
  return prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'queued' },
    orderBy: { id: 'asc' },
    take,
    select: { id: true, contactId: true, recipientEmail: true, recipientPhone: true },
  });
}

function findContactsByIds(propertyId, ids) {
  return prisma.contact.findMany({
    where: { propertyId, id: { in: ids } },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true,
      marketingConsent: true,
      unsubscribedAt: true,
      emailBounced: true,
    },
  });
}

/** queued -> sending for ONE recipient; false if it was cancelled/claimed meanwhile. */
async function claimRecipient(id) {
  const { count } = await prisma.campaignRecipient.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'sending' },
  });
  return count === 1;
}

function updateRecipient(id, data) {
  return prisma.campaignRecipient.update({ where: { id }, data });
}

/** Everything still queued becomes skipped (used after a cancel, including rows a worker added late). */
function skipQueued(campaignId, reason) {
  return prisma.campaignRecipient.updateMany({
    where: { campaignId, status: 'queued' },
    data: { status: 'skipped', failureReason: reason },
  });
}

function skipRecipient(id, reason) {
  return prisma.campaignRecipient.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'skipped', failureReason: reason },
  });
}

function incrementCounts(id, { sent = 0, failed = 0, skipped = 0, bounced = 0 }) {
  return prisma.campaign.update({
    where: { id },
    data: {
      sentCount: { increment: sent },
      failedCount: { increment: failed },
      skippedCount: { increment: skipped },
      bouncedCount: { increment: bounced },
      lastProgressAt: new Date(),
    },
  });
}

async function recipientCounts(campaignId, db = prisma) {
  const rows = await db.campaignRecipient.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } });
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  const complainedCount = await db.campaignRecipient.count({ where: { campaignId, complainedAt: { not: null } } });
  return {
    sentCount: by.sent || 0,
    failedCount: by.failed || 0,
    skippedCount: by.skipped || 0,
    bouncedCount: by.bounced || 0,
    complainedCount,
    totalRecipients: Object.values(by).reduce((a, b) => a + b, 0),
    open: (by.queued || 0) + (by.sending || 0),
  };
}

function reconcileCounts(id, counts) {
  const { sentCount, failedCount, skippedCount, bouncedCount, complainedCount, totalRecipients } = counts;
  return prisma.campaign.update({
    where: { id },
    data: { sentCount, failedCount, skippedCount, bouncedCount, complainedCount, totalRecipients },
  });
}

/** sending -> sent|failed, only for the current lease holder. */
async function finish(id, owner, status, counts, db) {
  const now = new Date();
  const { sentCount, failedCount, skippedCount, bouncedCount, complainedCount, totalRecipients } = counts;
  const { count } = await db.campaign.updateMany({
    where: { id, leaseOwner: owner, status: 'sending' },
    data: {
      status,
      sentAt: now,
      finishedAt: now,
      lastProgressAt: now,
      leaseOwner: null,
      leaseUntil: null,
      sentCount,
      failedCount,
      skippedCount,
      bouncedCount,
      complainedCount,
      totalRecipients,
    },
  });
  return count === 1;
}

/** Stop sending but keep the unsent recipients queued so retry-failed can resume them. */
async function halt(id, owner, reason) {
  const now = new Date();
  const { count } = await prisma.campaign.updateMany({
    where: { id, leaseOwner: owner, status: 'sending' },
    data: { status: 'failed', haltReason: reason, finishedAt: now, leaseOwner: null, leaseUntil: null },
  });
  return count === 1;
}

function listStalled(before) {
  return prisma.campaign.findMany({
    where: { status: 'sending', lastProgressAt: { lt: before } },
    select: { id: true, propertyId: true, lastProgressAt: true },
    take: 50,
  });
}

module.exports = {
  create,
  findById,
  search,
  update,
  listRecipientsPage,
  startSending,
  cancelSending,
  requeueFailedRecipients,
  countRecipients,
  resumeSending,
  findForWorker,
  listClaimable,
  tryAcquireLease,
  renewLease,
  releaseLease,
  failInterruptedRecipients,
  addRecipientPage,
  markPrepared,
  nextQueuedBatch,
  findContactsByIds,
  claimRecipient,
  updateRecipient,
  skipQueued,
  skipRecipient,
  incrementCounts,
  recipientCounts,
  reconcileCounts,
  finish,
  halt,
  listStalled,
};
