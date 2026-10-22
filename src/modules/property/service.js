const propertyRepository = require('./repository');
const pipelinesRepository = require('../pipelines/repository');
const { NotFoundError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function createProperty(data, actingUser) {
  const property = await propertyRepository.createWithOwner(data, actingUser.id);
  await pipelinesRepository.ensureDefaults(property.id);
  await logAudit({
    propertyId: property.id,
    userId: actingUser?.id,
    action: 'property.created',
    entityType: 'Property',
    entityId: property.id,
  });
  return property;
}

async function getProperty(id) {
  const property = await propertyRepository.findById(id);
  if (!property) throw new NotFoundError('Property');
  return property;
}

async function getPropertyForUser(id, userId) {
  const property = await propertyRepository.findByIdForUser(id, userId);
  if (!property) throw new NotFoundError('Property');
  return property;
}

function listProperties() {
  return propertyRepository.list();
}

// Phase 5: the route-facing function now — see repository.js's listForUser
// comment for why the previous unscoped listing was a gap worth closing.
function listPropertiesForUser(userId) {
  return propertyRepository.listForUser(userId);
}

async function updateProperty(id, data, actingUser) {
  await getProperty(id); // 404s if missing
  const property = await propertyRepository.update(id, data);
  await logAudit({
    propertyId: id,
    userId: actingUser?.id,
    action: 'property.updated',
    entityType: 'Property',
    entityId: id,
    metadata: data,
  });
  return property;
}

module.exports = {
  createProperty,
  getProperty,
  getPropertyForUser,
  listProperties,
  listPropertiesForUser,
  updateProperty,
};
