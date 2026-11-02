import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_VERSION, JsonFileProjectStore, migrateEnvelope, migrateProject } from './project-store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstore-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = () => join(dir, 'nested', 'projects.json');

describe('JsonFileProjectStore', () => {
  it('persists across a restart (reopening the file)', async () => {
    const a = new JsonFileProjectStore(file());
    await a.transaction((d) => {
      d.sessions.s = { id: 's', ownerId: 'o', createdAt: 't' };
    });
    const b = new JsonFileProjectStore(file());
    expect(await b.read((d) => d.sessions.s.ownerId)).toBe('o');
    expect(JSON.parse(readFileSync(file(), 'utf8')).fileVersion).toBe(FILE_VERSION);
  });

  it('leaves state and file untouched when the callback throws', async () => {
    const s = new JsonFileProjectStore(file());
    await s.transaction((d) => {
      d.sessions.a = { id: 'a', ownerId: 'o', createdAt: 't' };
    });
    const before = readFileSync(file(), 'utf8');
    await expect(
      s.transaction((d) => {
        d.sessions.b = { id: 'b', ownerId: 'o', createdAt: 't' };
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await s.read((d) => Object.keys(d.sessions))).toEqual(['a']);
    expect(readFileSync(file(), 'utf8')).toBe(before);
    // The chain survives the failure.
    await s.transaction((d) => {
      d.sessions.c = { id: 'c', ownerId: 'o', createdAt: 't' };
    });
    expect(await s.read((d) => Object.keys(d.sessions).sort())).toEqual(['a', 'c']);
  });

  it('rolls back in-memory state when the write fails', async () => {
    const s = new JsonFileProjectStore(file());
    await s.transaction((d) => {
      d.sessions.a = { id: 'a', ownerId: 'o', createdAt: 't' };
    });
    // Make the target path unwritable by turning the tmp-file's directory into a missing one.
    rmSync(join(dir, 'nested'), { recursive: true, force: true });
    await expect(
      s.transaction((d) => {
        d.sessions.b = { id: 'b', ownerId: 'o', createdAt: 't' };
      })
    ).rejects.toThrow();
    expect(await s.read((d) => Object.keys(d.sessions))).toEqual(['a']);
  });

  it('serializes concurrent transactions without lost updates', async () => {
    const s = new JsonFileProjectStore(file());
    await Promise.all(
      Array.from({ length: 20 }, () =>
        s.transaction((d) => {
          d.counters.discovery.count += 1;
        })
      )
    );
    expect(await s.read((d) => d.counters.discovery.count)).toBe(20);
    expect(await new JsonFileProjectStore(file()).read((d) => d.counters.discovery.count)).toBe(20);
  });

  it('rejects async callbacks', async () => {
    const s = new JsonFileProjectStore(null);
    await expect(s.transaction((async () => 1) as any)).rejects.toThrow(/synchronous/);
  });

  it('read returns clones, not live state', async () => {
    const s = new JsonFileProjectStore(null);
    await s.transaction((d) => {
      d.sessions.a = { id: 'a', ownerId: 'o', createdAt: 't' };
    });
    const copy = await s.read((d) => d.sessions);
    copy.a.ownerId = 'mutated';
    expect(await s.read((d) => d.sessions.a.ownerId)).toBe('o');
  });

  it('quarantines a corrupt file and starts empty', async () => {
    const path = file();
    new JsonFileProjectStore(path); // creates dir
    writeFileSync(path, '{ not json');
    const s = new JsonFileProjectStore(path);
    expect(await s.read((d) => Object.keys(d.projects))).toEqual([]);
    expect(readdirSync(join(dir, 'nested')).some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('refuses a file from a newer version instead of overwriting it', () => {
    const path = file();
    new JsonFileProjectStore(path);
    writeFileSync(path, JSON.stringify({ fileVersion: FILE_VERSION + 1, data: {} }));
    expect(() => new JsonFileProjectStore(path)).toThrow(/newer/);
    expect(JSON.parse(readFileSync(path, 'utf8')).fileVersion).toBe(FILE_VERSION + 1);
  });

  it('runs file and project migrations in order and repeatably', () => {
    const file1 = migrateEnvelope(
      { fileVersion: 1, data: { projects: {} } },
      { 1: (d: any) => ({ ...d, migrated: true }) },
      2
    ) as any;
    expect(file1.migrated).toBe(true);
    const mp = (p: any) => migrateProject(p, { 1: (x: any) => ({ ...x, a: 1 }), 2: (x: any) => ({ ...x, b: 2 }) }, 3);
    const out = mp({ schemaVersion: 1 });
    expect(out).toMatchObject({ schemaVersion: 3, a: 1, b: 2 });
    expect(mp(out)).toEqual(out); // already current => unchanged
    expect(() => migrateProject({ schemaVersion: 1 }, {}, 2)).toThrow(/No migration/);
  });
});
