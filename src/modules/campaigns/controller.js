const campaignsService = require('./service');

async function create(req, res) {
  const campaign = await campaignsService.createCampaign(req.body, req.user);
  res.status(201).json(campaign);
}

async function getOne(req, res) {
  const campaign = await campaignsService.getCampaign(req.params.id, req.propertyId);
  res.json(campaign);
}

async function search(req, res) {
  const result = await campaignsService.searchCampaigns({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function update(req, res) {
  const campaign = await campaignsService.updateCampaign(
    req.params.id,
    req.propertyId,
    req.body,
    req.user
  );
  res.json(campaign);
}

async function send(req, res) {
  const campaign = await campaignsService.sendCampaign(req.params.id, req.propertyId, req.user);
  res.json(campaign);
}

module.exports = { create, getOne, search, update, send };
