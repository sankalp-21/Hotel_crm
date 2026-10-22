const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const {
  SUPPORTED_PLACEHOLDERS,
  renderTemplate,
  findUnknownPlaceholders,
  unknownPlaceholderMessage,
} = require('../src/modules/campaigns/template');
const { createCampaignSchema, updateCampaignSchema } = require('../src/modules/campaigns/validator');

const contact = { fullName: 'Ana Silva', email: 'ana@x.com', phone: '+1 555 0101' };
const SEGMENT = '11111111-1111-4111-8111-111111111111';
const PROPERTY = '22222222-2222-4222-8222-222222222222';
const base = { propertyId: PROPERTY, segmentId: SEGMENT, name: 'N', channel: 'email', subject: 'Hi', body: 'Hello' };

// ───────────── rendering ─────────────
test('renders all supported placeholders, with or without spaces inside the braces', () => {
  assert.strictEqual(renderTemplate('{{fullName}}|{{email}}|{{phone}}', contact), 'Ana Silva|ana@x.com|+1 555 0101');
  assert.strictEqual(renderTemplate('{{ fullName }} {{  email}} {{phone  }}', contact), 'Ana Silva ana@x.com +1 555 0101');
});

test('missing contact values render as empty text, not "undefined" or "null"', () => {
  assert.strictEqual(renderTemplate('[{{fullName}}][{{phone}}]', { fullName: null }), '[][]');
});

test('rendering is a single pass: a value that looks like a placeholder is never expanded again', () => {
  const tricky = { fullName: '{{email}}', email: 'ana@x.com', phone: '' };
  assert.strictEqual(renderTemplate('Hi {{fullName}}', tricky), 'Hi {{email}}');
});

test('unknown placeholders are left as written (rendering never throws mid-send)', () => {
  assert.strictEqual(renderTemplate('Hi {{nickname}} / {{fullName}}', contact), 'Hi {{nickname}} / Ana Silva');
});

test('prototype-ish names are unknown, never resolved through the contact object', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.deepStrictEqual(findUnknownPlaceholders(`{{${name}}}`), [name]);
    assert.strictEqual(renderTemplate(`{{${name}}}`, contact), `{{${name}}}`);
  }
});

// ───────────── finding unknown placeholders ─────────────
test('findUnknownPlaceholders: distinct, trimmed, in order of first appearance, across several texts', () => {
  assert.deepStrictEqual(
    findUnknownPlaceholders('Hi {{ nick }} {{fullName}} {{nick}}', 'Bye {{ city }}', null, undefined),
    ['nick', 'city']
  );
});

test('names are case-sensitive; empty and spaced names are unknown', () => {
  assert.deepStrictEqual(findUnknownPlaceholders('{{fullname}} {{}} {{full name}} {{ }}'), ['fullname', '', 'full name']);
});

test('valid templates and text without braces have no unknown placeholders', () => {
  assert.deepStrictEqual(findUnknownPlaceholders('Hi {{fullName}}, { not } a placeholder {{email}}'), []);
  assert.strictEqual(unknownPlaceholderMessage('body', 'Hi {{fullName}}'), null);
});

test('the error message names the field, lists the unknown names and the supported ones', () => {
  const msg = unknownPlaceholderMessage('subject', 'Hi {{nick}} {{city}}');
  assert.match(msg, /in subject: \{\{nick\}\}, \{\{city\}\}/);
  assert.match(msg, /Supported: \{\{fullName\}\}, \{\{email\}\}, \{\{phone\}\}/);
});

test('a hostile template cannot produce an enormous error message', () => {
  const many = Array.from({ length: 50 }, (_, i) => `{{x${i}}}`).join('');
  const msg = unknownPlaceholderMessage('body', many);
  assert.match(msg, /and 30 more/);
  assert.ok(msg.length < 500, `message is ${msg.length} chars`);
  const long = `{{${'a'.repeat(5000)}}}`;
  assert.ok(unknownPlaceholderMessage('body', long).length < 300);
});

// ───────────── validation at create / update ─────────────
const fieldErrors = (r) => r.error.flatten().fieldErrors;

test('create: unknown placeholder in body -> rejected, listing the name', () => {
  const r = createCampaignSchema.safeParse({ ...base, body: 'Dear {{guestName}}' });
  assert.ok(!r.success);
  assert.match(fieldErrors(r).body[0], /\{\{guestName\}\}/);
  assert.match(fieldErrors(r).body[0], /Supported:/);
});

test('create: unknown placeholder in subject -> rejected on the subject field; both fields are reported together', () => {
  const r = createCampaignSchema.safeParse({ ...base, subject: 'Hi {{nick}}', body: 'Bye {{city}}' });
  assert.ok(!r.success);
  assert.match(fieldErrors(r).subject[0], /\{\{nick\}\}/);
  assert.match(fieldErrors(r).body[0], /\{\{city\}\}/);
});

test('create: every supported placeholder passes, with or without spaces', () => {
  const r = createCampaignSchema.safeParse({ ...base, subject: 'Hi {{ fullName }}', body: '{{fullName}} {{ email }} {{phone}}' });
  assert.ok(r.success, JSON.stringify(r.error?.flatten()));
});

test('update: the same rule applies to the update path (body and subject)', () => {
  assert.ok(!updateCampaignSchema.safeParse({ body: 'x {{nope}}' }).success);
  assert.ok(!updateCampaignSchema.safeParse({ subject: 'x {{nope}}' }).success);
  assert.ok(updateCampaignSchema.safeParse({ body: 'x {{ fullName }}', subject: 'ok {{email}}' }).success);
  assert.ok(updateCampaignSchema.safeParse({ name: 'only the name' }).success);
  assert.ok(updateCampaignSchema.safeParse({ subject: null, channel: 'sms' }).success);
});

// ───────────── one source of truth ─────────────
test('every supported placeholder is accepted by the validator AND replaced by the renderer', () => {
  for (const name of SUPPORTED_PLACEHOLDERS) {
    const text = `a {{${name}}} b`;
    assert.ok(createCampaignSchema.safeParse({ ...base, body: text }).success, `${name} must validate`);
    assert.strictEqual(renderTemplate(text, { [name]: 'VALUE' }), 'a VALUE b', `${name} must render`);
  }
});

test('every supported placeholder is a real Contact field in schema.prisma (list cannot drift from the model)', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const model = schema.match(/model\s+Contact\s*\{([^}]*)\}/)[1];
  for (const name of SUPPORTED_PLACEHOLDERS) {
    assert.match(model, new RegExp(`^\\s*${name}\\s`, 'm'), `Contact.${name} not found`);
  }
});
