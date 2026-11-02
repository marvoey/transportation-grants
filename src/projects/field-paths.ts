import { z } from 'zod';
import {
  ApplicantTypeSchema,
  CentsSchema,
  ChangeInput,
  ChangeInputSchema,
  HttpUrlSchema,
  IsoDateSchema,
  LIMITS,
  ModeSchema,
  PhaseSchema,
  Profile,
  ProfileSchema,
  ReadinessStatusSchema,
  StateCodeSchema,
  boundedString,
} from './schemas.js';
import { deepEqual } from './util.js';

/**
 * Appendix A of the plan as data. This registry is the single source for
 * which profile paths exist, which operations each allows, and how values are
 * validated. PATCH bodies, agent `proposedChanges`, `questions[].field`,
 * `unknowns` entries and readiness all derive from it, so the names cannot
 * drift between schema, API, agent and browser.
 */

export type Actor = 'user' | 'agent';

/** Thrown for a rejected change. `VALIDATION_ERROR` => 400, `INVALID_PROFILE` => 422. */
export class ChangeError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'INVALID_PROFILE' = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'ChangeError';
  }
}

interface BaseSpec {
  path: string;
  label: string;
}

export interface ScalarSpec extends BaseSpec {
  kind: 'scalar';
  schema: z.ZodTypeAny;
  nullable: boolean;
}

export interface StringListSpec extends BaseSpec {
  kind: 'stringList';
  item: z.ZodTypeAny;
}

export interface ObjectListSpec extends BaseSpec {
  kind: 'objectList';
  /** Value accepted by `add`, per actor (without server-set fields). */
  add: Record<Actor, z.ZodObject<any>>;
  /** Partial value accepted by `update`, per actor. */
  update: Record<Actor, z.ZodObject<any>>;
  /** Build the stored item from a validated add value. */
  build: (value: any, ctx: { id: string; actor: Actor }) => Record<string, unknown>;
}

export type PathSpec = ScalarSpec | StringListSpec | ObjectListSpec;

const scalar = (path: string, label: string, schema: z.ZodTypeAny, nullable = true): ScalarSpec => ({
  kind: 'scalar',
  path,
  label,
  schema,
  nullable,
});
const list = (path: string, label: string, item: z.ZodTypeAny): StringListSpec => ({
  kind: 'stringList',
  path,
  label,
  item,
});

const optionalNullable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

const evidenceFields = {
  description: boundedString(LIMITS.text),
  sourceUrl: HttpUrlSchema.nullable(),
};
const outcomeFields = {
  description: boundedString(LIMITS.text),
  metric: boundedString(LIMITS.item).nullable(),
  baseline: z.number().finite().min(-LIMITS.numberAbs).max(LIMITS.numberAbs).nullable(),
  target: z.number().finite().min(-LIMITS.numberAbs).max(LIMITS.numberAbs).nullable(),
  unit: boundedString(LIMITS.item).nullable(),
};
const milestoneFields = {
  name: boundedString(LIMITS.item),
  date: IsoDateSchema.nullable(),
};

const evidenceSpec: ObjectListSpec = {
  kind: 'objectList',
  path: 'need.evidence',
  label: 'Evidence',
  add: {
    user: z.object({ description: evidenceFields.description, sourceUrl: optionalNullable(HttpUrlSchema) }).strict(),
    agent: z.object({ description: evidenceFields.description, sourceUrl: optionalNullable(HttpUrlSchema) }).strict(),
  },
  update: {
    user: z.object(evidenceFields).partial().strict(),
    agent: z.object(evidenceFields).partial().strict(),
  },
  build: (v, { id, actor }) => ({
    id,
    description: v.description,
    sourceUrl: v.sourceUrl ?? null,
    suppliedBy: actor,
    verified: false,
  }),
};

const outcomesSpec: ObjectListSpec = {
  kind: 'objectList',
  path: 'outcomes',
  label: 'Outcomes',
  add: {
    user: z
      .object({
        description: outcomeFields.description,
        metric: optionalNullable(outcomeFields.metric.unwrap()),
        baseline: optionalNullable(outcomeFields.baseline.unwrap()),
        target: optionalNullable(outcomeFields.target.unwrap()),
        unit: optionalNullable(outcomeFields.unit.unwrap()),
      })
      .strict(),
    agent: z
      .object({
        description: outcomeFields.description,
        metric: optionalNullable(outcomeFields.metric.unwrap()),
        baseline: optionalNullable(outcomeFields.baseline.unwrap()),
        target: optionalNullable(outcomeFields.target.unwrap()),
        unit: optionalNullable(outcomeFields.unit.unwrap()),
      })
      .strict(),
  },
  update: {
    user: z.object(outcomeFields).partial().strict(),
    agent: z.object(outcomeFields).partial().strict(),
  },
  build: (v, { id }) => ({
    id,
    description: v.description,
    metric: v.metric ?? null,
    baseline: v.baseline ?? null,
    target: v.target ?? null,
    unit: v.unit ?? null,
  }),
};

