/**
 * The API's response shapes, mirrored in TypeScript.
 *
 * Written by hand rather than generated, which means this file is a place a
 * contract change can be missed. That is an accepted trade for a portfolio app:
 * it is also the artefact a reviewer reads to understand the API surface, and it
 * forces the naming decisions to be made deliberately rather than inherited from
 * a generator's defaults.
 *
 * Every list response is a `Page`, never a bare array, because the client has to
 * know whether asking for more is possible.
 */

export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';
export type ProjectStatus = 'active' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerId: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  viewerRole: ProjectMemberRole;
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
}

export interface ProjectMember {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectMemberRole;
  joinedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  createdByName: string;
  dueAt: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityAction =
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'project.member_added'
  | 'project.member_role_changed'
  | 'project.member_removed'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'task.assigned'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted';

export interface ActivityEntry {
  id: string;
  projectId: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: ActivityAction;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Board {
  todo: Task[];
  in_progress: Task[];
  done: Task[];
}

export interface PageInfo {
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface Page<T> {
  data: T[];
  pageInfo: PageInfo;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** The error envelope every non-2xx response uses. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
