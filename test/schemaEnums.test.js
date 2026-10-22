const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { recipientsQuerySchema, searchCampaignSchema } = require('../src/modules/campaigns/validator');

/** Read an enum's values straight from schema.prisma, so the API filters can't drift from the database. */
function prismaEnum(name) {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const m = schema.match(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `enum ${name} not found in schema.prisma`);
  return m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).map((l) => l.split(/\s+/)[0]);
}

test('GET /campaigns/:id/recipients?status= accepts every CampaignRecipientStatus (incl. bounced)', () => {
  for (const status of prismaEnum('CampaignRecipientStatus')) {
    assert.ok(recipientsQuerySchema.safeParse({ status }).success, `status=${status} must be accepted`);
  }
  assert.ok(!recipientsQuerySchema.safeParse({ status: 'nonsense' }).success);
});

test('GET /campaigns?status= accepts every CampaignStatus', () => {
  for (const status of prismaEnum('CampaignStatus')) {
    assert.ok(searchCampaignSchema.safeParse({ status }).success, `status=${status} must be accepted`);
  }
});
