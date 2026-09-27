import { NotFoundError } from '../../shared/errors.js';
import type { UpdateProfileBody } from '../auth/auth.schemas.js';
import { updateDisplayName } from '../auth/auth.repository.js';
import { findUserById } from './user.repository.js';

/**
 * The profile service is intentionally thin: there is no business rule beyond
 * "the display name is valid", and that rule is already enforced by the schema
 * at the route boundary. A service that only forwards would be indirection
 * without abstraction, but keeping the update here means a future rule (for
 * example, a name change invalidating cached avatars) has one obvious home.
 */
export const updateProfile = async (userId: string, body: UpdateProfileBody) => {
  const updated = await updateDisplayName(userId, body.displayName);
  if (!updated) throw new NotFoundError('User');

  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('User');

  return user;
};
