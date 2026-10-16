const { z } = require('zod');

/**
 * Provider-neutral delivery event contract. Any provider (SES, SendGrid, Mailgun, a plain SMTP
 * bounce parser) can be mapped onto this with a few lines in a small adapter.
 *
 *   POST /public/delivery-events/:propertyId?sig=...
 *   { "events": [ { "type": "bounce", "bounceType": "hard", "address": "a@b.com", "messageId": "...", "reason": "..." } ] }
 */
const eventSchema = z
  .object({
    type: z.enum(['delivered', 'bounce', 'complaint']),
    bounceType: z.enum(['hard', 'soft']).default('hard'), // only used when type = bounce
    address: z.string().trim().email().max(254).optional(),
    recipientId: z.string().max(100).optional(), // our CampaignRecipient id, if the provider echoes it
    messageId: z.string().max(500).optional(), // provider/SMTP message id
    reason: z.string().max(500).optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine((e) => e.address || e.recipientId || e.messageId, {
    message: 'an event needs at least one of address, recipientId or messageId',
  });

const deliveryEventsSchema = z.object({
  events: z.array(eventSchema).min(1).max(500),
});

module.exports = { deliveryEventsSchema };
