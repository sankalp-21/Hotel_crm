const contactsRepository = require('./repository');
const companiesRepository = require('../companies/repository');
const { NotFoundError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function assertCompanyInProperty(companyId, propertyId) {
  if (!companyId) return;
  // Scoped lookup: a company from another property is indistinguishable from a missing one.
  const company = await companiesRepository.findById(companyId, propertyId);
  if (!company) throw new NotFoundError('Company');
}

async function createContact(data, actingUser) {
  await assertCompanyInProperty(data.companyId, data.propertyId);

  const { consentSource, ...rest } = data;
  // A new contact is only opted in if the caller says so (and says where consent came from).
  const consent = rest.marketingConsent === true;
  const contact = await contactsRepository.create({
    ...rest,
    marketingConsent: consent,
    consentSource: consent ? consentSource : null,
    consentUpdatedAt: consent ? new Date() : null,
  });
  await logAudit({
    propertyId: contact.propertyId,
    userId: actingUser?.id,
    action: 'contact.created',
    entityType: 'Contact',
    entityId: contact.id,
  });
  if (consent) {
    await logConsentChange(contact, actingUser, { from: false, to: true, source: consentSource });
  }
  return contact;
}

// Consent changes are audited as booleans + source only: no email/name/phone in the log.
function logConsentChange(contact, actingUser, { from, to, source }) {
  return logAudit({
    propertyId: contact.propertyId,
    userId: actingUser?.id,
    action: to ? 'contact.consent_granted' : 'contact.consent_revoked',
    entityType: 'Contact',
    entityId: contact.id,
    metadata: { from, to, source: source ?? null },
  });
}

async function getContact(id, propertyId) {
  const contact = await contactsRepository.findById(id, propertyId);
  if (!contact) throw new NotFoundError('Contact');
  return contact;
}

async function searchContacts(query) {
  const [items, total] = await contactsRepository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function updateContact(id, propertyId, data, actingUser) {
  const current = await getContact(id, propertyId);
  if (data.companyId !== undefined) {
    await assertCompanyInProperty(data.companyId, propertyId);
  }

  // Consent provenance only changes when the flag actually flips; a stray consentSource is ignored.
  const { marketingConsent, consentSource, ...rest } = data;
  const update = { ...rest };
  const consentChanged = marketingConsent !== undefined && marketingConsent !== current.marketingConsent;

  if (consentChanged) {
    if (marketingConsent === true && current.unsubscribedAt) {
      // The contact opted out themselves. Staff flipping a flag must not override that;
      // they need to re-subscribe via their own action (not built yet), not via the CRM UI.
      throw new ConflictError('This contact unsubscribed and cannot be re-subscribed by staff');
    }
    update.marketingConsent = marketingConsent;
    update.consentSource = marketingConsent ? consentSource : (consentSource ?? 'staff_revocation');
    update.consentUpdatedAt = new Date();
  }

  // A bounce belongs to an ADDRESS, not to the person. When the email changes, the new address starts
  // clean (the old one stays on the suppression list, so it is still never mailed).
  const norm = (e) => String(e ?? '').trim().toLowerCase();
  if (rest.email !== undefined && current.emailBounced && norm(rest.email) !== norm(current.email)) {
    update.emailBounced = false;
  }

  const contact = await contactsRepository.update(id, propertyId, update);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'contact.updated',
    entityType: 'Contact',
    entityId: id,
    metadata: rest,
  });
  if (consentChanged) {
    await logConsentChange(contact, actingUser, {
      from: current.marketingConsent,
      to: marketingConsent,
      source: update.consentSource,
    });
  }
  return contact;
}

module.exports = { createContact, getContact, searchContacts, updateContact };
