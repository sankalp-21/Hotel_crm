const service = require('./service');

async function create(req, res) {
  const { entry, created } = await service.addSuppression(req.propertyId, req.body, req.user);
  res.status(created ? 201 : 200).json(entry);
}

async function search(req, res) {
  const result = await service.searchSuppressions({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function remove(req, res) {
  await service.removeSuppression(req.params.id, req.propertyId, req.user);
  res.status(204).end();
}

module.exports = { create, search, remove };
