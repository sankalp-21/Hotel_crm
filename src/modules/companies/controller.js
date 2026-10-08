const companiesService = require('./service');

async function create(req, res) {
  const company = await companiesService.createCompany(req.body, req.user);
  res.status(201).json(company);
}

async function getOne(req, res) {
  const company = await companiesService.getCompany(req.params.id, req.propertyId);
  res.json(company);
}

async function search(req, res) {
  const result = await companiesService.searchCompanies({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function update(req, res) {
  const company = await companiesService.updateCompany(req.params.id, req.propertyId, req.body, req.user);
  res.json(company);
}

module.exports = { create, getOne, search, update };
