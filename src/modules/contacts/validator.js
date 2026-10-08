const { z } = require('zod');

const contactStatusEnum = z.enum(['lead', 'customer', 'inactive']);

const createContactSchema = z.object({
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
});

const updateContactSchema = createContactSchema.partial().omit({ propertyId: true });

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
