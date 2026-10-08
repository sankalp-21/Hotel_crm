const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ---- Stub the Prisma client so repositories can be exercised without a DB.
const calls = [];
const fakePrisma = new Proxy(
  {},
  {
    get: (_t, model) =>
      new Proxy(
        {},
        {
          get: (_m, method) => (args) => {
            calls.push({ model, method, args });
            return Promise.resolve(null);
          },
        }
      ),
  }
);
const prismaPath = require.resolve('../src/infrastructure/db/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma };

const MODULES = {
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
  activities: 'activity',
  segments: 'segment',
  campaigns: 'campaign',
  pipelines: 'pipelineStage',
};
const ID = '11111111-1111-1111-1111-111111111111';
const PROP = '22222222-2222-2222-2222-222222222222';

for (const [mod, model] of Object.entries(MODULES)) {
  const repo = require(`../src/modules/${mod}/repository`);

  test(`${mod}.findById is tenant-scoped (never a bare findUnique by id)`, async () => {
    calls.length = 0;
    await repo.findById(ID, PROP);
    const call = calls.find((c) => c.model === model);
    assert.ok(call, 'expected a query on the model');
    assert.strictEqual(call.method, 'findFirst');
    assert.strictEqual(call.args.where.id, ID);
    assert.strictEqual(call.args.where.propertyId, PROP);
  });

  test(`${mod}.update only touches a row in the caller's property`, async () => {
    calls.length = 0;
    await repo.update(ID, PROP, { name: 'x' });
    const call = calls.find((c) => c.model === model && c.method === 'update');
    assert.ok(call, 'expected an update call');
    assert.strictEqual(call.args.where.id, ID);
    assert.strictEqual(call.args.where.propertyId, PROP);
  });
}

test('activities.listByContact is scoped to the property', async () => {
  calls.length = 0;
  await require('../src/modules/activities/repository').listByContact(ID, PROP);
  const call = calls.find((c) => c.model === 'activity' && c.method === 'findMany');
  assert.strictEqual(call.args.where.contactId, ID);
  assert.strictEqual(call.args.where.propertyId, PROP);
});

test('GUARD: non-auth services must not answer cross-tenant IDs with 403 (use scoped lookups -> 404)', () => {
  const modulesDir = path.join(__dirname, '..', 'src', 'modules');
  for (const dir of fs.readdirSync(modulesDir)) {
    if (dir === 'auth') continue;
    const file = path.join(modulesDir, dir, 'service.js');
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/new ForbiddenError\(/.test(src), `${dir}/service.js throws ForbiddenError`);
    assert.ok(!/does not belong to this property/.test(src), `${dir}/service.js leaks cross-tenant existence`);
  }
});

const { assertUserHasPropertyAccess } = require('../src/shared/tenancy/userAccess');
const { ValidationError } = require('../src/shared/errors/AppError');

test('assertUserHasPropertyAccess: no user id is a no-op', async () => {
  calls.length = 0;
  await assertUserHasPropertyAccess(null, PROP);
  await assertUserHasPropertyAccess(undefined, PROP);
  assert.strictEqual(calls.length, 0);
});

test('assertUserHasPropertyAccess: user without a role at the property is rejected (422)', async () => {
  calls.length = 0;
  await assert.rejects(() => assertUserHasPropertyAccess(ID, PROP), ValidationError);
  const call = calls.find((c) => c.model === 'userPropertyRole');
  assert.strictEqual(call.args.where.userId, ID);
  assert.strictEqual(call.args.where.propertyId, PROP);
  assert.deepStrictEqual(call.args.where.user, { isActive: true });
});

test('assertUserHasPropertyAccess: active user with a role at the property passes', async () => {
  // Swap in a stub that finds a matching role row, load a fresh copy, then restore.
  require.cache[prismaPath].exports = new Proxy({}, { get: () => ({ findFirst: async () => ({ id: 'row' }) }) });
  const modPath = require.resolve('../src/shared/tenancy/userAccess');
  delete require.cache[modPath];
  try {
    const fresh = require('../src/shared/tenancy/userAccess');
    await assert.doesNotReject(() => fresh.assertUserHasPropertyAccess(ID, PROP));
  } finally {
    require.cache[prismaPath].exports = fakePrisma;
  }
});
