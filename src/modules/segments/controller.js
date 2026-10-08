const segmentsService = require('./service');

async function create(req, res) {
  const segment = await segmentsService.createSegment(req.body, req.user);
  res.status(201).json(segment);
}

async function getOne(req, res) {
  const segment = await segmentsService.getSegment(req.params.id, req.propertyId);
  res.json(segment);
}

async function search(req, res) {
  const result = await segmentsService.searchSegments({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function update(req, res) {
  const segment = await segmentsService.updateSegment(
    req.params.id,
    req.propertyId,
    req.body,
    req.user
  );
  res.json(segment);
}

async function preview(req, res) {
  const result = await segmentsService.previewSegment(req.params.id, req.propertyId, req.query);
  res.json(result);
}

module.exports = { create, getOne, search, update, preview };
