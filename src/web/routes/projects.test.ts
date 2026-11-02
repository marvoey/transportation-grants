import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeService, rid } from '../../projects/test-helpers.js';
import { startTestServer, TestClient } from '../test-http.js';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server;
let service: ReturnType<typeof makeService>['service'];
let store: ReturnType<typeof makeService>['store'];

const ENV_KEYS = [
  'PROJECT_DISCOVERY_ENABLED', 'PROJECT_RATE_LIMIT_REQUESTS', 'PROJECT_IP_RATE_LIMIT_REQUESTS',
  'PROJECT_ALLOWED_ORIGINS', 'CORS_ORIGINS',
];
const saved: Record<string, string | undefined> = {};

async function boot(env: Record<string, string> = {}, limits?: { maxProjectsPerOwner?: number }) {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.PROJECT_DISCOVERY_ENABLED = 'true';
  Object.assign(process.env, env);
  const h = makeService({ limits });
  service = h.service;
  store = h.store;
  server = await startTestServer({ projectService: service });
}

afterEach(async () => {
  await server?.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const create = (c: TestClient, name = 'Main Street') => c.post('/api/projects', { name, requestId: rid() });

describe('feature flag off', () => {
  beforeEach(async () => {
    await boot({ PROJECT_DISCOVERY_ENABLED: 'false' });
  });

  it('404s every project route and creates no session', async () => {
    const c = server.client();
    for (const [m, p] of [['GET', '/api/projects'], ['POST', '/api/projects'], ['GET', '/api/projects/x'], ['PATCH', '/api/projects/x']]) {
      const r = await c.request(m, p, { body: m === 'POST' ? { name: 'x', requestId: rid() } : undefined });
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.body.code).toBe('PROJECT_NOT_FOUND');
    }
    expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
  });

  it('does not serve the workspace page or its scripts, in any spelling', async () => {
    const c = server.client();
    for (const p of ['/project.html', '/js/project.js', '/css/project.css', '/Project.html', '/project%2ehtml', '/JS/PROJECT.JS']) {
      expect((await c.get(p)).status, p).toBe(404);
    }
    // Other pages are unaffected.
    expect((await c.get('/chat.html')).status).toBe(200);
  });

  it('reports the flag as off', async () => {
    expect((await server.client().get('/api/features')).body.data).toEqual({ projectDiscovery: false });
  });
});

describe('feature flag on', () => {
  beforeEach(async () => {
    await boot();
  });

  it('serves the workspace assets', async () => {
    const c = server.client();
    expect((await c.get('/api/features')).body.data).toEqual({ projectDiscovery: true });
    for (const p of ['/project.html', '/js/project.js', '/css/project.css']) {
      expect((await c.get(p)).status, p).toBe(200);
    }
  });

  describe('sessions and cookies', () => {
    it('issues a persistent HttpOnly SameSite=Lax cookie only from POST /api/projects', async () => {
      const c = server.client();
      const r = await create(c);
      expect(r.status).toBe(201);
      const setCookie = r.headers.getSetCookie()[0];
      expect(setCookie).toMatch(/^tg_session=/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).not.toMatch(/Secure/i); // plain HTTP in this test
      const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1]);
      expect(maxAge).toBe(365 * 24 * 60 * 60);
      expect(r.body.data.project.revision).toBe(1);
      expect(JSON.stringify(r.body)).not.toMatch(/ownerId/);
    });

    it('marks the cookie Secure behind an HTTPS proxy', async () => {
      const r = await server.client().post('/api/projects', { name: 'x', requestId: rid() }, { headers: { 'X-Forwarded-Proto': 'https' } });
      expect(r.headers.getSetCookie()[0]).toMatch(/Secure/i);
    });

    it('GET without a session returns an empty list and creates no session row', async () => {
      const c = server.client();
      const r = await c.get('/api/projects');
      expect(r.body).toEqual({ success: true, data: { items: [], nextCursor: null } });
      expect(r.headers.getSetCookie()).toEqual([]);
      expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
    });

    it('a bad create request does not create a session', async () => {
      const r = await server.client().post('/api/projects', { name: '', requestId: rid() });
      expect(r.status).toBe(400);
      expect(r.headers.getSetCookie()).toEqual([]);
      expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
    });

    it('other project routes without a session fail with 401 SESSION_REQUIRED', async () => {
      const c = server.client();
      expect((await c.get('/api/projects/00000000-0000-4000-8000-000000000001')).body.code).toBe('SESSION_REQUIRED');
      const r = await c.patch('/api/projects/00000000-0000-4000-8000-000000000001', { expectedRevision: 1, requestId: rid(), changes: [] });
      expect(r.status).toBe(401);
      expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
    });

    it('a forged or stale cookie is treated as no session; create issues a new one', async () => {
      const c = server.client();
      c.cookies.set('tg_session', 'forged-value');
      expect((await c.get('/api/projects')).body.data.items).toEqual([]);
      expect((await c.get('/api/projects/00000000-0000-4000-8000-000000000001')).status).toBe(401);
      const r = await create(c);
      expect(r.status).toBe(201);
      expect(r.headers.getSetCookie()[0]).toMatch(/^tg_session=(?!forged-value)/);
    });
  });

  describe('origin and content-type protection', () => {
    it('rejects missing, foreign and null origins with 403 ORIGIN_REJECTED', async () => {
      for (const origin of [null, 'https://evil.example', 'null', 'not a url', 'file:///x']) {
        const r = await server.client().post('/api/projects', { name: 'x', requestId: rid() }, { origin });
        expect(r.status, String(origin)).toBe(403);
        expect(r.body.code).toBe('ORIGIN_REJECTED');
      }
      expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
    });

    it('rejects non-JSON content types', async () => {
      for (const contentType of [null, 'text/plain', 'application/x-www-form-urlencoded']) {
        const r = await server.client().request('POST', '/api/projects', { rawBody: '{"name":"x"}', contentType });
        expect(r.status, String(contentType)).toBe(403);
      }
    });

    it('applies to PATCH, status and DELETE as well', async () => {
      const c = server.client();
      const { body } = await create(c);
      const id = body.data.project.id;
      const evil = { origin: 'https://evil.example' };
      expect((await c.patch(`/api/projects/${id}`, { expectedRevision: 1, requestId: rid(), changes: [] }, evil)).status).toBe(403);
      expect((await c.post(`/api/projects/${id}/status`, { expectedRevision: 1, requestId: rid(), status: 'archived' }, evil)).status).toBe(403);
      expect((await c.delete(`/api/projects/${id}?expectedRevision=1&requestId=${rid()}`, evil)).status).toBe(403);
      expect((await c.get(`/api/projects/${id}`)).body.data.project.status).toBe('draft');
    });

    it('allows origins on the explicit allowlist', async () => {
      process.env.PROJECT_ALLOWED_ORIGINS = 'https://grants.example.com/';
      const r = await server.client().post('/api/projects', { name: 'x', requestId: rid() }, { origin: 'https://grants.example.com' });
      expect(r.status).toBe(201);
    });

    it('sends no CORS headers for project routes', async () => {
      const r = await server.client().get('/api/projects', { origin: 'https://evil.example' });
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
      const pre = await server.client().request('OPTIONS', '/api/projects', {
        origin: 'https://evil.example', contentType: null, headers: { 'Access-Control-Request-Method': 'POST' },
      });
      expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
      const r = await server.client().request('POST', '/api/projects', { rawBody: '{ nope' });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('CRUD flow', () => {
    it('creates, lists, reads, patches, archives, restores and deletes', async () => {
      const c = server.client();
      const created = (await create(c, 'Bridge repair')).body.data.project;
      expect((await c.get('/api/projects')).body.data.items.map((i: any) => i.name)).toEqual(['Bridge repair']);

      const read = (await c.get(`/api/projects/${created.id}`)).body.data.project;
      expect(read.readinessAssessment.completeCount).toBe(1);

      const patched = await c.patch(`/api/projects/${created.id}`, {
        expectedRevision: 1, requestId: rid(),
        changes: [{ op: 'set', path: 'applicant.type', value: 'county' }, { op: 'add', path: 'scope.modes', value: 'road' }],
      });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ statusChanged: false });
      expect(patched.body.data.project.profile.applicant.type).toBe('county');
      expect(patched.body.data.project.revision).toBe(2);

      const archived = await c.post(`/api/projects/${created.id}/status`, { expectedRevision: 2, requestId: rid(), status: 'archived' });
      expect(archived.body.data.project.status).toBe('archived');
      const blocked = await c.patch(`/api/projects/${created.id}`, {
        expectedRevision: 3, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 's' }],
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
      expect((await c.get('/api/projects?status=draft')).body.data.items).toEqual([]);
      expect((await c.get('/api/projects?status=archived')).body.data.items).toHaveLength(1);

      const restored = await c.post(`/api/projects/${created.id}/status`, { expectedRevision: 3, requestId: rid(), status: 'draft' });
      expect(restored.body.data.project.status).toBe('draft');

      const del = await c.delete(`/api/projects/${created.id}?expectedRevision=4&requestId=${rid()}`);
      expect(del.body).toEqual({ success: true, data: { deleted: true } });
      expect((await c.get(`/api/projects/${created.id}`)).status).toBe(404);
      expect((await c.get('/api/projects')).body.data.items).toEqual([]);
    });

    it('returns the standard envelope and codes for failures', async () => {
      const c = server.client();
      const id = (await create(c)).body.data.project.id;
      const stale = await c.patch(`/api/projects/${id}`, { expectedRevision: 9, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 's' }] });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ success: false, code: 'REVISION_CONFLICT', retryable: false });

      const forbidden = await c.patch(`/api/projects/${id}`, { expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'status', value: 'ready' }] });
      expect(forbidden.status).toBe(400);
      expect(forbidden.body.code).toBe('VALIDATION_ERROR');

      const invalid = await c.patch(`/api/projects/${id}`, {
        expectedRevision: 1, requestId: rid(),
        changes: [{ op: 'set', path: 'schedule.startDate', value: '2027-02-01' }, { op: 'set', path: 'schedule.endDate', value: '2027-01-01' }],
      });
      expect(invalid.status).toBe(422);
      expect(invalid.body.code).toBe('INVALID_PROFILE');

      const notReady = await c.post(`/api/projects/${id}/status`, { expectedRevision: 1, requestId: rid(), status: 'ready' });
      expect(notReady.status).toBe(422);
      expect(notReady.body.code).toBe('INVALID_TRANSITION');
    });

    it('replays a request with the same requestId instead of applying it twice', async () => {
      const c = server.client();
      const body = { name: 'Once', requestId: rid() };
      const a = await c.post('/api/projects', body);
      const b = await c.post('/api/projects', body);
      expect(b.body.data.project.id).toBe(a.body.data.project.id);
      expect((await c.get('/api/projects')).body.data.items).toHaveLength(1);
      const conflict = await c.post('/api/projects', { ...body, name: 'Different' });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('validates query parameters', async () => {
      const c = server.client();
      const id = (await create(c)).body.data.project.id;
      expect((await c.get('/api/projects?limit=0')).status).toBe(400);
      expect((await c.get('/api/projects?limit=abc')).status).toBe(400);
      expect((await c.get('/api/projects?status=weird')).status).toBe(400);
      expect((await c.get('/api/projects?limit=1&limit=2')).status).toBe(400);
      expect((await c.delete(`/api/projects/${id}?requestId=${rid()}`)).status).toBe(400);
    });
  });

  describe('isolation between sessions', () => {
    it('a second session cannot list, read, edit, archive or delete the first one’s project', async () => {
      const a = server.client();
      const b = server.client();
      const id = (await create(a, 'A only')).body.data.project.id;
      await create(b, 'B only');

      expect((await b.get('/api/projects')).body.data.items.map((i: any) => i.name)).toEqual(['B only']);
      expect((await b.get(`/api/projects/${id}`)).status).toBe(404);
      expect((await b.patch(`/api/projects/${id}`, { expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'x' }] })).status).toBe(404);
      expect((await b.post(`/api/projects/${id}/status`, { expectedRevision: 1, requestId: rid(), status: 'archived' })).status).toBe(404);
      expect((await b.delete(`/api/projects/${id}?expectedRevision=1&requestId=${rid()}`)).status).toBe(404);
      expect((await a.get(`/api/projects/${id}`)).body.data.project.profile.summary).toBeNull();
    });

    it('a project id or owner id in the body is not authorization', async () => {
      const a = server.client();
      const b = server.client();
      const id = (await create(a)).body.data.project.id;
      await create(b);
      const r = await b.patch(`/api/projects/${id}`, { expectedRevision: 1, requestId: rid(), changes: [], ownerId: 'whoever' });
      expect(r.status).toBe(400); // unknown field rejected before anything else
      expect((await b.get(`/api/projects/${id}`)).status).toBe(404);
    });
  });

  describe('caps and limits', () => {
    it('caps projects per session', async () => {
      await server.close();
      await boot({}, { maxProjectsPerOwner: 2 });
      const c = server.client();
      expect((await create(c, 'one')).status).toBe(201);
      expect((await create(c, 'two')).status).toBe(201);
      const r = await create(c, 'three');
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('LIMIT_EXCEEDED');
    });

    it('rate limits per session (429 RATE_LIMIT_EXCEEDED, retryable) independently of other sessions', async () => {
      await server.close();
      await boot({ PROJECT_RATE_LIMIT_REQUESTS: '3' });
      const a = server.client();
      const b = server.client();
      await create(a); // counted against the IP key (no session yet), then the owner key from here on
      await create(b);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await a.get('/api/projects')).status);
      expect(statuses).toContain(429);
      const limited = await a.get('/api/projects');
      expect(limited.body).toMatchObject({ success: false, code: 'RATE_LIMIT_EXCEEDED', retryable: true });
      expect((await b.get('/api/projects')).status).toBe(200); // b has its own budget
    });

    it('rate limits per IP across sessions', async () => {
      await server.close();
      await boot({ PROJECT_IP_RATE_LIMIT_REQUESTS: '4' });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await server.client().get('/api/projects')).status);
      expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
      expect(statuses.slice(4)).toEqual([429, 429]);
    });
  });
});
