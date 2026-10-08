const contactsRepository = require('./repository');
const companiesRepository = require('../companies/repository');
const { NotFoundError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function assertCompanyInProperty(companyId, propertyId) {
  if (!companyId) return;
  // Scoped lookup: a company from another property is indistinguishable from a missing one.
  const company = await companiesRepository.findById(companyId, propertyId);
  if (!company) throw new NotFoundError('Company');
}

async function createContact(data, actingUser) {
  await assertCompanyInProperty(data.companyId, data.propertyId);

  const contact = await contactsRepository.create(data);
  await logAudit({
    propertyId: contact.propertyId,
    userId: actingUser?.id,
    action: 'contact.created',
    entityType: 'Contact',
    entityId: contact.id,
  });
  return contact;
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
  await getContact(id, propertyId);
  if (data.companyId !== undefined) {
    await assertCompanyInProperty(data.companyId, propertyId);
  }

  const contact = await contactsRepository.update(id, propertyId, data);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'contact.updated',
    entityType: 'Contact',
    entityId: id,
    metadata: data,
  });
  return contact;
}

module.exports = { createContact, getContact, searchContacts, updateContact };
