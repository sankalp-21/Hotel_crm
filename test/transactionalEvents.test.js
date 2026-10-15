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

// ---- A fake transaction: records every write and "commits" only if the callback succeeds.
let log; // ordered record of writes: [{ via: 'tx'|'direct', op, ... }]
let committed;
let failAt; // name of a write that should throw (to prove rollback)
const TX = { id: 'TX' };

stub('../src/shared/db/transaction', {
  withTransaction: async (fn) => {
    const startLen = log.length;
    try {
      const result = await fn(TX);
      committed = true;
      return result;
    } catch (err) {
      committed = false;
      log.length = startLen; // roll back everything written inside the transaction
      throw err;
    }
  },
});
stub('../src/shared/events/outbox', {
  publish: async (db, event) => {
    if (failAt === event.eventType) throw new Error(`outbox write failed: ${event.eventType}`);
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'outbox', eventType: event.eventType, aggregateId: event.aggregateId });
  },
});
stub('../src/modules/audit/service', { logAudit: async () => {} });
stub('../src/shared/tenancy/userAccess', { assertUserHasPropertyAccess: async () => {} });

const STAGES = {
  open: { id: 'st-open', name: 'Inquiry', isWon: false, isLost: false, isDefault: true },
  won: { id: 'st-won', name: 'Won', isWon: true, isLost: false },
  lost: { id: 'st-lost', name: 'Lost', isWon: false, isLost: true },
};
stub('../src/modules/pipelines/repository', {
  ensureDefaults: async () => {},
  findById: async (id) => Object.values(STAGES).find((s) => s.id === id) || null,
  findDefault: async () => STAGES.open,
});
stub('../src/modules/contacts/repository', { findById: async () => ({ id: 'c1' }) });
stub('../src/modules/companies/repository', { findById: async () => ({ id: 'co1' }) });

let currentDeal;
stub('../src/modules/deals/repository', {
  findById: async () => currentDeal,
  create: async (data, db) => {
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'deal.create' });
    return { id: 'd1', propertyId: 'p1', contactId: 'c1', companyId: null, value: '100', ...data };
  },
  update: async (_id, _p, data, db) => {
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'deal.update' });
    return { ...currentDeal, ...data };
  },
});
const deals = require('../src/modules/deals/service');

const reset = () => {
  log = [];
  committed = undefined;
  failAt = undefined;
  currentDeal = { id: 'd1', propertyId: 'p1', contactId: 'c1', companyId: null, stageId: 'st-open', value: '100' };
};
const kinds = () => log.map((e) => e.eventType || e.op);

test('createDeal: the deal and deal.created are written in the SAME transaction', async () => {
  reset();
  await deals.createDeal({ propertyId: 'p1', title: 'Wedding', contactId: 'c1' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['deal.create', 'deal.created']);
  assert.ok(log.every((e) => e.via === 'tx'), 'every write used the transaction client');
  assert.strictEqual(committed, true);
});

test('createDeal in a Won stage records created + stage_changed + won, all in the transaction', async () => {
  reset();
  await deals.createDeal({ propertyId: 'p1', title: 'x', contactId: 'c1', stageId: 'st-won' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['deal.create', 'deal.created', 'deal.stage_changed', 'deal.won']);
  assert.ok(log.every((e) => e.via === 'tx'));
});

test('transitionDeal to Won: update + stage_changed + won commit together', async () => {
  reset();
  await deals.transitionDeal('d1', 'p1', { stageId: 'st-won' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['deal.update', 'deal.stage_changed', 'deal.won']);
  assert.ok(log.every((e) => e.via === 'tx'));
});

test('transitionDeal to Lost records deal.lost, not deal.won', async () => {
  reset();
  await deals.transitionDeal('d1', 'p1', { stageId: 'st-lost' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['deal.update', 'deal.stage_changed', 'deal.lost']);
});

test('ATOMICITY: if the outbox write fails the deal change is rolled back (no change without its event)', async () => {
  reset();
  failAt = 'deal.stage_changed';
  await assert.rejects(() => deals.transitionDeal('d1', 'p1', { stageId: 'st-won' }, { id: 'u1' }), /outbox write failed/);
  assert.strictEqual(committed, false);
  assert.deepStrictEqual(log, [], 'the deal update was undone along with the failed event');
});

test('ATOMICITY: a failing deal.created write rolls back the new deal', async () => {
  reset();
  failAt = 'deal.created';
  await assert.rejects(() => deals.createDeal({ propertyId: 'p1', title: 'x', contactId: 'c1' }, { id: 'u1' }));
  assert.deepStrictEqual(log, []);
});

test('transitioning to the stage a deal is already in writes nothing', async () => {
  reset();
  await deals.transitionDeal('d1', 'p1', { stageId: 'st-open' }, { id: 'u1' });
  assert.deepStrictEqual(log, []);
});

// ---------------- activities
let currentActivity;
const claimCalls = [];
let claimRows = [];
stub('../src/modules/activities/repository', {
  findById: async () => currentActivity,
  create: async (data, db) => {
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'activity.create' });
    return { id: 'a1', propertyId: 'p1', type: 'task', ...data };
  },
  update: async (_id, _p, data, db) => {
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'activity.update' });
    return { ...currentActivity, ...data };
  },
  claimDueReminders: async (db, limit) => {
    claimCalls.push({ viaTx: db === TX, limit });
    log.push({ via: db === TX ? 'tx' : 'direct', op: 'claim' });
    return claimRows;
  },
  listByContact: async () => [],
});
stub('../src/modules/notifications/repository', { listByContact: async () => [] });
stub('../src/modules/deals/repository', require('../src/modules/deals/repository')); // keep the deals stub
const activities = require('../src/modules/activities/service');