const milestonesSpec: ObjectListSpec = {
  kind: 'objectList',
  path: 'schedule.milestones',
  label: 'Milestones',
  add: {
    user: z.object({ name: milestoneFields.name, date: optionalNullable(IsoDateSchema) }).strict(),
    agent: z.object({ name: milestoneFields.name, date: optionalNullable(IsoDateSchema) }).strict(),
  },
  update: {
    user: z.object(milestoneFields).partial().strict(),
    agent: z.object(milestoneFields).partial().strict(),
  },
  build: (v, { id }) => ({ id, name: v.name, date: v.date ?? null }),
};

const assumptionsSpec: ObjectListSpec = {
  kind: 'objectList',
  path: 'assumptions',
  label: 'Assumptions',
  add: {
    // Only a direct user edit may supply `confirmed`.
    user: z.object({ text: boundedString(LIMITS.text), confirmed: z.boolean().optional() }).strict(),
    agent: z.object({ text: boundedString(LIMITS.text) }).strict(),
  },
  update: {
    user: z.object({ text: boundedString(LIMITS.text), confirmed: z.boolean() }).partial().strict(),
    agent: z.object({ text: boundedString(LIMITS.text) }).partial().strict(),
  },
  build: (v, { id, actor }) => ({
    id,
    text: v.text,
    confirmed: actor === 'user' ? v.confirmed === true : false,
  }),
};

const SPECS: PathSpec[] = [
  scalar('name', 'Project name', boundedString(LIMITS.name), false),
  scalar('summary', 'Summary', boundedString(LIMITS.text)),
  scalar('applicant.name', 'Applicant name', boundedString(LIMITS.item)),
  scalar('applicant.type', 'Applicant type', ApplicantTypeSchema),
  list('applicant.partners', 'Partners', boundedString(LIMITS.item)),
  scalar('location.state', 'State', StateCodeSchema),
  scalar('location.county', 'County', boundedString(LIMITS.item)),
  scalar('location.city', 'City', boundedString(LIMITS.item)),
  scalar('location.serviceArea', 'Service area', boundedString(LIMITS.item)),
  scalar('need.problem', 'Problem', boundedString(LIMITS.text)),
  evidenceSpec,
  list('need.beneficiaries', 'Beneficiaries', boundedString(LIMITS.item)),
  list('scope.modes', 'Modes', ModeSchema),
  list('scope.activities', 'Activities', boundedString(LIMITS.item)),
  list('scope.assets', 'Assets', boundedString(LIMITS.item)),
  scalar('scope.phase', 'Project phase', PhaseSchema),
  outcomesSpec,
  scalar('budget.totalCostCents', 'Total cost', CentsSchema),
  scalar('budget.requestedFundingCents', 'Requested funding', CentsSchema),
  scalar('budget.matchAmountCents', 'Match amount', CentsSchema),
  list('budget.matchSources', 'Match sources', boundedString(LIMITS.item)),
  scalar('budget.estimateBasis', 'Estimate basis', boundedString(LIMITS.text)),
  scalar('schedule.startDate', 'Start date', IsoDateSchema),
  scalar('schedule.endDate', 'End date', IsoDateSchema),
  milestonesSpec,
  scalar('readiness.planningStatus', 'Planning status', ReadinessStatusSchema),
  scalar('readiness.designStatus', 'Design status', ReadinessStatusSchema),
  scalar('readiness.environmentalStatus', 'Environmental status', ReadinessStatusSchema),
  scalar('readiness.rightOfWayStatus', 'Right-of-way status', ReadinessStatusSchema),
  list('constraints', 'Constraints', boundedString(LIMITS.item)),
  // `unknowns` values are validated specially (must be allowlisted paths).
  list('unknowns', 'Unknowns', z.string()),
  assumptionsSpec,
];

export const PATH_SPECS: ReadonlyMap<string, PathSpec> = new Map(SPECS.map((s) => [s.path, s]));
export const ALL_PATHS: readonly string[] = SPECS.map((s) => s.path);

