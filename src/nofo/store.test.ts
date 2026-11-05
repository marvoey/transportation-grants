import { promises as fs } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageCorruptError } from './store.js';
import { OPP_A, OPP_B, tmpStore } from './__fixtures__/helpers.js';
import type { PackageManifest } from './schemas.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
async function setup() {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  return t;
}

const manifest = (id: string): PackageManifest => ({
  schemaVersion: 1,
  opportunityId: id,
  retrievedAt: '2026-01-01T00:00:00Z',
  lastCheckedAt: '2026-01-01T00:00:00Z',
  coverage: { status: 'none', reasons: [], completenessNote: 'n' },
  documents: [],
  potentialMissingSources: [],
});

describe('PackageStore path safety', () => {
  it('rejects anything that is not a UUID as a package directory', async () => {
    const { store } = await setup();
    for (const bad of ['../x', '..', 'a/b', '', '/etc', 'ABCDEF', `${OPP_A}/..`]) {
      expect(() => store.packageDir(bad), bad).toThrow(PackageCorruptError);
    }
    expect(store.packageDir(OPP_A).startsWith(store.rootDir)).toBe(true);
  });

  it('rejects unsafe document ids, extensions and stored paths', async () => {
    const { store } = await setup();
    await expect(store.writeOriginal(OPP_A, '../escape', 'pdf', Buffer.from('x'))).rejects.toThrow(PackageCorruptError);
    await expect(store.writeOriginal(OPP_A, 'sg-ok', '../pdf', Buffer.from('x'))).rejects.toThrow(PackageCorruptError);
    await expect(store.readStored(OPP_A, '../../../etc/passwd')).rejects.toThrow(PackageCorruptError);
    await expect(store.readSupplementalFile(OPP_A, '../x.pdf')).rejects.toThrow(PackageCorruptError);
  });

  it('writes originals under the package and returns a package-relative path', async () => {
    const { store, dir } = await setup();
    const rel = await store.writeOriginal(OPP_A, 'sg-one', 'pdf', Buffer.from('%PDF-1.4'));
    expect(rel).toBe('documents/sg-one/original.pdf');
    expect((await fs.readFile(join(dir, OPP_A, rel))).toString()).toBe('%PDF-1.4');
    expect((await store.readStored(OPP_A, rel))?.toString()).toBe('%PDF-1.4');
    expect(await store.readStored(OPP_A, 'documents/none/original.pdf')).toBeNull();
  });
});

describe('PackageStore persistence', () => {
  it('round-trips a manifest and leaves no temp files', async () => {
    const { store, dir } = await setup();
    await store.writeManifest(OPP_A, manifest(OPP_A));
    expect(await store.readManifest(OPP_A)).toEqual(manifest(OPP_A));
    expect((await fs.readdir(join(dir, OPP_A))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('returns null for a package that does not exist', async () => {
    const { store } = await setup();
    expect(await store.readManifest(OPP_A)).toBeNull();
  });

  it('rejects an invalid manifest before touching the previous valid one', async () => {
    const { store } = await setup();
    await store.writeManifest(OPP_A, manifest(OPP_A));
    const broken = { ...manifest(OPP_A), coverage: { status: 'complete' } } as unknown as PackageManifest;
    await expect(store.writeManifest(OPP_A, broken)).rejects.toThrow();
    expect(await store.readManifest(OPP_A)).toEqual(manifest(OPP_A));
  });

  it('fails closed on corrupt or mismatched manifests', async () => {
    const { store, dir } = await setup();
    await fs.mkdir(join(dir, OPP_A), { recursive: true });
    await fs.writeFile(join(dir, OPP_A, 'manifest.json'), '{not json');
    await expect(store.readManifest(OPP_A)).rejects.toThrow(PackageCorruptError);

    await fs.writeFile(join(dir, OPP_A, 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));
    await expect(store.readManifest(OPP_A)).rejects.toThrow(PackageCorruptError);

    // A valid manifest copied into the wrong package folder must not be trusted.
    await fs.writeFile(join(dir, OPP_A, 'manifest.json'), JSON.stringify(manifest(OPP_B)));
    await expect(store.readManifest(OPP_A)).rejects.toThrow(PackageCorruptError);
  });

  it('lists only valid UUID package folders', async () => {
    const { store, dir } = await setup();
    await store.writeManifest(OPP_A, manifest(OPP_A));
    await store.writeManifest(OPP_B, manifest(OPP_B));
    await fs.mkdir(join(dir, 'not-a-package'), { recursive: true });
    await fs.writeFile(join(dir, 'README.txt'), 'x');
    expect((await store.listPackages()).map((p) => p.opportunityId)).toEqual([OPP_A, OPP_B]);
  });
});
