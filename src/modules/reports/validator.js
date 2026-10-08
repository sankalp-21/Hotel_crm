const { z } = require('zod');

const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

module.exports = { dateRangeSchema };
