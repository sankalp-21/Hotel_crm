const dealsService = require('./service');

async function create(req, res) {
  const deal = await dealsService.createDeal(req.body, req.user);
  res.status(201).json(deal);
}

async function getOne(req, res) {
  const deal = await dealsService.getDeal(req.params.id, req.propertyId);
  res.json(deal);
}

async function search(req, res) {
  const result = await dealsService.searchDeals({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function update(req, res) {
  const deal = await dealsService.updateDeal(req.params.id, req.propertyId, req.body, req.user);
  res.json(deal);
}

async function transition(req, res) {
  const deal = await dealsService.transitionDeal(req.params.id, req.propertyId, req.body, req.user);
  res.json(deal);
}

module.exports = { create, getOne, search, update, transition };
