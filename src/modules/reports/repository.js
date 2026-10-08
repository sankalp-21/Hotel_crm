const prisma = require('../../infrastructure/db/prisma');

function dealCreatedFilter(propertyId, from, to) {
  return {
    propertyId,
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }
      : {}),
  };
}

function dealClosedFilter(propertyId, from, to) {
  return {
    propertyId,
    closedAt: {
      not: null,
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    },
  };
}

async function countContactsByStatus(propertyId) {
  const rows = await prisma.contact.groupBy({
    by: ['status'],
    where: { propertyId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

async function countDealsByOutcome(propertyId, from, to) {
  const base = dealCreatedFilter(propertyId, from, to);
  const [open, won, lost, total] = await Promise.all([
    prisma.deal.count({ where: { ...base, stage: { isWon: false, isLost: false } } }),
    prisma.deal.count({ where: { ...base, stage: { isWon: true } } }),
    prisma.deal.count({ where: { ...base, stage: { isLost: true } } }),
    prisma.deal.count({ where: base }),
  ]);
  return { open, won, lost, total };
}

async function pipelineFunnel(propertyId, from, to) {
  const stages = await prisma.pipelineStage.findMany({
    where: { propertyId },
    orderBy: { position: 'asc' },
  });

  const base = dealCreatedFilter(propertyId, from, to);
  const deals = await prisma.deal.findMany({
    where: base,
    select: { stageId: true, value: true },
  });

  const byStage = new Map(stages.map((s) => [s.id, { count: 0, value: 0 }]));
  for (const d of deals) {
    const bucket = byStage.get(d.stageId);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += d.value ? Number(d.value) : 0;
  }

  const total = deals.length;
  return stages.map((stage) => {
    const stats = byStage.get(stage.id) || { count: 0, value: 0 };
    return {
      stageId: stage.id,
      name: stage.name,
      position: stage.position,
      isWon: stage.isWon,
      isLost: stage.isLost,
      dealCount: stats.count,
      totalValue: stats.value,
      shareOfPipeline: total > 0 ? Math.round((stats.count / total) * 1000) / 10 : 0,
    };
  });
}

async function sumDealValue(where) {
  const agg = await prisma.deal.aggregate({
    where,
    _sum: { value: true },
    _count: { _all: true },
  });
  return {
    count: agg._count._all,
    totalValue: agg._sum.value ? Number(agg._sum.value) : 0,
  };
}

async function forecast(propertyId, from, to) {
  const open = await sumDealValue({
    propertyId,
    stage: { isWon: false, isLost: false },
  });

  const wonClosed = await sumDealValue({
    ...dealClosedFilter(propertyId, from, to),
    stage: { isWon: true },
  });

  const lostClosed = await sumDealValue({
    ...dealClosedFilter(propertyId, from, to),
    stage: { isLost: true },
  });

  const closingSoon = await sumDealValue({
    propertyId,
    stage: { isWon: false, isLost: false },
    expectedCloseDate: {
      gte: from || new Date(),
      ...(to && { lte: to }),
    },
  });

  const closedTotal = wonClosed.count + lostClosed.count;
  const winRate = closedTotal > 0 ? Math.round((wonClosed.count / closedTotal) * 1000) / 10 : null;

  return {
    openPipeline: open,
    wonInPeriod: wonClosed,
    lostInPeriod: lostClosed,
    expectedToCloseInPeriod: closingSoon,
    winRatePercent: winRate,
  };
}

async function dashboardCounts(propertyId) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    contactsByStatus,
    dealsByOutcome,
    companies,
    openTasks,
    campaignsSent,
    recentActivities,
  ] = await Promise.all([
    countContactsByStatus(propertyId),
    countDealsByOutcome(propertyId),
    prisma.company.count({ where: { propertyId } }),
    prisma.activity.count({ where: { propertyId, status: 'open', type: 'task' } }),
    prisma.campaign.count({ where: { propertyId, status: 'sent' } }),
    prisma.activity.count({ where: { propertyId, createdAt: { gte: weekAgo } } }),
  ]);

  const openPipeline = await sumDealValue({
    propertyId,
    stage: { isWon: false, isLost: false },
  });

  return {
    contactsByStatus,
    deals: dealsByOutcome,
    companies,
    openTasks,
    campaignsSent,
    activitiesLast7Days: recentActivities,
    openPipelineValue: openPipeline.totalValue,
    openPipelineDeals: openPipeline.count,
  };
}

module.exports = {
  pipelineFunnel,
  forecast,
  dashboardCounts,
  countDealsByOutcome,
};
