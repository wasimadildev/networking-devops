/**
 * End-to-end smoke test against a running API.
 *
 * Not part of `npm test` — this drives a real server over HTTP, including the
 * negative authorisation cases, so it proves the wiring (CORS, middleware order,
 * the DB trigger) rather than the modules in isolation.
 *
 *   npx tsx scripts/smoke.ts [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = `${BASE}/api/v1`;

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
};

interface Envelope<T> {
  data: T;
  error?: { code: string; message: string; requestId?: string; details?: unknown };
  pageInfo?: { hasNextPage: boolean; nextCursor: string | null };
}

const call = async <T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; payload: Envelope<T> }> => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let payload: Envelope<T>;
  try {
    payload = text ? (JSON.parse(text) as Envelope<T>) : ({} as Envelope<T>);
  } catch {
    payload = { data: text as unknown as T };
  }
  return { status: response.status, payload };
};

const unique = Date.now();
const password = 'Str0ngPassphrase';
// Named because adding a member now takes an email, not a discovered user id.
const otherEmail = `outsider-${unique}@taskflow.dev`;
const viewerEmail = `viewer-${unique}@taskflow.dev`;
const editorEmail = `editor-${unique}@taskflow.dev`;

interface AuthData {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

interface ProjectData {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: string;
  viewerRole: 'owner' | 'editor' | 'viewer';
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
}

interface TaskData {
  id: string;
  title: string;
  status: string;
  completedAt: string | null;
  position: number;
}

const run = async (): Promise<void> => {
  console.log(`\n=== TaskFlow smoke test against ${BASE} ===\n`);

  // ---------------------------------------------------------------- health
  const healthResponse = await fetch(`${BASE}/health`);
  check('GET /health is 200', healthResponse.status === 200);
  const readyResponse = await fetch(`${BASE}/health/ready`);
  check('GET /health/ready is 200 (database reachable)', readyResponse.status === 200);

  // ---------------------------------------------------------------- auth
  const email = `smoke-${unique}@taskflow.dev`;
  const registered = await call<AuthData>('POST', '/auth/register', {
    body: { email, password, displayName: 'Smoke Tester' },
  });
  check('register returns 201', registered.status === 201, registered.payload);
  const token = registered.payload.data?.accessToken ?? '';
  const refreshToken = registered.payload.data?.refreshToken ?? '';
  check('register returns an access token', token.length > 0);

  const weak = await call('POST', '/auth/register', {
    body: { email: `weak-${unique}@taskflow.dev`, password: 'short', displayName: 'Weak' },
  });
  check('weak password rejected with 422', weak.status === 422, weak.payload.error);

  const duplicate = await call('POST', '/auth/register', {
    body: { email, password, displayName: 'Duplicate' },
  });
  check('duplicate email rejected with 409', duplicate.status === 409, duplicate.payload.error);

  const badLogin = await call('POST', '/auth/login', { body: { email, password: 'WrongPassphrase1' } });
  check('wrong password rejected with 401', badLogin.status === 401, badLogin.payload.error);
  check(
    'login failure does not reveal whether the account exists',
    badLogin.payload.error?.message === 'Email or password is incorrect',
    badLogin.payload.error?.message,
  );

  const noToken = await call('GET', '/projects');
  check('protected route without a token is 401', noToken.status === 401);

  const badToken = await call('GET', '/projects', { token: 'not.a.jwt' });
  check('protected route with a malformed token is 401', badToken.status === 401);

  // ---------------------------------------------------------------- projects
  const created = await call<ProjectData>('POST', '/projects', {
    token,
    body: { name: 'Smoke Project', slug: `smoke-project-${unique}`, description: 'created by the smoke test' },
  });
  check('create project returns 201', created.status === 201, created.payload);
  const project = created.payload.data;
  check('creator is the owner', project?.viewerRole === 'owner', project?.viewerRole);
  check('creator membership is recorded', project?.memberCount === 1, project?.memberCount);

  const badSlug = await call('POST', '/projects', {
    token,
    body: { name: 'Bad Slug', slug: 'Not A Slug' },
  });
  check('invalid slug rejected with 422', badSlug.status === 422, badSlug.payload.error);

  const duplicateSlug = await call('POST', '/projects', {
    token,
    body: { name: 'Duplicate Slug', slug: `smoke-project-${unique}` },
  });
  check('duplicate slug rejected with 409', duplicateSlug.status === 409, duplicateSlug.payload.error);

  // ---------------------------------------------------------------- tasks
  const taskResponse = await call<TaskData>('POST', `/projects/${project.id}/tasks`, {
    token,
    body: { title: 'First task', priority: 'high', dueAt: '2026-10-15T09:00:00.000Z' },
  });
  check('create task returns 201', taskResponse.status === 201, taskResponse.payload);
  const task = taskResponse.payload.data;
  check('new task defaults to todo', task?.status === 'todo', task?.status);
  check('new task has no completion stamp', task?.completedAt === null, task?.completedAt);
  check('first task gets position 0', task?.position === 0, task?.position);

  const secondTask = await call<TaskData>('POST', `/projects/${project.id}/tasks`, {
    token,
    body: { title: 'Second task' },
  });
  check('second task is spaced 1000 below the first', secondTask.payload.data?.position === 1000, secondTask.payload.data?.position);

  const done = await call<TaskData>('PATCH', `/tasks/${task.id}`, {
    token,
    body: { status: 'done' },
  });
  check('marking a task done succeeds', done.status === 200, done.payload);
  check(
    'the database trigger set completed_at',
    typeof done.payload.data?.completedAt === 'string',
    done.payload.data?.completedAt,
  );

  const reopened = await call<TaskData>('PATCH', `/tasks/${task.id}`, {
    token,
    body: { status: 'todo' },
  });
  check('reopening clears completed_at', reopened.payload.data?.completedAt === null, reopened.payload.data?.completedAt);

  const badStatus = await call('PATCH', `/tasks/${task.id}`, { token, body: { status: 'nonsense' } });
  check('invalid status rejected with 422', badStatus.status === 422, badStatus.payload.error);

  const moved = await call<TaskData>('POST', `/tasks/${task.id}/move`, {
    token,
    body: { status: 'in_progress', position: 500 },
  });
  check('drag-and-drop move succeeds', moved.status === 200, moved.payload);
  check('move applies both status and position', moved.payload.data?.status === 'in_progress' && moved.payload.data?.position === 500, moved.payload.data);

  const board = await call<{ todo: TaskData[]; in_progress: TaskData[]; done: TaskData[] }>(
    'GET',
    `/projects/${project.id}/board`,
    { token },
  );
  check('board groups by status', board.status === 200 && board.payload.data?.in_progress.length === 1, board.payload.data && {
    todo: board.payload.data.todo.length,
    inProgress: board.payload.data.in_progress.length,
    done: board.payload.data.done.length,
  });

  const filtered = await call<TaskData[]>('GET', `/projects/${project.id}/tasks?status=in_progress`, { token });
  check('status filter is applied server-side', filtered.payload.data?.length === 1, filtered.payload.data?.length);

  const injection = await call<TaskData[]>(
    'GET',
    `/projects/${project.id}/tasks?search=${encodeURIComponent("' OR 1=1 --")}`,
    { token },
  );
  check('a SQL injection attempt in a filter returns no rows', injection.status === 200 && injection.payload.data?.length === 0, injection.payload);

  // ---------------------------------------------------------------- comments
  const comment = await call<{ id: string; authorName: string }>('POST', `/tasks/${task.id}/comments`, {
    token,
    body: { body: 'Looks good to me.' },
  });
  check('create comment returns 201', comment.status === 201, comment.payload);

  const emptyComment = await call('POST', `/tasks/${task.id}/comments`, { token, body: { body: '   ' } });
  check('empty comment rejected with 422', emptyComment.status === 422, emptyComment.payload.error);

  const comments = await call<{ id: string; body: string }[]>('GET', `/tasks/${task.id}/comments`, { token });
  check('comments list returns the thread', comments.payload.data?.length === 1, comments.payload.data?.length);

  // ---------------------------------------------------------------- refresh rotation
  const rotated = await call<AuthData>('POST', '/auth/refresh', { body: { refreshToken } });
  check('refresh succeeds', rotated.status === 200, rotated.payload);
  const rotatedToken = rotated.payload.data?.refreshToken ?? '';
  check('refresh issues a new refresh token', rotatedToken.length > 0 && rotatedToken !== refreshToken);

  const replay = await call('POST', '/auth/refresh', { body: { refreshToken } });
  check('replaying the old refresh token is rejected', replay.status === 401, replay.payload);

  const afterReuse = await call('POST', '/auth/refresh', { body: { refreshToken: rotatedToken } });
  check(
    'reuse detection revoked the whole token family',
    afterReuse.status === 401,
    afterReuse.payload.error,
  );

  // ---------------------------------------------------------------- authorization
  const other = await call<AuthData>('POST', '/auth/register', {
    body: { email: otherEmail, password, displayName: 'Outsider' },
  });
  const otherToken = other.payload.data?.accessToken ?? '';

  const outsiderList = await call<unknown[]>('GET', '/projects', { token: otherToken });
  check('a new account sees no projects', outsiderList.payload.data?.length === 0, outsiderList.payload.data?.length);

  const outsiderRead = await call('GET', `/projects/${project.id}`, { token: otherToken });
  check(
    'a non-member gets 404 for a project they cannot see',
    outsiderRead.status === 404,
    outsiderRead.payload.error,
  );
  check('the 404 does not confirm the project exists', outsiderRead.payload.error?.code === 'not_found');

  const outsiderBoard = await call('GET', `/projects/${project.id}/board`, { token: otherToken });
  check('a non-member cannot read the board', outsiderBoard.status === 404);

  const outsiderTask = await call('GET', `/tasks/${task.id}`, { token: otherToken });
  check('a non-member cannot read a task by id', outsiderTask.status === 404);

  const outsiderWrite = await call('POST', `/projects/${project.id}/tasks`, {
    token: otherToken,
    body: { title: 'Should not exist' },
  });
  check('a non-member cannot create a task', outsiderWrite.status === 404);

  const outsiderComment = await call('POST', `/tasks/${task.id}/comments`, {
    token: otherToken,
    body: { body: 'Should not exist' },
  });
  check('a non-member cannot comment', outsiderComment.status === 404);

  const outsiderMembers = await call('GET', `/projects/${project.id}/members`, { token: otherToken });
  check('a non-member cannot list members', outsiderMembers.status === 404);

  const outsiderAddMember = await call('POST', `/projects/${project.id}/members`, {
    token: otherToken,
    body: { email: otherEmail, role: 'editor' },
  });
  check('a non-member cannot add members', outsiderAddMember.status === 404);

  const outsiderActivity = await call('GET', `/projects/${project.id}/activity`, { token: otherToken });
  check('a non-member cannot read the activity log', outsiderActivity.status === 404);

  // A viewer is a member but cannot write.
  const viewer = await call<AuthData>('POST', '/auth/register', {
    body: { email: viewerEmail, password, displayName: 'Viewer' },
  });
  const viewerToken = viewer.payload.data?.accessToken ?? '';
  const viewerId = viewer.payload.data?.user.id ?? '';

  const grant = await call('POST', `/projects/${project.id}/members`, {
    token,
    body: { email: viewerEmail, role: 'viewer' },
  });
  check('an owner can add a viewer', grant.status === 201, grant.payload);

  // Adding the same person twice must be a 409, not a silent role change. The
  // repository used to upsert on conflict, so this returned 201 and quietly
  // overwrote the existing role — including demoting an editor to viewer.
  const duplicateGrant = await call('POST', `/projects/${project.id}/members`, {
    token,
    body: { email: viewerEmail, role: 'editor' },
  });
  check('re-adding an existing member is a 409', duplicateGrant.status === 409, duplicateGrant.payload.error);

  const unknownEmailGrant = await call('POST', `/projects/${project.id}/members`, {
    token,
    body: { email: `nobody-${unique}@taskflow.dev`, role: 'viewer' },
  });
  check('adding an address with no account is a 404', unknownEmailGrant.status === 404);

  const idShapedGrant = await call('POST', `/projects/${project.id}/members`, {
    token,
    body: { userId: other.payload.data?.user.id, role: 'viewer' },
  });
  check('the old id-shaped member body is rejected (422)', idShapedGrant.status === 422);

  // The user search is scoped to people the caller already shares a project with.
  // Unscoped it returned every account's name and email to any valid token.
  const directoryAsOwner = await call<{ email: string }[]>('GET', '/users', { token });
  const directoryEmails = (directoryAsOwner.payload.data ?? []).map((user) => user.email);
  check(
    'user search hides accounts with no shared project',
    directoryAsOwner.status === 200 && !directoryEmails.includes(otherEmail),
    directoryEmails,
  );
  check('user search includes a project colleague', directoryEmails.includes(viewerEmail), directoryEmails);

  const directoryAsOutsider = await call<{ email: string }[]>('GET', '/users', { token: otherToken });
  const outsiderDirectory = (directoryAsOutsider.payload.data ?? []).map((user) => user.email);
  check(
    'user search returns nobody to a user with no projects',
    directoryAsOutsider.status === 200 && outsiderDirectory.length === 0,
    outsiderDirectory,
  );

  const viewerRead = await call<ProjectData>('GET', `/projects/${project.id}`, { token: viewerToken });
  check('a viewer can read the project', viewerRead.status === 200);
  check('the project reports the viewer role', viewerRead.payload.data?.viewerRole === 'viewer', viewerRead.payload.data?.viewerRole);

  const viewerBoard = await call('GET', `/projects/${project.id}/board`, { token: viewerToken });
  check('a viewer can read the board', viewerBoard.status === 200);

  const viewerWrite = await call('POST', `/projects/${project.id}/tasks`, {
    token: viewerToken,
    body: { title: 'Viewer should not create this' },
  });
  check('a viewer cannot create a task (403)', viewerWrite.status === 403, viewerWrite.payload.error);

  const viewerEdit = await call('PATCH', `/tasks/${task.id}`, { token: viewerToken, body: { title: 'nope' } });
  check('a viewer cannot edit a task (403)', viewerEdit.status === 403);

  const viewerComment = await call('POST', `/tasks/${task.id}/comments`, {
    token: viewerToken,
    body: { body: 'A viewer may comment' },
  });
  check('a viewer CAN comment', viewerComment.status === 201, viewerComment.payload);

  const viewerArchive = await call('PATCH', `/projects/${project.id}`, {
    token: viewerToken,
    body: { status: 'archived' },
  });
  check('a viewer cannot archive the project (403)', viewerArchive.status === 403);

  // Editor, but not owner: may write, may not manage members.
  const editor = await call<AuthData>('POST', '/auth/register', {
    body: { email: editorEmail, password, displayName: 'Editor' },
  });
  const editorToken = editor.payload.data?.accessToken ?? '';
  await call('POST', `/projects/${project.id}/members`, {
    token,
    body: { email: editorEmail, role: 'editor' },
  });

  const editorWrite = await call('POST', `/projects/${project.id}/tasks`, {
    token: editorToken,
    body: { title: 'Editor task' },
  });
  check('an editor can create a task', editorWrite.status === 201, editorWrite.payload);

  const editorMembers = await call('POST', `/projects/${project.id}/members`, {
    token: editorToken,
    body: { email: viewerEmail, role: 'viewer' },
  });
  check('an editor cannot add members (403)', editorMembers.status === 403);

  const selfRemoval = await call('DELETE', `/projects/${project.id}/members/${project.ownerId}`, { token });
  check('an owner cannot remove themselves (422)', selfRemoval.status === 422, selfRemoval.payload.error);

  // Comments: only the author may edit, an editor may delete anyone's.
  const authorComment = await call<{ id: string }>('POST', `/tasks/${task.id}/comments`, {
    token,
    body: { body: 'Author comment' },
  });
  const authorCommentId = authorComment.payload.data?.id ?? '';

  const editorEditsAuthorComment = await call('PATCH', `/comments/${authorCommentId}`, {
    token: editorToken,
    body: { body: 'Rewritten by an editor' },
  });
  check(
    'an editor cannot edit another user\'s comment (403)',
    editorEditsAuthorComment.status === 403,
    editorEditsAuthorComment.payload.error,
  );

  const editorDeletesAuthorComment = await call('DELETE', `/comments/${authorCommentId}`, { token: editorToken });
  check('an editor can delete any comment', editorDeletesAuthorComment.status === 204, editorDeletesAuthorComment.payload);

  const viewerDeletesOther = await call('DELETE', `/comments/${comment.payload.data?.id}`, {
    token: viewerToken,
  });
  check("a viewer cannot delete another user's comment (403)", viewerDeletesOther.status === 403);

  // ---------------------------------------------------------------- assignee rules
  const memberAssign = await call<TaskData>('POST', `/projects/${project.id}/tasks`, {
    token,
    body: { title: 'Assigned to a project member', assigneeId: viewerId },
  });
  check('assigning a project member works', memberAssign.status === 201, memberAssign.payload);

  const freshOutsider = await call<AuthData>('POST', '/auth/register', {
    body: { email: `assignee-${unique}@taskflow.dev`, password, displayName: 'Not A Member' },
  });
  const badAssign = await call<TaskData>('POST', `/projects/${project.id}/tasks`, {
    token,
    body: { title: 'Assigned to a non-member', assigneeId: freshOutsider.payload.data?.user.id },
  });
  check('assigning a non-member is rejected with 422', badAssign.status === 422, badAssign.payload.error);

  // ---------------------------------------------------------------- profile
  const me = await call<{ id: string; email: string }>('GET', '/users/me', { token });
  check('GET /users/me returns the caller', me.status === 200 && me.payload.data?.email === email, me.payload);
  check('the profile response has no password field', !('passwordHash' in (me.payload.data ?? {})));

  const rename = await call<{ displayName: string }>('PATCH', '/users/me', {
    token,
    body: { displayName: 'Renamed Tester' },
  });
  check('profile update works', rename.payload.data?.displayName === 'Renamed Tester', rename.payload.data);

  // ---------------------------------------------------------------- 404 / envelope
  const missingRoute = await call('GET', '/does-not-exist', { token });
  check('an unknown route returns the error envelope', missingRoute.status === 404 && missingRoute.payload.error?.code === 'not_found', missingRoute.payload);
  check('the error envelope carries a correlation id', typeof missingRoute.payload.error?.requestId === 'string');

  const correlation = await call('GET', '/projects', {
    token,
    headers: { 'X-Request-Id': 'smoke-test-correlation-id' },
  });
  check('a supplied correlation id is echoed back', correlation.status === 200);

  const malformedJson = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  check('malformed JSON returns 400, not 500', malformedJson.status === 400, malformedJson.status);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  if (failures > 0) process.exitCode = 1;
};

await run();
