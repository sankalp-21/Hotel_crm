const { z } = require('zod');

const memberIdParams = z.object({ id: z.string().uuid() });
const memberRoleParams = z.object({ id: z.string().uuid(), roleId: z.string().uuid() });
const addRoleSchema = z.object({ roleId: z.string().uuid() });
const addMemberSchema = z.object({ email: z.string().email(), roleId: z.string().uuid() });
const listMembersSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { memberIdParams, memberRoleParams, addRoleSchema, addMemberSchema, listMembersSchema };
