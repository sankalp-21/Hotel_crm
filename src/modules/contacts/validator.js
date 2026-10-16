const { z } = require('zod');

const contactStatusEnum = z.enum(['lead', 'customer', 'inactive']);

const consentRule = (data, ctx) => {
  if (data.marketingConsent === true && !data.consentSource) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'consentSource is required when marketingConsent is true (where/how consent was given)',
      path: ['consentSource'],
    });
  }
};

const contactBaseSchema = z.object({
  propertyId: z.string().uuid(),
  companyId: z.string().uuid().nullable().optional(),
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nationality: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().min(1).optional(),
  status: contactStatusEnum.optional(),
  tags: z.array(z.string().min(1)).optional(),
  preferences: z.record(z.unknown()).optional(),
  // Consent is recorded explicitly. unsubscribedAt / emailBounced are system-owned and not accepted here.
  marketingConsent: z.boolean().optional(),
  consentSource: z.string().trim().min(1).max(100).optional(),
});

const createContactSchema = contactBaseSchema.superRefine(consentRule);
const updateContactSchema = contactBaseSchema
  .partial()
  .omit({ propertyId: true })
  .superRefine(consentRule);

const searchContactSchema = z.object({
  search: z.string().optional(),
  status: contactStatusEnum.optional(),
  source: z.string().optional(),
  companyId: z.string().uuid().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createContactSchema, updateContactSchema, searchContactSchema };
