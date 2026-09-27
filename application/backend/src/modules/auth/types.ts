export type UserRole = 'member' | 'admin';
export type ProjectStatus = 'active' | 'archived';
export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * The authenticated caller, as attached to `req.auth` by the authenticate
 * middleware. Every module takes this rather than re-reading the header, so
 * there is exactly one place where identity enters the system.
 */
export interface AuthContext {
  userId: string;
  role: UserRole;
  sessionId: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: Date;
  lastLoginAt: Date | null;
}
