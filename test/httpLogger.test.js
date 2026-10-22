const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const pino = require('pino');

const { createHttpLogger, sanitizeUrl, reqSerializer } = require('../src/config/httpLogger');

const SECRET_BEARER = 'eyJhbGciOiJIUzI1NiJ9.SUPER-SECRET-JWT.signature';
const SECRET_SIG = 'f'.repeat(64);
const SECRET_TOKEN = 'eyJ2IjoxfQ.UNSUBSCRIBE-TOKEN-SECRET';

/** A real express app + real HTTP requests, with the log lines captured. */
async function captureLogs(requests) {
  const lines = [];
  const logger = pino({ level: 'info' }, { write: (s) => lines.push(s) });
  const app = express();
  app.use(createHttpLogger(logger));
  app.all('*', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    for (const { method = 'GET', path, headers = {} } of requests) {
      await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
        req.end();
      });
    }
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await new Promise((r) => server.close(r));
  }
  return lines.join('');
}

test('Authorization and cookie headers never reach the logs', async () => {
  const out = await captureLogs([
    { path: '/contacts', headers: { Authorization: `Bearer ${SECRET_BEARER}`, Cookie: 'session=SECRET-COOKIE', 'User-Agent': 'smoke-agent' } },
  ]);
  assert.ok(out.includes('/contacts'), 'the request is still logged');
  assert.ok(out.includes('smoke-agent'), 'harmless headers are kept');
  assert.ok(!out.includes('SUPER-SECRET-JWT'), 'bearer token leaked');
  assert.ok(!out.includes('SECRET-COOKIE'), 'cookie leaked');
});

test('webhook signature and unsubscribe token (query strings under /public) never reach the logs', async () => {
  const out = await captureLogs([
    { method: 'POST', path: `/public/delivery-events/abc123?sig=${SECRET_SIG}` },
    { method: 'POST', path: `/public/unsubscribe?token=${SECRET_TOKEN}` },
  ]);
  assert.ok(out.includes('/public/delivery-events/abc123'), 'path is still logged');
  assert.ok(out.includes('/public/unsubscribe'));
  assert.ok(!out.includes(SECRET_SIG), 'webhook secret leaked');
  assert.ok(!out.includes('UNSUBSCRIBE-TOKEN-SECRET'), 'unsubscribe token leaked');
});

test('ordinary query strings are kept for debugging (they carry no credentials)', async () => {
  const out = await captureLogs([{ path: '/contacts?search=ann&page=2' }]);
  assert.ok(out.includes('search=ann&page=2'));
});

test('sanitizeUrl: only /public URLs lose their query; no query is untouched', () => {
  assert.strictEqual(sanitizeUrl('/public/unsubscribe?token=x'), '/public/unsubscribe?[redacted]');
  assert.strictEqual(sanitizeUrl('/public/unsubscribe'), '/public/unsubscribe');
  assert.strictEqual(sanitizeUrl('/contacts?page=1'), '/contacts?page=1');
  assert.strictEqual(sanitizeUrl(undefined), undefined);
});

test('reqSerializer is an allow-list: unknown headers are dropped', () => {
  const out = reqSerializer({
    id: 'r1', method: 'GET', url: '/x', remoteAddress: '1.2.3.4',
    headers: { authorization: 'Bearer s', 'x-api-key': 'k', 'user-agent': 'ua', cookie: 'c' },
  });
  assert.deepStrictEqual(Object.keys(out.headers), ['user-agent']);
});
