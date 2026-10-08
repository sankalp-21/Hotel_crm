const segmentsRepository = require('./repository');
const { NotFoundError, ForbiddenError, ConflictError } = require('../../shared/errors/AppError');
const { logAudit } = require('../audit/service');

async function createSegment(data, actingUser) {
  try {
    const segment = await segmentsRepository.create({
      ...data,
      createdBy: actingUser?.id ?? null,
    });
    await logAudit({
      propertyId: segment.propertyId,
      userId: actingUser?.id,
      action: 'segment.created',
      entityType: 'Segment',
      entityId: segment.id,
      metadata: { name: segment.name },
    });
    return segment;
  } catch (err) {
    if (err.code === 'P2002') throw new ConflictError('A segment with this name already exists');
    throw err;
  }
}

async function getSegment(id, propertyId) {
  const segment = await segmentsRepository.findById(id);
  if (!segment) throw new NotFoundError('Segment');
  if (segment.propertyId !== propertyId) {
    throw new ForbiddenError('Segment does not belong to this property');
  }
  return segment;
}

async function searchSegments(query) {
  const [items, total] = await segmentsRepository.search(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function updateSegment(id, propertyId, data, actingUser) {
  await getSegment(id, propertyId);
  try {
    const segment = await segmentsRepository.update(id, data);
    await logAudit({
      propertyId,
      userId: actingUser?.id,
      action: 'segment.updated',
      entityType: 'Segment',
      entityId: id,
      metadata: data,
    });
    return segment;
  } catch (err) {
    if (err.code === 'P2002') throw new ConflictError('A segment with this name already exists');
    throw err;
  }
}

async function previewSegment(id, propertyId, { page = 1, pageSize = 20 } = {}) {
  const segment = await getSegment(id, propertyId);
  const [items, total] = await segmentsRepository.resolveContacts(propertyId, segment.filters, {
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { segment, items, total, page, pageSize };
}

module.exports = {
  createSegment,
  getSegment,
  searchSegments,
  updateSegment,
  previewSegment,
};
