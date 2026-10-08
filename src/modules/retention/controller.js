const retentionService = require('./service');

async function getPolicy(req, res) {
  const policy = await retentionService.getPolicy(req.propertyId);
  res.json(policy);
}

async function updatePolicy(req, res) {
  const policy = await retentionService.updatePolicy(req.propertyId, req.body, req.user);
  res.json(policy);
}

async function purge(req, res) {
  const result = await retentionService.runPurge(req.propertyId, req.user);
  res.json(result);
}

module.exports = { getPolicy, updatePolicy, purge };
