/**
 * Suppression addresses are compared exactly, so both sides must be normalised the same way.
 * Email: trimmed + lower-cased. Phone: trimmed with internal spaces/dashes/parens removed.
 */
function normalizeAddress(channel, address) {
  const raw = String(address ?? '').trim();
  if (channel === 'email') return raw.toLowerCase();
  return raw.replace(/[\s\-().]/g, '');
}

module.exports = { normalizeAddress };
