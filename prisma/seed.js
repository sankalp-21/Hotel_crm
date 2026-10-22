/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { syncPermissions } = require('../src/modules/auth/syncPermissions');

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed in production. Set ALLOW_PROD_SEED=true only if you intentionally need it.'
    );
  }

  console.log('Syncing permissions and roles...');
  const synced = await syncPermissions(prisma);
  console.log(
    `  +${synced.permissionsAdded.length} permissions, +${synced.rolesAdded.length} roles, +${synced.grantsAdded.length} grants`
  );
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });

  console.log('Seeding default property...');
  const property = await prisma.property.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo Hotel',
      address: '1 Demo Street, Demo City, 00000', // required in marketing email footers (CAN-SPAM)
      currency: 'USD',
      timezone: 'UTC',
    },
  });

  console.log('Seeding default pipeline stages...');
  const { ensureDefaults } = require('../src/modules/pipelines/repository');
  await ensureDefaults(property.id);

  console.log('Seeding super-admin user...');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is required when seeding in production');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isPlatformAdmin: true },
    create: { email: adminEmail, passwordHash, fullName: 'Super Admin', isPlatformAdmin: true },
  });

  await prisma.userPropertyRole.upsert({
    where: {
      userId_propertyId_roleId: {
        userId: admin.id,
        propertyId: property.id,
        roleId: superAdminRole.id,
      },
    },
    update: {},
    create: { userId: admin.id, propertyId: property.id, roleId: superAdminRole.id },
  });

  console.log('Seed complete.');
  console.log(`  Property: ${property.name} (${property.id})`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`  Admin login: ${adminEmail} / (password hidden)`);
  } else {
    console.log(`  Admin login: ${adminEmail} / ${adminPassword}`);
    console.log('  ⚠ Change SEED_ADMIN_PASSWORD before running this against anything real.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });