import { apiList, apiRequest } from './client';
import { clearTokens, getRefreshToken, setTokens } from './token-store';
import type {
  ActivityEntry,
  AuthSession,
  Board,
  Comment,
  Project,
  ProjectMember,
  ProjectMemberRole,
  Task,
  TaskPriority,
  TaskStatus,
  User,
} from './types';

/**
 * One function per API operation.
 *
 * Hooks call these and never touch a path string, so a route change is a change
 * in one file and the compiler catches any endpoint whose response shape was
 * renamed. Path strings appearing in a component is the thing this layer exists
 * to prevent.
 */
const V1 = '/api/v1';

export const authApi = {
  register: (body: { email: string; password: string; displayName: string }) =>
    apiRequest<AuthSession>(`${V1}/auth/register`, { method: 'POST', body, anonymous: true }),

  login: (body: { email: string; password: string }) =>
    apiRequest<AuthSession>(`${V1}/auth/login`, { method: 'POST', body, anonymous: true }),

  /**
   * Persists the session. Kept out of `login` and `register` deliberately so the
   * token write is one visible step at the call site rather than a side effect
   * hidden inside a function that appears to just return data.
   */
  adopt: (session: AuthSession): void => {
    setTokens(session.accessToken, session.refreshToken);
  },

  logout: async (): Promise<void> => {
    const refreshToken = getRefreshToken();
    // Revoke server-side when possible, so the refresh token cannot be reused
    // even if the local copy is deleted but recovered from a backup.
    if (refreshToken) {
      try {
        await apiRequest<void>(`${V1}/auth/logout`, { method: 'POST', body: { refreshToken } });
      } catch {
        // A failed logout must not trap the user in the app. The local tokens go
        // either way, and an unreachable server means nothing was leaked by
        // staying signed out of it.
      }
    }
    clearTokens();
  },

  /**
   * Exchanges the stored refresh token for a new session. Used on app boot.
   *
   * Returns the user rather than a boolean because the refresh response already
   * carries the identity — the same payload `login` returns. Asking for it again
   * with /users/me would be a second round trip on every page load for a value
   * the server already sent.
   *
   * The rotated refresh token is written to storage by `refreshSession` in the
   * client, so callers do not need `adopt` here.
   */
  restore: async (): Promise<User | null> => {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: getRefreshToken() }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const { data } = (await response.json()) as { data: AuthSession };
    setTokens(data.accessToken, data.refreshToken);
    return data.user;
  },

  /**
   * Revokes every refresh token belonging to the caller, including this one, so
   * the response is a 204 and carries no count. Local tokens are cleared because
   * this device's session is revoked too — leaving them in storage would produce
   * a 401 on the very next request, which is a worse experience than signing out
   * deliberately.
   */
  logoutAll: async (): Promise<void> => {
    try {
      await apiRequest<void>(`${V1}/auth/logout-all`, { method: 'POST' });
    } finally {
      // Cleared even if the request failed. The user asked to be signed out; a
      // server that cannot confirm it must not leave them apparently signed in.
      clearTokens();
    }
  },
};

export const userApi = {
  me: (signal?: AbortSignal) => apiRequest<User>(`${V1}/users/me`, { signal }),

  updateProfile: (body: { displayName: string }) =>
    apiRequest<User>(`${V1}/users/me`, { method: 'PATCH', body }),

  /**
   * Search across accounts, used by the "add a member" field.
   *
   * Scoped server-side to accounts the caller shares a project with, so this
   * cannot be used to harvest the user list — see searchUsers in the backend.
   *
   * Note the envelope: this endpoint uses sendData, not sendPage, so it returns
   * a bare `{ data: User[] }` with no pageInfo. It is a lookup box capped at
   * `limit`, not a browsable list, and using apiList here would read
   * `pageInfo` off a response that has none.
   */
  search: (query: string, signal?: AbortSignal) =>
    apiRequest<User[]>(`${V1}/users`, { query: { search: query, limit: 10 }, signal }),
};

/** Password changes live under /auth, not /users, and require the current password. */
export const passwordApi = {
  /**
   * Revokes every other session on success, so the response reports how many it
   * killed. The count is worth surfacing: "signed out of 3 sessions" tells the
   * user the change reached their other devices, which is the whole reason to
   * change a password.
   */
  change: (body: { currentPassword: string; newPassword: string }) =>
    apiRequest<{ sessionsRevoked: number }>(`${V1}/auth/change-password`, { method: 'POST', body }),
};

