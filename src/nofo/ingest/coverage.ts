import type { Coverage, ManifestDocument, Opportunity, PotentialMissingSource } from '../schemas.js';

export const COMPLETENESS_NOTE =
  'Completeness against the full official package cannot be verified: only the attachments Simpler.Grants.gov lists (plus any curated supplemental sources) were processed. ' +
  'Agencies may publish FAQs, checklists or amendments elsewhere.';

function label(doc: ManifestDocument): string {
  return doc.title || doc.fileName;
}

/** One plain-language reason a document is not usable as source content. */
function describeProblem(doc: ManifestDocument): string {
  switch (doc.retrieval.status) {
    case 'failed':
      return `${label(doc)}: could not be downloaded (${doc.retrieval.error ?? 'unknown error'}).`;
    case 'skipped_too_large':
      return `${label(doc)}: skipped because it exceeds a size limit.`;
    case 'skipped_unsafe':
      return `${label(doc)}: skipped because its URL was not allowed (${doc.retrieval.error ?? 'unsafe URL'}).`;
    case 'manual_required':
      return `${label(doc)}: a manually placed file is required but was not found.`;
    default:
      break;
  }
  switch (doc.processing.status) {
    case 'unsupported_format':
      return `${label(doc)}: unsupported format, registered but not parsed (${doc.processing.detail ?? 'no adapter'}).`;
    case 'parse_failed':
      return `${label(doc)}: could not be parsed (${doc.processing.error ?? 'unknown error'}).`;
    case 'empty_text':
      return `${label(doc)}: no extractable text (possibly scanned; OCR is out of scope).`;
    default:
      return `${label(doc)}: not processed.`;
  }
}

/**
 * Package coverage. There is deliberately no "complete" level: the best
 * outcome says only that every attachment Simpler.Grants.gov LISTED was parsed.
 */
export function computeCoverage(documents: ManifestDocument[]): Coverage {
  const active = documents.filter((d) => d.retrieval.status !== 'removed_upstream');
  const removed = documents.filter((d) => d.retrieval.status === 'removed_upstream');
  const parsed = active.filter((d) => d.processing.status === 'parsed');
  const reasons: string[] = [];

  if (active.length === 0) {
    reasons.push('Simpler.Grants.gov lists no attachments for this opportunity, so document coverage is unknown or incomplete.');
  }
  for (const doc of active) {
    if (doc.processing.status !== 'parsed') reasons.push(describeProblem(doc));
  }
  for (const doc of removed) {
    reasons.push(`${label(doc)}: no longer listed by Simpler.Grants.gov (kept from an earlier retrieval).`);
  }

  let status: Coverage['status'];
  if (parsed.length === 0) {
    status = 'none';
    if (active.length > 0) reasons.push('No document could be parsed.');
  } else {
    const hasProblem = active.some((d) => d.processing.status !== 'parsed');
    const hasControlling = parsed.some((d) => d.authority === 'controlling');
    if (!hasControlling) {
      reasons.push('No controlling document (NOFO or amendment) was identified among the parsed documents.');
    }
    status = hasProblem || !hasControlling ? 'partial' : 'api_listed_processed';
  }

  return { status, reasons, completenessNote: COMPLETENESS_NOTE };
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Sources that may exist but were not acquired. Recorded so nothing is
 * silently assumed absent; adding them later is a curation step.
 */
export function computePotentialMissingSources(
  opportunity: Opportunity,
  documents: ManifestDocument[]
): PotentialMissingSource[] {
  const active = documents.filter((d) => d.retrieval.status !== 'removed_upstream');
  const out: PotentialMissingSource[] = [];

  const infoUrl = safeHttpUrl(opportunity.summary.additionalInfoUrl);
  if (infoUrl) {
    out.push({
      kind: 'additional_info_url',
      description:
        'The opportunity lists an additional-information page. It is not retrieved automatically; review it for FAQs, checklists or amendments.',
      url: infoUrl,
    });
  }

  if (!active.some((d) => d.processing.status === 'parsed' && d.authority === 'controlling')) {
    out.push({
      kind: 'no_controlling_document',
      description: 'No NOFO or amendment document was attached through Simpler.Grants.gov and parsed.',
    });
  }

  if (!active.some((d) => d.authority === 'official_guidance')) {
    out.push({
      kind: 'official_guidance_not_attached',
      description:
        'No FAQ, Q&A, checklist or webinar material is attached through Simpler.Grants.gov. Agencies often publish these on their own sites; they can be added later as curated supplemental sources.',
    });
  }

  if (!active.some((d) => /amend/i.test(`${d.fileName} ${d.title}`))) {
    out.push({
      kind: 'amendments_not_listed',
      description:
        'Simpler.Grants.gov does not expose a separate list of amendments. Confirm on the agency site that no amendment supersedes the attached documents.',
    });
  }

  for (const doc of active) {
    if (doc.processing.status === 'unsupported_format') {
      out.push({
        kind: 'unparsed_attachment',
        documentId: doc.documentId,
        description: `${label(doc)}: registered but not parsed (${doc.processing.detail ?? 'unsupported format'}).`,
      });
    }
  }

  return out;
}
