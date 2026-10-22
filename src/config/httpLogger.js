const pinoHttp = require('pino-http');
const crypto = require('crypto');

/**
 * Request logging that never writes credentials.
 *
 * pino-http's default request serializer logs EVERY header and the full URL. That would put into the
 * logs: Authorization bearer tokens (a stolen log = stolen session), the per-hotel delivery-webhook
 * secret (`?sig=`) and unsubscribe tokens (`?token=`). So we log an allow-list instead:
 * method, path, request id, client address and a few harmless headers.
 */
const SAFE_HEADERS = ['user-agent', 'content-type', 'content-length', 'x-request-id'];

/** Public endpoints carry their credential in the query string, so it is dropped entirely there. */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  return url.startsWith('/public/') ? `${url.slice(0, q)}?[redacted]` : url;
}

function reqSerializer(req) {
  const headers = {};
  for (const name of SAFE_HEADERS) {
    if (req.headers && req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  return {
    id: req.id,
    method: req.method,
    url: sanitizeUrl(req.url),
    headers,
    remoteAddress: req.remoteAddress,
  };
}

function resSerializer(res) {
  return { statusCode: res.statusCode };
}

function genReqId(req, res) {
  const existing = req.headers['x-request-id'];
  const id = typeof existing === 'string' && existing ? existing : crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

function createHttpLogger(logger) {
  return pinoHttp({ logger, genReqId, serializers: { req: reqSerializer, res: resSerializer } });
}

module.exports = { createHttpLogger, reqSerializer, sanitizeUrl, SAFE_HEADERS };
