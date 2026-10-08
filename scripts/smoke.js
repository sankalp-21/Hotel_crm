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
  return { status: res.status, json };
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
