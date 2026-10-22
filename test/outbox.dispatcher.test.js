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
// The dispatcher's default repository needs a database; tests inject their own.
stub('../src/shared/events/outboxRepository', {});

const handlersRegistry = require('../src/shared/events/handlers');
const { computeBackoffMs, processEvent, dispatchBatch, dispatchPending, MAX_BACKOFF_MS } = require('../src/shared/events/dispatcher');
const { publish } = require('../src/shared/events/outbox');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };
const NOW = new Date('2026-10-10T10:00:00Z');

function makeRepo(rows = []) {
  const calls = { published: [], retried: [], failed: [] };
  return {
    calls,
    claim: async (limit) => rows.splice(0, limit),
    markPublished: async (id) => calls.published.push(id),
    markRetry: async (id, availableAt, lastError) => calls.retried.push({ id, availableAt, lastError }),
    markFailed: async (id, lastError) => calls.failed.push({ id, lastError }),
  };
}
const row = (over = {}) => ({ id: 'e1', eventType: 'x.happened', payload: { n: 1 }, attempts: 1, ...over });
const registry = (map) => ({ handlersFor: (t) => map[t] || [] });
const deps = (repo, map, extra = {}) => ({ repo, handlers: registry(map), now: () => NOW, maxAttempts: 3, log: silentLog, ...extra });

test('backoff doubles from 5s and is capped at 15 minutes', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(computeBackoffMs), [5_000, 10_000, 20_000, 40_000]);
  assert.strictEqual(computeBackoffMs(30), MAX_BACKOFF_MS);
  assert.strictEqual(computeBackoffMs(0), 5_000);
});

test('success: every handler runs with the payload and event id, then the event is published', async () => {
  const repo = makeRepo();
  const seen = [];
  const outcome = await processEvent(
    row(),
    deps(repo, { 'x.happened': [async (p, m) => seen.push(['a', p, m.eventId, m.attempt]), async () => seen.push(['b'])] })
  );
  assert.strictEqual(outcome, 'published');
  assert.deepStrictEqual(seen, [['a', { n: 1 }, 'e1', 1], ['b']]);
  assert.deepStrictEqual(repo.calls.published, ['e1']);
});

test('an event nobody listens to is published immediately (nothing to deliver)', async () => {
  const repo = makeRepo();
  assert.strictEqual(await processEvent(row({ eventType: 'deal.created' }), deps(repo, {})), 'published');
  assert.deepStrictEqual(repo.calls.published, ['e1']);
});

test('a failing handler schedules a retry with backoff and records the error', async () => {
  const repo = makeRepo();
  const outcome = await processEvent(row({ attempts: 2 }), deps(repo, { 'x.happened': [async () => { throw new Error('smtp down'); }] }));
  assert.strictEqual(outcome, 'retry');
  assert.deepStrictEqual(repo.calls.published, []);
  assert.strictEqual(repo.calls.retried[0].lastError, 'smtp down');
  assert.strictEqual(repo.calls.retried[0].availableAt.getTime(), NOW.getTime() + 10_000);
});

test('one failing handler makes the WHOLE event retry (so handlers must be idempotent)', async () => {
  const repo = makeRepo();
  let firstRuns = 0;
  const map = { 'x.happened': [async () => { firstRuns += 1; }, async () => { throw new Error('boom'); }] };
  assert.strictEqual(await processEvent(row(), deps(repo, map)), 'retry');
  assert.strictEqual(await processEvent(row({ attempts: 2 }), deps(repo, map)), 'retry');
  assert.strictEqual(firstRuns, 2, 'the successful sibling is re-run on retry');
});

test('DEAD LETTER: after max attempts the event is marked failed, not retried forever', async () => {
  const repo = makeRepo();
  const outcome = await processEvent(row({ attempts: 3 }), deps(repo, { 'x.happened': [async () => { throw new Error('still broken'); }] }));
  assert.strictEqual(outcome, 'failed');
  assert.deepStrictEqual(repo.calls.failed, [{ id: 'e1', lastError: 'still broken' }]);
  assert.deepStrictEqual(repo.calls.retried, []);
});

