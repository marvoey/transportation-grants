import type { Authority } from '../schemas.js';

/**
 * Deterministic authority classification (no LLM). It is a TRIAGE AID, not a
 * legal determination:
 *  - documents that are derivative of a NOFO (FAQ, Q&A, checklist, template,
 *    webinar, instructions, guide) are `official_guidance`, even when their
 *    title mentions the NOFO;
 *  - documents that look like the NOFO or an amendment are `controlling`;
 *  - everything else is `unclassified` and is treated as non-controlling
 *    downstream until a curator overrides it.
 */
const GUIDANCE_PATTERNS: Array<[RegExp, string]> = [
  [/\bfaqs?\b/, 'faq'],
  [/\bfrequently asked\b/, 'frequently asked'],
  [/\bquestions? and answers?\b/, 'questions and answers'],
  [/\bq\s*&\s*a\b/, 'q&a'],
  [/\bq and a\b/, 'q and a'],
  [/\bchecklists?\b/, 'checklist'],
  [/\binstructions?\b/, 'instructions'],
  [/\bguide(s|lines?)?\b/, 'guide'],
  [/\btemplates?\b/, 'template'],
  [/\bwebinars?\b/, 'webinar'],
  [/\boffice hours\b/, 'office hours'],
  [/\badditional resources\b/, 'additional resources'],
];

const CONTROLLING_PATTERNS: Array<[RegExp, string]> = [
  [/\bnofo\b/, 'nofo'],
  [/\bnotice of funding\b/, 'notice of funding'],
  [/\bfunding opportunity announcement\b/, 'funding opportunity announcement'],
  [/\bfoa\b/, 'foa'],
  [/\bamendments?\b/, 'amendment'],
  [/\bmodifications?\b/, 'modification'],
];

export interface AuthorityResult {
  authority: Authority;
  reason: string;
}

export function classifyAuthority(fileName: string, description: string | null): AuthorityResult {
  // File names use underscores/dots/hyphens as separators, which defeat \b.
  const text = `${fileName} ${description ?? ''}`.toLowerCase().replace(/[_.\-]+/g, ' ');

  for (const [pattern, label] of GUIDANCE_PATTERNS) {
    if (pattern.test(text)) {
      return { authority: 'official_guidance', reason: `heuristic: matched "${label}" (derivative or supporting document)` };
    }
  }
  for (const [pattern, label] of CONTROLLING_PATTERNS) {
    if (pattern.test(text)) {
      return { authority: 'controlling', reason: `heuristic: matched "${label}" (candidate controlling document; confirm)` };
    }
  }
  return { authority: 'unclassified', reason: 'heuristic: no recognizable NOFO, amendment or guidance pattern' };
}
