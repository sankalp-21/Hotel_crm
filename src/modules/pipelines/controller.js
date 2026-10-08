const pipelinesService = require('./service');

async function list(req, res) {
  const stages = await pipelinesService.listStages(req.propertyId);
  res.json({ items: stages });
}

async function create(req, res) {
  const stage = await pipelinesService.createStage(req.body, req.user);
  res.status(201).json(stage);
}

async function update(req, res) {
  const stage = await pipelinesService.updateStage(req.params.id, req.propertyId, req.body, req.user);
  res.json(stage);
}

module.exports = { list, create, update };
