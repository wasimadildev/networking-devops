import { z } from 'zod';

/**
 * Every request body is described here, and the TypeScript types are inferred
 * from the schema rather than written twice. A field added to the schema is
 * immediately available to the handler, and a field removed from the schema is a
 * compile error — which is the whole point of not hand-maintaining interfaces.
 */

const trimmed = z.string().trim();

export const emailSchema = trimmed
  .email('Enter a valid email address')
  .max(254, 'Email is too long')
  // Normalised at the boundary so 'A@B.com' and 'a@b.com' cannot become two
  // accounts. CITEXT protects uniqueness in the database; this protects the
  // lookup key and keeps the stored value canonical.
  .transform((value) => value.toLowerCase());

/**
 * A deliberately explicit password policy. A long passphrase beats a short
 * complex one, so length is the primary control and character classes only add
 * a floor. The error names the rule that failed instead of saying "too weak",
 * which is useless to the person typing.
 */
export const passwordSchema = trimmed
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters')
  .refine((value) => /[a-z]/.test(value), 'Password must include a lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must include an uppercase letter')
  .refine((value) => /\d/.test(value), 'Password must include a digit');

export const displayNameSchema = trimmed
  .min(2, 'Display name is too short')
  .max(80, 'Display name is too long');

export const registerBodySchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .strict();

export const loginBodySchema = z
  .object({
    email: emailSchema,
    // Login deliberately does NOT apply the registration policy: an account
    // created before the policy tightened must still be able to sign in.
    password: z.string().min(1, 'Password is required').max(200),
  })
  .strict();

export const refreshBodySchema = z
  .object({
    refreshToken: z.string().min(20, 'Refresh token is malformed').max(512),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export const updateProfileBodySchema = z
  .object({
    displayName: displayNameSchema,
  })
  .strict();

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
