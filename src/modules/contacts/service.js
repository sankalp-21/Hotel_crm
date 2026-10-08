const contactsRepository = require('./repository');
const companiesRepository = require('../companies/repository');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function assertCompanyInProperty(companyId, propertyId) {
  if (!companyId) return;
  const company = await companiesRepository.findById(companyId);
  if (!company) throw new NotFoundError('Company');
  if (company.propertyId !== propertyId) {
    throw new ValidationError('Company does not belong to this property');
  }
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
  const contact = await contactsRepository.findById(id);
  if (!contact) throw new NotFoundError('Contact');
  if (contact.propertyId !== propertyId) {
    throw new ForbiddenError('Contact does not belong to this property');
  }
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

  const contact = await contactsRepository.update(id, data);
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
