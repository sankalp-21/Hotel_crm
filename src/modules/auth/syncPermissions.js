const { PERMISSIONS, ROLE_PERMISSION_DEFAULTS } = require('./permissions');

/**
 * Bring the database's permissions, roles and role->permission grants in line with
 * permissions.js (the single source of truth). Safe to run on every deploy, in any environment:
 *
 *  - ADDITIVE ONLY: it creates what is missing and never deletes or edits anything, so it can't
 *    take access away from anyone or fight a manual change.
 *  - IDEMPOTENT: a second run changes nothing.
 *  - Creates no demo data (no property, no users) — that is the seed script's job.
 *
 * Why it exists: grants live in Postgres, but new permissions are introduced in code. Without
 * this, a database seeded before a release answers 403 "Missing permission ..." for the new routes.
 *
 * `prisma` is injected so the logic is unit-testable without a database.
 * Returns what was (or, with dryRun, would be) added.
 */
async function syncPermissions(prisma, { dryRun = false } = {}) {
  const known = new Set(Object.values(PERMISSIONS));
  for (const [role, codes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    for (const code of codes) {
      if (!known.has(code)) throw new Error(`Role "${role}" references unknown permission "${code}"`);
    }
  }

  const result = { permissionsAdded: [], rolesAdded: [], grantsAdded: [] };

  // 1. Permissions
  const existingPerms = new Set((await prisma.permission.findMany({ select: { code: true } })).map((p) => p.code));
  result.permissionsAdded = [...known].filter((code) => !existingPerms.has(code));
  if (!dryRun && result.permissionsAdded.length) {
    await prisma.permission.createMany({ data: result.permissionsAdded.map((code) => ({ code })), skipDuplicates: true });
  }

  // 2. Roles
  const existingRoles = new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));
  result.rolesAdded = Object.keys(ROLE_PERMISSION_DEFAULTS).filter((name) => !existingRoles.has(name));
  if (!dryRun && result.rolesAdded.length) {
    await prisma.role.createMany({ data: result.rolesAdded.map((name) => ({ name })), skipDuplicates: true });
  }

  // 3. Grants. (In a dry run, a brand-new role/permission has no id yet: all of its grants are "missing".)
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const perms = await prisma.permission.findMany({ select: { id: true, code: true } });
  const roleId = new Map(roles.map((r) => [r.name, r.id]));
  const permId = new Map(perms.map((p) => [p.code, p.id]));
  const granted = new Set(
    (await prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true } })).map(
      (g) => `${g.roleId}:${g.permissionId}`
    )
  );

  const toCreate = [];
  for (const [role, codes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    for (const code of codes) {
      const rid = roleId.get(role);
      const pid = permId.get(code);
      if (rid && pid && granted.has(`${rid}:${pid}`)) continue;
      result.grantsAdded.push({ role, permission: code });
      if (rid && pid) toCreate.push({ roleId: rid, permissionId: pid });
    }
  }
  if (!dryRun && toCreate.length) {
    await prisma.rolePermission.createMany({ data: toCreate, skipDuplicates: true });
  }

  return result;
}

module.exports = { syncPermissions };
