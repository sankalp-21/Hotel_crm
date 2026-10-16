const service = require('./service');

async function receive(req, res) {
  const summary = await service.applyEvents(req.params.propertyId, req.body.events);
  res.json(summary); // 200 even when nothing matched: providers retry on errors, and that wouldn't help
}

module.exports = { receive };
