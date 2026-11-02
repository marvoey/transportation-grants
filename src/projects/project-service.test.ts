import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { GrantServerError } from '../types/index.js';
import { ProjectService } from './project-service.js';
import { JsonFileProjectStore } from './project-store.js';
import { makeService, rid } from './test-helpers.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GrantServerError);
    return (e as GrantServerError).code;
  }
  throw new Error('expected rejection');
};

async function setup() {
  const h = makeService();
  const a = await h.service.createSession();
  const b = await h.service.createSession();
  return { ...h, a: a.ownerId, b: b.ownerId, ownerA: a, ownerB: b };
}

/** Fill a project to six of six. */
async function complete(service: ProjectService, owner: string, id: string, rev: number) {
  const r = await service.patchProject(owner, id, {
    expectedRevision: rev,
    requestId: rid(),
    changes: [
      { op: 'set', path: 'applicant.type', value: 'city' },
      { op: 'set', path: 'location.state', value: 'WA' },
      { op: 'set', path: 'location.city', value: 'Tacoma' },
      { op: 'set', path: 'need.problem', value: 'Unsafe crossings' },
      { op: 'add', path: 'scope.activities', value: 'Crosswalks' },
      { op: 'add', path: 'outcomes', value: { description: 'Fewer injuries' } },
    ],
  });
  return r.project;
}

describe('sessions', () => {
  it('stores only a hash of the cookie value and resolves it', async () => {
    const { service, store, ownerA } = await setup();
    const raw = JSON.stringify(await store.read((d) => d.sessions));
    expect(raw).not.toContain(ownerA.cookieValue);
    expect(await service.resolveSession(ownerA.cookieValue)).toEqual({ ownerId: ownerA.ownerId });
    expect(await service.resolveSession('forged')).toBeNull();
    expect(await service.resolveSession(undefined)).toBeNull();
  });

  it('resolving never creates a session', async () => {
    const { service, store } = makeService();
    await service.resolveSession('whatever');
    expect(await store.read((d) => Object.keys(d.sessions))).toEqual([]);
  });
});

describe('create / get / list', () => {
  it('creates a draft project without leaking the owner', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: '  Main Street safety ', requestId: rid() });
    expect(project).toMatchObject({ revision: 1, status: 'draft', schemaVersion: 1 });
    expect(project.profile.name).toBe('Main Street safety');
    expect(project.readinessAssessment.completeCount).toBe(1);
    expect(JSON.stringify(project)).not.toContain(a);
    expect('ownerId' in project).toBe(false);
  });

  it('rejects invalid input', async () => {
    const { service, a } = await setup();
    expect(await code(service.createProject(a, { name: '', requestId: rid() }))).toBe('VALIDATION_ERROR');
    expect(await code(service.createProject(a, { name: 'x', requestId: 'short' }))).toBe('VALIDATION_ERROR');
    expect(await code(service.createProject(a, { name: 'x', requestId: rid(), extra: 1 }))).toBe('VALIDATION_ERROR');
  });

  it('enforces the per-owner project cap but not for replays', async () => {
    const { service, a } = await (async () => {
      const h = makeService({ limits: { maxProjectsPerOwner: 2 } });
      return { ...h, a: (await h.service.createSession()).ownerId };
    })();
    const r1 = rid();
    await service.createProject(a, { name: 'one', requestId: r1 });
    await service.createProject(a, { name: 'two', requestId: rid() });
    expect(await code(service.createProject(a, { name: 'three', requestId: rid() }))).toBe('LIMIT_EXCEEDED');
    await expect(service.createProject(a, { name: 'one', requestId: r1 })).resolves.toBeDefined();
  });

  it('lists only the owner’s projects, newest first, with cursors', async () => {
    const { service, clock, a, b } = await setup();
    for (const n of ['p1', 'p2', 'p3']) {
      await service.createProject(a, { name: n, requestId: rid() });
      clock.advance(1000);
    }
    await service.createProject(b, { name: 'other', requestId: rid() });
    const page1 = await service.listProjects(a, { limit: 2 });
    expect(page1.items.map((i) => i.name)).toEqual(['p3', 'p2']);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await service.listProjects(a, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.name)).toEqual(['p1']);
    expect(page2.nextCursor).toBeNull();
    expect((await service.listProjects(b)).items.map((i) => i.name)).toEqual(['other']);
    expect(await code(service.listProjects(a, { cursor: '***' }))).toBe('VALIDATION_ERROR');
  });
});

