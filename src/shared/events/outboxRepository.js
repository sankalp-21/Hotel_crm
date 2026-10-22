const prisma = require('../../infrastructure/db/prisma');

/**
 * Prisma stores DateTime columns as UTC wall-clock values in `timestamp` (no zone) columns, while
 * Postgres' now() is zone-aware. Comparing them directly shifts by the server's UTC offset (hours,
 * on a non-UTC database), so every raw comparison here uses the database clock expressed as UTC.
 */

/**
 * Atomically lease up to `limit` due events for this dispatcher.
 *
 * One statement: FOR UPDATE SKIP LOCKED means concurrent dispatchers (several API instances,
 * separate workers) each get different rows and never wait on each other, and the lease
 * (`lockedUntil`) means rows held by a crashed dispatcher become claimable again after it
 * expires. Claimable = pending and due, or processing with an expired lease.
 */
async function claim(limit, leaseSeconds) {
  const rows = await prisma.$queryRaw`
    UPDATE outbox_events
       SET status = 'processing',
           "lockedUntil" = timezone('UTC', now()) + make_interval(secs => ${leaseSeconds}::double precision),
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox_events
        WHERE (status = 'pending' AND "availableAt" <= timezone('UTC', now()))
           OR (status = 'processing' AND "lockedUntil" < timezone('UTC', now()))
        ORDER BY "createdAt" ASC
        LIMIT ${limit}::int
        FOR UPDATE SKIP LOCKED
     )
 RETURNING id, "eventType", "aggregateType", "aggregateId", payload, attempts, "createdAt"`;
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

function markPublished(id) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { status: 'published', publishedAt: new Date(), lockedUntil: null, lastError: null },
  });
}

function markRetry(id, availableAt, lastError) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { status: 'pending', availableAt, lockedUntil: null, lastError },
  });
}

function markFailed(id, lastError) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { status: 'failed', lockedUntil: null, lastError },
  });
}

/** Operator action: put a dead-lettered event back in the queue. Returns the number of rows changed. */
async function retryFailed(id) {
  const result = await prisma.outboxEvent.updateMany({
    where: { id, status: 'failed' },
    data: { status: 'pending', attempts: 0, availableAt: new Date(), lockedUntil: null, lastError: null },
  });
  return result.count;
}

function findById(id) {
  return prisma.outboxEvent.findUnique({ where: { id }, select: { id: true, status: true } });
}

async function list({ status, eventType, aggregateId, page = 1, pageSize = 20 }) {
  const where = {
    ...(status && { status }),
    ...(eventType && { eventType }),
    ...(aggregateId && { aggregateId }),
  };
  const [items, total, grouped] = await Promise.all([
    prisma.outboxEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        status: true,
        attempts: true,
        lastError: true,
        availableAt: true,
        createdAt: true,
        publishedAt: true,
      },
    }),
    prisma.outboxEvent.count({ where }),
    prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const counts = { pending: 0, processing: 0, published: 0, failed: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  return { items, total, counts };
}

async function purgePublishedBefore(date) {
  const result = await prisma.outboxEvent.deleteMany({
    where: { status: 'published', publishedAt: { lt: date } },
  });
  return result.count;
}

module.exports = {
  claim,
  markPublished,
  markRetry,
  markFailed,
  retryFailed,
  findById,
  list,
  purgePublishedBefore,
};
