const { z } = require('zod');

const createPropertySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  timezone: z.string().default('UTC'),
  currency: z.string().length(3).default('USD'),
});

const updatePropertySchema = createPropertySchema.partial();

module.exports = { createPropertySchema, updatePropertySchema };
