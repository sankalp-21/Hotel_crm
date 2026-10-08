const propertyService = require('./service');

async function create(req, res) {
  const property = await propertyService.createProperty(req.body, req.user);
  res.status(201).json(property);
}

async function getOne(req, res) {
  const property = await propertyService.getPropertyForUser(req.params.id, req.user.id);
  res.json(property);
}

async function list(req, res) {
  const properties = await propertyService.listPropertiesForUser(req.user.id);
  res.json({ items: properties });
}

async function update(req, res) {
  const property = await propertyService.updateProperty(req.params.id, req.body, req.user);
  res.json(property);
}

module.exports = { create, getOne, list, update };
