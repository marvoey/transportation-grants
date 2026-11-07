import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

type Listener = (event: { detail?: { on: boolean } }) => void;

/** Loads public/js/dev-mode.js the way a page would, with a fake document and storage. */
function load(storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | 'blocked') {
  const classes = new Set<string>();
  const events: Array<{ type: string; detail: { on: boolean } }> = [];
  const document = {
    body: {
      classList: {
        toggle(name: string, force: boolean) {
          if (force) classes.add(name); else classes.delete(name);
        },
        contains: (name: string) => classes.has(name),
      },
    },
    dispatchEvent(event: { type: string; detail: { on: boolean } }) {
      events.push(event);
      return true;
    },
  };
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const sandbox: Record<string, unknown> = {
    document,
    CustomEvent: class { type: string; detail: { on: boolean }; constructor(type: string, init: { detail: { on: boolean } }) { this.type = type; this.detail = init.detail; } },
  };
  sandbox.window = sandbox;
  sandbox.localStorage = storage === 'blocked' ? blocked : storage;
  vm.runInNewContext(read('public/js/dev-mode.js'), sandbox);
  return { mode: sandbox.DevMode as { isOn(): boolean; set(on: boolean): void }, classes, events };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

describe('developer mode switch', () => {
  it('is off by default', () => {
    const { mode, classes } = load(memoryStorage());
    expect(mode.isOn()).toBe(false);
    expect(classes.has('dev-mode')).toBe(false);
  });

  it('turns on and off, remembers the choice and announces the change', () => {
    const storage = memoryStorage();
    const { mode, classes, events } = load(storage);
    mode.set(true);
    expect(mode.isOn()).toBe(true);
    expect(classes.has('dev-mode')).toBe(true);
    expect(storage.data['grantflow.devMode']).toBe('on');
    mode.set(false);
    expect(classes.has('dev-mode')).toBe(false);
    expect(storage.data['grantflow.devMode']).toBe('off');
    expect(events.map((e) => [e.type, e.detail.on])).toEqual([['devmodechange', true], ['devmodechange', false]]);
  });

  it('starts on when the browser remembered it', () => {
    const { mode, classes } = load(memoryStorage({ 'grantflow.devMode': 'on' }));
    expect(mode.isOn()).toBe(true);
    expect(classes.has('dev-mode')).toBe(true);
  });

  it('still works for the life of the page when storage is blocked', () => {
    const { mode, classes } = load('blocked');
    expect(mode.isOn()).toBe(false);
    mode.set(true);
    expect(mode.isOn()).toBe(true);
    expect(classes.has('dev-mode')).toBe(true);
  });

  it('ignores any stored value except "on"', () => {
    expect(load(memoryStorage({ 'grantflow.devMode': 'true' })).mode.isOn()).toBe(false);
  });
});

describe('the Dev tray and what developer mode hides', () => {
  const html = read('public/chat.html');
  const css = read('public/css/style.css');
  const discover = read('public/js/discover.js');

  it('has a Dev tray with the switch, beside the Samples and Answers trays', () => {
    expect(html).toContain('id="devDrawer"');
    expect(html).toContain('id="devTab"');
    expect(html).toContain('id="devModeToggle"');
    expect(html).toMatch(/id="devStatus"[^>]*aria-live="polite"/);
    expect(html).toContain('id="samplesDrawer"');
    expect(html).toContain('id="answersDrawer"');
  });

  it('loads dev-mode.js before the scripts that read it, and the tray script after drawer-kit.js', () => {
    const at = (name: string) => html.indexOf(`/js/${name}`);
    expect(at('dev-mode.js')).toBeGreaterThan(-1);
    expect(at('dev-mode.js')).toBeLessThan(at('discover.js'));
    expect(at('drawer-kit.js')).toBeLessThan(at('dev-drawer.js'));
  });

  it('hides developer-only content unless the body has the dev-mode class', () => {
    expect(css).toMatch(/body:not\(\.dev-mode\) \.dev-only\s*\{\s*display: none !important;/);
  });

  it('marks the developer console and the raw-traffic option as developer-only', () => {
    expect(html).toMatch(/<details id="findConsole" class="dev-console dev-only"/);
    expect(html).toMatch(/<label class="dev-only"><input type="checkbox" id="findInspect">/);
  });

  it('marks the API calls, explanations and raw listings as developer-only, but not the results', () => {
    for (const marker of ['find-explanation', 'find-inspect-item', 'find-inspect', 'find-apicalls', 'find-scored', 'find-trace']) {
      expect(discover, marker).toMatch(new RegExp(`'[^']*\\b${marker} dev-only'`));
    }
    expect(discover).toContain("'nofo-collapsible dev-only'"); // "How the list was built"
    // The shortlist cards, the summary card, the questions and the disclaimer stay visible.
    expect(discover).toMatch(/var card = el\('div', 'card find-card'\)|function renderCard/);
    expect(discover).not.toMatch(/find-disclaimer[^']*dev-only/);
  });

  it('asks the server for raw traffic only while developer mode is on', () => {
    expect(discover).toContain('inspect: developerMode() && els.inspect.checked');
  });

  it('closes the Dev tray after the switch is used, like the other trays close after a copy', () => {
    const drawer = read('public/js/dev-drawer.js');
    expect(drawer).toMatch(/M\.set\(toggle\.checked\);[\s\S]*tray\.setOpen\(false, true\)/);
  });
});
