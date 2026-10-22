const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { createJob } = require('../src/shared/jobs/scheduler');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, error: () => {}, warn() {}, debug() {} };

test('a job never overlaps itself: ticks are skipped while a run is still going', async () => {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  const job = createJob({
    name: 't',
    intervalMs: 5,
    initialDelayMs: 1,
    log: quiet,
    run: async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(40);
      active -= 1;
    },
  });
  job.start();
  await sleep(120);
  await job.stop();
  assert.strictEqual(maxActive, 1);
  assert.ok(runs >= 2 && runs <= 4, `runs=${runs}`);
});

test('an error in a run is logged and the schedule keeps going', async () => {
  const errors = [];
  let runs = 0;
  const job = createJob({
    name: 'flaky',
    intervalMs: 5,
    initialDelayMs: 1,
    log: { ...quiet, error: (...a) => errors.push(a) },
    run: async () => {
      runs += 1;
      throw new Error('boom');
    },
  });
  job.start();
  await sleep(50);
  await job.stop();
  assert.ok(runs >= 3);
  assert.ok(errors.length >= 3);
});

test('stop() waits for the run in progress, then nothing runs again', async () => {
  let finished = false;
  let runs = 0;
  const job = createJob({
    name: 'graceful',
    intervalMs: 1000,
    initialDelayMs: 1,
    log: quiet,
    run: async () => {
      runs += 1;
      await sleep(40);
      finished = true;
    },
  });
  job.start();
  await sleep(10); // run has started
  await job.stop();
  assert.strictEqual(finished, true, 'stop resolved only after the in-flight run completed');
  await sleep(30);
  assert.strictEqual(runs, 1);
});

test('start is idempotent; runOnce triggers a run and skips if one is already running', async () => {
  let runs = 0;
  const job = createJob({ name: 'once', intervalMs: 10_000, initialDelayMs: 10_000, log: quiet, run: async () => { runs += 1; await sleep(20); } });
  job.start();
  job.start();
  const a = job.runOnce();
  const b = job.runOnce();
  await Promise.all([a, b]);
  assert.strictEqual(runs, 1);
  await job.stop();
});