const resetActivity = () => {
  reset();
  claimCalls.length = 0;
  claimRows = [];
  currentActivity = { id: 'a1', propertyId: 'p1', contactId: 'c1', dealId: null, type: 'task', status: 'open' };
};

test('createActivity: the activity and activity.created share one transaction', async () => {
  resetActivity();
  await activities.createActivity({ propertyId: 'p1', type: 'task', subject: 's', contactId: 'c1' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['activity.create', 'activity.created']);
  assert.ok(log.every((e) => e.via === 'tx'));
});

test('completeActivity: completion and activity.completed share one transaction; completing twice records nothing new', async () => {
  resetActivity();
  await activities.completeActivity('a1', 'p1', { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['activity.update', 'activity.completed']);
  assert.ok(log.every((e) => e.via === 'tx'));

  resetActivity();
  currentActivity.status = 'completed';
  await activities.completeActivity('a1', 'p1', { id: 'u1' });
  assert.deepStrictEqual(log, []);
});

test('updateActivity to completed records activity.completed in the transaction; other updates record no event', async () => {
  resetActivity();
  await activities.updateActivity('a1', 'p1', { status: 'completed' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['activity.update', 'activity.completed']);

  resetActivity();
  await activities.updateActivity('a1', 'p1', { subject: 'renamed' }, { id: 'u1' });
  assert.deepStrictEqual(kinds(), ['activity.update']);
});

// ---------------- reminders
test('REMINDERS: claiming and queueing happen in ONE transaction, one event per claimed activity', async () => {
  resetActivity();
  claimRows = [
    { id: 'a1', propertyId: 'p1', contactId: 'c1', dealId: null, type: 'task', subject: 's1', assignedTo: 'u1' },
    { id: 'a2', propertyId: 'p1', contactId: 'c2', dealId: null, type: 'call', subject: 's2', assignedTo: 'u2' },
  ];
  const result = await activities.processDueReminders();
  assert.deepStrictEqual(kinds(), ['claim', 'activity.reminder_due', 'activity.reminder_due']);
  assert.ok(log.every((e) => e.via === 'tx'));
  assert.deepStrictEqual(result.activityIds, ['a1', 'a2']);
  assert.strictEqual(result.processed, 2);
  assert.strictEqual(claimCalls[0].viaTx, true);
});

test('REMINDERS: nothing due means no events', async () => {
  resetActivity();
  const result = await activities.processDueReminders();
  assert.deepStrictEqual(kinds(), ['claim']);
  assert.strictEqual(result.processed, 0);
});

test('REMINDERS: if queueing an event fails the claim is rolled back, so the reminder is retried, not lost', async () => {
  resetActivity();
  claimRows = [{ id: 'a1', propertyId: 'p1', contactId: 'c1', dealId: null, type: 'task', subject: 's', assignedTo: 'u1' }];
  failAt = 'activity.reminder_due';
  await assert.rejects(() => activities.processDueReminders(), /outbox write failed/);
  assert.strictEqual(committed, false);
  assert.deepStrictEqual(log, [], 'the reminderSentAt flag is undone, so the next sweep claims it again');
});

test('REMINDERS: the batch size is bounded', async () => {
  resetActivity();
  const result = await activities.processDueReminders();
  assert.strictEqual(claimCalls[0].limit, result.batchSize);
  assert.ok(result.batchSize > 0 && result.batchSize <= 200);
});
