const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The outbox and reminder queries are raw SQL, which can't be exercised without a database.
 * These guards pin the properties that make them safe, so a well-meaning edit can't quietly
 * remove one. (The queries themselves were also checked with a real Postgres parser.)
 */
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');
const rawSql = (src) => [...src.matchAll(/\$queryRaw`([\s\S]*?)`/g)].map((m) => m[1]);

const outbox = rawSql(read('shared/events/outboxRepository.js'));
const reminders = rawSql(read('modules/activities/repository.js'));

test('exactly one raw statement each (so these guards cover everything)', () => {
  assert.strictEqual(outbox.length, 1);
  assert.strictEqual(reminders.length, 1);
});

for (const [name, [sql]] of [['outbox claim', outbox], ['reminder claim', reminders]]) {
  test(`${name}: uses FOR UPDATE SKIP LOCKED so concurrent workers never take the same row`, () => {
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  });

  test(`${name}: never compares against a bare now() (Prisma stores UTC wall-clock in timestamp columns)`, () => {
    const bare = sql.replace(/timezone\('UTC', now\(\)\)/g, '').match(/\bnow\(\)/g);
    assert.strictEqual(bare, null, 'wrap now() as timezone(\'UTC\', now())');
  });

  test(`${name}: is a single atomic UPDATE ... RETURNING (claim and flag in one statement)`, () => {
    assert.match(sql, /\bUPDATE\b/);
    assert.match(sql, /\bRETURNING\b/);
  });
}

test('outbox claim: recovers rows leased by a crashed dispatcher (expired lease) and honours retry backoff', () => {
  const [sql] = outbox;
  assert.match(sql, /status = 'processing' AND "lockedUntil" < timezone\('UTC', now\(\)\)/);
  assert.match(sql, /status = 'pending' AND "availableAt" <= timezone\('UTC', now\(\)\)/);
  assert.match(sql, /attempts = attempts \+ 1/);
});

test('reminder claim: only open activities that were never queued, oldest first', () => {
  const [sql] = reminders;
  assert.match(sql, /status = 'open'/);
  assert.match(sql, /"reminderSentAt" IS NULL/);
  assert.match(sql, /ORDER BY "reminderAt" ASC/);
});
