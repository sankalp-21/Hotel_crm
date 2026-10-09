#!/usr/bin/env node
/* Hotel CRM — Phase 0 smoke test. Requires Node 18+ (global fetch). No dependencies.
 *
 * Usage (server running in NODE_ENV=development, DB seeded):
 *   node smoke.js
 * Env overrides:
 *   BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, PROPERTY_ID, REMINDER_WAIT_SECONDS
 *
 * Safe to re-run: all created records use a unique tag/suffix, and the campaign
 * targets ONLY the contact created by this run (segment filtered by unique tag).
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const PROPERTY_ID = process.env.PROPERTY_ID || '00000000-0000-0000-0000-000000000001';
const REMINDER_WAIT = Number(process.env.REMINDER_WAIT_SECONDS || 40);

const run = Date.now().toString(36);
const tag = `smoke-${run}`;
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
  }
}

async function call(method, path, { body, token, headers = {}, property = PROPERTY_ID } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (property) h['x-property-id'] = property;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

const section = (t) => console.log(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Smoke test against ${BASE} (run ${run})`);

  section('Health');
  let r = await call('GET', '/health', { property: null });
  check('GET /health 200', r.status === 200, r);
  r = await call('GET', '/ready', { property: null });
  check('GET /ready 200 (db + redis up)', r.status === 200, r.json);

  section('Auth');
  r = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD }, property: null });
  check('login 200', r.status === 200, r);
  const token = r.json?.accessToken;
  const refreshToken = r.json?.refreshToken;
  check('login returns tokens + propertyRoles', Boolean(token && refreshToken && r.json?.propertyRoles?.length), r.json);
  if (!token) {
    console.log('\nCannot continue without a token. Is the DB seeded (npm run seed)?');
    return;
  }

  r = await call('GET', '/auth/me', { token, property: null });
  check('GET /auth/me 200', r.status === 200, r);
  r = await call('GET', '/auth/me', { property: null });
  check('no token -> 401', r.status === 401, r);
  r = await call('GET', '/auth/me', { token: 'garbage', property: null });
  check('bad token -> 401', r.status === 401, r);

  r = await call('POST', '/auth/refresh', { body: { refreshToken }, property: null });
  check('refresh rotates tokens', r.status === 200 && r.json?.refreshToken && r.json.refreshToken !== refreshToken, r);
  r = await call('POST', '/auth/refresh', { body: { refreshToken }, property: null });
  check('reusing old refresh token -> 401', r.status === 401, r);
  // Reuse detection revokes ALL sessions for the user; log in again.
  r = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD }, property: null });
  const t = r.json?.accessToken || token; // fall back so one failure doesn't cascade
  check('re-login after reuse detection', r.status === 200 && Boolean(r.json?.accessToken), r);

  section('Property / tenant scoping');
  r = await call('GET', '/properties', { token: t, property: null });
  check('GET /properties lists user properties', r.status === 200 && r.json?.items?.some((p) => p.id === PROPERTY_ID), r.json);
  r = await call('GET', '/contacts', { token: t, property: null });
  check('missing property context -> 422', r.status === 422, r);
  r = await call('GET', '/contacts', { token: t, property: '11111111-1111-1111-1111-111111111111' });
  check('property user has no role in -> 403', r.status === 403, r);

  section('Pipeline');
  r = await call('GET', '/pipeline/stages', { token: t });
  check('GET /pipeline/stages 200', r.status === 200, r);
  const stages = Array.isArray(r.json) ? r.json : r.json?.items || [];
  const byName = (n) => stages.find((s) => s.name === n);
  check('default stages present (Inquiry/Qualified/Won/Lost)', ['Inquiry', 'Qualified', 'Won', 'Lost'].every(byName), stages.map((s) => s.name));

  section('Companies & contacts');
  r = await call('POST', '/companies', {
    token: t,
    body: { propertyId: PROPERTY_ID, name: `Acme Travel ${run}`, type: 'travel_agency', email: `acme-${run}@example.com` },
  });
  check('create company 201', r.status === 201, r);
  const companyId = r.json?.id;

  r = await call('POST', '/contacts', {
    token: t,
    body: {
      propertyId: PROPERTY_ID,
      fullName: `Smoke Tester ${run}`,
      email: `smoke-${run}@example.com`,
      phone: '+15550001111',
      companyId,
      source: 'website',
      tags: [tag],
    },
  });
  check('create contact 201', r.status === 201, r);
  const contactId = r.json?.id;

  r = await call('GET', `/contacts?search=${encodeURIComponent(`Smoke Tester ${run}`)}`, { token: t });
  check('search contacts finds it', r.status === 200 && r.json?.items?.some((c) => c.id === contactId), r.json);
  r = await call('GET', `/contacts?tag=${tag}&status=lead`, { token: t });
  check('filter by tag + status', r.status === 200 && r.json?.total === 1, r.json);
  r = await call('PATCH', `/contacts/${contactId}`, { token: t, body: { status: 'customer' } });
  check('PATCH contact status', r.status === 200 && r.json?.status === 'customer', r);
  await call('PATCH', `/contacts/${contactId}`, { token: t, body: { status: 'lead' } });
  r = await call('GET', `/companies/${companyId}`, { token: t });
  check('company shows linked contact', r.status === 200 && r.json?.contacts?.some((c) => c.id === contactId), r.json);
  r = await call('POST', '/contacts', {
    token: t,
    body: { propertyId: PROPERTY_ID, fullName: 'Bad Co Link', companyId: '22222222-2222-2222-2222-222222222222' },
  });
  check('contact with nonexistent company -> 404', r.status === 404, r);

  section('Deals');
  r = await call('POST', '/deals', {
    token: t,
    body: { propertyId: PROPERTY_ID, title: `Wedding block ${run}`, contactId, companyId, value: 12500.5 },
  });
  check('create deal 201 (default stage)', r.status === 201, r);
  const dealId = r.json?.id;
  check('deal landed in default stage (Inquiry)', r.json?.stage?.name === 'Inquiry', r.json?.stage);

  r = await call('POST', `/deals/${dealId}/transition`, { token: t, body: { stageId: byName('Qualified')?.id } });
  check('transition -> Qualified', r.status === 200 && r.json?.stage?.name === 'Qualified', r);
  r = await call('POST', `/deals/${dealId}/transition`, { token: t, body: { stageId: byName('Won')?.id } });
  check('transition -> Won sets closedAt', r.status === 200 && Boolean(r.json?.closedAt), r);
  r = await call('GET', `/deals?outcome=won&contactId=${contactId}`, { token: t });
  check('deals filter outcome=won', r.status === 200 && r.json?.items?.some((d) => d.id === dealId), r.json);

  section('Activities & reminders');
  const reminderAt = new Date(Date.now() + 3000).toISOString();
  r = await call('POST', '/activities', {
    token: t,
    body: { propertyId: PROPERTY_ID, type: 'task', subject: `Call back ${run}`, contactId, dealId, dueAt: new Date(Date.now() + 3600000).toISOString(), reminderAt },
  });
  check('create activity 201', r.status === 201, r);
  const activityId = r.json?.id;
  r = await call('POST', '/activities', { token: t, body: { propertyId: PROPERTY_ID, type: 'note', subject: 'orphan' } });
  check('activity without contact/deal -> 422', r.status === 422, r);

  r = await call('GET', `/contacts/${contactId}/timeline`, { token: t });
  check('contact timeline includes the activity', r.status === 200 && r.json?.items?.some((i) => i.kind === 'activity' && i.id === activityId), r.json);

  console.log(`  … waiting up to ${REMINDER_WAIT}s for the reminder sweep (15s interval)`);
  let reminderSeen = false;
  for (let waited = 0; waited < REMINDER_WAIT && !reminderSeen; waited += 5) {
    await sleep(5000);
    const n = await call('GET', '/notifications?pageSize=50', { token: t });
    reminderSeen = Boolean(
      n.json?.items?.some((x) => x.eventType === 'activity.reminder_due' && x.payload?.activityId === activityId)
    );
  }
  check('reminder produced a notification record', reminderSeen);
  r = await call('GET', `/activities/${activityId}`, { token: t });
  check('activity.reminderSentAt is set', Boolean(r.json?.reminderSentAt), r.json);
  r = await call('POST', `/activities/${activityId}/complete`, { token: t });
  check('complete activity', r.status === 200 && r.json?.status === 'completed', r);

  section('Segments & campaigns');
  r = await call('POST', '/segments', { token: t, body: { propertyId: PROPERTY_ID, name: `Smoke seg ${run}`, filters: { tags: [tag], hasEmail: true } } });
  check('create segment 201', r.status === 201, r);
  const segmentId = r.json?.id;
  r = await call('GET', `/segments/${segmentId}/preview`, { token: t });
  check('segment preview resolves exactly 1 contact', r.status === 200 && r.json?.total === 1, r.json);

  r = await call('POST', '/campaigns', {
    token: t,
    body: { propertyId: PROPERTY_ID, segmentId, name: `Smoke campaign ${run}`, channel: 'email', subject: 'Hello {{fullName}}', body: 'Hi {{fullName}}, this is a smoke test.' },
  });
  check('create campaign 201 (draft)', r.status === 201 && r.json?.status === 'draft', r);
  const campaignId = r.json?.id;

  r = await call('POST', `/campaigns/${campaignId}/send`, { token: t });
  check('send without Idempotency-Key -> 422', r.status === 422, r);
  const idemKey = `smoke-send-${run}`;
  r = await call('POST', `/campaigns/${campaignId}/send`, { token: t, headers: { 'Idempotency-Key': idemKey } });
  check('send campaign 200', r.status === 200, r);
  check('campaign status sent, 1 recipient sent', r.json?.status === 'sent' && r.json?.sentCount === 1 && r.json?.totalRecipients === 1, r.json && { status: r.json.status, sentCount: r.json.sentCount, total: r.json.totalRecipients, failed: r.json.failedCount });
  const firstBody = r.json;
  r = await call('POST', `/campaigns/${campaignId}/send`, { token: t, headers: { 'Idempotency-Key': idemKey } });
  check('same Idempotency-Key replays stored response', r.status === 200 && r.json?.id === firstBody?.id, r);
  r = await call('POST', `/campaigns/${campaignId}/send`, { token: t, headers: { 'Idempotency-Key': `${idemKey}-2` } });
  check('re-send with new key -> 409 (already sent)', r.status === 409, r);

  section('Role escalation (Phase 1.1)');
  r = await call('GET', '/auth/roles', { token: t });
  const adminRoles = Object.fromEntries((r.json?.items || []).map((x) => [x.name, x.id]));
  check(
    'admin sees all 4 assignable roles',
    r.status === 200 && ['super_admin', 'property_manager', 'sales_agent', 'auditor'].every((n) => adminRoles[n]),
    r.json?.items?.map((x) => x.name)
  );

  const mgrEmail = `mgr-${run}@example.com`;
  const mgrPassword = `Smoke-${run}-Aa1xyz!`;
  const userBody = (email, roleId) => ({
    email,
    password: mgrPassword,
    fullName: 'Smoke User',
    propertyId: PROPERTY_ID,
    roleId,
  });
  const idem = (k) => ({ 'Idempotency-Key': `${k}-${run}` });

  r = await call('POST', '/auth/users', { token: t, headers: idem('mk-mgr'), body: userBody(mgrEmail, adminRoles.property_manager) });
  check('admin creates a property_manager 201', r.status === 201, r);
  const mgrAId = r.json?.id;

  r = await call('POST', '/auth/login', { body: { email: mgrEmail, password: mgrPassword }, property: null });
  const mt = r.json?.accessToken;
  check('manager can log in', r.status === 200 && Boolean(mt), r);

  r = await call('GET', '/auth/roles', { token: mt });
  const mgrRoleNames = (r.json?.items || []).map((x) => x.name);
  const mgrRoles = Object.fromEntries((r.json?.items || []).map((x) => [x.name, x.id]));
  check(
    'manager role picker excludes super_admin, includes sales_agent',
    r.status === 200 && !mgrRoleNames.includes('super_admin') && mgrRoleNames.includes('sales_agent'),
    mgrRoleNames
  );

  r = await call('POST', '/auth/users', { token: mt, headers: idem('esc-1'), body: userBody(`esc-${run}@example.com`, adminRoles.super_admin) });
  check('ESCALATION BLOCKED: manager creating a super_admin -> 403', r.status === 403, r);

  r = await call('POST', '/auth/users', { token: mt, headers: idem('badrole'), body: userBody(`orphan-${run}@example.com`, '33333333-3333-3333-3333-333333333333') });
  check('unknown roleId -> 422 (not 500)', r.status === 422, r);

  r = await call('POST', '/auth/users', { token: mt, headers: idem('orphan-retry'), body: userBody(`orphan-${run}@example.com`, mgrRoles.sales_agent) });
  check('same email works afterwards (no orphan user left behind)', r.status === 201, r);

  r = await call('POST', '/auth/users', { token: mt, headers: idem('agent'), body: userBody(`agent-${run}@example.com`, mgrRoles.sales_agent) });
  check('manager creating a sales_agent -> 201', r.status === 201, r);

  r = await call('POST', '/properties', { token: mt, body: { name: `Probe ${run}`, currency: 'USD', timezone: 'UTC' }, property: null });
  check('manager cannot create properties -> 403', r.status === 403, r);

  section('Tenant isolation (Phase 1.3)');
  r = await call('POST', '/properties', { token: t, property: null, body: { name: `Isolation Hotel ${run}`, currency: 'USD', timezone: 'UTC' } });
  check('admin creates a second property (tenant B) 201', r.status === 201, r);
  const propB = r.json?.id;

  r = await call('GET', '/properties', { token: t, property: null });
  check('creator can see the new property (gets a role there)', r.status === 200 && r.json?.items?.some((p) => p.id === propB), r.json);

  r = await call('GET', '/auth/roles', { token: t, property: propB });
  const rolesB = Object.fromEntries((r.json?.items || []).map((x) => [x.name, x.id]));
  check('creator can administer tenant B (lists roles there)', r.status === 200 && Boolean(rolesB.property_manager), r);

  const mgrBEmail = `mgrb-${run}@example.com`;
  r = await call('POST', '/auth/users', { token: t, property: propB, headers: idem('mk-mgr-b'), body: { email: mgrBEmail, password: mgrPassword, fullName: 'Tenant B Manager', propertyId: propB, roleId: rolesB.property_manager } });
  check('create a manager who belongs ONLY to tenant B', r.status === 201, r);
  const mgrBId = r.json?.id;

  r = await call('POST', '/auth/login', { body: { email: mgrBEmail, password: mgrPassword }, property: null });
  const tb = r.json?.accessToken;
  check('tenant B manager logs in', r.status === 200 && Boolean(tb), r);

  const asB = (method, path, body, headers) => call(method, path, { token: tb, property: propB, body, headers });

  // --- reads of tenant A's records from tenant B must look like "does not exist"
  const crossReads = [
    ['contact', `/contacts/${contactId}`],
    ['company', `/companies/${companyId}`],
    ['deal', `/deals/${dealId}`],
    ['activity', `/activities/${activityId}`],
    ['segment', `/segments/${segmentId}`],
    ['segment preview', `/segments/${segmentId}/preview`],
    ['campaign', `/campaigns/${campaignId}`],
    ['contact timeline', `/contacts/${contactId}/timeline`],
  ];
  for (const [label, path] of crossReads) {
    r = await asB('GET', path);
    check(`B reading A's ${label} -> 404 (was 403)`, r.status === 404, r);
  }

  // --- writes against tenant A's records from tenant B must fail and change nothing
  const crossWrites = [
    ['PATCH contact', 'PATCH', `/contacts/${contactId}`, { fullName: 'Hijacked' }],
    ['PATCH company', 'PATCH', `/companies/${companyId}`, { name: 'Hijacked' }],
    ['PATCH deal', 'PATCH', `/deals/${dealId}`, { title: 'Hijacked' }],
    ['PATCH activity', 'PATCH', `/activities/${activityId}`, { subject: 'Hijacked' }],
    ['PATCH segment', 'PATCH', `/segments/${segmentId}`, { name: 'Hijacked' }],
    ['PATCH campaign', 'PATCH', `/campaigns/${campaignId}`, { name: 'Hijacked' }],
    ['PATCH pipeline stage', 'PATCH', `/pipeline/stages/${byName('Qualified')?.id}`, { name: 'Hijacked' }],
    ['transition deal', 'POST', `/deals/${dealId}/transition`, { stageId: byName('Lost')?.id }],
    ['complete activity', 'POST', `/activities/${activityId}/complete`, undefined],
  ];
  for (const [label, method, path, body] of crossWrites) {
    r = await asB(method, path, body);
    check(`B attempting to ${label} owned by A -> 404`, r.status === 404, r);
  }
  r = await asB('POST', `/campaigns/${campaignId}/send`, undefined, idem('x-send'));
  check("B sending A's campaign -> 404", r.status === 404, r);

  r = await call('GET', `/contacts/${contactId}`, { token: t });
  check("A's contact unchanged after B's attempts", r.status === 200 && r.json?.fullName === `Smoke Tester ${run}`, r.json?.fullName);
  r = await call('GET', `/deals/${dealId}`, { token: t });
  check("A's deal unchanged after B's attempts", r.status === 200 && r.json?.title === `Wedding block ${run}`, r.json?.title);
  r = await call('GET', `/pipeline/stages`, { token: t });
  check("A's pipeline stage names unchanged", (r.json?.items || []).every((st) => st.name !== 'Hijacked'), r.json?.items?.map((x) => x.name));

  // --- B cannot link tenant A's records into its own
  r = await asB('POST', '/contacts', { propertyId: propB, fullName: `B Contact ${run}`, email: `b-${run}@example.com`, tags: [tag] });
  check('B creates its own contact 201', r.status === 201, r);
  const contactB = r.json?.id;

  r = await asB('POST', '/contacts', { propertyId: propB, fullName: 'Linker', companyId });
  check("B linking A's company to a contact -> 404", r.status === 404, r);
  r = await asB('POST', '/deals', { propertyId: propB, title: 'x', contactId });
  check("B creating a deal with A's contact -> 404", r.status === 404, r);
  r = await asB('POST', '/deals', { propertyId: propB, title: 'x', contactId: contactB, stageId: byName('Qualified')?.id });
  check("B creating a deal in A's pipeline stage -> 404", r.status === 404, r);
  r = await asB('POST', '/campaigns', { propertyId: propB, segmentId, name: 'x', channel: 'email', subject: 's', body: 'b' });
  check("B creating a campaign on A's segment -> 404", r.status === 404, r);
  r = await asB('POST', '/activities', { propertyId: propB, type: 'task', subject: 'x', dealId });
  check("B creating an activity on A's deal -> 404", r.status === 404, r);

  // --- assignee must belong to the same tenant (1.3 core fix)
  r = await asB('POST', '/activities', { propertyId: propB, type: 'task', subject: 'x', contactId: contactB, assignedTo: mgrAId });
  check("ASSIGNEE CHECK: B assigning a tenant-A user -> 422", r.status === 422, r);
  r = await asB('POST', '/activities', { propertyId: propB, type: 'task', subject: 'x', contactId: contactB, assignedTo: '44444444-4444-4444-4444-444444444444' });
  check('ASSIGNEE CHECK: unknown user id gives the same 422 (no existence oracle)', r.status === 422, r);
  r = await asB('POST', '/activities', { propertyId: propB, type: 'task', subject: 'own', contactId: contactB, assignedTo: mgrBId });
  check('B assigning its own user -> 201', r.status === 201, r);
  const activityB = r.json?.id;
  r = await asB('PATCH', `/activities/${activityB}`, { assignedTo: mgrAId });
  check("ASSIGNEE CHECK: re-assigning to a tenant-A user via PATCH -> 422", r.status === 422, r);

  // --- listing and header scoping
  r = await asB('GET', '/contacts');
  check("B's contact list excludes tenant A data", r.status === 200 && !r.json?.items?.some((c) => c.id === contactId) && r.json?.total === 1, r.json?.total);
  r = await call('GET', '/contacts', { token: tb, property: PROPERTY_ID });
  check('B user sending tenant A as property context -> 403', r.status === 403, r);

  section('Idempotency (Phase 1.4)');
  const withKey = (k) => ({ 'Idempotency-Key': k });

  // An immediate retry must replay the stored response. Before 1.4 this raced and returned 409.
  for (let i = 0; i < 3; i += 1) {
    const k = `imm-${i}-${run}`;
    const body = userBody(`idem-${i}-${run}@example.com`, adminRoles.sales_agent);
    const first = await call('POST', '/auth/users', { token: t, headers: withKey(k), body });
    const retry = await call('POST', '/auth/users', { token: t, headers: withKey(k), body });
    check(
      `immediate retry #${i + 1} replays the stored 201 (no 409)`,
      first.status === 201 && retry.status === 201 && retry.json?.id === first.json?.id && retry.headers['idempotent-replayed'] === 'true',
      { first: first.status, retry: retry.status, replayed: retry.headers['idempotent-replayed'] }
    );
  }

  const keyDiff = `diff-${run}`;
  r = await call('POST', '/auth/users', { token: t, headers: withKey(keyDiff), body: userBody(`idem-d1-${run}@example.com`, adminRoles.sales_agent) });
  check('first use of a key succeeds', r.status === 201, r);
  r = await call('POST', '/auth/users', { token: t, headers: withKey(keyDiff), body: userBody(`idem-d2-${run}@example.com`, adminRoles.sales_agent) });
  check('same key with a different body -> 409', r.status === 409 && /different request/.test(r.json?.error?.message || ''), r);

  // Keys are private to the caller: another user/tenant using the same key string is unaffected.
  const keyShared = `shared-${run}`;
  const aShared = await call('POST', '/auth/users', { token: t, headers: withKey(keyShared), body: userBody(`shared-a-${run}@example.com`, adminRoles.sales_agent) });
  const bSharedBody = { email: `shared-b-${run}@example.com`, password: mgrPassword, fullName: 'Smoke User', propertyId: propB, roleId: rolesB.sales_agent };
  const bShared = await asB('POST', '/auth/users', bSharedBody, withKey(keyShared));
  check(
    'same key string from another user/tenant executes independently (201, no cross-tenant 409)',
    aShared.status === 201 && bShared.status === 201 && aShared.json?.id !== bShared.json?.id,
    { a: aShared.status, b: bShared.status, bBody: bShared.json }
  );
  const bReplay = await asB('POST', '/auth/users', bSharedBody, withKey(keyShared));
  check(
    "tenant B's replay returns B's own response, never A's",
    bReplay.status === 201 && bReplay.json?.id === bShared.json?.id && bReplay.headers['idempotent-replayed'] === 'true',
    bReplay
  );

  section('User management (Phase 1.2)');
  r = await call('GET', '/auth/me', { token: t, property: null });
  const adminId = r.json?.user?.id;
  check('seeded admin is a platform admin', r.json?.user?.isPlatformAdmin === true, r.json);
  r = await call('GET', '/auth/me', { token: mt, property: null });
  check('property manager is not a platform admin', r.json?.user?.isPlatformAdmin === false, r.json);

  const teamEmail = `team-${run}@example.com`;
  r = await call('POST', '/auth/users', { token: mt, headers: withKey(`mk-team-${run}`), body: userBody(teamEmail, mgrRoles.sales_agent) });
  check('manager creates a team member (sales_agent) 201', r.status === 201, r);
  const teamId = r.json?.id;

  r = await call('GET', '/users', { token: t });
  check(
    'admin lists members, paginated (the demo hotel accumulates users across smoke runs)',
    r.status === 200 && r.json?.items?.length > 0 && r.json?.total >= 3 && r.json?.pageSize === 20,
    { total: r.json?.total, pageSize: r.json?.pageSize }
  );
  check(
    'member list shows roles and exposes no credentials or platform flags',
    (r.json?.items || []).every((u) => Array.isArray(u.roles) && u.passwordHash === undefined && u.isPlatformAdmin === undefined),
    r.json?.items?.[0]
  );
  r = await call('GET', `/users?search=${run}`, { token: t });
  const memberIds = (r.json?.items || []).map((u) => u.id);
  check("this run's members are found by search", r.status === 200 && [mgrAId, teamId].every((id) => memberIds.includes(id)), r.json?.total);
  r = await call('GET', `/users?search=${encodeURIComponent(EMAIL)}`, { token: t });
  check('the admin is found by email', r.status === 200 && r.json?.items?.some((u) => u.id === adminId), r.json?.total);
  r = await call('GET', `/users?search=team-${run}`, { token: t });
  check('search narrows to one member', r.status === 200 && r.json?.total === 1, r.json?.total);
  r = await call('GET', `/users/${teamId}`, { token: mt });
  check('manager reads a member', r.status === 200 && r.json?.roles?.[0]?.name === 'sales_agent', r.json);

  r = await call('POST', '/auth/login', { body: { email: teamEmail, password: mgrPassword }, property: null });
  const teamTok = r.json?.accessToken;
  r = await call('GET', '/users', { token: teamTok });
  check('a sales_agent cannot list users -> 403', r.status === 403, r);

  r = await call('DELETE', `/users/${adminId}/roles/${adminRoles.super_admin}`, { token: mt });
  check('manager cannot remove a super_admin role -> 403', r.status === 403, r);
  r = await call('DELETE', `/users/${adminId}`, { token: mt });
  check('manager cannot remove a super_admin from the property -> 403', r.status === 403, r);
  r = await call('POST', `/users/${teamId}/roles`, { token: mt, body: { roleId: adminRoles.super_admin } });
  check('manager cannot grant super_admin -> 403', r.status === 403, r);

  r = await call('POST', `/users/${teamId}/roles`, { token: mt, body: { roleId: mgrRoles.auditor } });
  check('manager adds the auditor role -> 201, now two roles', r.status === 201 && r.json?.roles?.length === 2, r.json);
  r = await call('POST', `/users/${teamId}/roles`, { token: mt, body: { roleId: mgrRoles.auditor } });
  check('adding the same role again -> 409', r.status === 409, r);
  r = await call('DELETE', `/users/${teamId}/roles/${mgrRoles.auditor}`, { token: mt });
  check('manager removes the auditor role -> 200, back to one role', r.status === 200 && r.json?.roles?.length === 1, r.json);
  r = await call('DELETE', `/users/${teamId}/roles/${mgrRoles.auditor}`, { token: mt });
  check('removing a role they do not hold -> 404', r.status === 404, r);
  r = await call('GET', `/users/${teamId}`, { token: tb, property: propB });
  check("tenant B cannot see tenant A's member -> 404", r.status === 404, r);
  r = await call('GET', '/users/33333333-3333-3333-3333-333333333333', { token: mt });
  check('unknown user id -> 404', r.status === 404, r);

  // Give an existing account (tenant B's manager) access to this property, then take it away.
  r = await call('POST', '/users/members', { token: t, body: { email: mgrBEmail, roleId: adminRoles.auditor } });
  check('admin adds an existing account to this property by email -> 201', r.status === 201 && r.json?.roles?.[0]?.name === 'auditor', r.json);
  r = await call('GET', '/properties', { token: tb, property: null });
  check('that account now sees both properties', r.json?.items?.some((p) => p.id === PROPERTY_ID) && r.json?.items?.some((p) => p.id === propB), r.json?.items?.length);
  r = await call('POST', '/users/members', { token: mt, body: { email: mgrBEmail, roleId: adminRoles.super_admin } });
  check('manager cannot add anyone as super_admin by email -> 403', r.status === 403, r);
  r = await call('DELETE', `/users/${mgrBId}`, { token: t });
  check('removing them from this property -> 204', r.status === 204, r);
  r = await call('GET', '/properties', { token: tb, property: null });
  check('they lose this property but keep their own', !r.json?.items?.some((p) => p.id === PROPERTY_ID) && r.json?.items?.some((p) => p.id === propB), r.json?.items?.length);
  r = await call('POST', '/users/members', { token: t, body: { email: `ghost-${run}@example.com`, roleId: adminRoles.auditor } });
  check('adding an unknown email -> 404', r.status === 404, r);

  r = await call('DELETE', `/users/${teamId}`, { token: mt });
  check('manager removes a member from the property -> 204', r.status === 204, r);
  r = await call('GET', '/contacts', { token: teamTok });
  check('removed member loses access at once (their token is still valid) -> 403', r.status === 403, r);
  r = await call('GET', `/users/${teamId}`, { token: mt });
  check('removed member is no longer listed -> 404', r.status === 404, r);

  // A property must always keep someone who can manage its users (tenant B: the creator + mgrB).
  r = await call('DELETE', `/users/${adminId}`, { token: tb, property: propB });
  check("tenant B's manager cannot remove the super_admin who created the property -> 403", r.status === 403, r);
  r = await call('DELETE', `/users/${adminId}`, { token: t, property: propB });
  check('the super_admin can step down while another admin remains -> 204', r.status === 204, r);
  r = await call('DELETE', `/users/${mgrBId}`, { token: tb, property: propB });
  check('LAST ADMIN: the only remaining admin cannot be removed -> 409', r.status === 409, r);
  r = await call('DELETE', `/users/${mgrBId}/roles/${rolesB.property_manager}`, { token: tb, property: propB });
  check('LAST ADMIN: ...nor demoted by removing their role -> 409', r.status === 409, r);

  section('Change password (Phase 1.2)');
  const cpEmail = `cp-${run}@example.com`;
  const cpNew = `Newpass-${run}-9z`;
  r = await call('POST', '/auth/users', { token: t, headers: withKey(`mk-cp-${run}`), body: userBody(cpEmail, adminRoles.sales_agent) });
  check('create an account for the password test 201', r.status === 201, r);
  const cpId = r.json?.id;
  r = await call('POST', '/auth/login', { body: { email: cpEmail, password: mgrPassword }, property: null });
  const cpRefresh1 = r.json?.refreshToken;
  const cpTok1 = r.json?.accessToken;
  check('account logs in', r.status === 200 && Boolean(cpTok1), r);

  r = await call('POST', '/auth/change-password', { property: null, body: { currentPassword: mgrPassword, newPassword: cpNew } });
  check('change-password needs a token -> 401', r.status === 401, r);
  r = await call('POST', '/auth/change-password', { token: cpTok1, property: null, body: { currentPassword: 'definitely-wrong', newPassword: cpNew } });
  check('wrong current password -> 422 (not 401)', r.status === 422, r);
  r = await call('POST', '/auth/change-password', { token: cpTok1, property: null, body: { currentPassword: mgrPassword, newPassword: mgrPassword } });
  check('new password equal to the current one -> 422', r.status === 422, r);
  r = await call('POST', '/auth/change-password', { token: cpTok1, property: null, body: { currentPassword: mgrPassword, newPassword: 'weak' } });
  check('weak new password -> 422', r.status === 422, r);
  r = await call('POST', '/auth/change-password', { token: cpTok1, property: null, body: { currentPassword: mgrPassword, newPassword: cpNew } });
  check('change password -> 204', r.status === 204, r);
  r = await call('POST', '/auth/login', { body: { email: cpEmail, password: mgrPassword }, property: null });
  check('the old password no longer works -> 401', r.status === 401, r);
  r = await call('POST', '/auth/login', { body: { email: cpEmail, password: cpNew }, property: null });
  const cpTok2 = r.json?.accessToken;
  const cpRefresh2 = r.json?.refreshToken;
  check('the new password works', r.status === 200 && Boolean(cpTok2), r);
  r = await call('POST', '/auth/refresh', { body: { refreshToken: cpRefresh1 }, property: null });
  check('sessions from before the change are signed out (old refresh token -> 401)', r.status === 401, r);

  section('Platform administration (Phase 1.2)');
  r = await call('GET', '/platform/users', { token: mt, property: null });
  check('a property manager cannot use platform endpoints -> 403', r.status === 403, r);
  r = await call('GET', `/platform/users?search=cp-${run}`, { token: t, property: null });
  check('platform admin finds the account', r.status === 200 && r.json?.total === 1 && r.json?.items?.[0]?.id === cpId && r.json.items[0].isActive === true, r.json);
  r = await call('PATCH', `/platform/users/${adminId}/status`, { token: t, property: null, body: { isActive: false } });
  check('platform admin cannot disable themselves -> 422', r.status === 422, r);
  r = await call('PATCH', `/platform/users/${cpId}/status`, { token: mt, property: null, body: { isActive: false } });
  check('a property manager cannot disable accounts -> 403', r.status === 403, r);
  r = await call('PATCH', `/platform/users/${cpId}/status`, { token: t, property: null, body: { isActive: false } });
  check('platform admin disables the account -> 200', r.status === 200 && r.json?.isActive === false, r);
  r = await call('GET', '/auth/me', { token: cpTok2, property: null });
  check('DEACTIVATION IS IMMEDIATE: their still-valid access token is rejected -> 401', r.status === 401, r);
  r = await call('POST', '/auth/refresh', { body: { refreshToken: cpRefresh2 }, property: null });
  check('their refresh token is revoked -> 401', r.status === 401, r);
  r = await call('POST', '/auth/login', { body: { email: cpEmail, password: cpNew }, property: null });
  check('they cannot log in while disabled -> 401', r.status === 401, r);
  r = await call('PATCH', `/platform/users/${cpId}/status`, { token: t, property: null, body: { isActive: true } });
  check('platform admin re-enables the account -> 200', r.status === 200 && r.json?.isActive === true, r);
  r = await call('POST', '/auth/login', { body: { email: cpEmail, password: cpNew }, property: null });
  check('they can log in again', r.status === 200 && Boolean(r.json?.accessToken), r);

  section('Reports / audit / retention');
  r = await call('GET', '/reports/dashboard', { token: t });
  check('dashboard 200', r.status === 200 && r.json?.deals, r);
  r = await call('GET', '/reports/pipeline', { token: t });
  check('pipeline funnel 200', r.status === 200 && Array.isArray(r.json?.stages) && r.json?.outcomes?.total >= 1, r.json);
  r = await call('GET', '/reports/forecast', { token: t });
  check('forecast 200', r.status === 200 && r.json?.forecast, r);
  r = await call('GET', `/audit-logs?entityType=Deal&entityId=${dealId}`, { token: t });
  check('audit trail has deal.created + deal.stage_changed', r.status === 200 && r.json?.items?.some((a) => a.action === 'deal.created') && r.json?.items?.some((a) => a.action === 'deal.stage_changed'), r.json?.items?.map((a) => a.action));
  r = await call('GET', '/retention/policy', { token: t });
  check('retention policy 200', r.status === 200, r);

  section('Result');
}

main()
  .catch((err) => {
    failed += 1;
    failures.push(`crashed: ${err.message}`);
    console.error(err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log('Failures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    process.exit(failed ? 1 : 0);
  });