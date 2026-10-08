const reportsService = require('./service');

async function dashboard(req, res) {
  const data = await reportsService.getDashboard(req.propertyId);
  res.json({ propertyId: req.propertyId, ...data });
}

async function pipeline(req, res) {
  const funnel = await reportsService.getPipelineReport(req.propertyId, req.query);
  const outcomes = await reportsService.getForecastReport(req.propertyId, req.query).then((r) => r.outcomes);
  res.json({
    propertyId: req.propertyId,
    period: { from: req.query.from ?? null, to: req.query.to ?? null },
    outcomes,
    stages: funnel,
  });
}

async function forecast(req, res) {
  const data = await reportsService.getForecastReport(req.propertyId, req.query);
  res.json({ propertyId: req.propertyId, ...data });
}

module.exports = { dashboard, pipeline, forecast };
