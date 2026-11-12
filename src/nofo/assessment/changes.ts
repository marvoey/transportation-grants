import type { Finding, FindingStatus } from './schemas.js';

/**
 * What moved since the last message: the findings that became supported (settled) and the ones that turned into a concern
 * (a possible conflict or something for a specialist). Plain code on two sets of statuses, so it can say "your answer settled
 * two items and raised one new concern" without a model. The page sends the previous statuses back with the next message.
 */
export interface Changes {
  settled: string[];
  concerns: string[];
  /** One plain sentence, written by code. */
  line: string;
}

const short = (title: string): string => (title.length > 70 ? `${title.slice(0, 69).trim()}…` : title);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Null when there is nothing to compare with (the first message). */
export function diffFindings(previous: Record<string, FindingStatus> | undefined, findings: Finding[]): Changes | null {
  if (!previous || Object.keys(previous).length === 0) return null;
  const settled: string[] = [];
  const concerns: string[] = [];
  for (const f of findings) {
    const before = previous[f.requirementId];
    if (!before || before === f.status) continue;
    if (f.status === 'supported') settled.push(f.title);
    else if ((f.status === 'conflict' || f.status === 'needs_specialist_review') && (before === 'unknown' || before === 'supported')) concerns.push(f.title);
  }
  const parts: string[] = [];
  const names = (titles: string[]): string => `${titles.slice(0, 2).map(short).join('; ')}${titles.length > 2 ? `; and ${titles.length - 2} more` : ''}`;
  if (settled.length > 0) parts.push(`${plural(settled.length, 'item', 'items')} settled (${names(settled)})`);
  if (concerns.length > 0) parts.push(`${plural(concerns.length, 'new concern', 'new concerns')} (${names(concerns)})`);
  const line = parts.length > 0 ? `Since your last message: ${parts.join(', and ')}.` : 'Since your last message, nothing in the findings changed.';
  return { settled, concerns, line };
}