describe('ownership isolation', () => {
  it('another principal cannot read, edit, change status or delete', async () => {
    const { service, a, b } = await setup();
    const { project } = await service.createProject(a, { name: 'mine', requestId: rid() });
    expect(await code(service.getProject(b, project.id))).toBe('PROJECT_NOT_FOUND');
    expect(
      await code(
        service.patchProject(b, project.id, {
          expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'hacked' }],
        })
      )
    ).toBe('PROJECT_NOT_FOUND');
    expect(
      await code(service.setStatus(b, project.id, { expectedRevision: 1, requestId: rid(), status: 'archived' }))
    ).toBe('PROJECT_NOT_FOUND');
    expect(await code(service.deleteProject(b, project.id, { expectedRevision: 1, requestId: rid() }))).toBe(
      'PROJECT_NOT_FOUND'
    );
    // Same response as a project that never existed.
    expect(await code(service.getProject(a, '00000000-0000-4000-8000-0000000fffff'))).toBe('PROJECT_NOT_FOUND');
    expect((await service.getProject(a, project.id)).project.profile.summary).toBeNull();
  });

  it('a supplied owner id is not authorization and prototype keys are not projects', async () => {
    const { service, a } = await setup();
    expect(await code(service.getProject(a, '__proto__'))).toBe('PROJECT_NOT_FOUND');
    expect(await code(service.getProject(a, 'constructor'))).toBe('PROJECT_NOT_FOUND');
  });
});

describe('patch, revisions and idempotency', () => {
  it('applies changes, bumps revision, records metadata and recomputes readiness', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const r = await service.patchProject(a, project.id, {
      expectedRevision: 1,
      requestId: rid(),
      changes: [{ op: 'set', path: 'applicant.type', value: 'tribal' }],
    });
    expect(r.project.revision).toBe(2);
    expect(r.project.profile.applicant.type).toBe('tribal');
    expect(r.project.fieldMetadata['applicant.type']).toMatchObject({ source: 'user_edit', messageId: null });
    expect(r.project.readinessAssessment.completeCount).toBe(2);
    expect(r.statusChanged).toBe(false);
  });

  it('two edits from the same revision: the second gets REVISION_CONFLICT and nothing is overwritten', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    await service.patchProject(a, project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'first' }],
    });
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'second' }],
        })
      )
    ).toBe('REVISION_CONFLICT');
    expect((await service.getProject(a, project.id)).project.profile.summary).toBe('first');
  });

  it('concurrent patches from one revision: exactly one wins', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const results = await Promise.allSettled(
      ['x', 'y', 'z'].map((v) =>
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: v }],
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.getProject(a, project.id)).project.revision).toBe(2);
  });

  it('replays the stored result for the same requestId and body, even with a now-stale revision', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const body = { expectedRevision: 1, requestId: rid(), changes: [{ op: 'add', path: 'constraints', value: 'c' }] };
    const first = await service.patchProject(a, project.id, body);
    const again = await service.patchProject(a, project.id, body);
    expect(again).toEqual(first);
    expect((await service.getProject(a, project.id)).project.revision).toBe(2); // applied once
  });

  it('IDEMPOTENCY_CONFLICT when a requestId is reused with a different body', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const requestId = rid();
    await service.patchProject(a, project.id, {
      expectedRevision: 1, requestId, changes: [{ op: 'set', path: 'summary', value: 'one' }],
    });
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId, changes: [{ op: 'set', path: 'summary', value: 'two' }],
        })
      )
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('idempotency records are owner-scoped and expire after 24h', async () => {
    const { service, clock, a, b } = await setup();
    const requestId = rid();
    const p1 = await service.createProject(a, { name: 'P', requestId });
    const p2 = await service.createProject(b, { name: 'P', requestId });
    expect(p1.project.id).not.toBe(p2.project.id);
    clock.advance(24 * 60 * 60 * 1000 + 1);
    const p3 = await service.createProject(a, { name: 'P', requestId });
    expect(p3.project.id).not.toBe(p1.project.id);
  });

  it('rejects invalid changes with VALIDATION_ERROR / INVALID_PROFILE and changes nothing', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'ownerId', value: 'x' }],
        })
      )
    ).toBe('VALIDATION_ERROR');
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId: rid(), changes: Array.from({ length: 51 }, () => ({ op: 'add', path: 'constraints', value: 'c' })),
        })
      )
    ).toBe('VALIDATION_ERROR');
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: 1, requestId: rid(),
          changes: [
            { op: 'set', path: 'budget.totalCostCents', value: 100 },
            { op: 'set', path: 'budget.requestedFundingCents', value: 200 },
          ],
        })
      )
    ).toBe('INVALID_PROFILE');
    const cur = (await service.getProject(a, project.id)).project;
    expect(cur.revision).toBe(1);
    expect(cur.profile.budget.totalCostCents).toBeNull();
  });
});

