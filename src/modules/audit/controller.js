const auditService = require('./service');

async function list(req, res) {
  const { entityType, entityId, page, pageSize } = req.query;
  const result = await auditService.listAuditLogs({
    propertyId: req.propertyId,
    entityType,
    entityId,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  res.json(result);
}

module.exports = { list };
