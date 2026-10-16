const { verifyUnsubscribeToken } = require('./tokens');
const service = require('./service');
const pages = require('./pages');

function html(res, status, body) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).send(body);
}

// GET only shows a confirmation page: mail scanners and link-preview bots prefetch GET links,
// and must not be able to unsubscribe people by doing so.
async function show(req, res) {
  const ids = verifyUnsubscribeToken(req.query.token);
  if (!ids) return html(res, 400, pages.invalidPage());
  const hotelName = await service.getPropertyName(ids.propertyId);
  return html(res, 200, pages.confirmPage({ token: req.query.token, hotelName }));
}

// POST performs the opt-out. This is both the confirmation form and the RFC 8058 one-click
// endpoint (mail clients POST "List-Unsubscribe=One-Click" to the List-Unsubscribe URL).
async function perform(req, res) {
  const ids = verifyUnsubscribeToken(req.query.token);
  if (!ids) return html(res, 400, pages.invalidPage());
  await service.unsubscribeContact(ids);
  const hotelName = await service.getPropertyName(ids.propertyId);
  return html(res, 200, pages.donePage({ hotelName }));
}

module.exports = { show, perform };
