const { z } = require('zod');

const segmentFiltersSchema = z
  .object({
    status: z.enum(['lead', 'customer', 'inactive']).optional(),
    source: z.string().min(1).optional(),
    companyId: z.string().uuid().optional(),
    tags: z.array(z.string().min(1)).optional(),
    hasEmail: z.boolean().optional(),
    search: z.string().optional(),
    createdBefore: z.coerce.date().optional(),
    createdAfter: z.coerce.date().optional(),
  })
  .default({});

const createSegmentSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  filters: segmentFiltersSchema,
});

const updateSegmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  filters: segmentFiltersSchema.optional(),
});

const searchSegmentSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const previewSegmentSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = {
  segmentFiltersSchema,
  createSegmentSchema,
  updateSegmentSchema,
  searchSegmentSchema,
  previewSegmentSchema,
};
