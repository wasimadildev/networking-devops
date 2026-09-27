import { z } from 'zod';

export const userSearchQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
