const companiesRepository = require('./repository');
const { NotFoundError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function createCompany(data, actingUser) {
  const payload = { ...data };
  if (payload.website === '') delete payload.website;

  const company = await companiesRepository.create(payload);
  await logAudit({
    propertyId: company.propertyId,
    userId: actingUser?.id,
    action: 'company.created',
    entityType: 'Company',
    entityId: company.id,
  });
  return company;
}

async function getCompany(id, propertyId) {
  const company = await companiesRepository.findById(id, propertyId);
  if (!company) throw new NotFoundError('Company');
  return company;
}

async function searchCompanies({ propertyId, search, type, page, pageSize }) {
  const [items, total] = await companiesRepository.search({
    propertyId,
    search,
    type,
    page,
    pageSize,
  });
  return { items, total, page, pageSize };
}

async function updateCompany(id, propertyId, data, actingUser) {
  await getCompany(id, propertyId);
  const payload = { ...data };
  if (payload.website === '') payload.website = null;

  const company = await companiesRepository.update(id, propertyId, payload);
  await logAudit({
    propertyId,
    userId: actingUser?.id,
    action: 'company.updated',
    entityType: 'Company',
    entityId: id,
    metadata: data,
  });
  return company;
}

module.exports = { createCompany, getCompany, searchCompanies, updateCompany };
