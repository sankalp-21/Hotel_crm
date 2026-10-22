const { escapeHtml } = require('../unsubscribe/pages');
const { renderTemplate } = require('./template');

/**
 * Build the final email for one recipient: personalised body + compliance footer
 * (hotel name, postal address, unsubscribe link) and the RFC 8058 one-click headers.
 * Plain-text and HTML parts are both produced; every interpolated value is escaped in the HTML part.
 */
function buildMarketingEmail({ renderedBody, property, unsubscribeUrl }) {
  const footerLines = [property.name, property.address].filter(Boolean);

  const text = `${renderedBody}\n\n--\n${footerLines.join('\n')}\nUnsubscribe: ${unsubscribeUrl}\n`;

  const html =
    `<div style="white-space:pre-wrap">${escapeHtml(renderedBody)}</div>` +
    `<hr><p style="font-size:12px;color:#666">${footerLines.map(escapeHtml).join('<br>')}<br>` +
    `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`;

  const headers = {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  return { text, html, headers };
}

/**
 * Render a campaign for ONE contact: subject, plain body and (for email) the full message with footer.
 * The single path used by real sends, preview and test-send, so they cannot drift apart.
 * `unsubscribeUrl` is required for email; previews pass an inert link (see buildInertUnsubscribeUrl).
 */
function renderCampaignMessage({ campaign, contact, property, unsubscribeUrl }) {
  const isEmail = campaign.channel === 'email';
  const subject = isEmail ? renderTemplate(campaign.subject, contact) : null;
  const body = renderTemplate(campaign.body, contact);
  const email = isEmail ? buildMarketingEmail({ renderedBody: body, property, unsubscribeUrl }) : null;
  return { subject, body, email };
}

module.exports = { buildMarketingEmail, renderCampaignMessage };
