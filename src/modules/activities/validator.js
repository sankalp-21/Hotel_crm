const { z } = require('zod');

const activityTypeEnum = z.enum(['call', 'email', 'meeting', 'task', 'note']);
const activityStatusEnum = z.enum(['open', 'completed', 'cancelled']);

const createActivitySchema = z
  .object({
    propertyId: z.string().uuid(),
    type: activityTypeEnum,
    subject: z.string().min(1),
    body: z.string().optional(),
    contactId: z.string().uuid().nullable().optional(),
    dealId: z.string().uuid().nullable().optional(),
    dueAt: z.coerce.date().optional(),
    reminderAt: z.coerce.date().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.contactId || d.dealId, {
    message: 'At least one of contactId or dealId is required',
    path: ['contactId'],
  });

const updateActivitySchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  reminderAt: z.coerce.date().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  status: activityStatusEnum.optional(),
});

const searchActivitySchema = z.object({
  search: z.string().optional(),
  type: activityTypeEnum.optional(),
  status: activityStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const timelineQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

module.exports = {
  createActivitySchema,
  updateActivitySchema,
  searchActivitySchema,
  timelineQuerySchema,
};
