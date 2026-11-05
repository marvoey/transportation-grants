import { logger } from '../../config/config.js';
import { verifySource, type VerifiableDocument } from '../citations.js';
import { createAnthropicLlm, resolveExtractionModel, type LlmFn } from '../llm.js';
import { parseOpportunityId } from '../schemas.js';
import { PackageStore } from '../store.js';
import { mapLimit, sha256Hex } from '../util.js';
import { checkSupportedByQuotes } from './check-values.js';
import { DEFAULT_BATCH_LIMITS, makeBatches, splitBatch, type Batch, type BatchLimits } from './chunker.js';
import { finalizeRequirements, mergeDrafts, type Draft } from './merge.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage } from './prompts.js';
import {
  WIRE_JSON_SCHEMA,
  WireEnvelopeSchema,
  WireRequirementSchema,
  toCandidate,
  type Candidate,
  type RequirementsFile,
} from './schemas.js';

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export interface ExtractOptions {
  store?: PackageStore;
  /** Injectable for tests; defaults to the configured Anthropic model. */
  llm?: LlmFn;
  model?: string;
  /** Ignore a cached requirements.json. */
  refresh?: boolean;
  /** Also extract from `official_guidance` documents (FAQs, checklists). Controlling documents are always used. */
  includeGuidance?: boolean;
  limits?: BatchLimits;
  concurrency?: number;
  maxTokens?: number;
  /** Independent passes to combine (default 1). The model's recall varies run to run; more passes raise recall at proportional cost. */
  passes?: number;
  now?: () => Date;
}

export interface ExtractResult {
  file: RequirementsFile;
  /** True when a still-valid cached requirements.json was returned and no model call was made. */
  cached: boolean;
}

const MAX_REJECTIONS_STORED = 100;

type BatchOutcome =
  | { ok: true; candidates: Candidate[]; invalidItems: number; splits: number }
  | { ok: false; error: string };

/** A batch is split in half at most this many times when the model's output is cut off. */
const MAX_SPLIT_DEPTH = 2;

/**
 * Extracts source-grounded requirements from an ingested opportunity package.
 * The package comes from `ingestOpportunity()`; nothing here depends on a
 * program, a fiscal year or an opportunity ID. The model PROPOSES; code
 * verifies every citation against the stored document text and drops
 * anything it cannot verify.
 */
