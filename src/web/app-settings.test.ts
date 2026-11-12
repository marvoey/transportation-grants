import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

interface SettingsApi {
  showFindNotice(): boolean;
  setShowFindNotice(on: boolean): void;
  simulatePrepare(): boolean;
  setSimulatePrepare(on: boolean): void;
  hideAssessNotice(): boolean;
  setHideAssessNotice(on: boolean): void;
}

const KEY = 'grantflow.showFindNotice';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

/** Loads public/js/app-settings.js the way a page would, with a fake document (holding the notice) and storage. */
function load(storage: ReturnType<typeof memoryStorage> | 'blocked', options: { notice?: boolean } = {}) {
  const notice = { hidden: true };
  const assessNotice = { hidden: false };
  const events: Array<{ type: string; detail: { showFindNotice: boolean } }> = [];
  const document = {
    readyState: 'complete',
    getElementById: (id: string) => (id === 'findNotice' && options.notice !== false ? notice : id === 'assessNotice' && options.notice !== false ? assessNotice : null),
    addEventListener() {},
    dispatchEvent(event: { type: string; detail: { showFindNotice: boolean } }) {
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
    CustomEvent: class { type: string; detail: { showFindNotice: boolean }; constructor(type: string, init: { detail: { showFindNotice: boolean } }) { this.type = type; this.detail = init.detail; } },
  };
  sandbox.window = sandbox;
  sandbox.localStorage = storage === 'blocked' ? blocked : storage;
  vm.runInNewContext(read('public/js/app-settings.js'), sandbox);
  return { settings: sandbox.AppSettings as SettingsApi, notice, assessNotice, events };
}

describe('the "Preliminary only" notice setting', () => {
  it('is hidden by default', () => {
    const { settings, notice } = load(memoryStorage());
    expect(settings.showFindNotice()).toBe(false);
    expect(notice.hidden).toBe(true);
  });

  it('shows the notice when turned on, hides it when turned off, and remembers each choice', () => {
    const storage = memoryStorage();
    const { settings, notice, events } = load(storage);
    settings.setShowFindNotice(true);
    expect(notice.hidden).toBe(false);
    expect(storage.data[KEY]).toBe('on');
    settings.setShowFindNotice(false);
    expect(notice.hidden).toBe(true);
    expect(storage.data[KEY]).toBe('off');
    expect(events.map((e) => [e.type, e.detail.showFindNotice])).toEqual([['appsettingschange', true], ['appsettingschange', false]]);
  });

  it('comes back as the person left it', () => {
    const shown = load(memoryStorage({ [KEY]: 'on' }));
    expect(shown.settings.showFindNotice()).toBe(true);
    expect(shown.notice.hidden).toBe(false);
    const hidden = load(memoryStorage({ [KEY]: 'off' }));
    expect(hidden.notice.hidden).toBe(true);
    // Anything unexpected in storage means the default: hidden.
    expect(load(memoryStorage({ [KEY]: 'banana' })).settings.showFindNotice()).toBe(false);
  });

  it('still works for the life of the page when storage is blocked', () => {
    const { settings, notice } = load('blocked');
    expect(settings.showFindNotice()).toBe(false);
    settings.setShowFindNotice(true);
    expect(settings.showFindNotice()).toBe(true);
    expect(notice.hidden).toBe(false);
  });

  it('does not fail when the page has no notice element', () => {
    const { settings } = load(memoryStorage(), { notice: false });
    expect(() => settings.setShowFindNotice(true)).not.toThrow();
  });
});

describe('the "Simulate preparing" setting', () => {
  const SIMULATE_KEY = 'grantflow.simulatePrepare';

  it('is on by default, and anything unexpected in storage means the default', () => {
    expect(load(memoryStorage()).settings.simulatePrepare()).toBe(true);
    expect(load(memoryStorage({ [SIMULATE_KEY]: 'banana' })).settings.simulatePrepare()).toBe(true);
    expect(load(memoryStorage({ [SIMULATE_KEY]: 'off' })).settings.simulatePrepare()).toBe(false);
  });

  it('remembers each choice, announces it, and leaves the notice setting alone', () => {
    const storage = memoryStorage();
    const { settings, notice, events } = load(storage);
    settings.setSimulatePrepare(false);
    expect(storage.data[SIMULATE_KEY]).toBe('off');
    expect(settings.simulatePrepare()).toBe(false);
    expect(settings.showFindNotice()).toBe(false);
    expect(notice.hidden).toBe(true);
    settings.setSimulatePrepare(true);
    expect(storage.data[SIMULATE_KEY]).toBe('on');
    expect(events).toHaveLength(2);
    expect(load(memoryStorage({ [SIMULATE_KEY]: 'off' })).settings.simulatePrepare()).toBe(false);
  });

  it('still works for the life of the page when storage is blocked', () => {
    const { settings } = load('blocked');
    expect(settings.simulatePrepare()).toBe(true);
    settings.setSimulatePrepare(false);
    expect(settings.simulatePrepare()).toBe(false);
  });
});

describe('the "Hide the Preliminary only box on Assess" setting', () => {
  const HIDE_KEY = 'grantflow.hideAssessNotice';

  it('shows the box by default, hides it when turned on, and remembers each choice', () => {
    const storage = memoryStorage();
    const { settings, assessNotice, notice } = load(storage);
    expect(settings.hideAssessNotice()).toBe(false);
    expect(assessNotice.hidden).toBe(false);
    settings.setHideAssessNotice(true);
    expect(assessNotice.hidden).toBe(true);
    expect(storage.data[HIDE_KEY]).toBe('on');
    expect(notice.hidden).toBe(true); // the Find grants notice setting is separate
    settings.setHideAssessNotice(false);
    expect(assessNotice.hidden).toBe(false);
    expect(storage.data[HIDE_KEY]).toBe('off');
  });

  it('comes back as the person left it, and anything unexpected in storage means shown', () => {
    expect(load(memoryStorage({ [HIDE_KEY]: 'on' })).assessNotice.hidden).toBe(true);
    expect(load(memoryStorage({ [HIDE_KEY]: 'banana' })).settings.hideAssessNotice()).toBe(false);
  });

  it('announces the change with the other settings, and works when storage is blocked', () => {
    const { settings, events } = load('blocked');
    settings.setHideAssessNotice(true);
    expect(settings.hideAssessNotice()).toBe(true);
    expect((events[0].detail as unknown as { hideAssessNotice: boolean }).hideAssessNotice).toBe(true);
  });
});

describe('chat.html wiring', () => {
  const html = read('public/chat.html');

  it('ships the notice hidden, so it never flashes up before the setting is read', () => {
    expect(html).toMatch(/<div class="nofo-banner" id="findNotice" role="note" hidden>\s*<strong>Preliminary only\.<\/strong> This list is a starting point/);
  });

  it('has a Settings tray with a closed tab and the switch, offered with the Find grants view', () => {
    expect(html).toMatch(/<aside id="settingsDrawer" class="tray tray--settings"[^>]* hidden>/);
    expect(html).toMatch(/id="settingsTab"[^>]*aria-expanded="false"/);
    expect(html).toContain('id="findNoticeToggle"');
    expect(html).toContain('id="simulatePrepareToggle"');
    expect(html).toContain('id="assessNoticeToggle"');
    expect(html).toContain('id="assessNotice"');
    expect(html).toContain('id="settingsClose"');
  });

  it('loads the setting before the tray, and the drawer kit before both', () => {
    const order = ['drawer-kit.js', 'app-settings.js', 'settings-drawer.js'].map((name) => html.indexOf(`/js/${name}`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('loads the replay script', () => {
    expect(html).toContain('/js/prepare-replay.js');
  });
});