test('error messages are truncated so a huge error cannot bloat the table', async () => {
  const repo = makeRepo();
  await processEvent(row(), deps(repo, { 'x.happened': [async () => { throw new Error('x'.repeat(5000)); }] }));
  assert.strictEqual(repo.calls.retried[0].lastError.length, 1000);
});

test('a bookkeeping failure never throws out of the dispatcher (the lease expiry recovers the row)', async () => {
  const repo = makeRepo();
  repo.markPublished = async () => { throw new Error('db down'); };
  repo.markRetry = async () => { throw new Error('db down'); };
  assert.strictEqual(await processEvent(row(), deps(repo, {})), 'retry');
});

test('dispatchBatch leases a batch and tallies outcomes; one bad event does not block the others', async () => {
  const repo = makeRepo([row({ id: 'ok' }), row({ id: 'bad', eventType: 'bad.event' }), row({ id: 'dead', eventType: 'bad.event', attempts: 3 })]);
  const map = { 'bad.event': [async () => { throw new Error('nope'); }] };
  const summary = await dispatchBatch({ ...deps(repo, map), limit: 10 });
  assert.deepStrictEqual({ c: summary.claimed, p: summary.published, r: summary.retry, f: summary.failed }, { c: 3, p: 1, r: 1, f: 1 });
});

test('dispatchBatch asks the repository for the configured batch size and lease', async () => {
  let asked;
  const repo = makeRepo();
  repo.claim = async (limit, lease) => { asked = { limit, lease }; return []; };
  await dispatchBatch({ ...deps(repo, {}), limit: 7, leaseSeconds: 99 });
  assert.deepStrictEqual(asked, { limit: 7, lease: 99 });
});

test('dispatchPending drains full batches but is bounded per call', async () => {
  let claims = 0;
  const repo = makeRepo();
  repo.claim = async (limit) => { claims += 1; return Array.from({ length: limit }, (_, i) => row({ id: `e${claims}-${i}` })); };
  const total = await dispatchPending({ ...deps(repo, {}), limit: 2, maxBatches: 3 });
  assert.strictEqual(claims, 3);
  assert.strictEqual(total.claimed, 6);
});

test('dispatchPending stops as soon as a batch comes back short', async () => {
  let claims = 0;
  const repo = makeRepo();
  repo.claim = async () => { claims += 1; return claims === 1 ? [row({ id: 'a' }), row({ id: 'b' })] : []; };
  const total = await dispatchPending({ ...deps(repo, {}), limit: 5, maxBatches: 5 });
  assert.strictEqual(claims, 1);
  assert.strictEqual(total.published, 2);
});

test('handler registry: handlers accumulate per event type and must be functions', () => {
  handlersRegistry.clear();
  const a = async () => {};
  const b = async () => {};
  handlersRegistry.on('e', a);
  handlersRegistry.on('e', b);
  assert.deepStrictEqual(handlersRegistry.handlersFor('e'), [a, b]);
  assert.deepStrictEqual(handlersRegistry.handlersFor('unknown'), []);
  assert.throws(() => handlersRegistry.on('e', 'nope'), TypeError);
  handlersRegistry.clear();
});

test('publish writes through the CALLER\'s client and normalises the payload to plain JSON', async () => {
  const written = [];
  const tx = { outboxEvent: { create: async (args) => { written.push(args); return args; } } };
  await publish(tx, {
    aggregateType: 'Deal',
    aggregateId: 'd1',
    eventType: 'deal.created',
    payload: { when: new Date('2026-01-02T03:04:05Z'), value: { toString: () => '12.50', toJSON: () => '12.50' }, keep: 1 },
  });
  assert.deepStrictEqual(written[0].data, {
    aggregateType: 'Deal',
    aggregateId: 'd1',
    eventType: 'deal.created',
    payload: { when: '2026-01-02T03:04:05.000Z', value: '12.50', keep: 1 },
  });
});
