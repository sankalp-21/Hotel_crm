const { z } = require('zod');

const createPropertySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  timezone: z.string().default('UTC'),
  currency: z.string().length(3).default('USD'),
  // Max campaign messages per second for this hotel (null = server default)
  campaignSendRatePerSec: z.number().int().min(1).max(100).nullable().optional(),
});

const updatePropertySchema = createPropertySchema.partial();


// ─────────────────────────────────────────────
// Campaign sender identity (Phase 3.4)
// ─────────────────────────────────────────────
// A display name can't contain line breaks or the characters that delimit an address: that is how
// header-injection / display-name spoofing tricks are built. null clears a field.
const fromName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((v) => !/[\r\n\0<>"]/.test(v), 'name contains invalid characters');
const emailAddress = z.string().trim().toLowerCase().email().max(254);

const senderSettingsSchema = z
  .object({
    emailFromName: fromName.nullable().optional(),
    emailFromAddress: emailAddress.nullable().optional(),
    emailReplyTo: emailAddress.nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'provide at least one field' });

module.exports = {
  senderSettingsSchema, createPropertySchema, updatePropertySchema };
