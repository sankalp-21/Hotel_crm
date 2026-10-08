const reportsRepository = require('./repository');

function getDashboard(propertyId) {
  return reportsRepository.dashboardCounts(propertyId);
}

function getPipelineReport(propertyId, { from, to } = {}) {
  return reportsRepository.pipelineFunnel(propertyId, from, to);
}

async function getForecastReport(propertyId, { from, to } = {}) {
  const funnel = await reportsRepository.pipelineFunnel(propertyId, from, to);
  const forecast = await reportsRepository.forecast(propertyId, from, to);
  const outcomes = await reportsRepository.countDealsByOutcome(propertyId, from, to);

  return {
    period: { from: from ?? null, to: to ?? null },
    outcomes,
    forecast,
    funnel,
  };
}

module.exports = { getDashboard, getPipelineReport, getForecastReport };
