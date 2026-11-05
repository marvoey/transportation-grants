import { promises as fs } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The guide requires generic acquisition: no program-specific code. This
 * guard fails if production source under src/nofo names a program, a fiscal
 * year, or hardcodes an opportunity UUID. Test code and fixtures may.
 */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__') continue;
      out.push(...(await sourceFiles(full)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('src/nofo contains no program-specific logic', () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ['a program name (BUILD, WCPP, INFRA, ...)', /\b(BUILD|WCPP|INFRA|RAISE|TIGER|NHTSA|FMCSA|FHWA|FTA)\b/],
    ['a fiscal-year literal', /\bFY\s?-?\d{2,4}\b/i],
    ['a hardcoded UUID', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
    ['an opportunity number literal', /\b[A-Z]{2,6}\d{2}-\d{2}-[A-Z]{2}-[A-Z]+\b/],
  ];

  it('scans the production sources', async () => {
    const files = await sourceFiles(new URL('.', import.meta.url).pathname);
    expect(files.length).toBeGreaterThan(10); // the scan really ran
    const hits: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf-8');
      for (const [label, pattern] of FORBIDDEN) {
        const match = pattern.exec(text);
        if (match) hits.push(`${file.split('/src/')[1]}: ${label}: "${match[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });
});
