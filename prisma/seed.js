/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { PERMISSIONS, ROLE_PERMISSION_DEFAULTS } = require('../src/modules/auth/permissions');

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed in production. Set ALLOW_PROD_SEED=true only if you intentionally need it.'
    );
  }

  console.log('Seeding permissions...');
  const permissionRecords = {};
  for (const code of Object.values(PERMISSIONS)) {
    permissionRecords[code] = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }

  console.log('Seeding roles...');
  const roleRecords = {};
  for (const [roleName, permissionCodes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roleRecords[roleName] = role;

    for (const code of permissionCodes) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permissionRecords[code].id } },
        update: {},
        create: { roleId: role.id, permissionId: permissionRecords[code].id },
      });
    }
  }

  console.log('Seeding default property...');
  const property = await prisma.property.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo Hotel',
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
    update: {},
    create: { email: adminEmail, passwordHash, fullName: 'Super Admin' },
  });

  await prisma.userPropertyRole.upsert({
    where: {
      userId_propertyId_roleId: {
        userId: admin.id,
        propertyId: property.id,
        roleId: roleRecords.super_admin.id,
      },
    },
    update: {},
    create: { userId: admin.id, propertyId: property.id, roleId: roleRecords.super_admin.id },
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