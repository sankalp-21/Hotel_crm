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
  res.status(202).json(campaign); // accepted: workers send in the background; poll GET /campaigns/:id
}

async function cancel(req, res) {
  const campaign = await campaignsService.cancelCampaign(req.params.id, req.propertyId, req.user);
  res.json(campaign);
}

async function retryFailed(req, res) {
  const campaign = await campaignsService.retryFailed(req.params.id, req.propertyId, req.user);
  res.status(202).json(campaign);
}

async function recipients(req, res) {
  const result = await campaignsService.listRecipients(req.params.id, req.propertyId, req.query);
  res.json(result);
}

module.exports = { create, getOne, search, update, send, cancel, retryFailed, recipients };