/** Paths a user can mark "unknown": everything except the name and the unknowns list itself. */
export const UNKNOWN_ELIGIBLE_PATHS: readonly string[] = ALL_PATHS.filter(
  (p) => p !== 'name' && p !== 'unknowns'
);

export function isAllowedPath(path: string): boolean {
  return PATH_SPECS.has(path);
}

export function pathLabel(path: string): string {
  return PATH_SPECS.get(path)?.label ?? path;
}

// ---------------------------------------------------------------------------
// Path access

export function getAtPath(profile: Profile, path: string): unknown {
  let cur: any = profile;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAtPath(profile: Profile, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: any = profile;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Validation of a single change

export interface ValidChange {
  op: ChangeInput['op'];
  path: string;
  spec: PathSpec;
  /** Validated (and normalized) value for set/add/update; undefined for remove of objects. */
  value?: unknown;
  itemId?: string;
}

function parseOrThrow<T>(schema: z.ZodType<T, any, any>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.errors.map((e) => `${e.path.join('.') || 'value'}: ${e.message}`).join('; ');
    throw new ChangeError(`${what}: ${msg}`);
  }
  return r.data;
}

/** Validate one change against the registry. Throws ChangeError. */
export function validateChange(raw: unknown, actor: Actor): ValidChange {
  const change = parseOrThrow(ChangeInputSchema, raw, 'Invalid change');
  const spec = PATH_SPECS.get(change.path);
  if (!spec) throw new ChangeError(`Path not allowed: ${change.path}`);
  const where = `${change.op} ${change.path}`;

  if (spec.kind === 'scalar') {
    if (change.op !== 'set') throw new ChangeError(`Operation ${change.op} not allowed on ${change.path}`);
    if (change.itemId !== undefined) throw new ChangeError(`${where}: itemId not allowed`);
    if (change.value === undefined) throw new ChangeError(`${where}: value is required (use null for unknown)`);
    if (change.value === null) {
      if (!spec.nullable) throw new ChangeError(`${where}: value must not be null`);
      return { op: 'set', path: change.path, spec, value: null };
    }
    return { op: 'set', path: change.path, spec, value: parseOrThrow(spec.schema, change.value, where) };
  }

  if (spec.kind === 'stringList') {
    if (change.op !== 'add' && change.op !== 'remove') {
      throw new ChangeError(`Operation ${change.op} not allowed on ${change.path}`);
    }
    if (change.itemId !== undefined) throw new ChangeError(`${where}: itemId not allowed`);
    const value = parseOrThrow(spec.item, change.value, where);
    if (change.path === 'unknowns' && !UNKNOWN_ELIGIBLE_PATHS.includes(value as string)) {
      throw new ChangeError(`${where}: "${String(value)}" is not an allowlisted field path`);
    }
    return { op: change.op, path: change.path, spec, value };
  }

  // objectList
  if (change.op === 'set') throw new ChangeError(`Operation set not allowed on ${change.path}`);
  if (change.op === 'add') {
    if (change.itemId !== undefined) throw new ChangeError(`${where}: itemId not allowed`);
    return { op: 'add', path: change.path, spec, value: parseOrThrow(spec.add[actor], change.value, where) };
  }
  if (change.itemId === undefined) throw new ChangeError(`${where}: itemId is required`);
  if (change.op === 'remove') {
    if (change.value !== undefined) throw new ChangeError(`${where}: value not allowed`);
    return { op: 'remove', path: change.path, spec, itemId: change.itemId };
  }
  const value = parseOrThrow(spec.update[actor], change.value, where);
  if (Object.keys(value as object).length === 0) throw new ChangeError(`${where}: no fields to update`);
  return { op: 'update', path: change.path, spec, value, itemId: change.itemId };
}

// ---------------------------------------------------------------------------
// Applying changes

export interface ApplyContext {
  actor: Actor;
  newId: () => string;
}

export interface ApplyResult {
  profile: Profile;
  /** Paths whose value changed (for field metadata). */
  touched: string[];
}

/**
 * Pure: validates and applies `changes` to a copy of `profile`. All or none —
 * throws ChangeError on the first problem. Revalidates the whole result
 * (bounds and cross-field rules => INVALID_PROFILE).
 */
export function applyChanges(profile: Profile, rawChanges: unknown[], ctx: ApplyContext): ApplyResult {
  const next: Profile = structuredClone(profile);
  const touched = new Set<string>();

  for (const raw of rawChanges) {
    const change = validateChange(raw, ctx.actor);
    applyOne(next, change, ctx, touched);
  }

  const parsed = ProfileSchema.safeParse(next);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new ChangeError(`Resulting profile is invalid: ${msg}`, 'INVALID_PROFILE');
  }
  assertUnknownsValid(parsed.data);
  return { profile: parsed.data, touched: [...touched] };
}

