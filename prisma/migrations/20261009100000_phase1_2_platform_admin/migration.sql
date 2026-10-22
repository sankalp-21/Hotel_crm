-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Preserve current behaviour: until now, holding super_admin on any property was what allowed
-- creating properties. Those users become platform admins so nobody loses access on upgrade.
UPDATE "users" SET "isPlatformAdmin" = true
WHERE "id" IN (
  SELECT upr."userId"
  FROM "user_property_roles" upr
  JOIN "roles" r ON r."id" = upr."roleId"
  WHERE r."name" = 'super_admin'
);
