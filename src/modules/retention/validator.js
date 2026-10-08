const { z } = require('zod');

const updatePolicySchema = z.object({
  auditLogRetentionDays: z.number().int().positive().optional(),
  contactDocumentRetentionDays: z.number().int().positive().optional(),
});

module.exports = { updatePolicySchema };
