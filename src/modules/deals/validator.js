const { z } = require('zod');

const createDealSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1),
  stageId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().min(1).max(8).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  source: z.string().min(1).optional(),
  notes: z.string().optional(),
});

const updateDealSchema = createDealSchema.partial().omit({ propertyId: true, stageId: true });

const searchDealSchema = z.object({
  search: z.string().optional(),
  stageId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  outcome: z.enum(['open', 'won', 'lost']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const transitionDealSchema = z.object({
  stageId: z.string().uuid(),
});

module.exports = {
  createDealSchema,
  updateDealSchema,
  searchDealSchema,
  transitionDealSchema,
};
