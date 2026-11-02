import type { ChangeOp, Profile, ReadinessAssessment } from './schemas.js';

/** Discovery steps shown in the workspace (§3 of the plan). */
export const DISCOVERY_STEPS = [
  'applicant_location',
  'problem_beneficiaries',
  'activities_outcomes',
  'cost_match',
  'schedule_readiness',
  'review',
] as const;
export type DiscoveryStep = (typeof DISCOVERY_STEPS)[number];

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Everything the agent may see, all loaded server-side. The browser supplies none of it. */
export interface AgentInput {
  requestId: string;
  profile: Profile;
  missingFields: ReadinessAssessment['missingFields'];
  /** Chronological, bounded; the last entry is the current user message. */
  history: AgentHistoryMessage[];
}

/** A validated change plus its rationale and the precondition it was proposed against. */
export interface AgentChange {
  op: ChangeOp;
  path: string;
  value?: unknown;
  itemId?: string;
  rationale: string;
  /** Absent for `add`. Computed from the profile snapshot the model saw. */
  basis?: unknown;
}

export interface AgentResult {
  reply: string;
  questions: Array<{ field: string; text: string }>;
  changes: AgentChange[];
  suggestedNextStep: DiscoveryStep;
  usage?: { inputTokens: number; outputTokens: number };
}

export type DiscoveryAgent = (input: AgentInput) => Promise<AgentResult>;

export interface DiscoveryDeps {
  runAgent: DiscoveryAgent;
  /** False when no provider credentials are configured (503 MISSING_CONFIG, nothing stored). */
  isConfigured: () => boolean;
  timeoutMs: number;
  /** An in_progress turn older than timeoutMs + graceMs is treated as failed. */
  graceMs: number;
  dailyLimit: number;
  /** Max persisted messages sent to the model. */
  historyMessages: number;
}
