const { z } = require('zod');

const userIdParams = z.object({ id: z.string().uuid() });
const statusSchema = z.object({ isActive: z.boolean() });
const listUsersSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const outboxIdParams = z.object({ id: z.string().uuid() });
const listOutboxSchema = z.object({
  status: z.enum(['pending', 'processing', 'published', 'failed']).optional(),
  eventType: z.string().optional(),
  aggregateId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { userIdParams, statusSchema, listUsersSchema, outboxIdParams, listOutboxSchema };
