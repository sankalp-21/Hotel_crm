const prisma = require('../../infrastructure/db/prisma');

const activityInclude = {
  contact: { select: { id: true, fullName: true, email: true, status: true } },
  deal: { select: { id: true, title: true, stageId: true } },
};

function create(data, db = prisma) {
  return db.activity.create({ data, include: activityInclude });
}

function findById(id, propertyId) {
  return prisma.activity.findFirst({ where: { id, propertyId }, include: activityInclude });
}

function search({
  propertyId,
  search,
  type,
  status,
  contactId,
  dealId,
  dueBefore,
  dueAfter,
  page,
  pageSize,
}) {
  const where = {
    propertyId,
    ...(type && { type }),
    ...(status && { status }),
    ...(contactId && { contactId }),
    ...(dealId && { dealId }),
    ...((dueBefore || dueAfter) && {
      dueAt: {
        ...(dueAfter && { gte: dueAfter }),
        ...(dueBefore && { lte: dueBefore }),
      },
    }),
    ...(search && {
      OR: [
        { subject: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  return Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: activityInclude,
    }),
    prisma.activity.count({ where }),
  ]);
}

function update(id, propertyId, data, db = prisma) {
  return db.activity.update({ where: { id, propertyId }, data, include: activityInclude });
}

/**
 * Due reminders: open activities with reminderAt in the past and not yet sent.
 */
/**
 * Atomically claim activities whose reminder is due: lock them, flag `reminderSentAt` (meaning
 * "reminder queued"), and return them. Must run inside the same transaction that writes the
 * matching outbox events, so a reminder is either fully queued or not claimed at all.
 *
 * FOR UPDATE SKIP LOCKED: concurrent sweeps (several instances) get disjoint rows, so each
 * reminder is queued exactly once.
 *
 * Uses the database clock as UTC: Prisma stores DateTime as UTC wall-clock in `timestamp`
 * columns, and comparing those with a zone-aware now() would shift by the server's UTC offset.
 */
function claimDueReminders(db, limit) {
  return db.$queryRaw`
    WITH due AS (
      SELECT id FROM activities
       WHERE status = 'open' AND "reminderAt" <= timezone('UTC', now()) AND "reminderSentAt" IS NULL
       ORDER BY "reminderAt" ASC
       LIMIT ${limit}::int
       FOR UPDATE SKIP LOCKED
    )
    UPDATE activities a
       SET "reminderSentAt" = timezone('UTC', now())
      FROM due
     WHERE a.id = due.id
 RETURNING a.id, a."propertyId", a."contactId", a."dealId", a.type, a.subject,
           a."dueAt", a."reminderAt", a."assignedTo", a."createdBy"`;
}

function listByContact(contactId, propertyId, { skip = 0, take = 50 } = {}) {
  return prisma.activity.findMany({
    where: { contactId, propertyId },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    include: activityInclude,
  });
}

module.exports = {
  create,
  findById,
  search,
  update,
  claimDueReminders,
  listByContact,
};
