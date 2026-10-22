/**
 * Campaign template placeholders: ONE parser used by validation (create / update / send),
 * rendering (real sends, preview, test-send) so what is accepted is exactly what is rendered.
 *
 * Syntax: {{name}} or {{ name }} (whitespace inside the braces is ignored).
 * Anything between double braces that is not a supported name is "unknown".
 */
const SUPPORTED_PLACEHOLDERS = Object.freeze(['fullName', 'email', 'phone']);
const SUPPORTED = new Set(SUPPORTED_PLACEHOLDERS);

// Any {{ ... }} block with no braces inside it. Global: use only through String#replace / matchAll.
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

const MAX_REPORTED = 20;
const MAX_NAME_LEN = 40;

/** Distinct unknown placeholder names in the given templates, in order of first appearance. */
function findUnknownPlaceholders(...templates) {
  const seen = new Set();
  for (const template of templates) {
    if (typeof template !== 'string') continue;
    for (const match of template.matchAll(PLACEHOLDER_RE)) {
      const name = match[1].trim();
      if (!SUPPORTED.has(name)) seen.add(name.slice(0, MAX_NAME_LEN));
    }
  }
  return [...seen];
}

/** "{{a}}, {{b}}" for messages (capped, so a hostile template can't make a giant error). */
function formatPlaceholders(names) {
  const shown = names.slice(0, MAX_REPORTED).map((n) => `{{${n}}}`);
  if (names.length > MAX_REPORTED) shown.push(`and ${names.length - MAX_REPORTED} more`);
  return shown.join(', ');
}

function supportedList() {
  return SUPPORTED_PLACEHOLDERS.map((n) => `{{${n}}}`).join(', ');
}

/** The error text for a field that contains unknown placeholders, or null when it is fine. */
function unknownPlaceholderMessage(field, template) {
  const unknown = findUnknownPlaceholders(template);
  if (unknown.length === 0) return null;
  return `Unknown placeholder(s) in ${field}: ${formatPlaceholders(unknown)}. Supported: ${supportedList()}`;
}

/**
 * Replace supported placeholders with the contact's values in a SINGLE pass, so a value that itself
 * contains "{{email}}" (e.g. a contact named that way) is never expanded a second time. Unknown
 * placeholders are left as written: rendering never throws mid-send (validation rejects them earlier).
 */
function renderTemplate(template, contact) {
  return String(template).replace(PLACEHOLDER_RE, (whole, inner) => {
    const name = inner.trim();
    return SUPPORTED.has(name) ? String(contact?.[name] ?? '') : whole;
  });
}

module.exports = {
  SUPPORTED_PLACEHOLDERS,
  renderTemplate,
  findUnknownPlaceholders,
  unknownPlaceholderMessage,
  formatPlaceholders,
  supportedList,
};
