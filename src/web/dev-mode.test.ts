import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

interface DevModeApi {
  sections: string[];
  isOn(): boolean;
  set(on: boolean): void;
  sectionOn(id: string): boolean;
  setSection(id: string, on: boolean): void;
  shows(id: string): boolean;
}

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
    JSON,
  };
  sandbox.window = sandbox;
  sandbox.localStorage = storage === 'blocked' ? blocked : storage;
  vm.runInNewContext(read('public/js/dev-mode.js'), sandbox);
  return { mode: sandbox.DevMode as DevModeApi, classes, events };
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

describe('developer sections', () => {
  const ids = ['console', 'apicalls', 'note', 'trace', 'built', 'scored'];

  it('are all ticked by default, but only show while developer mode is on', () => {
    const { mode } = load(memoryStorage());
    expect(mode.sections).toEqual(ids);
    for (const id of ids) {
      expect(mode.sectionOn(id)).toBe(true);
      expect(mode.shows(id)).toBe(false);
    }
    mode.set(true);
    for (const id of ids) expect(mode.shows(id)).toBe(true);
  });

  it('can be unticked one at a time: the body gets a dev-hide class and the choice is remembered', () => {
    const storage = memoryStorage();
    const { mode, classes } = load(storage);
    mode.set(true);
    mode.setSection('trace', false);
    expect(mode.sectionOn('trace')).toBe(false);
    expect(mode.shows('trace')).toBe(false);
    expect(mode.shows('scored')).toBe(true);
    expect(classes.has('dev-hide-trace')).toBe(true);
    expect(classes.has('dev-hide-scored')).toBe(false);
    expect(JSON.parse(storage.data['grantflow.devSections'])).toEqual(ids.filter((id) => id !== 'trace'));
    mode.setSection('trace', true);
    expect(classes.has('dev-hide-trace')).toBe(false);
  });

  it('are restored from storage, and damaged or unknown storage means all ticked', () => {
    const restored = load(memoryStorage({ 'grantflow.devSections': JSON.stringify(['console', 'scored', 'bogus']) }));
    expect(ids.filter((id) => restored.mode.sectionOn(id))).toEqual(['console', 'scored']);
    expect(restored.classes.has('dev-hide-note')).toBe(true);
    for (const bad of ['not json', '{"a":1}', '"console"', 'null']) {
      const { mode } = load(memoryStorage({ 'grantflow.devSections': bad }));
      expect(ids.every((id) => mode.sectionOn(id)), bad).toBe(true);
    }
  });

  it('ignore an unknown id and announce each change', () => {
    const { mode, events } = load(memoryStorage());
    mode.setSection('nope', false);
    expect(events).toHaveLength(0);
    mode.setSection('note', false);
    expect(events).toHaveLength(1);
    expect((events[0].detail as unknown as { sections: Record<string, boolean> }).sections.note).toBe(false);
  });

  it('still work when storage is blocked', () => {
    const { mode } = load('blocked');
    mode.set(true);
    mode.setSection('built', false);
    expect(mode.shows('built')).toBe(false);
    expect(mode.shows('console')).toBe(true);
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

  it('marks the developer console and the raw-traffic option as developer-only sections', () => {
    expect(html).toMatch(/<details id="findConsole" class="dev-console dev-only dev-section-console"/);
    expect(html).toMatch(/<label class="dev-only dev-section-apicalls"><input type="checkbox" id="findInspect">/);
  });

  it('has one checkbox per section in the Dev tray, and a CSS rule that hides each unticked section', () => {
    for (const id of ['console', 'apicalls', 'note', 'trace', 'built', 'scored']) {
      expect(html, id).toContain(`data-dev-section="${id}"`);
      expect(css, id).toContain(`body.dev-hide-${id} .dev-section-${id}`);
    }
  });

  it('marks the API calls, explanations and raw listings as developer-only, but not the results', () => {
    const sections: Record<string, string> = {
      'find-explanation': 'note',
      'find-inspect-item': 'apicalls',
      'find-inspect': 'apicalls',
      'find-apicalls': 'apicalls',
      'find-scored': 'scored',
      'find-trace': 'trace',
    };
    for (const [marker, section] of Object.entries(sections)) {
      expect(discover, marker).toMatch(new RegExp(`'[^']*\\b${marker} dev-only dev-section-${section}'`));
    }
    expect(discover).toContain("'nofo-collapsible dev-only dev-section-built'"); // "How the list was built"
    // The shortlist cards, the summary card, the questions and the disclaimer stay visible.
    expect(discover).toMatch(/var card = el\('div', 'card find-card'\)|function renderCard/);
    expect(discover).not.toMatch(/find-disclaimer[^']*dev-only/);
  });

  it('asks the server for raw traffic only while the API calls section is showing', () => {
    expect(discover).toContain("inspect: developerShows('apicalls') && els.inspect.checked");
  });

  it('closes the Dev tray after the switch is used, like the other trays close after a copy', () => {
    const drawer = read('public/js/dev-drawer.js');
    expect(drawer).toMatch(/M\.set\(toggle\.checked\);[\s\S]*tray\.setOpen\(false, true\)/);
  });

  it('keeps the tray open when a section checkbox is used, so several can be changed at once', () => {
    const drawer = read('public/js/dev-drawer.js');
    const sectionHandler = drawer.slice(drawer.indexOf('boxes.forEach(function (box) {\n      box.addEventListener'));
    expect(sectionHandler).toContain('M.setSection(');
    expect(sectionHandler.slice(0, sectionHandler.indexOf('// Kept in step'))).not.toContain('setOpen');
  });
});