function applyOne(profile: Profile, c: ValidChange, ctx: ApplyContext, touched: Set<string>): void {
  const { spec } = c;
  const where = `${c.op} ${c.path}`;

  if (spec.kind === 'scalar') {
    setAtPath(profile, c.path, c.value);
    touched.add(c.path);
    // Setting an unknown path to a real value removes it from unknowns.
    if (c.value !== null) removeUnknown(profile, c.path);
    return;
  }

  const current = getAtPath(profile, c.path) as any[];

  if (spec.kind === 'stringList') {
    if (c.op === 'add') {
      if (!current.includes(c.value)) {
        current.push(c.value);
        touched.add(c.path);
      }
      if (c.path !== 'unknowns') removeUnknown(profile, c.path);
    } else {
      const idx = current.indexOf(c.value);
      if (idx === -1) throw new ChangeError(`${where}: value not found`);
      current.splice(idx, 1);
      touched.add(c.path);
    }
    return;
  }

  // objectList
  if (c.op === 'add') {
    current.push(spec.build(c.value, { id: ctx.newId(), actor: ctx.actor }));
    touched.add(c.path);
    removeUnknown(profile, c.path);
    return;
  }
  const idx = current.findIndex((item) => item.id === c.itemId);
  if (idx === -1) throw new ChangeError(`${where}: item ${c.itemId} not found`);
  if (c.op === 'remove') {
    current.splice(idx, 1);
  } else {
    current[idx] = { ...current[idx], ...(c.value as object) };
  }
  touched.add(c.path);
}

function removeUnknown(profile: Profile, path: string): void {
  const i = profile.unknowns.indexOf(path);
  if (i !== -1) profile.unknowns.splice(i, 1);
}

/** Stored/updated profiles must only list allowlisted paths in `unknowns`. */
export function assertUnknownsValid(profile: Profile): void {
  for (const p of profile.unknowns) {
    if (!UNKNOWN_ELIGIBLE_PATHS.includes(p)) {
      throw new ChangeError(`unknowns: "${p}" is not an allowlisted field path`, 'INVALID_PROFILE');
    }
  }
}

// ---------------------------------------------------------------------------
// Suggestion basis (precondition checked at apply time)

/**
 * The precondition a change was proposed against. `add` has none — additions
 * do not conflict with concurrent edits.
 */
export function computeBasis(profile: Profile, c: ValidChange): unknown {
  if (c.op === 'add') return undefined;
  if (c.spec.kind === 'scalar') return getAtPath(profile, c.path) ?? null;
  if (c.spec.kind === 'stringList') return c.value; // remove: the string must still be present
  const item = (getAtPath(profile, c.path) as any[]).find((i) => i.id === c.itemId);
  return item === undefined ? undefined : structuredClone(item);
}

/** True when the change's precondition still holds against the current profile. */
export function basisHolds(profile: Profile, c: ValidChange, basis: unknown): boolean {
  if (c.op === 'add') return true;
  if (c.spec.kind === 'scalar') return deepEqual(getAtPath(profile, c.path) ?? null, basis ?? null);
  if (c.spec.kind === 'stringList') return (getAtPath(profile, c.path) as unknown[]).includes(c.value);
  const item = (getAtPath(profile, c.path) as any[]).find((i) => i.id === c.itemId);
  return item !== undefined && deepEqual(item, basis);
}

/** One line per allowlisted path describing how it may be changed (used in the agent prompt). */
export function describePathsForPrompt(): string {
  return SPECS.map((spec) => {
    if (spec.kind === 'scalar') {
      return `- ${spec.path}: op "set"; value ${spec.nullable ? 'or null for unknown' : '(required, never null)'}`;
    }
    if (spec.kind === 'stringList') {
      const note = spec.path === 'unknowns' ? ' (value must itself be one of these paths)' : '';
      return `- ${spec.path}: op "add" or "remove"; value is one string${note}`;
    }
    const fields = Object.keys(spec.add.agent.shape).join(', ');
    return `- ${spec.path}: op "add" (value object with: ${fields}), "update" (itemId + partial value), or "remove" (itemId)`;
  }).join('\n');
}

/** Does the profile hold a non-empty value at `path`? (used by readiness) */
export function hasValue(profile: Profile, path: string): boolean {
  const v = getAtPath(profile, path);
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

