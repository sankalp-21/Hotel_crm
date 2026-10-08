const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const { signRefreshToken, verifyRefreshToken, hashToken } = require('../src/shared/auth/tokens');

test('refresh tokens issued in the same second for the same user are unique', () => {
  const user = { id: '00000000-0000-0000-0000-000000000099' };
  const tokens = Array.from({ length: 50 }, () => signRefreshToken(user));
  const hashes = new Set(tokens.map(hashToken));
  assert.strictEqual(hashes.size, 50);
});

test('refresh token still verifies and carries the subject', () => {
  const user = { id: '00000000-0000-0000-0000-000000000099' };
  const payload = verifyRefreshToken(signRefreshToken(user));
  assert.strictEqual(payload.sub, user.id);
  assert.ok(payload.jti);
});
