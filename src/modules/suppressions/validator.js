const { z } = require('zod');

const channelEnum = z.enum(['email', 'sms']);
const reasonEnum = z.enum(['manual', 'unsubscribed', 'bounced', 'complaint']);

// Staff can only add *manual* entries. unsubscribed/bounced/complaint are written by the system
// (unsubscribe link, delivery tracking), so they can't be forged or mislabelled through the API.
const createSuppressionSchema = z
  .object({
    propertyId: z.string().uuid().optional(),
    channel: channelEnum.default('email'),
    address: z.string().trim().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.channel === 'email' && !z.string().email().safeParse(data.address).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'address must be a valid email', path: ['address'] });
    }
  });

const searchSuppressionSchema = z.object({
  channel: channelEnum.optional(),
  reason: reasonEnum.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createSuppressionSchema, searchSuppressionSchema };
