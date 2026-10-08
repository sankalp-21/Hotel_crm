const { z } = require('zod');

const companyTypeEnum = z.enum(['corporate', 'travel_agency', 'event_planner', 'other']);

const createCompanySchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(1),
  type: companyTypeEnum.optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const updateCompanySchema = createCompanySchema.partial().omit({ propertyId: true });

const searchCompanySchema = z.object({
  search: z.string().optional(),
  type: companyTypeEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createCompanySchema, updateCompanySchema, searchCompanySchema };
