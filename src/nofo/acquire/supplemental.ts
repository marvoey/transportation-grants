import { SupplementalConfigSchema, type SupplementalConfig } from '../schemas.js';
import type { PackageStore } from '../store.js';

export class SupplementalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplementalConfigError';
  }
}

/**
 * Optional, hand-authored curation for one opportunity package:
 * data/opportunities/<uuid>/supplemental.json. It lets a curator add official
 * sources Simpler.Grants.gov does not attach (agency FAQs, checklists,
 * amendments) as listed https URLs or manually placed files, and override
 * authority classification. Nothing is discovered or crawled automatically.
 * Absent file => no supplemental sources.
 */
export async function loadSupplementalConfig(store: PackageStore, opportunityId: string): Promise<SupplementalConfig> {
  const raw = await store.readSupplementalConfig(opportunityId);
  if (raw === null) return { sources: [], overrides: {} };
  const parsed = SupplementalConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SupplementalConfigError(`supplemental.json for ${opportunityId} is invalid (${where}).`);
  }
  return parsed.data;
}
