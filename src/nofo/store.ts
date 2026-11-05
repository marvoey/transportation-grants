import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { join, resolve, sep } from 'path';
import { getConfig } from '../config/config.js';
import {
  DOCUMENT_ID_PATTERN,
  NormalizedDocumentSchema,
  OpportunitySchema,
  PackageManifestSchema,
  UUID_PATTERN,
  type NormalizedDocument,
  type Opportunity,
  type PackageManifest,
} from './schemas.js';

/** Thrown when a package on disk cannot be read or does not match its schema. Fails closed. */
export class PackageCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageCorruptError';
  }
}

const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;
const SUPPLEMENTAL_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/**
 * File-based package store: data/opportunities/<uuid>/...
 * The ONLY things that reach a path are a validated UUID, a server-generated
 * document ID and an allow-listed extension. Writes are atomic (temp file +
 * rename). The CLI is a single writer; there is no cross-process locking.
 */
export class PackageStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  static fromConfig(): PackageStore {
    return new PackageStore(resolve(process.cwd(), getConfig().nofo.dataDir));
  }

  packageDir(opportunityId: string): string {
    if (!UUID_PATTERN.test(opportunityId)) {
      throw new PackageCorruptError('Invalid opportunity ID.');
    }
    return this.within(this.rootDir, opportunityId);
  }

  private documentDir(opportunityId: string, documentId: string): string {
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      throw new PackageCorruptError('Invalid document ID.');
    }
    return this.within(this.packageDir(opportunityId), 'documents', documentId);
  }

  private within(base: string, ...parts: string[]): string {
    const full = resolve(base, ...parts);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new PackageCorruptError('Path escapes the package directory.');
    }
    return full;
  }

  // ---- manifest / opportunity -------------------------------------------------

  async readManifest(opportunityId: string): Promise<PackageManifest | null> {
    const raw = await this.readJson(join(this.packageDir(opportunityId), 'manifest.json'));
    if (raw === null) return null;
    const parsed = PackageManifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.opportunityId !== opportunityId) {
      throw new PackageCorruptError(
        `The stored manifest for ${opportunityId} is invalid. Delete that package folder or re-run with --refresh.`
      );
    }
    return parsed.data;
  }

  async writeManifest(opportunityId: string, manifest: PackageManifest): Promise<void> {
    const valid = PackageManifestSchema.parse(manifest);
    await this.writeAtomic(join(this.packageDir(opportunityId), 'manifest.json'), JSON.stringify(valid, null, 2) + '\n');
  }

  async readOpportunity(opportunityId: string): Promise<Opportunity | null> {
    const raw = await this.readJson(join(this.packageDir(opportunityId), 'opportunity.json'));
    if (raw === null) return null;
    const parsed = OpportunitySchema.safeParse(raw);
    if (!parsed.success) {
      throw new PackageCorruptError(`The stored opportunity record for ${opportunityId} is invalid.`);
    }
    return parsed.data;
  }

  async writeOpportunity(opportunityId: string, opportunity: Opportunity): Promise<void> {
    const valid = OpportunitySchema.parse(opportunity);
    await this.writeAtomic(join(this.packageDir(opportunityId), 'opportunity.json'), JSON.stringify(valid, null, 2) + '\n');
  }

  // ---- documents ---------------------------------------------------------------

  /** Stores the original bytes; returns the path relative to the package directory. */
  async writeOriginal(opportunityId: string, documentId: string, extension: string, bytes: Buffer): Promise<string> {
    if (!EXTENSION_PATTERN.test(extension)) throw new PackageCorruptError('Invalid file extension.');
    const rel = `documents/${documentId}/original.${extension}`;
    await this.writeAtomic(join(this.documentDir(opportunityId, documentId), `original.${extension}`), bytes);
    return rel;
  }

  async writeNormalized(opportunityId: string, documentId: string, doc: NormalizedDocument): Promise<string> {
    const valid = NormalizedDocumentSchema.parse(doc);
    await this.writeAtomic(join(this.documentDir(opportunityId, documentId), 'normalized.json'), JSON.stringify(valid) + '\n');
    return `documents/${documentId}/normalized.json`;
  }

  async readNormalized(opportunityId: string, documentId: string): Promise<NormalizedDocument | null> {
    const raw = await this.readJson(join(this.documentDir(opportunityId, documentId), 'normalized.json'));
    if (raw === null) return null;
    const parsed = NormalizedDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PackageCorruptError(`The normalized content for document ${documentId} is invalid.`);
    }
    return parsed.data;
  }

  /** Reads a stored file by its package-relative path. Null if it does not exist. */
  async readStored(opportunityId: string, relativePath: string): Promise<Buffer | null> {
    const full = this.within(this.packageDir(opportunityId), relativePath);
    try {
      return await fs.readFile(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // ---- supplemental (optional, hand-authored) -----------------------------------

  async readSupplementalConfig(opportunityId: string): Promise<unknown | null> {
    return this.readJson(join(this.packageDir(opportunityId), 'supplemental.json'));
  }

  async readSupplementalFile(opportunityId: string, fileName: string): Promise<Buffer | null> {
    if (!SUPPLEMENTAL_FILE_PATTERN.test(fileName)) throw new PackageCorruptError('Invalid supplemental file name.');
    try {
      return await fs.readFile(this.within(this.packageDir(opportunityId), 'supplemental', fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // ---- listing (for later milestones) ------------------------------------------

  async listPackages(): Promise<Array<{ opportunityId: string; manifest: PackageManifest }>> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const packages: Array<{ opportunityId: string; manifest: PackageManifest }> = [];
    for (const entry of entries.sort()) {
      if (!UUID_PATTERN.test(entry)) continue;
      const manifest = await this.readManifest(entry);
      if (manifest) packages.push({ opportunityId: entry, manifest });
    }
    return packages;
  }

  // ---- internals ---------------------------------------------------------------

  private async readJson(path: string): Promise<unknown | null> {
    let text: string;
    try {
      text = await fs.readFile(path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PackageCorruptError('A stored package file is not valid JSON. Delete the package folder or re-run with --refresh.');
    }
  }

  private async writeAtomic(path: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(resolve(path, '..'), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, path);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
  }
}
