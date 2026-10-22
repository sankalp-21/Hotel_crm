const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const stub = (modPath, exports) => {
  const p = require.resolve(modPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

let reminderResults;
let reminderCalls = 0;
let purgedKeys = 0;
let outboxCutoff;
stub('../src/modules/activities/service', {
  processDueReminders: async () => {
    reminderCalls += 1;
    return reminderResults.shift() ?? { processed: 0, activityIds: [], batchSize: 50 };
  },
});
stub('../src/shared/middleware/idempotency', {
  purgeExpiredKeys: async () => {
    purgedKeys += 1;
    return 3;
  },
});
stub('../src/shared/events/outboxRepository', {
  purgePublishedBefore: async (date) => {
    outboxCutoff = date;
    return 2;
  },
});
stub('../src/shared/events/dispatcher', { dispatchPending: async () => ({ claimed: 0 }) });
stub('../src/modules/notifications/worker', { registerNotificationHandlers: () => {} });

const { sweepReminders, housekeeping } = require('../src/jobs');

const full = (n) => ({ processed: 50, activityIds: Array(n).fill('a'), batchSize: 50 });

test('reminder sweep keeps going while batches come back full, and stops on a short batch', async () => {
  reminderCalls = 0;
  reminderResults = [full(50), full(50), { processed: 7, activityIds: [], batchSize: 50 }, full(50)];
  await sweepReminders();
  assert.strictEqual(reminderCalls, 3);
});

test('reminder sweep is bounded per run even if the backlog never shrinks', async () => {
  reminderCalls = 0;
  reminderResults = Array.from({ length: 50 }, () => full(50));
  await sweepReminders();
  assert.strictEqual(reminderCalls, 5);
});

test('reminder sweep with nothing due makes one call', async () => {
  reminderCalls = 0;
  reminderResults = [];
  await sweepReminders();
  assert.strictEqual(reminderCalls, 1);
});

test('housekeeping purges expired idempotency keys and published outbox events older than 7 days', async () => {
  purgedKeys = 0;
  const before = Date.now();
  await housekeeping();
  assert.strictEqual(purgedKeys, 1);
  const ageDays = (before - outboxCutoff.getTime()) / 86_400_000;
  assert.ok(ageDays > 6.99 && ageDays < 7.01, `cutoff is ${ageDays} days old`);
});