describe('status, archive and ready', () => {
  it('requires six of six for ready and an explicit transition', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    expect(
      await code(service.setStatus(a, project.id, { expectedRevision: 1, requestId: rid(), status: 'ready' }))
    ).toBe('INVALID_TRANSITION');
    const full = await complete(service, a, project.id, 1);
    expect(full.status).toBe('draft'); // never auto-promoted
    const ready = await service.setStatus(a, project.id, { expectedRevision: full.revision, requestId: rid(), status: 'ready' });
    expect(ready.project.status).toBe('ready');
  });

  it('reverts ready -> draft in the same transaction when an edit drops completeness', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const full = await complete(service, a, project.id, 1);
    const ready = await service.setStatus(a, project.id, { expectedRevision: full.revision, requestId: rid(), status: 'ready' });
    const r = await service.patchProject(a, project.id, {
      expectedRevision: ready.project.revision,
      requestId: rid(),
      changes: [{ op: 'set', path: 'need.problem', value: null }],
    });
    expect(r.statusChanged).toBe(true);
    expect(r.project.status).toBe('draft');
    expect(r.project.readinessAssessment.completeCount).toBe(5);
    expect(r.project.fieldMetadata['need.problem']).toBeUndefined();
  });

  it('keeps ready when an edit does not reduce completeness', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const full = await complete(service, a, project.id, 1);
    const ready = await service.setStatus(a, project.id, { expectedRevision: full.revision, requestId: rid(), status: 'ready' });
    const r = await service.patchProject(a, project.id, {
      expectedRevision: ready.project.revision, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 's' }],
    });
    expect(r.statusChanged).toBe(false);
    expect(r.project.status).toBe('ready');
  });

  it('validates transitions and archived projects are read-only until restored', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const set = (rev: number, status: string) => service.setStatus(a, project.id, { expectedRevision: rev, requestId: rid(), status });
    expect(await code(set(1, 'draft'))).toBe('INVALID_TRANSITION');
    const archived = await set(1, 'archived');
    expect(await code(set(2, 'ready'))).toBe('INVALID_TRANSITION');
    expect(
      await code(
        service.patchProject(a, project.id, {
          expectedRevision: archived.project.revision, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 's' }],
        })
      )
    ).toBe('PROJECT_ARCHIVED');
    expect((await service.getProject(a, project.id)).project.status).toBe('archived'); // reads still work
    const restored = await set(2, 'draft');
    expect(restored.project.status).toBe('draft');
    await expect(
      service.patchProject(a, project.id, {
        expectedRevision: restored.project.revision, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 's' }],
      })
    ).resolves.toBeDefined();
  });

  it('archived projects can be deleted', async () => {
    const { service, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    const archived = await service.setStatus(a, project.id, { expectedRevision: 1, requestId: rid(), status: 'archived' });
    await expect(
      service.deleteProject(a, project.id, { expectedRevision: archived.project.revision, requestId: rid() })
    ).resolves.toEqual({ deleted: true });
  });
});

describe('delete', () => {
  it('hard-deletes the project and every dependent row, atomically', async () => {
    const { service, store, a } = await setup();
    const { project } = await service.createProject(a, { name: 'P', requestId: rid() });
    await store.transaction((d) => {
      d.messages[project.id] = [{ id: 'm', projectId: project.id, role: 'user', content: 'secret', createdAt: 't', requestId: 'r' }];
      d.batches[project.id] = [{ id: 'b', projectId: project.id, baseRevision: 1, state: 'pending', changes: [], createdAt: 't' }];
      d.discoveryRequests[project.id] = [];
    });
    expect(await code(service.deleteProject(a, project.id, { expectedRevision: 99, requestId: rid() }))).toBe('REVISION_CONFLICT');
    const requestId = rid();
    await service.deleteProject(a, project.id, { expectedRevision: 1, requestId });
    const left = await store.read((d) => ({
      p: Object.keys(d.projects), m: Object.keys(d.messages), b: Object.keys(d.batches), r: Object.keys(d.discoveryRequests),
      idem: JSON.stringify(d.idempotency),
    }));
    expect(left).toMatchObject({ p: [], m: [], b: [], r: [] });
    expect(left.idem).not.toContain('"P"'); // no project snapshot lingers in replay records
    expect(await code(service.getProject(a, project.id))).toBe('PROJECT_NOT_FOUND');
    // Replay of the delete still reports success.
    await expect(service.deleteProject(a, project.id, { expectedRevision: 1, requestId })).resolves.toEqual({ deleted: true });
  });
});

describe('restart persistence', () => {
  it('edits survive reopening the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'psvc-'));
    try {
      const path = join(dir, 'projects.json');
      const h1 = makeService({ filePath: path });
      const s = await h1.service.createSession();
      const { project } = await h1.service.createProject(s.ownerId, { name: 'Durable', requestId: rid() });
      await h1.service.patchProject(s.ownerId, project.id, {
        expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'kept' }],
      });
      // "Restart": a brand new store and service over the same file.
      const service2 = new ProjectService({ store: new JsonFileProjectStore(path) });
      const session = await service2.resolveSession(s.cookieValue);
      expect(session?.ownerId).toBe(s.ownerId);
      const got = await service2.getProject(session!.ownerId, project.id);
      expect(got.project).toMatchObject({ revision: 2 });
      expect(got.project.profile.summary).toBe('kept');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
