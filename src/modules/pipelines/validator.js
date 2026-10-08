const { z } = require('zod');

const createStageSchema = z
  .object({
    propertyId: z.string().uuid(),
    name: z.string().min(1),
    position: z.number().int().nonnegative().optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((d) => !(d.isWon && d.isLost), {
    message: 'A stage cannot be both won and lost',
    path: ['isWon'],
  });

const updateStageSchema = z
  .object({
    name: z.string().min(1).optional(),
    position: z.number().int().nonnegative().optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((d) => !(d.isWon === true && d.isLost === true), {
    message: 'A stage cannot be both won and lost',
    path: ['isWon'],
  });

module.exports = { createStageSchema, updateStageSchema };
