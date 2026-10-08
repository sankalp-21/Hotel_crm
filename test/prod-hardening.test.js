const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TooManyRequestsError, ForbiddenError } = require('../src/shared/errors/AppError');
const { createUserSchema } = require('../src/modules/auth/validator');

test('TooManyRequestsError returns 429', () => {
  const err = new TooManyRequestsError();
  assert.equal(err.statusCode, 429);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.equal(err.isOperational, true);
});

test('ForbiddenError returns 403', () => {
  const err = new ForbiddenError('nope');
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'nope');
});

test('createUserSchema enforces stronger passwords', () => {
  const weak = createUserSchema.safeParse({
    email: 'a@b.com',
    password: 'short',
    fullName: 'Admin',
    propertyId: '00000000-0000-0000-0000-000000000001',
    roleId: '00000000-0000-0000-0000-000000000002',
  });
  assert.equal(weak.success, false);

  const ok = createUserSchema.safeParse({
    email: 'a@b.com',
    password: 'StrongPass123',
    fullName: 'Admin',
    propertyId: '00000000-0000-0000-0000-000000000001',
    roleId: '00000000-0000-0000-0000-000000000002',
  });
  assert.equal(ok.success, true);
});
