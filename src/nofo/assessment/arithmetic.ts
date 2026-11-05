import type { ProjectFacts } from './schemas.js';

/**
 * Simple deterministic arithmetic over the stated money facts. The total
 * project cost and the federal request are separate facts and are never
 * conflated; the federal share is (request + other federal funds) / total,
 * the way funding notices define it.
 */
export interface Derived {
  requestedFederalUsd: number | null;
  otherFederalFundsUsd: number | null;
  nonFederalMatchUsd: number | null;
  totalProjectCostUsd: number | null;
  /** request + other federal + non-federal match, when enough is known. */
  impliedTotalUsd: number | null;
  /** The total used for percentages: the stated one if given, else the implied one. */
  totalUsedUsd: number | null;
  totalSource: 'stated' | 'implied' | null;
  federalSharePct: number | null;
  nonFederalSharePct: number | null;
  /** Things assumed to get a number; always shown to the user. */
  assumptions: string[];
  consistency: { status: 'consistent' | 'inconsistent' | 'incomplete'; message: string };
}

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function deriveArithmetic(facts: ProjectFacts): Derived {
  const request = facts.requestedFederalUsd?.value ?? null;
  const otherRaw = facts.otherFederalFundsUsd?.value ?? null;
  const match = facts.nonFederalMatchUsd?.value ?? null;
  const total = facts.totalProjectCostUsd?.value ?? null;
  const assumptions: string[] = [];

  // Unstated other federal funds are treated as none, and we say so.
  const other = otherRaw ?? 0;
  const otherAssumed = request !== null && otherRaw === null;
  if (otherAssumed) assumptions.push('Assumes no other federal funds, since none were stated.');

  const impliedTotal = request !== null && match !== null ? request + other + match : null;
  const totalUsed = total ?? impliedTotal;
  const totalSource = total !== null ? 'stated' : impliedTotal !== null ? 'implied' : null;
  if (totalSource === 'implied') {
    assumptions.push(`Total project cost not stated; using the sum of the stated amounts (${usd(impliedTotal as number)}).`);
  }

  const federalSharePct = request !== null && totalUsed !== null && totalUsed > 0 ? round2(((request + other) / totalUsed) * 100) : null;
  const nonFederalSharePct = match !== null && totalUsed !== null && totalUsed > 0 ? round2((match / totalUsed) * 100) : null;

  let consistency: Derived['consistency'];
  if (total !== null && impliedTotal !== null) {
    const parts = [request, otherRaw !== null ? otherRaw : null, match].filter((n): n is number => n !== null);
    const sum = `${parts.map(usd).join(' + ')} = ${usd(impliedTotal)}`;
    consistency =
      Math.abs(total - impliedTotal) <= 0.5
        ? { status: 'consistent', message: `The amounts add up: ${sum}, which matches the stated total project cost of ${usd(total)}.` }
        : { status: 'inconsistent', message: `The amounts do not add up: ${sum}, but the stated total project cost is ${usd(total)}.` };
  } else {
    consistency = { status: 'incomplete', message: 'Not enough amounts have been given to check that the numbers add up.' };
  }

  return {
    requestedFederalUsd: request,
    otherFederalFundsUsd: otherRaw,
    nonFederalMatchUsd: match,
    totalProjectCostUsd: total,
    impliedTotalUsd: impliedTotal,
    totalUsedUsd: totalUsed,
    totalSource,
    federalSharePct,
    nonFederalSharePct,
    assumptions,
    consistency,
  };
}

export { usd as formatUsd };
