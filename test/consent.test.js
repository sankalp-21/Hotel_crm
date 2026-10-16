const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// ---- Stub prisma + audit so services run without a DB.
const state = { contacts: new Map(), suppressions: [], audits: [] };
const fakePrisma = {
  contact: {
    create: async ({ data }) => {
      const row = { id: 'c-new', ...data };
      state.contacts.set(row.id, row);
      return row;
    },
    findFirst: async ({ where }) => {
      const c = state.contacts.get(where.id);
      return c && c.propertyId === where.propertyId ? c : null;
    },
    update: async ({ where, data }) => {
      const c = { ...state.contacts.get(where.id), ...data };
      state.contacts.set(where.id, c);
      return c;
    },
  },
  suppressionEntry: {
    findFirst: async ({ where }) =>
      state.suppressions.find(
        (s) =>
          s.propertyId === where.propertyId &&
          (where.id ? s.id === where.id : s.channel === where.channel && s.address === where.address)
      ) || null,
    create: async ({ data }) => {
      const row = { id: `s${state.suppressions.length + 1}`, createdAt: new Date(), ...data };
      state.suppressions.push(row);
      return row;
    },
    findMany: async ({ where }) =>
      state.suppressions.filter(
        (s) =>
          s.propertyId === where.propertyId &&
          s.channel === where.channel &&
          where.address.in.includes(s.address)
      ),
    deleteMany: async ({ where }) => {
      state.suppressions = state.suppressions.filter(
        (s) => !(s.id === where.id && s.propertyId === where.propertyId)
      );
      return { count: 1 };
    },
  },
  company: { findFirst: async () => ({ id: 'co' }) },
  auditLog: { create: async ({ data }) => state.audits.push(data) },
};
const prismaPath = require.resolve('../src/infrastructure/db/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma };

const { classifyContact, classifyContacts, SKIP_REASONS } = require('../src/modules/campaigns/eligibility');
const { normalizeAddress } = require('../src/modules/suppressions/normalize');
const suppressions = require('../src/modules/suppressions/service');
const contactsService = require('../src/modules/contacts/service');
const { createContactSchema, updateContactSchema } = require('../src/modules/contacts/validator');
const { createSuppressionSchema } = require('../src/modules/suppressions/validator');

const PROP = 'p1';
const base = { email: 'Guest@Example.com', phone: '+1 555-0100', status: 'lead', marketingConsent: true, unsubscribedAt: null, emailBounced: false };
const none = new Set();

test.beforeEach(() => {
  state.contacts.clear();
  state.suppressions = [];
  state.audits = [];
});

// ---------- eligibility ----------
test('eligible contact passes', () => {
  assert.strictEqual(classifyContact(base, 'email', none), null);
});

test('no consent is the default safe outcome', () => {
  assert.strictEqual(classifyContact({ ...base, marketingConsent: false }, 'email', none), SKIP_REASONS.NO_CONSENT);
});

test('unsubscribed wins even when consent flag is true', () => {
  assert.strictEqual(
    classifyContact({ ...base, unsubscribedAt: new Date() }, 'email', none),
    SKIP_REASONS.UNSUBSCRIBED
  );
});

test('bounced email is skipped for email but not for sms', () => {
  const c = { ...base, emailBounced: true };
  assert.strictEqual(classifyContact(c, 'email', none), SKIP_REASONS.BOUNCED);
  assert.strictEqual(classifyContact(c, 'sms', none), null);
});

test('missing address, inactive status', () => {
  assert.strictEqual(classifyContact({ ...base, email: null }, 'email', none), SKIP_REASONS.NO_ADDRESS);
  assert.strictEqual(classifyContact({ ...base, status: 'inactive' }, 'email', none), SKIP_REASONS.INACTIVE);
  assert.strictEqual(classifyContact({ ...base, status: 'inactive' }, 'email', none, { includeInactive: true }), null);
});

test('suppression match is case-insensitive for email', async () => {
  await suppressions.suppressAddress({ propertyId: PROP, channel: 'email', address: '  GUEST@example.COM ' });
  const [r] = await classifyContacts(PROP, 'email', [base]);
  assert.strictEqual(r.skipReason, SKIP_REASONS.SUPPRESSED);
});

test('suppression in another property does not affect this one', async () => {
  await suppressions.suppressAddress({ propertyId: 'other', channel: 'email', address: 'guest@example.com' });
  const [r] = await classifyContacts(PROP, 'email', [base]);
  assert.strictEqual(r.skipReason, null);
});

test('phone normalisation ignores formatting', () => {
  assert.strictEqual(normalizeAddress('sms', '+1 (555) 010-0'), '+15550100');
});

// ---------- suppression service ----------
test('suppressAddress is idempotent and never duplicates', async () => {
  const a = await suppressions.suppressAddress({ propertyId: PROP, channel: 'email', address: 'x@y.com' });
  const b = await suppressions.suppressAddress({ propertyId: PROP, channel: 'email', address: 'X@Y.com' });
  assert.strictEqual(a.created, true);
  assert.strictEqual(b.created, false);
  assert.strictEqual(state.suppressions.length, 1);
});

test('audit for manual suppression never contains the address', async () => {
  await suppressions.addSuppression(PROP, { channel: 'email', address: 'secret@y.com' }, { id: 'u1' });
  assert.strictEqual(state.audits[0].action, 'suppression.added');
  assert.ok(!JSON.stringify(state.audits[0]).includes('secret@y.com'));
});

test('only manual entries can be removed; system entries are 409', async () => {
  const { entry } = await suppressions.suppressAddress({ propertyId: PROP, channel: 'email', address: 'a@b.com', reason: 'unsubscribed' });
  await assert.rejects(() => suppressions.removeSuppression(entry.id, PROP, { id: 'u1' }), { statusCode: 409 });
  const { entry: manual } = await suppressions.suppressAddress({ propertyId: PROP, channel: 'email', address: 'm@b.com' });
  await suppressions.removeSuppression(manual.id, PROP, { id: 'u1' });
  assert.ok(!state.suppressions.find((s) => s.id === manual.id));
});

test('removing an entry from another property is 404', async () => {
  const { entry } = await suppressions.suppressAddress({ propertyId: 'other', channel: 'email', address: 'a@b.com' });
  await assert.rejects(() => suppressions.removeSuppression(entry.id, PROP, { id: 'u1' }), { statusCode: 404 });
});

test('create schema: email must be valid, system reasons cannot be supplied', () => {
  assert.ok(!createSuppressionSchema.safeParse({ channel: 'email', address: 'nope' }).success);
  const ok = createSuppressionSchema.safeParse({ address: 'a@b.com', reason: 'bounced' });
  assert.ok(ok.success);
  assert.strictEqual(ok.data.reason, undefined);
});

// ---------- contact consent ----------
test('validator: consent=true requires consentSource, on create and update', () => {
  const create = { propertyId: '11111111-1111-1111-1111-111111111111', fullName: 'A', marketingConsent: true };
  assert.ok(!createContactSchema.safeParse(create).success);
  assert.ok(createContactSchema.safeParse({ ...create, consentSource: 'signup_form' }).success);
  assert.ok(!updateContactSchema.safeParse({ marketingConsent: true }).success);
  assert.ok(updateContactSchema.safeParse({ marketingConsent: false }).success);
});

test('validator: unsubscribedAt / emailBounced cannot be set through the API', () => {
  const r = updateContactSchema.safeParse({ unsubscribedAt: null, emailBounced: false });
  assert.ok(r.success);
  assert.strictEqual(r.data.unsubscribedAt, undefined);
  assert.strictEqual(r.data.emailBounced, undefined);
});

test('create without consent stores marketingConsent=false and no provenance', async () => {
  const c = await contactsService.createContact({ propertyId: PROP, fullName: 'A' }, { id: 'u1' });
  assert.strictEqual(c.marketingConsent, false);
  assert.strictEqual(c.consentUpdatedAt, null);
  assert.ok(!state.audits.some((a) => a.action.startsWith('contact.consent')));
});

test('granting consent records source + timestamp and audits without PII', async () => {
  state.contacts.set('c1', { id: 'c1', propertyId: PROP, email: 'p@ii.com', marketingConsent: false, unsubscribedAt: null });
  const c = await contactsService.updateContact('c1', PROP, { marketingConsent: true, consentSource: 'front_desk' }, { id: 'u1' });
  assert.strictEqual(c.marketingConsent, true);
  assert.strictEqual(c.consentSource, 'front_desk');
  assert.ok(c.consentUpdatedAt instanceof Date);
  const a = state.audits.find((x) => x.action === 'contact.consent_granted');
  assert.deepStrictEqual(a.metadata, { from: false, to: true, source: 'front_desk' });
});

test('staff cannot re-grant consent over a contact\'s own unsubscribe', async () => {
  state.contacts.set('c1', { id: 'c1', propertyId: PROP, marketingConsent: false, unsubscribedAt: new Date() });
  await assert.rejects(
    () => contactsService.updateContact('c1', PROP, { marketingConsent: true, consentSource: 'front_desk' }, { id: 'u1' }),
    { statusCode: 409 }
  );
});

test('stray consentSource without a flag change does not rewrite provenance', async () => {
  state.contacts.set('c1', { id: 'c1', propertyId: PROP, marketingConsent: true, consentSource: 'signup_form', unsubscribedAt: null });
  const c = await contactsService.updateContact('c1', PROP, { fullName: 'B', consentSource: 'hacked' }, { id: 'u1' });
  assert.strictEqual(c.consentSource, 'signup_form');
});

test('revoking consent is audited', async () => {
  state.contacts.set('c1', { id: 'c1', propertyId: PROP, marketingConsent: true, unsubscribedAt: null });
  await contactsService.updateContact('c1', PROP, { marketingConsent: false }, { id: 'u1' });
  assert.ok(state.audits.some((a) => a.action === 'contact.consent_revoked'));
});
