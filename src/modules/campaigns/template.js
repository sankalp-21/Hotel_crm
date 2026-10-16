function renderTemplate(template, contact) {
  return String(template)
    .replaceAll('{{fullName}}', contact.fullName || '')
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '');
}

module.exports = { renderTemplate };
