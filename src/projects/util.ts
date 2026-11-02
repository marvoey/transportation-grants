import { createHash } from 'crypto';

/** JSON with object keys sorted, so equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
