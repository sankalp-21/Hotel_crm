const { z } = require('zod');

const createCampaignSchema = z
  .object({
    propertyId: z.string().uuid(),
    segmentId: z.string().uuid(),
    name: z.string().min(1),
    channel: z.enum(['email', 'sms']).default('email'),
    subject: z.string().min(1).optional(),
    body: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.channel === 'email' && !data.subject) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'subject is required for email campaigns', path: ['subject'] });
    }
  });

const updateCampaignSchema = z
  .object({
    name: z.string().min(1).optional(),
    segmentId: z.string().uuid().optional(),
    channel: z.enum(['email', 'sms']).optional(),
    subject: z.string().min(1).nullable().optional(),
    body: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.channel === 'email' && data.subject === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'subject is required for email campaigns', path: ['subject'] });
    }
  });

const searchCampaignSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['draft', 'sending', 'sent', 'failed', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const recipientsQuerySchema = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'skipped', 'failed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

module.exports = {
  recipientsQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
  searchCampaignSchema,
};