/**
 * No `'all'` option, deliberately. The server's list filter is an enum of
 * active|archived with active as the default, so a client sending `all` gets a
 * 422 rather than an unfiltered list. The project switcher offers the two real
 * states instead of a third one the API does not have.
 */
export type ProjectQuery = {
  status?: 'active' | 'archived';
  search?: string;
  limit?: number;
  cursor?: string;
};

export const projectApi = {
  list: (query: ProjectQuery = {}, signal?: AbortSignal) =>
    apiList<Project>(`${V1}/projects`, { query: { ...query, status: query.status ?? 'active' }, signal }),

  get: (projectId: string, signal?: AbortSignal) =>
    apiRequest<Project>(`${V1}/projects/${projectId}`, { signal }),

  create: (body: { name: string; slug: string; description?: string }) =>
    apiRequest<Project>(`${V1}/projects`, { method: 'POST', body }),

  update: (projectId: string, body: { name?: string; description?: string; status?: 'active' | 'archived' }) =>
    apiRequest<Project>(`${V1}/projects/${projectId}`, { method: 'PATCH', body }),

  members: (projectId: string, signal?: AbortSignal) =>
    apiList<ProjectMember>(`${V1}/projects/${projectId}/members`, { signal }),

  /**
   * Adds by email, not by user id. The server resolves the address to an account
   * so the app never needs a browsable user directory; see addMemberBodySchema
   * in the backend for the reasoning.
   */
  addMember: (projectId: string, body: { email: string; role: Exclude<ProjectMemberRole, 'owner'> }) =>
    apiRequest<{ userId: string; role: string }>(`${V1}/projects/${projectId}/members`, {
      method: 'POST',
      body,
    }),

  changeMemberRole: (projectId: string, userId: string, role: Exclude<ProjectMemberRole, 'owner'>) =>
    apiRequest<{ userId: string; role: string }>(`${V1}/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    }),

  /**
   * 204 No Content, so there is no body to read — the type is `void` and the
   * client returns `{ data: undefined }`. Typing this as `{ removed: true }`
   * would be a shape the server never sends, so a caller checking the result
   * would branch on a value that cannot exist.
   */
  removeMember: (projectId: string, userId: string) =>
    apiRequest<void>(`${V1}/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  activity: (projectId: string, signal?: AbortSignal) =>
    apiList<ActivityEntry>(`${V1}/projects/${projectId}/activity`, { signal }),

  board: (projectId: string, signal?: AbortSignal) =>
    apiRequest<Board>(`${V1}/projects/${projectId}/board`, { signal }),
};

/**
 * Declared as a `type`, not an `interface`, on purpose: only a type alias gets
 * TypeScript's implicit index signature, so an interface cannot be passed
 * straight to a parameter typed `Record<string, string | number | boolean>`.
 * The query object is forwarded verbatim to the client's serialiser, so it has
 * to be a plain string-keyed bag by construction.
 */
export type TaskQuery = {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToMe?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
};

export const taskApi = {
  list: (projectId: string, query: TaskQuery = {}, signal?: AbortSignal) =>
    apiList<Task>(`${V1}/projects/${projectId}/tasks`, { query, signal }),

  get: (taskId: string, signal?: AbortSignal) => apiRequest<Task>(`${V1}/tasks/${taskId}`, { signal }),

  create: (
    projectId: string,
    body: {
      title: string;
      description?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string | null;
      dueAt?: string | null;
    },
  ) => apiRequest<Task>(`${V1}/projects/${projectId}/tasks`, { method: 'POST', body }),

  update: (taskId: string, body: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'assigneeId' | 'dueAt'>>) =>
    apiRequest<Task>(`${V1}/tasks/${taskId}`, { method: 'PATCH', body }),

  move: (taskId: string, body: { status: TaskStatus; position: number }) =>
    apiRequest<Task>(`${V1}/tasks/${taskId}/move`, { method: 'POST', body }),

  remove: (taskId: string) => apiRequest<void>(`${V1}/tasks/${taskId}`, { method: 'DELETE' }),
};

export const commentApi = {
  list: (taskId: string, signal?: AbortSignal) =>
    apiList<Comment>(`${V1}/tasks/${taskId}/comments`, { signal }),

  create: (taskId: string, body: { body: string }) =>
    apiRequest<Comment>(`${V1}/tasks/${taskId}/comments`, { method: 'POST', body }),

  update: (commentId: string, body: { body: string }) =>
    apiRequest<Comment>(`${V1}/comments/${commentId}`, { method: 'PATCH', body }),

  remove: (commentId: string) => apiRequest<void>(`${V1}/comments/${commentId}`, { method: 'DELETE' }),
};
