/* eslint-disable no-console */
/**
 * Sync roles/permissions in the database with src/modules/auth/permissions.js.
 *
 *   npm run permissions:sync              apply
 *   npm run permissions:sync -- --dry-run show what would change, change nothing
 *
 * Additive and idempotent — run it after every `migrate:deploy`, in every environment
 * (including production, unlike the seed). Creates no demo data.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { syncPermissions } = require('../src/modules/auth/syncPermissions');

const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient();

async function main() {
  const r = await syncPermissions(prisma, { dryRun });
  const verb = dryRun ? 'Would add' : 'Added';

  console.log(`${verb} ${r.permissionsAdded.length} permission(s), ${r.rolesAdded.length} role(s), ${r.grantsAdded.length} grant(s).`);
  r.permissionsAdded.forEach((p) => console.log(`  + permission ${p}`));
  r.rolesAdded.forEach((n) => console.log(`  + role ${n}`));
  r.grantsAdded.forEach((g) => console.log(`  + ${g.role} -> ${g.permission}`));
  if (!r.permissionsAdded.length && !r.rolesAdded.length && !r.grantsAdded.length) console.log('Already in sync.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