export async function extractRequirements(opportunityId: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const id = parseOpportunityId(opportunityId);
  const store = options.store ?? PackageStore.fromConfig();
  const now = options.now ?? (() => new Date());
  const limits = options.limits ?? DEFAULT_BATCH_LIMITS;
  const passes = Math.min(5, Math.max(1, Math.floor(options.passes ?? 1)));

  const manifest = await store.readManifest(id);
  if (!manifest) {
    throw new ExtractionError(`No ingested package for ${id}. Run: npm run nofo:ingest -- ${id}`);
  }

  // Only documents that parsed, and only those whose authority we can stand behind: controlling
  // documents always, guidance on request, never "unclassified" and never documents removed upstream.
  const wanted = new Set<string>(options.includeGuidance ? ['controlling', 'official_guidance'] : ['controlling']);
  const documents: VerifiableDocument[] = [];
  const titles = new Map<string, string>();
  const shas = new Map<string, string | null>();
  for (const entry of manifest.documents) {
    if (entry.retrieval.status === 'removed_upstream' || entry.processing.status !== 'parsed' || !wanted.has(entry.authority)) continue;
    const normalized = await store.readNormalized(id, entry.documentId);
    if (!normalized) continue;
    documents.push({ documentId: entry.documentId, authority: entry.authority, normalized });
    titles.set(entry.documentId, entry.title);
    shas.set(entry.documentId, entry.sha256);
  }
  if (documents.length === 0) {
    throw new ExtractionError(
      `No parsed ${options.includeGuidance ? 'controlling or guidance' : 'controlling'} document in the package for ${id} ` +
        `(coverage: ${manifest.coverage.status}). Re-run ingestion, or classify a document as controlling in supplemental.json.`
    );
  }

  const model = options.model ?? (options.llm ? 'injected-llm' : resolveExtractionModel());
  const sourceManifestHash = sha256Hex(
    documents
      .map((d) => `${d.documentId}:${shas.get(d.documentId) ?? ''}:${d.normalized.processorVersion}`)
      .sort()
      .join('\n')
  );

  // Cache: reuse when the source documents, prompt and model are unchanged and the last run was complete.
  if (!options.refresh) {
    const existing = await store.readRequirements(id).catch(() => null);
    if (
      existing &&
      existing.status === 'complete' &&
      existing.sourceManifestHash === sourceManifestHash &&
      existing.promptVersion === PROMPT_VERSION &&
      existing.passes >= passes &&
      existing.model === model
    ) {
      return { file: existing, cached: true };
    }
  }

  const llm = options.llm ?? createAnthropicLlm({ model: options.model });
  const baseBatches: Batch[] = documents.flatMap((d) =>
    makeBatches({ documentId: d.documentId, title: titles.get(d.documentId) ?? d.documentId, authority: d.authority, normalized: d.normalized }, limits)
  );
  // Each pass re-reads every batch independently; duplicates across passes are merged after verification.
  const batches: Batch[] = Array.from({ length: passes }, (_, k) =>
    baseBatches.map((b) => (passes > 1 ? { ...b, id: `${b.id}#${k + 1}` } : b))
  ).flat();
  const byId = new Map(documents.map((d) => [d.documentId, d]));

  const usage = { inputTokens: 0, outputTokens: 0 };

  async function runBatch(batch: Batch, depth = 0): Promise<BatchOutcome> {
    const call = { system: SYSTEM_PROMPT, user: buildUserMessage(batch), schema: WIRE_JSON_SCHEMA, maxTokens: options.maxTokens ?? 16_000 };
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try {
        result = await llm(call);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'model call failed' };
      }
      usage.inputTokens += result.inputTokens;
      usage.outputTokens += result.outputTokens;

      if (result.stopReason === 'refusal') return { ok: false, error: 'The model declined this batch (refusal).' };
      if (result.stopReason === 'max_tokens') {
        // Recover by splitting the batch in half rather than silently losing its pages.
        const halves = depth < MAX_SPLIT_DEPTH ? splitBatch(batch) : null;
        if (!halves) return { ok: false, error: 'The model output was cut off (max_tokens) and the batch could not be split further.' };
        const [a, b] = [await runBatch(halves[0], depth + 1), await runBatch(halves[1], depth + 1)];
        if (!a.ok) return a;
        if (!b.ok) return b;
        return {
          ok: true,
          candidates: [...a.candidates, ...b.candidates],
          invalidItems: a.invalidItems + b.invalidItems,
          splits: 1 + a.splits + b.splits,
        };
      }

      let envelope;
      try {
        envelope = WireEnvelopeSchema.safeParse(JSON.parse(result.text));
      } catch {
        envelope = null;
      }
      if (!envelope || !envelope.success) {
        if (attempt === 0) continue; // one retry for malformed output
        return { ok: false, error: 'The model returned output that did not match the schema.' };
      }

      const candidates: Candidate[] = [];
      let invalidItems = 0;
      for (const item of envelope.data.requirements) {
        const parsed = WireRequirementSchema.safeParse(item);
        if (parsed.success) candidates.push(toCandidate(parsed.data));
        else invalidItems += 1;
      }
      return { ok: true, candidates, invalidItems, splits: 0 };
    }
    return { ok: false, error: 'The model returned no usable output.' };
  }

  const outcomes = await mapLimit(batches, options.concurrency ?? 3, async (batch) => {
    const outcome = await runBatch(batch);
    logger.info(`Extraction batch ${batch.id}: ${outcome.ok ? `${outcome.candidates.length} candidates` : 'failed'}`);
    return { batch, outcome };
  });

  const failed = outcomes.filter((o) => !o.outcome.ok).map((o) => ({ batchId: o.batch.id, error: (o.outcome as { error: string }).error }));
  if (failed.length === batches.length) {
    throw new ExtractionError(`Every extraction batch failed. First error: ${failed[0]?.error ?? 'unknown'}`);
  }

  // ---- verify, then merge -------------------------------------------------------
  const rejections: Array<{ title: string; reason: string; detail: string }> = [];
  const reject = (title: string, reason: string, detail: string): void => {
    if (rejections.length < MAX_REJECTIONS_STORED) rejections.push({ title: title.slice(0, 200), reason, detail });
  };
  let candidateCount = 0;
  let rejectedCount = 0;
  let sourcesRejected = 0;
  let locationsCorrected = 0;
  let checksDropped = 0;
  const drafts: Draft[] = [];

  for (const { outcome } of outcomes) {
    if (!outcome.ok) continue;
    for (let i = 0; i < outcome.invalidItems; i++) {
      candidateCount += 1;
      rejectedCount += 1;
      reject('(unparseable candidate)', 'invalid_candidate', 'The item did not match the schema.');
    }
    for (const candidate of outcome.candidates) {
      candidateCount += 1;
      const verified = [];
      const reasons: string[] = [];
      for (const claim of candidate.sources) {
        const result = verifySource(claim, byId);
        if (result.ok) {
          verified.push(result.source);
          if (result.source.locationCorrected) locationsCorrected += 1;
        } else {
          sourcesRejected += 1;
          reasons.push(`${result.reason}: ${result.detail}`);
        }
      }
      if (verified.length === 0) {
        rejectedCount += 1;
        reject(candidate.title, 'no_verified_source', reasons.join(' | ').slice(0, 400) || 'no sources');
        continue;
      }

      const flags: string[] = [];
      if (candidate.ambiguous) flags.push(`flagged ambiguous by the model${candidate.ambiguityNote ? `: ${candidate.ambiguityNote}` : ''}`);
      if (reasons.length > 0) flags.push(`${reasons.length} cited source(s) could not be verified and were dropped`);
      let check = candidate.check;
      if (check && !checkSupportedByQuotes(check, verified.map((s) => s.quote))) {
        check = undefined;
        checksDropped += 1;
        flags.push('numeric check dropped: the number is not in the verified quote');
      }

      drafts.push({
        category: candidate.category,
        topic: candidate.topic,
        title: candidate.title,
        description: candidate.description,
        mandatory: candidate.mandatory,
        programVariant: candidate.programVariant,
        appliesWhen: candidate.appliesWhen,
        evidenceNeeded: candidate.evidenceNeeded,
        check,
        sources: verified,
        flags,
      });
    }
  }

  const { merged, mergedCount } = mergeDrafts(drafts);
  const requirements = finalizeRequirements(id, merged);

  const file: RequirementsFile = {
    schemaVersion: 1,
    opportunityId: id,
    generatedAt: now().toISOString(),
    model, // the model that was requested; it is also the cache identity
    promptVersion: PROMPT_VERSION,
    passes,
    sourceManifestHash,
    status: failed.length > 0 ? 'partial' : 'complete',
    documents: documents.map((d) => ({
      documentId: d.documentId,
      title: titles.get(d.documentId) ?? d.documentId,
      authority: d.authority,
      sha256: shas.get(d.documentId) ?? null,
      units: d.normalized.kind === 'pdf' ? d.normalized.pageCount : d.normalized.sections.length,
    })),
    batches: {
      total: batches.length,
      succeeded: batches.length - failed.length,
      split: outcomes.reduce((n, o) => n + (o.outcome.ok ? o.outcome.splits : 0), 0),
      failed,
    },
    usage,
    stats: {
      candidates: candidateCount,
      rejected: rejectedCount,
      merged: mergedCount,
      kept: requirements.length,
      sourcesRejected,
      locationsCorrected,
      checksDropped,
    },
    rejections,
    requirements,
  };

  await store.writeRequirements(id, file);
  logger.info(`Extracted ${requirements.length} requirements for ${id} (${failed.length} failed batches)`);
  return { file, cached: false };
}

