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

let context;
let saved; // notifications keyed by dedupeKey
let sends;
let sendError;
stub('../src/modules/notifications/repository', {
  resolveActivityReminderDue: async () => context,
  findByDedupeKey: async (key) => saved.get(key) || null,
  saveNotification: async (data) => {
    saved.set(data.dedupeKey, { ...(saved.get(data.dedupeKey) || {}), ...data });
    return saved.get(data.dedupeKey);
  },
});
stub('../src/modules/notifications/channel', {
  send: async (msg) => {
    sends.push(msg);
    if (sendError) throw sendError;
    return { success: true };
  },
});

const service = require('../src/modules/notifications/service');
const { formatWhen } = require('../src/modules/notifications/templates');
const handlers = require('../src/shared/events/handlers');
const { registerNotificationHandlers } = require('../src/modules/notifications/worker');

const CTX = {
  propertyId: 'p1',
  recipientEmail: 'sam@hotel.test',
  recipientName: 'Sam',
  activityId: 'a1',
  contactId: 'c1',
  type: 'call',
  subject: 'Call the bride',
  dueAt: '2026-10-10T14:00:00Z',
  reminderAt: '2026-10-10T13:00:00Z',
  timezone: 'Asia/Kolkata',
  contactName: 'Priya',
  dealTitle: 'Wedding block',
};
const reset = () => {
  context = { ...CTX };
  saved = new Map();
  sends = [];
  sendError = null;
};
const EVENT = 'activity.reminder_due';
const handle = (eventId = 'evt-1') => service.handleEvent(EVENT, { activityId: 'a1' }, { eventId });

test('sends the reminder and records it as sent under the event id', async () => {
  reset();
  await handle();
  assert.strictEqual(sends.length, 1);
  assert.strictEqual(sends[0].to, 'sam@hotel.test');
  const row = saved.get('evt-1:email');
  assert.strictEqual(row.status, 'sent');
  assert.ok(row.sentAt instanceof Date);
});

test('IDEMPOTENT: redelivering an event that already succeeded does not email again', async () => {
  reset();
  await handle();
  await handle();
  await handle();
  assert.strictEqual(sends.length, 1);
});

test('different events (different ids) each send their own email', async () => {
  reset();
  await handle('evt-1');
  await handle('evt-2');
  assert.strictEqual(sends.length, 2);
});

test('FAILURE IS NOT SWALLOWED: a failed send is recorded AND rethrown so the outbox retries it', async () => {
  reset();
  sendError = new Error('SMTP unreachable');
  await assert.rejects(() => handle(), /SMTP unreachable/);
  const row = saved.get('evt-1:email');
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.failureReason, 'SMTP unreachable');
  assert.strictEqual(row.sentAt, null);
});

test('RETRY: after a failure the next delivery sends, and updates the SAME notification row', async () => {
  reset();
  sendError = new Error('SMTP unreachable');
  await assert.rejects(() => handle());
  sendError = null;
  await handle();
  assert.strictEqual(sends.length, 2, 'one failed attempt + one successful');
  assert.strictEqual(saved.size, 1, 'a single row, not one per attempt');
  assert.strictEqual(saved.get('evt-1:email').status, 'sent');
  assert.strictEqual(saved.get('evt-1:email').failureReason, null);
});

test('no recipient (user removed / no access): skipped quietly, nothing sent or saved, no retry', async () => {
  reset();
  context = null;
  assert.strictEqual(await handle(), null);
  assert.strictEqual(sends.length, 0);
  assert.strictEqual(saved.size, 0);
});

test('events without a resolver are ignored', async () => {
  reset();
  assert.strictEqual(await service.handleEvent('deal.created', {}, { eventId: 'x' }), null);
  assert.strictEqual(sends.length, 0);
});

test('only events that produce notifications get a handler registered', () => {
  handlers.clear();
  registerNotificationHandlers();
  assert.strictEqual(handlers.handlersFor('activity.reminder_due').length, 1);
  for (const quiet of ['deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'activity.created', 'campaign.sent']) {
    assert.strictEqual(handlers.handlersFor(quiet).length, 0, quiet);
  }
  registerNotificationHandlers(); // idempotent
  assert.strictEqual(handlers.handlersFor('activity.reminder_due').length, 1);
});

test('the registered handler passes the outbox event id through for dedupe', async () => {
  reset();
  handlers.clear();
  const wasRegistered = require('../src/modules/notifications/worker');
  void wasRegistered;
  handlers.on(EVENT, (payload, meta) => service.handleEvent(EVENT, payload, meta));
  await handlers.handlersFor(EVENT)[0]({ activityId: 'a1' }, { eventId: 'evt-9' });
  assert.ok(saved.has('evt-9:email'));
});

test('reminder email shows times in the PROPERTY timezone, not UTC', async () => {
  reset();
  await handle();
  const body = sends[0].body;
  assert.match(body, /Asia\/Kolkata/);
  assert.match(body, /10 Oct 2026, 19:30/); // 14:00Z is 19:30 in India
  assert.match(body, /18:30/); // 13:00Z reminder time
  assert.doesNotMatch(body, /T14:00:00/);
});

test('formatWhen: handles missing/invalid dates and unknown timezones without throwing', () => {
  assert.strictEqual(formatWhen(null), 'n/a');
  assert.strictEqual(formatWhen('not a date'), 'n/a');
  assert.match(formatWhen('2026-10-10T14:00:00Z', 'Not/AZone'), /\(UTC\)$/);
  assert.match(formatWhen('2026-10-10T14:00:00Z'), /14:00 \(UTC\)$/);
});
