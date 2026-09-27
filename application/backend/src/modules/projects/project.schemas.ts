import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/pagination.js';
// Reused so a member email is normalised to lowercase exactly as registration
// and login do. A member added as "A@B.com" must resolve to the same row as
// "a@b.com", and duplicating the normalisation here would be a chance to forget.
import { emailSchema } from '../auth/auth.schemas.js';

export const slugSchema = z
  .string()
  .trim()
  .min(2, 'Slug is too short')
  .max(60, 'Slug is too long')
  // Matches projects_slug_format in the DB. Validating the same shape in two
  // places is deliberate: the database constraint is the guarantee, the schema
  // is the fast, friendly failure before a round trip.
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and single hyphens');

export const projectStatusSchema = z.enum(['active', 'archived']);

export const memberRoleSchema = z.enum(['owner', 'editor', 'viewer']);

export const projectIdParamSchema = z.object({ projectId: z.uuid('projectId must be a uuid') });
export const memberIdParamSchema = z.object({
  projectId: z.uuid('projectId must be a uuid'),
  userId: z.uuid('userId must be a uuid'),
});

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
    slug: slugSchema,
    description: z.string().trim().max(2000, 'Description is too long').nullish(),
  })
  .strict();

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullish(),
    status: projectStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.default('active'),
  // Free-text search over name and description. It is passed to the repository
  // as a bound parameter, never interpolated.
  search: z.string().trim().max(120).optional(),
});

export const listMembersQuerySchema = paginationQuerySchema.extend({
  role: memberRoleSchema.optional(),
});

/**
 * Adding a member takes an *email*, not a user id.
 *
 * An id-based body needs the client to have discovered the id somewhere, and the
 * only place to discover a stranger's id is a user directory — which is exactly
 * the endpoint this change removed, because it handed every authenticated caller
 * a list of every account's name and email. Requiring the email moves the
 * resolution server-side, so the directory never has to exist.
 *
 * A project owner can therefore learn whether one specific address has an
 * account, which is a real but much narrower disclosure than a browsable
 * directory: it requires already being an owner, and it only answers the exact
 * address they typed rather than every prefix match of it.
 */
export const addMemberBodySchema = z
  .object({
    email: emailSchema,
    role: memberRoleSchema.exclude(['owner']),
  })
  .strict();

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
