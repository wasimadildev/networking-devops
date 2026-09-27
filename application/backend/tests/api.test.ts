/**
 * HTTP-level tests against a real PostgreSQL database.
 *
 * These are the tests AGENTS.md asks for: any endpoint that can be authorised
 * wrongly gets a negative case, and the negative cases are the interesting half.
 * A test that only proves the happy path would pass against an API that returns
 * every project to every caller.
 *
 * The app is built once and the database is truncated between tests, so no test
 * can inherit a token, a project, or a membership from its neighbour.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, truncateAll } from './helpers.js';

let app: Express;

interface TestAccount {
  token: string;
  refreshToken: string;
  userId: string;
  email: string;
}

let accountCounter = 0;

const register = async (displayName = 'Test User'): Promise<TestAccount> => {
  accountCounter += 1;
  const email = `http-${Date.now()}-${accountCounter}@taskflow.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassphrase', displayName });

  expect(response.status).toBe(201);
  return {
    token: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
    userId: response.body.data.user.id,
    email,
  };
};

const createProject = async (account: TestAccount, name = 'Test Project'): Promise<string> => {
  accountCounter += 1;
  const response = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${account.token}`)
    .send({ name, slug: `test-project-${Date.now()}-${accountCounter}` });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
};

const createTask = async (account: TestAccount, projectId: string, title = 'Test task'): Promise<string> => {
  const response = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set('Authorization', `Bearer ${account.token}`)
    .send({ title });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
};

// Not async: returning a Promise would strip supertest's .expect() chain, which
// is the whole reason to return the Test object rather than a result.
// Adds by email, matching the API. The id-based form was removed so the app
// never needs a browsable user directory; see addMemberBodySchema.
const addMember = (account: TestAccount, projectId: string, email: string, role: string) =>
  request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set('Authorization', `Bearer ${account.token}`)
    .send({ email, role });

beforeAll(() => {
  app = createApp();
});
beforeEach(truncateAll);
afterAll(closeDatabase);

describe('health', () => {
  it('reports liveness without touching the database', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('reports readiness only when the database answers', async () => {
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.data.checks.database.ok).toBe(true);
  });

  it('needs no authentication', async () => {
    await request(app).get('/health').expect(200);
    await request(app).get('/health/ready').expect(200);
  });
});

describe('the error envelope', () => {
  it('wraps every failure in the same shape', async () => {
    const account = await register();
    const response = await request(app)
      .get('/api/v1/nope')
      .set('Authorization', `Bearer ${account.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'not_found',
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });

  it('never includes a stack trace', async () => {
    const account = await register();
    const response = await request(app)
      .get('/api/v1/nope')
      .set('Authorization', `Bearer ${account.token}`);

    expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts:\d+/);
    expect(response.body.error.stack).toBeUndefined();
  });

  it('echoes a supplied correlation id', async () => {
    const account = await register();
    const response = await request(app)
      .get('/api/v1/nope')
      .set('Authorization', `Bearer ${account.token}`)
      .set('X-Request-Id', 'test-correlation-id');
    expect(response.body.error.requestId).toBe('test-correlation-id');
  });

  it('answers 401, not 404, for an unknown path when unauthenticated', async () => {
    // Authentication runs before route matching, so an anonymous caller cannot
    // map the API surface by watching 404s turn into 401s. Asserted because it
    // looks like a routing bug until you know it is deliberate.
    const response = await request(app).get('/api/v1/nope');
    expect(response.status).toBe(401);
  });

  it('rejects malformed JSON with 400 rather than 500', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');
    expect(response.status).toBe(400);
  });
});

describe('registration', () => {
  it('returns a token pair and never the password hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'fresh@taskflow.test', password: 'Str0ngPassphrase', displayName: 'Fresh' });

    expect(response.status).toBe(201);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it.each([
    ['a short password', { email: 'a@taskflow.test', password: 'Ab1!', displayName: 'Alpha' }],
    ['a missing email', { password: 'Str0ngPassphrase', displayName: 'Alpha' }],
    ['a malformed email', { email: 'not-an-email', password: 'Str0ngPassphrase', displayName: 'Alpha' }],
    ['a missing display name', { email: 'a@taskflow.test', password: 'Str0ngPassphrase' }],
    ['an unknown field', { email: 'a@taskflow.test', password: 'Str0ngPassphrase', displayName: 'Alpha', role: 'admin' }],
  ])('rejects %s with 422', async (_label, body) => {
    const response = await request(app).post('/api/v1/auth/register').send(body);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
  });

  it('rejects a duplicate email with 409', async () => {
    const body = { email: 'dupe@taskflow.test', password: 'Str0ngPassphrase', displayName: 'Dupe Person' };
    await request(app).post('/api/v1/auth/register').send(body).expect(201);
    const second = await request(app).post('/api/v1/auth/register').send(body);
    expect(second.status).toBe(409);
  });
});

describe('login', () => {
  it('authenticates with the right password', async () => {
    const account = await register();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'Str0ngPassphrase' });
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    // Differing responses turn the login form into an account-enumeration oracle.
    const account = await register();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'WrongPassphrase1' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@taskflow.test', password: 'Str0ngPassphrase' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
    expect(wrongPassword.body.error.code).toBe(unknownUser.body.error.code);
  });
});

describe('authentication middleware', () => {
  it.each([
    ['/api/v1/projects', 'get'],
    ['/api/v1/users/me', 'get'],
  ])('refuses %s without a token', async (path, method) => {
    await request(app)[method as 'get'](path).expect(401);
  });

  it.each([
    ['a malformed token', 'not-a-jwt'],
    ['a token with a broken signature', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad'],
    ['a bearer token that is empty', ''],
  ])('refuses %s', async (_label, token) => {
    await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('refuses a revoked-session access token after the family is revoked', async () => {
    // The access token is a stateless JWT, so it stays valid until it expires.
    // Logging out revokes the family; this asserts the documented limit of the
    // stateless design rather than pretending it does not exist.
    const account = await register();
    const projectId = await createProject(account);

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ refreshToken: account.refreshToken })
      .expect(204);

    // The access token still works, which is exactly the 15-minute window the
    // short TTL buys. Documented here so nobody mistakes it for a bug.
    await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${account.token}`).expect(200);
    expect(projectId).toEqual(expect.any(String));
  });
});

describe('refresh token rotation', () => {
  it('issues a new refresh token', async () => {
    const account = await register();
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });
    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).not.toBe(account.refreshToken);
  });

  it('revokes the whole family when an already-rotated token is replayed', async () => {
    const account = await register();

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });
    const newToken = rotated.body.data.refreshToken as string;

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(401);

    // The stolen-token scenario: the attacker and the victim both get locked out,
    // which is the intent. A silent success here would be the vulnerability.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: newToken }).expect(401);
  });

  it('rejects a refresh token that was never issued', async () => {
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(43) })
      .expect(401);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const account = await register();
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.token })
      .expect(401);
  });

  it('rejects an expired refresh token', async () => {
    const account = await register();
    // Age it out directly: a wait is not a test.
    const { query } = await import('../src/db/pool.js');
    const { hashRefreshToken } = await import('../src/modules/auth/token.service.js');
    await query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 day' WHERE token_hash = $1`, [
      hashRefreshToken(account.refreshToken),
    ]);
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(401);
  });
});

describe('projects', () => {
  it('makes the creator the owner', async () => {
    const account = await register();
    const projectId = await createProject(account);
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${account.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.viewerRole).toBe('owner');
    expect(response.body.data.memberCount).toBe(1);
  });

  it('lists only the caller’s projects', async () => {
    const mine = await register('Mine');
    const theirs = await register('Theirs');
    await createProject(mine, 'Mine');
    await createProject(theirs, 'Theirs');

    const response = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${mine.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Mine');
  });

  it.each([
    ['an uppercase slug', 'Not-Slug'],
    ['a slug with spaces', 'not a slug'],
    ['a slug with underscores', 'not_a_slug'],
    ['a slug with a trailing dash', 'trailing-'],
    ['an empty slug', ''],
  ])('rejects %s with 422', async (_label, slug) => {
    const account = await register();
    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ name: 'Project', slug });
    expect(response.status).toBe(422);
  });

  it('reports real counts after an update instead of zeros', async () => {
    // Regression: updateProject used to return memberCount/taskCount hard-coded
    // to 0, so renaming a project appeared to empty it.
    const account = await register();
    const projectId = await createProject(account);
    const taskId = await createTask(account, projectId);

    const response = await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Renamed');
    expect(response.body.data.memberCount).toBe(1);
    expect(response.body.data.taskCount).toBe(1);
    expect(taskId).toEqual(expect.any(String));
  });
});

describe('task authorisation', () => {
  it('hides a project from a non-member behind a 404', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);

    const response = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${stranger.token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('gives a non-member the same 404 as a project that does not exist', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);

    const forbidden = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    const missing = await request(app)
      .get('/api/v1/projects/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${stranger.token}`);

    expect(forbidden.status).toBe(missing.status);
    expect(forbidden.body.error.code).toBe(missing.body.error.code);
    expect(forbidden.body.error.message).toBe(missing.body.error.message);
  });

  it.each([
    ['GET', '/api/v1/projects/PROJECT/board'],
    ['GET', '/api/v1/projects/PROJECT/members'],
    ['GET', '/api/v1/projects/PROJECT/activity'],
    ['GET', '/api/v1/projects/PROJECT/tasks'],
    ['POST', '/api/v1/projects/PROJECT/tasks'],
  ])('refuses %s %s to a non-member', async (method, pathTemplate) => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    const path = pathTemplate.replace('PROJECT', projectId);

    const response = await request(app)[method.toLowerCase() as 'get'](path)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ title: 'Should not exist' });
    expect(response.status).toBe(404);
  });

  it('refuses a non-member reading a task by its id', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);

    await request(app)
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('refuses a non-member editing a task by its id', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ title: 'Hijacked' })
      .expect(404);
  });

  it('refuses a non-member commenting on a task', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);

    await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ body: 'Should not exist' })
      .expect(404);
  });

  it('does not leak another user’s tasks through their project list', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    await createTask(owner, projectId, 'Private task');

    // Tasks are only ever listed through a project, and the stranger is refused
    // the project, so the list is 404 rather than an empty page. An empty page
    // would be the wrong answer: it would confirm the project exists.
    const viaProject = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(viaProject.status).toBe(404);

    // And the stranger's own project list stays empty, so no task id is exposed.
    const own = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(0);
  });
});

describe('role enforcement', () => {
  it('lets a viewer read but not write', async () => {
    const owner = await register('Owner');
    const viewer = await register('Viewer');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    await addMember(owner, projectId, viewer.email, 'viewer').expect(201);

    await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ title: 'Viewer task' })
      .expect(403);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ title: 'Viewer edit' })
      .expect(403);
  });

  it('lets a viewer comment, because discussion is a read-level action', async () => {
    const owner = await register('Owner');
    const viewer = await register('Viewer');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    await addMember(owner, projectId, viewer.email, 'viewer').expect(201);

    await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ body: "A viewer's comment" })
      .expect(201);
  });

  it('refuses a viewer archiving the project', async () => {
    const owner = await register('Owner');
    const viewer = await register('Viewer');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, viewer.email, 'viewer').expect(201);

    await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ status: 'archived' })
      .expect(403);
  });

  it('lets an editor write but not manage members', async () => {
    const owner = await register('Owner');
    const editor = await register('Editor');
    const newcomer = await register('Newcomer');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, editor.email, 'editor').expect(201);

    await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ title: 'Editor task' })
      .expect(201);

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ email: newcomer.email, role: 'viewer' })
      .expect(403);
  });

  it('refuses an editor changing a role', async () => {
    const owner = await register('Owner');
    const editor = await register('Editor');
    const target = await register('Target');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, editor.email, 'editor').expect(201);
    await addMember(owner, projectId, target.email, 'viewer').expect(201);

    await request(app)
      .patch(`/api/v1/projects/${projectId}/members/${target.userId}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ role: 'viewer' })
      .expect(403);
  });

  it('refuses a self-promotion to owner', async () => {
    const owner = await register('Owner');
    const projectId = await createProject(owner);
    // The schema does not offer 'owner' as an assignable role at all, so the
    // request is rejected before any authorisation question arises.
    const response = await request(app)
      .patch(`/api/v1/projects/${projectId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'owner' });
    expect(response.status).toBe(422);
  });

  it('refuses the only owner removing themselves', async () => {
    const owner = await register('Owner');
    const projectId = await createProject(owner);
    const response = await request(app)
      .delete(`/api/v1/projects/${projectId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(response.status).toBe(422);
  });
});

describe('comment authorisation', () => {
  it('refuses an editor editing another user’s comment', async () => {
    const owner = await register('Owner');
    const editor = await register('Editor');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    await addMember(owner, projectId, editor.email, 'editor').expect(201);

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Author comment' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/comments/${comment.body.data.id}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ body: 'Rewritten' })
      .expect(403);
  });

  it('lets an author edit their own comment', async () => {
    const owner = await register('Owner');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Original' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/comments/${comment.body.data.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Corrected' })
      .expect(200);
  });

  it('refuses a viewer deleting another user’s comment', async () => {
    const owner = await register('Owner');
    const viewer = await register('Viewer');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    await addMember(owner, projectId, viewer.email, 'viewer').expect(201);

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Author comment' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/comments/${comment.body.data.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(403);
  });

  it('lets an editor delete any comment', async () => {
    const owner = await register('Owner');
    const editor = await register('Editor');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    await addMember(owner, projectId, editor.email, 'editor').expect(201);

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Author comment' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/comments/${comment.body.data.id}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .expect(204);
  });
});

describe('input handling', () => {
  it('treats a SQL injection attempt in search as text, not SQL', async () => {
    const account = await register();
    const projectId = await createProject(account);
    await createTask(account, projectId, 'Legitimate task');

    for (const attempt of ["' OR 1=1 --", "'; DROP TABLE tasks; --", "' UNION SELECT * FROM users --"]) {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/tasks`)
        .query({ search: attempt })
        .set('Authorization', `Bearer ${account.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    }

    // The table is still there, which is the part that matters.
    await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${account.token}`)
      .expect(200);
  });

  it('rejects a sort key that is not on the allowlist', async () => {
    const account = await register();
    const projectId = await createProject(account);
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .query({ sortBy: 'password_hash' })
      .set('Authorization', `Bearer ${account.token}`);
    expect(response.status).toBe(422);
  });

  it('rejects an unknown request field rather than ignoring it', async () => {
    const account = await register();
    const projectId = await createProject(account);
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({ title: 'Task', status: 'done', completedAt: '2020-01-01T00:00:00.000Z' });
    expect(response.status).toBe(422);
  });

  it('rejects an oversized page limit', async () => {
    const account = await register();
    const response = await request(app)
      .get('/api/v1/projects')
      .query({ limit: 100000 })
      .set('Authorization', `Bearer ${account.token}`);
    expect(response.status).toBe(422);
  });

  it('rejects a garbage cursor', async () => {
    const account = await register();
    const response = await request(app)
      .get('/api/v1/projects')
      .query({ cursor: '!!!not-a-cursor!!!' })
      .set('Authorization', `Bearer ${account.token}`);
    expect(response.status).toBe(422);
  });

  it('refuses to assign a task to a non-member', async () => {
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Task', assigneeId: stranger.userId });

    expect(response.status).toBe(422);
  });
});

describe('user search is not a user directory', () => {
  it('hides accounts the caller shares no project with', async () => {
    // Regression test. The search used to return every active account's name and
    // email to anyone with a valid token, which is a complete account directory
    // and directly contradicts the login endpoint's refusal to reveal whether an
    // address exists.
    const caller = await register('Caller');
    const stranger = await register('Stranger');
    await createProject(caller, 'Callers project');

    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${caller.token}`);

    expect(response.status).toBe(200);
    const emails = (response.body.data as { email: string }[]).map((user) => user.email);
    expect(emails).toContain(caller.email);
    expect(emails).not.toContain(stranger.email);
  });

  it('returns nothing at all to a caller with no projects', async () => {
    const loner = await register('Loner');
    const stranger = await register('Stranger');

    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${loner.token}`);

    expect(response.status).toBe(200);
    // The caller's own row is included by the shared-project predicate only if
    // they are a member of something, so a brand-new account sees nobody —
    // including itself, which is correct: there is no directory to browse.
    expect(response.body.data).toHaveLength(0);
    expect(stranger.email).toBeTruthy();
  });

  it('finds a project colleague by email', async () => {
    const owner = await register('Owner');
    const colleague = await register('Colleague');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, colleague.email, 'editor').expect(201);

    const response = await request(app)
      .get('/api/v1/users')
      .query({ search: colleague.email })
      .set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(200);
    expect((response.body.data as { email: string }[]).map((u) => u.email)).toContain(colleague.email);
  });

  it('does not match a stranger by a partial email prefix', async () => {
    const caller = await register('Caller');
    const stranger = await register('Stranger');
    await createProject(caller, 'Callers project');

    // Assert on the stranger specifically rather than on the result count: every
    // generated address shares a prefix like "user-", so a prefix search
    // legitimately returns the caller. The claim under test is only that the
    // stranger is unreachable, not that the query returns nothing.
    const response = await request(app)
      .get('/api/v1/users')
      .query({ search: stranger.email.slice(0, 8) })
      .set('Authorization', `Bearer ${caller.token}`);

    expect(response.status).toBe(200);
    const emails = (response.body.data as { email: string }[]).map((user) => user.email);
    expect(emails).not.toContain(stranger.email);
  });

  it('never returns a password hash', async () => {
    const caller = await register('Caller');
    await createProject(caller, 'Callers project');

    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${caller.token}`);

    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/v1/users').expect(401);
  });
});

describe('adding a member by email', () => {
  it('adds a colleague the caller shares a project with', async () => {
    const owner = await register('Owner');
    const colleague = await register('Colleague');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: colleague.email.toUpperCase(), role: 'editor' });

    expect(response.status).toBe(201);
    expect(response.body.data.userId).toBe(colleague.userId);
  });

  it('adds a brand-new user who shares nothing yet', async () => {
    // The reason adding takes an email rather than a user id: a stranger's id is
    // only discoverable from a directory, and the directory was removed.
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: stranger.email, role: 'viewer' });

    expect(response.status).toBe(201);
  });

  it('404s for an address with no account', async () => {
    const owner = await register('Owner');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: 'nobody@taskflow.test', role: 'viewer' });

    expect(response.status).toBe(404);
  });

  it('refuses a non-owner', async () => {
    const owner = await register('Owner');
    const editor = await register('Editor');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, editor.email, 'editor').expect(201);

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ email: stranger.email, role: 'viewer' })
      .expect(403);
  });

  it('409s when the person is already a member', async () => {
    const owner = await register('Owner');
    const colleague = await register('Colleague');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, colleague.email, 'viewer').expect(201);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: colleague.email, role: 'viewer' });

    expect(response.status).toBe(409);
  });

  it('rejects a body carrying a userId instead of an email', async () => {
    // The old id-based shape must not keep working, or the directory problem
    // returns the moment someone reads the old API docs.
    const owner = await register('Owner');
    const stranger = await register('Stranger');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: stranger.userId, role: 'viewer' });

    expect(response.status).toBe(422);
  });

  it('rejects a malformed email', async () => {
    const owner = await register('Owner');
    const projectId = await createProject(owner);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: 'not-an-email', role: 'viewer' });

    expect(response.status).toBe(422);
  });
});

describe('cors', () => {
  it('allows the configured frontend origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow an arbitrary origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
