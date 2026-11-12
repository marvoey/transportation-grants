/**
 * Turns docs/GrantFlow_BigBuild_Live_App_Demo_Script.md into public/demo/demo-script.json, which the presenter window
 * (public/demo-script.html) shows next to the app in demo mode. The markdown stays the one place the script is edited:
 * run `npm run demo:script` after changing it. Plain Node, no dependencies.
 *
 * Reads: the title block (bold label lines), the numbered "Before recording" list, and every "### <time> — <title>" scene
 * with its SHOW/DO, SAY, DIRECTING NOTE and FALLBACK blocks, in order. Text keeps the markdown's **bold** and `code`
 * marks; the window renders them with textContent only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs', 'GrantFlow_BigBuild_Live_App_Demo_Script.md');
const target = join(root, 'public', 'demo', 'demo-script.json');

const lines = readFileSync(source, 'utf8').replace(/\r\n/g, '\n').split('\n');
const title = (lines.find((l) => l.startsWith('# ')) || '# Demo script').slice(2).trim();

const meta = [];
const setup = [];
const scenes = [];
let section = '';
let scene = null;
let block = null;

const kindOf = (label) => (/^SHOW/i.test(label) ? 'show' : /^SAY/i.test(label) ? 'say' : /^DIRECTING/i.test(label) ? 'note' : /^FALLBACK/i.test(label) ? 'fallback' : 'text');

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  const h2 = /^## (.+)/.exec(line);
  if (h2) { section = h2[1]; scene = null; block = null; continue; }
  const h3 = /^### (.+)/.exec(line);
  if (h3 && section.startsWith('Exact timed')) {
    const m = /^(\d+:\d\d[–-]\d+:\d\d) — (.+)$/.exec(h3[1]);
    scene = { time: m ? m[1] : '', title: m ? m[2] : h3[1], blocks: [] };
    scenes.push(scene);
    block = null;
    continue;
  }
  if (!section && /^\*\*[^*]+:\*\*/.test(line)) { meta.push(line.replace(/\s{2}$/, '')); continue; }
  if (section.startsWith('Before recording')) {
    const item = /^(\d+)\. (.+)/.exec(line);
    const sub = /^\s{2,}- (.+)/.exec(line);
    if (item) setup.push({ text: item[2], sub: [] });
    else if (sub && setup.length) setup[setup.length - 1].sub.push(sub[1]);
    continue;
  }
  if (!scene) continue;
  const labelled = /^\*\*([A-Z][A-Z/ —-]*[A-Z.:]?[^*]*?)(?::)?\*\*:?\s*(.*)$/.exec(line);
  if (labelled && kindOf(labelled[1]) !== 'text') {
    block = { kind: kindOf(labelled[1]), label: labelled[1].replace(/:$/, ''), text: labelled[2].trim() };
    scene.blocks.push(block);
    continue;
  }
  if (!block || !line.trim()) continue;
  const quote = /^>\s?(.*)$/.exec(line);
  const text = (quote ? quote[1] : line).trim();
  block.text = (block.text ? block.text + ' ' : '') + text;
}

for (const s of scenes) for (const b of s.blocks) if (b.kind === 'say') b.text = b.text.replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '');

// The exact messages to paste into the app: the bold-labelled sub-bullets of the setup item that gives them.
const messages = [];
for (const item of setup) {
  for (const sub of item.sub) {
    const m = /^\*\*([^*]+):\*\*\s*`([^`]+)`/.exec(sub);
    if (m) messages.push({ label: m[1], text: m[2] });
  }
}

if (scenes.length === 0 || messages.length === 0) {
  console.error('Could not read the scenes or the messages from the script: check its headings and bullets.');
  process.exit(1);
}

writeFileSync(target, JSON.stringify({ version: 1, title, meta, messages, setup, scenes }, null, 2) + '\n');
console.log(`Wrote ${target}: ${scenes.length} scenes, ${messages.length} messages, ${setup.length} setup items.`);
