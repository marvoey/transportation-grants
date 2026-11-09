// Copies the Reveal.js files the presentation needs from node_modules into public/vendor/reveal/,
// so /big-build.html works with no CDN and no node_modules at run time.
//
//   npm run presentation:vendor
//
// Needs `reveal.js` installed (pinned in package.json). The copy is committed on purpose.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'reveal.js');
const dest = join(root, 'public', 'vendor', 'reveal');

if (!existsSync(join(src, 'dist', 'reveal.js'))) {
  console.error('reveal.js is not installed. Run: npm install --save-exact reveal.js@<version>');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

cpSync(join(src, 'dist', 'reveal.js'), join(dest, 'reveal.js'));
cpSync(join(src, 'dist', 'reveal.css'), join(dest, 'reveal.css'));
cpSync(join(src, 'dist', 'reset.css'), join(dest, 'reset.css'));
mkdirSync(join(dest, 'plugin'), { recursive: true });
cpSync(join(src, 'dist', 'plugin', 'notes.js'), join(dest, 'plugin', 'notes.js'));
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'));

const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf-8')).version;
console.log(`Copied reveal.js ${version} to public/vendor/reveal/`);
