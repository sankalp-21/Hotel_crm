const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222;line-height:1.5}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.4rem;background:#222;color:#fff;cursor:pointer}</style>
</head><body>${inner}</body></html>`;
}

function confirmPage({ token, hotelName }) {
  const who = hotelName ? escapeHtml(hotelName) : 'this sender';
  return layout(
    'Unsubscribe',
    `<h1>Unsubscribe</h1><p>Stop receiving marketing emails from ${who}?</p>
<form method="post" action="/public/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Yes, unsubscribe me</button></form>`
  );
}

const donePage = ({ hotelName } = {}) =>
  layout(
    'Unsubscribed',
    `<h1>You're unsubscribed</h1><p>You will no longer receive marketing emails${
      hotelName ? ` from ${escapeHtml(hotelName)}` : ''
    }.</p>`
  );

const invalidPage = () =>
  layout('Link not valid', '<h1>Link not valid</h1><p>This unsubscribe link is invalid or has expired. Please use the link in a more recent email, or reply to the hotel directly.</p>');

module.exports = { escapeHtml, confirmPage, donePage, invalidPage };
