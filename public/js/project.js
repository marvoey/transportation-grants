/**
 * Project Discovery Workspace.
 *
 * The right-hand profile is the authoritative saved artifact; the left-hand guide only helps the
 * user think. Everything the user or the AI supplies is rendered with textContent / DOM APIs
 * (never innerHTML), and links are only created for http(s) URLs.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants and field descriptors (names mirror src/projects/field-paths.ts)

  const STEPS = [
    { id: 'applicant_location', title: 'Applicant and location' },
    { id: 'problem_beneficiaries', title: 'Problem and beneficiaries' },
    { id: 'activities_outcomes', title: 'Activities and outcomes' },
    { id: 'cost_match', title: 'Cost and match' },
    { id: 'schedule_readiness', title: 'Schedule and readiness' },
    { id: 'review', title: 'Review' },
  ];

  const APPLICANT_TYPES = [
    ['state', 'State government'],
    ['city', 'City / municipality'],
    ['county', 'County government'],
    ['tribal', 'Tribal government'],
    ['mpo', 'Metropolitan planning organization'],
    ['transit_agency', 'Transit agency'],
  ];
  const STATES = (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND ' +
    'OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'
  ).split(' ');
  const MODES = [
    ['road', 'Road'], ['transit', 'Transit'], ['bike_ped', 'Bike / pedestrian'], ['rail', 'Rail'],
    ['freight', 'Freight'], ['aviation', 'Aviation'], ['port', 'Port / maritime'], ['other', 'Other'],
  ];
  const PHASES = [
    ['planning', 'Planning'], ['design', 'Design'], ['environmental', 'Environmental review'],
    ['construction', 'Construction'], ['operations', 'Operations'],
  ];
  const READINESS = [
    ['not_started', 'Not started'], ['in_progress', 'In progress'], ['complete', 'Complete'],
    ['not_applicable', 'Not applicable'],
  ];

  const SECTIONS = [
    {
      id: 'overview', title: 'Overview', fields: [
        { path: 'name', label: 'Project name', type: 'text', required: true, max: 120 },
        { path: 'summary', label: 'Summary', type: 'textarea', max: 2000 },
      ],
    },
    {
      id: 'applicant', title: 'Applicant and location', fields: [
        { path: 'applicant.name', label: 'Applicant name', type: 'text', max: 200 },
        { path: 'applicant.type', label: 'Applicant type', type: 'select', options: APPLICANT_TYPES,
          hint: 'If your organization is not listed (for example a nonprofit), leave this unset and describe it under Constraints.' },
        { path: 'applicant.partners', label: 'Partners', type: 'list', hint: 'One per line.' },
        { path: 'location.state', label: 'State', type: 'select', options: STATES.map((s) => [s, s]) },
        { path: 'location.county', label: 'County', type: 'text', max: 200 },
        { path: 'location.city', label: 'City', type: 'text', max: 200 },
        { path: 'location.serviceArea', label: 'Service area', type: 'text', max: 200 },
      ],
    },
    {
      id: 'need', title: 'Need and beneficiaries', fields: [
        { path: 'need.problem', label: 'Problem', type: 'textarea', max: 2000 },
        { path: 'need.beneficiaries', label: 'Beneficiaries', type: 'list', hint: 'One per line.' },
        {
          path: 'need.evidence', label: 'Evidence', type: 'objlist', itemLabel: 'evidence item', required: 'description',
          fields: [
            { key: 'description', label: 'Description', type: 'textarea', max: 2000 },
            { key: 'sourceUrl', label: 'Source URL (http or https)', type: 'url' },
          ],
        },
      ],
    },
    {
      id: 'scope', title: 'Scope and outcomes', fields: [
        { path: 'scope.phase', label: 'Project phase', type: 'select', options: PHASES },
        { path: 'scope.modes', label: 'Modes', type: 'checklist', options: MODES },
        { path: 'scope.activities', label: 'Activities', type: 'list', hint: 'One per line.' },
        { path: 'scope.assets', label: 'Assets', type: 'list', hint: 'One per line.' },
        {
          path: 'outcomes', label: 'Outcomes', type: 'objlist', itemLabel: 'outcome', required: 'description',
          fields: [
            { key: 'description', label: 'Outcome', type: 'textarea', max: 2000 },
            { key: 'metric', label: 'Metric', type: 'text', max: 200 },
            { key: 'baseline', label: 'Baseline', type: 'number' },
            { key: 'target', label: 'Target', type: 'number' },
            { key: 'unit', label: 'Unit', type: 'text', max: 200 },
          ],
        },
      ],
    },
    {
      id: 'budget', title: 'Budget and match', fields: [
        { path: 'budget.totalCostCents', label: 'Total cost (USD)', type: 'cents' },
        { path: 'budget.requestedFundingCents', label: 'Requested funding (USD)', type: 'cents' },
        { path: 'budget.matchAmountCents', label: 'Match amount (USD)', type: 'cents' },
        { path: 'budget.matchSources', label: 'Match sources', type: 'list', hint: 'One per line.' },
        { path: 'budget.estimateBasis', label: 'Basis for the estimate', type: 'textarea', max: 2000 },
      ],
    },
    {
      id: 'schedule', title: 'Schedule', fields: [
        { path: 'schedule.startDate', label: 'Start date', type: 'date' },
        { path: 'schedule.endDate', label: 'End date', type: 'date' },
        {
          path: 'schedule.milestones', label: 'Milestones', type: 'objlist', itemLabel: 'milestone', required: 'name',
          fields: [
            { key: 'name', label: 'Milestone', type: 'text', max: 200 },
            { key: 'date', label: 'Date', type: 'date' },
          ],
        },
      ],
    },
    {
      id: 'readiness', title: 'Readiness', fields: [
        { path: 'readiness.planningStatus', label: 'Planning', type: 'select', options: READINESS },
        { path: 'readiness.designStatus', label: 'Design', type: 'select', options: READINESS },
        { path: 'readiness.environmentalStatus', label: 'Environmental review', type: 'select', options: READINESS },
        { path: 'readiness.rightOfWayStatus', label: 'Right of way', type: 'select', options: READINESS },
      ],
    },
    {
      id: 'notes', title: 'Constraints, unknowns and assumptions', fields: [
        { path: 'constraints', label: 'Constraints', type: 'list', hint: 'One per line.' },
        {
          path: 'assumptions', label: 'Assumptions', type: 'objlist', itemLabel: 'assumption', required: 'text',
          hint: 'Assumptions only count once you confirm them.',
          fields: [
            { key: 'text', label: 'Assumption', type: 'textarea', max: 2000 },
            { key: 'confirmed', label: 'I confirm this is true', type: 'checkbox' },
          ],
        },
      ],
    },
  ];

  const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
  const FIELD_BY_PATH = new Map(ALL_FIELDS.map((f) => [f.path, f]));

  // ---------------------------------------------------------------------------
  // Small helpers

  const $ = (id) => document.getElementById(id);

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const idFor = (path) => 'f-' + path.replace(/[^a-zA-Z0-9]+/g, '-');

  function getAt(obj, path) {
    return path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
  }
  function setAt(obj, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((o, k) => o[k], obj);
    target[last] = value;
  }

  function safeHttpUrl(value) {
    try {
      const u = new URL(String(value));
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function storageSet(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch { /* storage unavailable: not essential */ }
  }

  /** "12.5" -> 1250 cents without floating-point arithmetic; '' -> null; invalid -> undefined. */
  function dollarsToCents(text) {
    const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
    if (t === '') return null;
    const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return undefined;
    return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  }
  function centsToDollars(cents) {
    if (cents === null || cents === undefined) return '';
    const whole = Math.floor(cents / 100);
    const frac = String(cents % 100).padStart(2, '0');
    return frac === '00' ? String(whole) : `${whole}.${frac}`;
  }

  // ---------------------------------------------------------------------------
  // State

  const state = {
    list: [],
    project: null, // server record (no ownerId)
    saved: null, // project.profile as last saved
    draft: null, // working copy bound to the form
    fieldErrors: {}, // key -> message
    saving: false,
    lastAttempt: null, // { sig, requestId } for idempotent retry of a failed save
    newRowCounter: 0,
    currentStep: null,
    tab: 'guide',
    // Discovery (Stage 3)
    messages: [],
    questions: [],
    batch: null,
    discovery: { busy: false, failed: null }, // failed: { requestId, message } of an unanswered turn
  };

  const readOnly = () => !!state.project && state.project.status === 'archived';

  // ---------------------------------------------------------------------------
  // Banner, status and dialogs

  function showBanner(kind, message, actions) {
    const b = $('banner');
    b.dataset.kind = kind;
    b.replaceChildren(el('div', { text: message }));
    if (actions && actions.length) {
      b.append(
        el('div', { class: 'pw-banner-actions' }, actions.map((a) => el('button', { type: 'button', class: a.secondary ? 'pw-secondary pw-small' : 'pw-small', onclick: a.onClick, text: a.label })))
      );
    }
    b.hidden = false;
  }
  function clearBanner() {
    $('banner').hidden = true;
    $('banner').replaceChildren();
  }

  function setSaveStatus(kind, text) {
    for (const id of ['saveStatus', 'footerStatus']) {
      const n = $(id);
      n.textContent = text;
      n.dataset.state = kind;
    }
  }

  function askConfirm({ title, body, okLabel, cancelLabel }) {
    const dlg = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmBody').replaceChildren(...(Array.isArray(body) ? body : [body]).filter(Boolean));
    const ok = $('confirmOk');
    const cancel = $('confirmCancel');
    ok.hidden = !okLabel;
    ok.textContent = okLabel || '';
    cancel.textContent = cancelLabel || 'Cancel';
    return new Promise((resolve) => {
      const done = (value) => {
        ok.onclick = null;
        cancel.onclick = null;
        dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(value);
      };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      dlg.onclose = () => done(false);
      dlg.showModal();
      cancel.focus();
    });
  }

  function describeError(e) {
    if (!e) return 'Something went wrong.';
    if (e.code === 'RATE_LIMIT_EXCEEDED') return 'Too many requests right now. Wait a moment and try again.';
    if (e instanceof TypeError) return 'Could not reach the server. Your changes are still on this page; try again.';
    return e.message || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------------
  // Form rendering

  function isUnknown(path) {
    return state.draft.unknowns.includes(path);
  }

  function fieldError(key) {
    return state.fieldErrors[key] || null;
  }
  function setFieldError(key, message, input, errNode) {
    if (message) state.fieldErrors[key] = message;
    else delete state.fieldErrors[key];
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (errNode) {
      errNode.textContent = message || '';
      errNode.hidden = !message;
    }
  }

  function inputControl(desc, value, onValue, opts) {
    // desc: { type, options, max }. Returns { control, errNode }.
    const disabled = opts.disabled;
    const errNode = el('p', { class: 'pw-field-error', id: opts.id + '-err', hidden: true });
    let control;
    const describedBy = [opts.hintId, errNode.id].filter(Boolean).join(' ');

    switch (desc.type) {
      case 'textarea':
        control = el('textarea', { id: opts.id, rows: 3, maxlength: desc.max, disabled });
        control.value = value ?? '';
        control.addEventListener('input', () => onValue(control.value.trim() === '' ? null : control.value.trim(), control, errNode));
        break;
      case 'select': {
        control = el('select', { id: opts.id, disabled });
        control.append(el('option', { value: '', text: 'Not set' }));
        for (const [v, label] of desc.options) control.append(el('option', { value: v, text: label }));
        control.value = value ?? '';
        control.addEventListener('change', () => onValue(control.value === '' ? null : control.value, control, errNode));
        break;
      }
      case 'date':
        control = el('input', { type: 'date', id: opts.id, disabled });
        control.value = value ?? '';
        control.addEventListener('input', () => onValue(control.value === '' ? null : control.value, control, errNode));
        break;
      case 'cents':
        control = el('input', { type: 'text', inputmode: 'decimal', id: opts.id, disabled, autocomplete: 'off' });
        control.value = centsToDollars(value);
        control.addEventListener('input', () => {
          const cents = dollarsToCents(control.value);
          if (cents === undefined) {
            setFieldError(opts.key, 'Enter a dollar amount like 1250000 or 1250000.50.', control, errNode);
            return;
          }
          setFieldError(opts.key, null, control, errNode);
          onValue(cents, control, errNode);
        });
        break;
      case 'number':
        control = el('input', { type: 'text', inputmode: 'decimal', id: opts.id, disabled, autocomplete: 'off' });
        control.value = value === null || value === undefined ? '' : String(value);
        control.addEventListener('input', () => {
          const t = control.value.trim();
          if (t === '') { setFieldError(opts.key, null, control, errNode); onValue(null, control, errNode); return; }
          const n = Number(t);
          if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
            setFieldError(opts.key, 'Enter a number.', control, errNode);
            return;
          }
          setFieldError(opts.key, null, control, errNode);
          onValue(n, control, errNode);
        });
        break;
      case 'checkbox':
        control = el('input', { type: 'checkbox', id: opts.id, disabled });
        control.checked = !!value;
        control.addEventListener('change', () => onValue(control.checked, control, errNode));
        break;
      default: // text, url
        control = el('input', { type: 'text', id: opts.id, maxlength: desc.max, disabled, autocomplete: 'off', inputmode: desc.type === 'url' ? 'url' : undefined });
        control.value = value ?? '';
        control.addEventListener('input', () => {
          const v = control.value.trim() === '' ? null : control.value.trim();
          if (desc.type === 'url' && v !== null && !safeHttpUrl(v)) {
            setFieldError(opts.key, 'Use a link starting with http:// or https://.', control, errNode);
            return;
          }
          setFieldError(opts.key, null, control, errNode);
          onValue(v, control, errNode);
        });
    }
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    control.setAttribute('aria-invalid', 'false');
    return { control, errNode };
  }

  function buildField(field) {
    const path = field.path;
    const id = idFor(path);
    const locked = readOnly();
    const unknown = isUnknown(path);
    const disabled = locked || unknown;
    const hintId = field.hint ? id + '-hint' : null;
    const wrap = el('div', { class: 'pw-field', 'data-path': path });

    const unknownBox = field.path === 'name' ? null : el('label', { class: 'pw-unknown' },
      (() => {
        const cb = el('input', { type: 'checkbox', disabled: locked });
        cb.checked = unknown;
        cb.addEventListener('change', () => toggleUnknown(path, cb.checked));
        return cb;
      })(),
      "I don't know"
    );

    const labelText = field.required === true ? `${field.label} (required)` : field.label;
    const hint = field.hint ? el('p', { class: 'pw-hint', id: hintId, text: field.hint }) : null;

    if (field.type === 'list') {
      const ta = el('textarea', { id, rows: 3, disabled, 'aria-describedby': hintId || undefined });
      ta.value = (getAt(state.draft, path) || []).join('\n');
      ta.addEventListener('input', () => {
        const seen = new Set();
        const lines = ta.value.split('\n').map((l) => l.trim()).filter((l) => l && !seen.has(l) && seen.add(l));
        setAt(state.draft, path, lines);
        onDraftChange();
      });
      wrap.append(el('label', { for: id, text: labelText }), hint, ta, unknownBox);
      return wrap;
    }

    if (field.type === 'checklist') {
      const current = new Set(getAt(state.draft, path) || []);
      const group = el('div', { class: 'pw-checks', role: 'group', 'aria-labelledby': id + '-lbl' });
      for (const [value, label] of field.options) {
        const cb = el('input', { type: 'checkbox', value, disabled });
        cb.checked = current.has(value);
        cb.addEventListener('change', () => {
          const next = field.options.map(([v]) => v).filter((v) => (v === value ? cb.checked : current.has(v)));
          current.clear();
          next.forEach((v) => current.add(v));
          setAt(state.draft, path, next);
          onDraftChange();
        });
        group.append(el('label', {}, cb, label));
      }
      wrap.append(el('span', { id: id + '-lbl', class: 'pw-label', text: labelText, style: 'display:block;font-weight:500;margin-bottom:0.25rem' }), hint, group, unknownBox);
      return wrap;
    }

    if (field.type === 'objlist') {
      wrap.append(el('span', { id: id + '-lbl', text: labelText, style: 'display:block;font-weight:500;margin-bottom:0.25rem' }), hint);
      const items = el('div', { class: 'pw-items', role: 'list', 'aria-labelledby': id + '-lbl' });
      const list = getAt(state.draft, path) || [];
      list.forEach((item, index) => items.append(buildItem(field, item, index, disabled)));
      wrap.append(items);
      const add = el('button', {
        type: 'button', class: 'pw-secondary pw-small', disabled, text: `Add ${field.itemLabel}`,
        onclick: () => {
          const item = { id: `new-${++state.newRowCounter}` };
          for (const f of field.fields) item[f.key] = f.type === 'checkbox' ? false : null;
          if (field.path === 'need.evidence') { item.suppliedBy = 'user'; item.verified = false; }
          getAt(state.draft, path).push(item);
          replaceField(path);
          const last = $(idFor(path)).querySelectorAll('.pw-item');
          const first = last[last.length - 1] && last[last.length - 1].querySelector('input,textarea,select');
          if (first) first.focus();
          onDraftChange();
        },
      });
      wrap.append(add, unknownBox);
      // The wrapper's own id lets replaceField/focus find the list.
      wrap.id = id;
      return wrap;
    }

    // Scalar
    const { control, errNode } = inputControl(field, getAt(state.draft, path), (v) => {
      setAt(state.draft, path, v);
      onDraftChange();
    }, { id, key: path, disabled, hintId });
    wrap.append(el('label', { for: id, text: labelText }), hint, control, errNode, unknownBox);
    return wrap;
  }

  function buildItem(field, item, index, disabled) {
    const itemKey = `${field.path}#${item.id}`;
    const grid = el('div', { class: 'pw-item-grid' });
    for (const f of field.fields) {
      const id = `${idFor(field.path)}-${index}-${f.key}`;
      const fieldKey = `${itemKey}.${f.key}`;
      const { control, errNode } = inputControl(f, item[f.key], (v) => {
        item[f.key] = v;
        onDraftChange();
      }, { id, key: fieldKey, disabled });
      if (f.type === 'checkbox') {
        grid.append(el('div', { class: 'pw-field' }, el('label', { class: 'pw-unknown', for: id }, control, f.label), errNode));
      } else {
        grid.append(el('div', { class: 'pw-field' }, el('label', { for: id, text: f.label }), control, errNode));
      }
    }
    const actions = el('div', { class: 'pw-item-actions' });
    if (field.path === 'need.evidence') {
      actions.append(el('span', { class: 'pw-hint', text: `${item.suppliedBy === 'agent' ? 'Suggested by the AI' : 'Added by you'} · not verified` }));
      const href = item.sourceUrl ? safeHttpUrl(item.sourceUrl) : null;
      if (href) actions.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: 'Open source' }));
    }
    actions.append(el('button', {
      type: 'button', class: 'pw-danger pw-small', disabled, text: 'Remove',
      'aria-label': `Remove ${field.itemLabel} ${index + 1}`,
      onclick: () => {
        const list = getAt(state.draft, field.path);
        list.splice(list.findIndex((x) => x.id === item.id), 1);
        for (const k of Object.keys(state.fieldErrors)) if (k.startsWith(itemKey + '.')) delete state.fieldErrors[k];
        replaceField(field.path);
        onDraftChange();
      },
    }));
    return el('div', { class: 'pw-item', role: 'listitem' }, grid, actions);
  }

  function replaceField(path) {
    const old = document.querySelector(`#profileForm [data-path="${CSS.escape(path)}"]`);
    if (!old) return;
    old.replaceWith(buildField(FIELD_BY_PATH.get(path)));
  }

  function toggleUnknown(path, checked) {
    const field = FIELD_BY_PATH.get(path);
    const u = state.draft.unknowns;
    if (checked) {
      if (!u.includes(path)) u.push(path);
      // Marking something unknown clears whatever was there.
      const empty = field.type === 'list' || field.type === 'checklist' || field.type === 'objlist' ? [] : null;
      setAt(state.draft, path, empty);
    } else {
      state.draft.unknowns = u.filter((p) => p !== path);
    }
    for (const k of Object.keys(state.fieldErrors)) if (k === path || k.startsWith(path + '#')) delete state.fieldErrors[k];
    replaceField(path);
    const box = document.querySelector(`#profileForm [data-path="${CSS.escape(path)}"] .pw-unknown input`);
    if (box) box.focus();
    onDraftChange();
  }

  function renderForm() {
    const form = $('profileForm');
    form.replaceChildren();
    const nav = $('sectionNav');
    nav.replaceChildren();
    for (const s of SECTIONS) {
      nav.append(el('a', { href: `#sec-${s.id}`, text: s.title }));
      const fs = el('fieldset', { class: 'pw-section', id: `sec-${s.id}` }, el('legend', { text: s.title }));
      for (const f of s.fields) fs.append(buildField(f));
      form.append(fs);
    }
  }

  // ---------------------------------------------------------------------------
  // Diff (draft vs saved) -> PATCH changes, and rebase after a revision conflict

  /** Builds the change list. `errors` are problems the user must fix before saving. */
  function buildChanges(saved, draft) {
    const changes = [];
    const errors = [];
    const removedUnknown = saved.unknowns.filter((p) => !draft.unknowns.includes(p));
    const addedUnknown = draft.unknowns.filter((p) => !saved.unknowns.includes(p));

    // Clear unknown flags first so setting a value never races the server's own clean-up.
    for (const p of removedUnknown) changes.push({ op: 'remove', path: 'unknowns', value: p });

    for (const f of ALL_FIELDS) {
      const before = getAt(saved, f.path);
      const after = getAt(draft, f.path);
      if (f.type === 'list' || f.type === 'checklist') {
        for (const v of before) if (!after.includes(v)) changes.push({ op: 'remove', path: f.path, value: v });
        for (const v of after) if (!before.includes(v)) changes.push({ op: 'add', path: f.path, value: v });
      } else if (f.type === 'objlist') {
        for (const b of before) {
          const a = after.find((x) => x.id === b.id);
          if (!a) { changes.push({ op: 'remove', path: f.path, itemId: b.id }); continue; }
          const value = {};
          for (const sub of f.fields) if (!eq(a[sub.key], b[sub.key])) value[sub.key] = a[sub.key];
          if (Object.keys(value).length) changes.push({ op: 'update', path: f.path, itemId: b.id, value });
        }
        for (const a of after) {
          if (!String(a.id).startsWith('new-')) continue;
          const value = {};
          for (const sub of f.fields) {
            const v = a[sub.key];
            if (sub.type === 'checkbox' ? v === true : v !== null && v !== undefined) value[sub.key] = v;
          }
          const hasContent = f.fields.some((sub) => sub.type !== 'checkbox' && value[sub.key] !== undefined);
          if (!hasContent) continue; // an untouched blank row is ignored
          if (value[f.required] === undefined) {
            errors.push(`Add a ${f.fields.find((s) => s.key === f.required).label.toLowerCase()} to the new ${f.itemLabel}, or remove it.`);
            continue;
          }
          changes.push({ op: 'add', path: f.path, value });
        }
      } else if (!eq(before, after)) {
        changes.push({ op: 'set', path: f.path, value: after });
      }
    }
    for (const p of addedUnknown) changes.push({ op: 'add', path: 'unknowns', value: p });
    for (const key of Object.keys(state.fieldErrors)) errors.push('Fix the highlighted fields before saving.');
    return { changes, errors: [...new Set(errors)] };
  }

  /** Re-applies the user's local edits (base -> mine) on top of the server's newer profile. */
  function rebase(base, mine, theirs) {
    const out = clone(theirs);
    for (const f of ALL_FIELDS) {
      const b = getAt(base, f.path);
      const m = getAt(mine, f.path);
      const o = getAt(out, f.path);
      if (f.type === 'list' || f.type === 'checklist') {
        for (const v of b) if (!m.includes(v) && o.includes(v)) o.splice(o.indexOf(v), 1);
        for (const v of m) if (!b.includes(v) && !o.includes(v)) o.push(v);
      } else if (f.type === 'objlist') {
        for (const bi of b) {
          const mi = m.find((x) => x.id === bi.id);
          const oi = o.findIndex((x) => x.id === bi.id);
          if (!mi) { if (oi !== -1) o.splice(oi, 1); continue; }
          if (oi === -1) continue;
          for (const sub of f.fields) if (!eq(mi[sub.key], bi[sub.key])) o[oi][sub.key] = mi[sub.key];
        }
        for (const mi of m) if (String(mi.id).startsWith('new-')) o.push(clone(mi));
      } else if (!eq(b, m)) {
        setAt(out, f.path, m);
      }
    }
    const bu = base.unknowns, mu = mine.unknowns;
    out.unknowns = out.unknowns.filter((p) => !(bu.includes(p) && !mu.includes(p)));
    for (const p of mu) if (!bu.includes(p) && !out.unknowns.includes(p)) out.unknowns.push(p);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Dirty tracking and save

  function pendingChanges() {
    return state.draft && state.saved ? buildChanges(state.saved, state.draft) : { changes: [], errors: [] };
  }
  const isDirty = () => pendingChanges().changes.length > 0;

  function onDraftChange() {
    if (state.saving) return;
    updateControls();
    if (state.lastAttempt) state.lastAttempt = null;
    const dirty = isDirty();
    setSaveStatus(dirty ? 'dirty' : 'saved', dirty ? 'Unsaved changes' : 'Saved');
  }

  function updateControls() {
    const ro = readOnly();
    const dirty = isDirty();
    $('profileForm').inert = state.saving; // no typing while a save is in flight
    $('saveBtn').disabled = ro || !dirty || state.saving;
    $('discardBtn').disabled = ro || !dirty || state.saving;
    $('saveBtn').textContent = state.saving ? 'Saving…' : 'Save changes';
    $('archiveBtn').textContent = ro ? 'Restore project' : 'Archive';
    $('reviewBtn').disabled = false;
    $('replyInput').disabled = ro || state.discovery.busy;
    $('replySend').disabled = ro || state.discovery.busy;
  }

  /** Returns true if there is nothing left unsaved afterwards. */
  async function save() {
    if (state.saving || !state.project) return false;
    const { changes, errors } = pendingChanges();
    if (errors.length) {
      showBanner('error', errors.join(' '));
      setSaveStatus('error', 'Not saved');
      return false;
    }
    if (!changes.length) return true;

    const body = { expectedRevision: state.project.revision, changes };
    const sig = JSON.stringify(body);
    // Reuse the requestId for a retry of the same payload, so a lost response cannot apply twice.
    const requestId = state.lastAttempt && state.lastAttempt.sig === sig ? state.lastAttempt.requestId : newRequestId();
    state.lastAttempt = { sig, requestId };

    state.saving = true;
    updateControls();
    setSaveStatus('saving', 'Saving…');
    try {
      const res = await patchProject(state.project.id, { ...body, requestId });
      state.lastAttempt = null;
      adoptServerProject(res.data.project);
      clearBanner();
      if (res.data.statusChanged) {
        showBanner('info', 'This project went back to Draft because required details are no longer complete.');
      }
      setSaveStatus('saved', 'Saved');
      await refreshListQuiet();
      return true;
    } catch (e) {
      if (e.code === 'REVISION_CONFLICT') {
        handleConflict();
      } else if (e.code === 'SESSION_REQUIRED' || e.code === 'PROJECT_NOT_FOUND') {
        handleMissing(e);
      } else {
        showBanner('error', `${describeError(e)} Your edits are still on this page.`, [
          { label: 'Retry save', onClick: () => save() },
        ]);
        setSaveStatus('error', 'Not saved');
      }
      return false;
    } finally {
      state.saving = false;
      updateControls();
    }
  }

  function handleConflict() {
    state.lastAttempt = null;
    setSaveStatus('error', 'Not saved — project changed');
    showBanner('warn', 'This project was changed somewhere else since you opened it (for example in another tab). Your edits have not been saved.', [
      {
        label: 'Reload and keep my edits',
        onClick: async () => {
          try {
            const res = await getProject(state.project.id);
            const rebased = rebase(state.saved, state.draft, res.data.project.profile);
            adoptServerProject(res.data.project, rebased);
            clearBanner();
            onDraftChange();
          } catch (e) { showBanner('error', describeError(e)); }
        },
      },
      {
        label: 'Discard my edits and reload', secondary: true,
        onClick: async () => {
          try {
            const res = await getProject(state.project.id);
            adoptServerProject(res.data.project);
            clearBanner();
            setSaveStatus('saved', 'Saved');
          } catch (e) { showBanner('error', describeError(e)); }
        },
      },
    ]);
  }

  /** Takes a server record as the new saved state. `draftOverride` keeps local edits (rebase). */
  function adoptServerProject(project, draftOverride) {
    const same = state.project && state.project.id === project.id;
    const scrollY = window.scrollY;
    state.project = project;
    state.saved = project.profile;
    state.draft = draftOverride ? draftOverride : clone(project.profile);
    state.fieldErrors = {};
    renderProject(!same);
    window.scrollTo(0, scrollY);
  }

  // ---------------------------------------------------------------------------
  // Rendering of the project chrome

  const STATUS_LABEL = { draft: 'Draft', ready: 'Ready', archived: 'Archived' };
  const STATUS_CLASS = { draft: 'badge-warning', ready: 'badge-success', archived: 'badge-secondary' };

  function renderProject(focusTitle) {
    const p = state.project;
    $('workspace').hidden = false;
    $('emptyState').hidden = true;
    $('projectTitle').textContent = p.profile.name;
    document.title = `${p.profile.name} - Project Workspace`;
    const badge = $('statusBadge');
    badge.textContent = STATUS_LABEL[p.status];
    badge.className = `badge ${STATUS_CLASS[p.status]}`;
    renderForm();
    renderCompleteness();
    renderGuideStep();
    renderConversation();
    renderSuggestions();
    updateControls();
    if (readOnly()) {
      showBanner('info', 'This project is archived and read-only. Restore it to make changes.', [
        { label: 'Restore project', onClick: () => toggleArchive() },
      ]);
    }
    if (focusTitle) $('projectTitle').focus();
  }

  function renderCompleteness() {
    const a = state.project.readinessAssessment;
    const box = $('completeness');
    box.replaceChildren(
      el('p', { text: `${a.completeCount} of ${a.requiredCount} required items complete` }),
      el('progress', { max: a.requiredCount, value: a.completeCount, 'aria-label': 'Required items complete' }),
      a.missingFields.length
        ? el('div', {}, el('p', { text: 'Still needed:' }), el('ul', {}, a.missingFields.map((m) => el('li', { text: m.state === 'unknown' ? `${m.label} (marked unknown)` : m.label }))))
        : el('p', { text: 'All required items are filled in.' }),
      a.warnings.length
        ? el('details', { class: 'pw-warnings' }, el('summary', { text: `${a.warnings.length} optional details not provided` }), el('ul', {}, a.warnings.map((w) => el('li', { text: w.message }))))
        : null,
      el('p', { class: 'pw-hint', text: 'Counts reflect saved changes. Completeness is not an eligibility check.' })
    );
  }

  // ---- guide (step line; conversation and suggestions are added with discovery) ----

  function stepFromProfile() {
    const miss = new Set(state.project.readinessAssessment.missingFields.map((m) => m.key));
    const p = state.project.profile;
    if (miss.has('applicant.type') || miss.has('location')) return 'applicant_location';
    if (miss.has('need.problem')) return 'problem_beneficiaries';
    if (miss.has('scope.activities') || miss.has('outcomes')) return 'activities_outcomes';
    if (p.budget.totalCostCents === null && !p.unknowns.includes('budget.totalCostCents')) return 'cost_match';
    if (p.schedule.startDate === null && !p.unknowns.includes('schedule.startDate')) return 'schedule_readiness';
    return 'review';
  }

  function renderGuideStep() {
    const id = state.currentStep || stepFromProfile();
    const index = STEPS.findIndex((s) => s.id === id);
    const step = STEPS[index];
    $('guideStep').replaceChildren(
      el('span', { text: `Step ${index + 1} of ${STEPS.length}: ${step.title} ` }),
      el('button', { type: 'button', class: 'pw-secondary pw-small', text: 'Previous', disabled: index === 0, 'aria-label': 'Previous step',
        onclick: () => { state.currentStep = STEPS[index - 1].id; renderGuideStep(); } }),
      ' ',
      el('button', { type: 'button', class: 'pw-secondary pw-small', text: 'Skip to next', disabled: index === STEPS.length - 1, 'aria-label': 'Skip to next step',
        onclick: () => { state.currentStep = STEPS[index + 1].id; renderGuideStep(); } })
    );
  }

  // ---------------------------------------------------------------------------
  // Project list, selection, creation

  async function refreshList() {
    const res = await listProjects({ limit: 100 });
    state.list = res.data.items;
    const sel = $('projectSelect');
    sel.replaceChildren();
    for (const p of state.list) {
      const suffix = p.status === 'archived' ? ' (archived)' : p.status === 'ready' ? ' (ready)' : '';
      sel.append(new Option(`${p.name}${suffix}`, p.id));
    }
    sel.disabled = state.list.length === 0;
    if (state.project && state.list.some((p) => p.id === state.project.id)) sel.value = state.project.id;
  }

  /** The list is only a selector: a failure to refresh it must not look like a failed save. */
  async function refreshListQuiet() {
    try { await refreshList(); } catch { /* keep the previous list */ }
  }

  async function confirmDiscardIfDirty() {
    if (!state.project || !isDirty()) return true;
    return askConfirm({
      title: 'Discard unsaved changes?',
      body: el('p', { text: 'You have changes that are not saved. Switching projects will discard them.' }),
      okLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
    });
  }

  async function openProject(id, { silent } = {}) {
    if (!silent && !(await confirmDiscardIfDirty())) {
      if (state.project) $('projectSelect').value = state.project.id;
      return;
    }
    clearBanner();
    setSaveStatus('saving', 'Loading…');
    try {
      const res = await getProject(id);
      state.messages = [];
      state.questions = [];
      state.batch = null;
      guideNotice(null);
      state.currentStep = null;
      state.lastAttempt = null;
      state.discovery = { busy: false, failed: null };
      state.project = null;
      adoptServerProject(res.data.project);
      $('projectSelect').value = id;
      storageSet('pw:lastProject', id);
      const url = new URL(location.href);
      url.searchParams.set('id', id);
      history.replaceState(null, '', url);
      setSaveStatus('saved', 'Saved');
      await loadDiscovery();
    } catch (e) {
      handleMissing(e);
    }
  }

  function showEmpty() {
    state.project = null;
    $('workspace').hidden = true;
    $('emptyState').hidden = false;
    document.title = 'Project Workspace - DOT Grant Search';
  }

  function handleMissing(e) {
    const noSession = e && e.code === 'SESSION_REQUIRED';
    const gone = noSession || (e && e.code === 'PROJECT_NOT_FOUND');
    if (gone) {
      // Forget the unreachable project; a transient network error must not.
      storageSet('pw:lastProject', null);
      const url = new URL(location.href);
      url.searchParams.delete('id');
      history.replaceState(null, '', url);
    }
    const message = noSession
      ? 'We could not find your project session. Your browser may have cleared its cookies, or this server may have been reset, so earlier projects are no longer reachable. You can start a new project.'
      : e && e.code === 'PROJECT_NOT_FOUND'
        ? 'That project no longer exists or is not available to this browser.'
        : `Could not load the project. ${describeError(e)}`;
    showBanner(gone ? 'warn' : 'error', message, gone ? [] : [{ label: 'Try again', onClick: () => init() }]);
    refreshList().then(() => {
      if (state.list.length) openProject(state.list[0].id, { silent: true }).then(() => showBanner('warn', message));
      else showEmpty();
    }).catch(() => showEmpty());
  }

  function openNewDialog() {
    const dlg = $('newDialog');
    $('newName').value = '';
    $('newError').hidden = true;
    dlg.showModal();
    $('newName').focus();
  }

  async function submitNew(e) {
    e.preventDefault();
    const name = $('newName').value.trim();
    const err = $('newError');
    if (!name) { err.textContent = 'Enter a project name.'; err.hidden = false; $('newName').focus(); return; }
    if (!(await confirmDiscardIfDirtyAfterClose())) return;
    $('newCreate').disabled = true;
    try {
      const res = await createProject(name);
      $('newDialog').close();
      clearBanner();
      state.project = null;
      await refreshList();
      await openProject(res.data.project.id, { silent: true });
    } catch (e2) {
      err.textContent = describeError(e2);
      err.hidden = false;
    } finally {
      $('newCreate').disabled = false;
    }
  }

  async function confirmDiscardIfDirtyAfterClose() {
    if (!state.project || !isDirty()) return true;
    $('newDialog').close();
    const ok = await confirmDiscardIfDirty();
    if (!ok) $('newDialog').showModal();
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Footer actions

  async function reviewReadiness() {
    if (isDirty() && !readOnly()) {
      if (!(await save())) return;
    }
    const a = state.project.readinessAssessment;
    const body = [
      el('p', { text: `${a.completeCount} of ${a.requiredCount} required items are complete.` }),
      a.missingFields.length
        ? el('div', {}, el('p', { text: 'Still needed:' }), el('ul', {}, a.missingFields.map((m) => el('li', { text: m.state === 'unknown' ? `${m.label} (marked unknown)` : m.label }))))
        : el('p', { text: 'Everything required is filled in.' }),
      a.warnings.length ? el('div', {}, el('p', { text: 'Optional details not provided:' }), el('ul', {}, a.warnings.map((w) => el('li', { text: w.message })))) : null,
      el('p', { class: 'pw-hint', text: '“Ready” means you reviewed this profile for grant discovery. It does not mean the project qualifies for any grant.' }),
    ];
    const status = state.project.status;
    if (status === 'archived') {
      await askConfirm({ title: 'Review readiness', body, okLabel: null, cancelLabel: 'Close' });
      return;
    }
    const canReady = status === 'draft' && a.completeCount === a.requiredCount;
    const canDraft = status === 'ready';
    const ok = await askConfirm({
      title: 'Review readiness', body,
      okLabel: canReady ? 'Mark as ready' : canDraft ? 'Return to draft' : null,
      cancelLabel: 'Close',
    });
    if (ok) await changeStatus(canReady ? 'ready' : 'draft');
  }

  async function changeStatus(status) {
    try {
      const res = await setProjectStatus(state.project.id, {
        expectedRevision: state.project.revision, requestId: newRequestId(), status,
      });
      adoptServerProject(res.data.project);
      clearBanner();
      if (readOnly()) renderProject(false);
      await refreshListQuiet();
      setSaveStatus('saved', 'Saved');
    } catch (e) {
      if (e.code === 'REVISION_CONFLICT') handleConflict();
      else showBanner('error', describeError(e));
    }
  }

  async function toggleArchive() {
    if (!readOnly() && isDirty() && !(await save())) return;
    await changeStatus(readOnly() ? 'draft' : 'archived');
  }

  async function explore() {
    // Save pending direct edits first; never navigate after a failed save.
    if (!readOnly() && isDirty() && !(await save())) return;
    const a = state.project.readinessAssessment;
    if (a.completeCount < a.requiredCount) {
      const go = await askConfirm({
        title: 'Some project details are missing',
        body: [
          el('p', { text: 'You can still explore grants. Grant chat will only use what is saved so far, and it will ask for anything it needs.' }),
          el('ul', {}, a.missingFields.map((m) => el('li', { text: m.label }))),
          el('p', { class: 'pw-hint', text: 'Missing details never block you; they just mean less tailoring.' }),
        ],
        okLabel: 'Continue to grant chat', cancelLabel: 'Keep editing',
      });
      if (!go) return;
    }
    location.href = '/chat.html?' + new URLSearchParams({ projectId: state.project.id });
  }

  async function removeProject() {
    const name = state.project.profile.name;
    const ok = await askConfirm({
      title: 'Delete this project?',
      body: [
        el('p', { text: `“${name}” and its conversation will be permanently deleted from the server.` }),
        el('p', { text: 'This cannot be undone.' }),
      ],
      okLabel: 'Delete permanently', cancelLabel: 'Keep project',
    });
    if (!ok) return;
    try {
      await deleteProject(state.project.id, state.project.revision);
      storageSet('pw:lastProject', null);
      state.project = null;
      state.saved = null;
      state.draft = null;
      clearBanner();
      await refreshList();
      if (state.list.length) await openProject(state.list[0].id, { silent: true });
      else {
        const url = new URL(location.href);
        url.searchParams.delete('id');
        history.replaceState(null, '', url);
        showEmpty();
      }
    } catch (e) {
      if (e.code === 'REVISION_CONFLICT') handleConflict();
      else if (e.code === 'PROJECT_NOT_FOUND') handleMissing(e);
      else showBanner('error', describeError(e));
    }
  }

  function discard() {
    state.draft = clone(state.saved);
    state.fieldErrors = {};
    state.lastAttempt = null;
    renderForm();
    updateControls();
    clearBanner();
    setSaveStatus('saved', 'Saved');
  }

  // ---------------------------------------------------------------------------
  // Tabs (small screens)

  function selectTab(name, focus) {
    state.tab = name;
    $('panes').dataset.tab = name;
    for (const [tabName, id] of [['guide', 'tabGuide'], ['profile', 'tabProfile']]) {
      const tab = $(id);
      const selected = tabName === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery guide: conversation, questions, reviewable suggestions

  const FIELD_LABEL = (path) => (FIELD_BY_PATH.get(path) ? FIELD_BY_PATH.get(path).label : path);

  function optionLabel(field, value) {
    const hit = field && field.options ? field.options.find(([v]) => v === value) : null;
    return hit ? hit[1] : String(value);
  }

  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  /** Human-readable text for a stored value at `path` (all rendered via textContent). */
  function formatValue(path, value) {
    if (value === null || value === undefined || value === '') return 'Not set (unknown)';
    const field = FIELD_BY_PATH.get(path);
    if (field && field.type === 'cents') return moneyFmt.format(value / 100);
    if (field && (field.type === 'select' || field.type === 'checklist')) return optionLabel(field, value);
    if (typeof value === 'object') {
      return Object.entries(value)
        .filter(([k, v]) => k !== 'id' && v !== null && v !== undefined && k !== 'verified' && k !== 'suppliedBy')
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
    }
    return String(value);
  }

  function describeChange(c) {
    const label = FIELD_LABEL(c.path);
    const field = FIELD_BY_PATH.get(c.path);
    if (c.op === 'set') return `Set ${label}`;
    if (field && field.type === 'objlist') {
      return c.op === 'add' ? `Add to ${label}` : c.op === 'update' ? `Change an item in ${label}` : `Remove an item from ${label}`;
    }
    if (c.path === 'unknowns') return c.op === 'add' ? 'Mark as unknown' : 'No longer mark as unknown';
    return c.op === 'add' ? `Add to ${label}` : `Remove from ${label}`;
  }

  /** A change replaces something the user already has. It is never pre-selected. */
  function isOverwrite(c) {
    if (c.op === 'set') return c.basis !== null && c.basis !== undefined;
    return c.op === 'update' || c.op === 'remove';
  }

  function renderConversation() {
    const log = $('conversation');
    log.setAttribute('aria-busy', String(state.discovery.busy));
    log.replaceChildren();
    for (const m of state.messages) {
      const failed = state.discovery.failed && state.discovery.failed.requestId === m.requestId && m.role === 'user';
      log.append(
        el('div', { class: 'pw-msg', 'data-role': m.role, 'data-state': failed ? 'failed' : undefined },
          el('span', { class: 'pw-msg-meta', text: m.role === 'user' ? 'You' : 'Guide' }),
          m.content,
          failed ? el('span', { class: 'pw-msg-meta', text: 'No reply yet. Use “Retry last message”.' }) : null
        )
      );
    }
    if (state.discovery.busy) {
      log.append(el('div', { class: 'pw-msg', 'data-role': 'assistant' }, el('span', { class: 'pw-msg-meta', text: 'Guide' }), 'Thinking…'));
    }
    log.scrollTop = log.scrollHeight;

    // Suggested questions (with a quick way to say "I don't know")
    const qs = $('questions');
    qs.replaceChildren();
    if (!state.discovery.busy && !readOnly()) {
      for (const q of state.questions || []) {
        qs.append(
          el('li', {},
            el('button', {
              type: 'button', text: q.text,
              onclick: () => {
                const input = $('replyInput');
                input.value = `${q.text}\n`;
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
              },
            }),
            el('button', {
              type: 'button', class: 'pw-secondary pw-small', text: "I don't know", style: 'margin-top:0.25rem',
              'aria-label': `I don't know: ${q.text}`,
              onclick: () => sendTurn(`I don't know the answer to this: ${FIELD_LABEL(q.field)}.`, newRequestId()),
            })
          )
        );
      }
    }

    $('replyRetry').hidden = !(state.discovery.failed && !state.discovery.busy);
  }

  function guideNotice(message, kind) {
    const n = $('guideNotice');
    n.hidden = !message;
    n.textContent = message || '';
    if (kind) n.dataset.kind = kind;
  }

  async function loadDiscovery() {
    if (!state.project) return;
    const id = state.project.id;
    try {
      const items = [];
      let cursor;
      let lastTurn = null;
      do {
        const res = await listDiscoveryMessages(id, cursor);
        items.push(...res.data.items);
        lastTurn = res.data.lastTurn;
        cursor = res.data.nextCursor;
      } while (cursor);
      const sug = await listDiscoverySuggestions(id, 'pending');
      if (!state.project || state.project.id !== id) return; // the user switched projects meanwhile

      state.messages = items;
      state.batch = sug.data.items[0] || null;
      state.discovery.failed = null;
      if (lastTurn && lastTurn.state === 'complete') {
        state.questions = lastTurn.questions || [];
        if (lastTurn.suggestedNextStep) state.currentStep = lastTurn.suggestedNextStep;
      } else if (lastTurn && lastTurn.state === 'failed') {
        const m = items.find((x) => x.role === 'user' && x.requestId === lastTurn.requestId);
        if (m) state.discovery.failed = { requestId: m.requestId, message: m.content };
      } else if (lastTurn && lastTurn.state === 'in_progress') {
        guideNotice('A reply to your last message may still be on its way. Reload in a moment.', 'info');
      }
    } catch (e) {
      if (e.code === 'SESSION_REQUIRED' || e.code === 'PROJECT_NOT_FOUND') return handleMissing(e);
      guideNotice(`Could not load the conversation. ${describeError(e)} You can still edit the profile directly.`, 'warn');
    }
    renderGuideStep();
    renderConversation();
    renderSuggestions();
    updateControls();
  }

  async function submitReply(e) {
    e.preventDefault();
    const text = $('replyInput').value.trim();
    if (!text || state.discovery.busy || readOnly()) return;
    $('replyInput').value = '';
    await sendTurn(text, newRequestId());
  }

  async function retryLast() {
    const f = state.discovery.failed;
    if (!f || state.discovery.busy) return;
    await sendTurn(f.message, f.requestId, { retry: true });
  }

  async function sendTurn(message, requestId, { retry } = {}) {
    if (state.discovery.busy || !state.project || readOnly()) return;
    guideNotice(null);
    // The guide must see the user's direct edits (and the revision must match), so save first.
    if (isDirty() && !(await save())) {
      guideNotice('Save or fix your profile changes first, then send your message again.', 'warn');
      if (!retry) $('replyInput').value = message;
      return;
    }
    const projectId = state.project.id;
    state.discovery.busy = true;
    state.discovery.failed = null;
    if (!retry) state.messages.push({ id: `tmp-${requestId}`, role: 'user', content: message, requestId });
    renderConversation();
    updateControls();
    try {
      const res = await sendDiscoveryTurn(projectId, { message, expectedRevision: state.project.revision, requestId });
      if (!state.project || state.project.id !== projectId) return;
      state.questions = res.data.questions || [];
      state.currentStep = res.data.suggestedNextStep;
      state.discovery.busy = false;
      await loadDiscovery(); // authoritative messages, ids and pending batch from the server
    } catch (e) {
      if (!state.project || state.project.id !== projectId) return;
      state.discovery.busy = false;
      if (e.code === 'SESSION_REQUIRED' || e.code === 'PROJECT_NOT_FOUND') return handleMissing(e);
      if (e.code === 'REVISION_CONFLICT' || e.code === 'PROJECT_ARCHIVED' || e.code === 'VALIDATION_ERROR' || e.code === 'LIMIT_EXCEEDED') {
        // Nothing was stored for this message: take it back out and give the text back to the user.
        state.messages = state.messages.filter((m) => m.id !== `tmp-${requestId}`);
        $('replyInput').value = message;
        guideNotice(
          e.code === 'REVISION_CONFLICT'
            ? 'The project changed elsewhere. Reload it, check your profile, then send again.'
            : describeError(e),
          'warn'
        );
        if (e.code === 'REVISION_CONFLICT') handleConflict();
      } else {
        // The message may be stored without a reply: offer a retry that reuses the same requestId.
        state.discovery.failed = { requestId, message };
        const detail =
          e.code === 'AGENT_TIMEOUT' ? 'The guide took too long to answer.'
          : e.code === 'AGENT_INVALID_OUTPUT' ? 'The guide could not produce a usable answer.'
          : e.code === 'DISCOVERY_BUSY' ? 'A reply is already being prepared.'
          : e.code === 'MISSING_CONFIG' ? 'AI help is not configured on this server.'
          : e.code === 'RATE_LIMIT_EXCEEDED' ? 'You are sending messages too quickly.'
          : 'AI help is not available right now.';
        guideNotice(`${detail} Your profile was not changed and you can keep editing it directly. You can retry this message.`, 'warn');
      }
    } finally {
      state.discovery.busy = false;
      renderConversation();
      updateControls();
    }
  }

  function renderSuggestions() {
    const box = $('suggestions');
    const badge = $('pendingBadge');
    box.replaceChildren();
    const batch = state.batch;
    if (!batch || batch.state !== 'pending') {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    badge.textContent = String(batch.changes.length);
    badge.setAttribute('aria-label', `${batch.changes.length} suggested changes to review`);

    const heading = el('h4', { id: 'batchHeading', text: `Suggested changes (${batch.changes.length}) — review before applying` });
    const boxes = [];
    const list = el('div', { role: 'group', 'aria-labelledby': 'batchHeading' });
    batch.changes.forEach((c, i) => {
      const overwrite = isOverwrite(c);
      const cb = el('input', { type: 'checkbox', id: `chg-${i}`, disabled: readOnly(), 'data-id': c.id });
      cb.checked = !overwrite; // overwrites are never pre-selected
      cb.addEventListener('change', updateApplyLabel);
      boxes.push(cb);

      const field = FIELD_BY_PATH.get(c.path);
      const rows = [];
      if (c.op === 'set') {
        if (overwrite) rows.push(['Currently', formatValue(c.path, c.basis)]);
        rows.push([overwrite ? 'Suggested' : 'Value', formatValue(c.path, c.value)]);
      } else if (c.op === 'update') {
        if (c.basis) rows.push(['Currently', formatValue(c.path, c.basis)]);
        rows.push(['Changes to', formatValue(c.path, c.value)]);
      } else if (c.op === 'remove') {
        rows.push(['Removes', formatValue(c.path, c.basis || c.value)]);
      } else {
        rows.push(['Adds', c.path === 'unknowns' ? FIELD_LABEL(c.value) : formatValue(c.path, c.value)]);
      }
      rows.push(['Why', c.rationale]);

      list.append(
        el('div', { class: 'pw-change', 'data-disposition': c.disposition },
          el('label', { for: `chg-${i}` }, cb, el('span', {}, describeChange(c), overwrite ? el('span', { class: 'pw-overwrite', text: ' (replaces existing information)' }) : null)),
          el('dl', {}, rows.map(([k, v]) => el('div', {}, el('dt', { text: `${k}: ` }), el('dd', { text: v }))))
        )
      );
    });

    const applyBtn = el('button', { type: 'button', id: 'applyBtn', disabled: readOnly() });
    const dismissBtn = el('button', { type: 'button', class: 'pw-secondary', text: 'Dismiss all', disabled: readOnly(), onclick: () => dismissBatch() });
    function updateApplyLabel() {
      const n = boxes.filter((b) => b.checked).length;
      applyBtn.textContent = n ? `Apply ${n} selected` : 'Apply none (dismiss)';
    }
    applyBtn.addEventListener('click', () => applyBatch(boxes.filter((b) => b.checked).map((b) => b.dataset.id)));
    updateApplyLabel();

    box.append(el('div', { class: 'pw-batch' }, heading, list, el('div', { class: 'pw-batch-actions' }, applyBtn, dismissBtn)));
  }

  async function applyBatch(ids) {
    const batch = state.batch;
    if (!batch || readOnly()) return;
    // Pending direct edits go in first so accepted changes land on top of them, not over them.
    if (isDirty() && !(await save())) return;
    try {
      const res = await applyDiscoverySuggestion(state.project.id, batch.id, {
        expectedRevision: state.project.revision, requestId: newRequestId(), acceptedChangeIds: ids,
      });
      state.batch = null;
      adoptServerProject(res.data.project);
      const applied = res.data.batch.changes.filter((c) => c.disposition === 'applied').length;
      const conflicts = res.data.batch.changes.filter((c) => c.disposition === 'conflict');
      if (ids.length === 0) clearBanner();
      else if (conflicts.length) {
        showBanner('warn', `Applied ${applied} change${applied === 1 ? '' : 's'}. ${conflicts.length} skipped because you changed ${[...new Set(conflicts.map((c) => FIELD_LABEL(c.path)))].join(', ')} after it was suggested.`);
      } else {
        showBanner('info', `Applied ${applied} change${applied === 1 ? '' : 's'} to your profile.`);
      }
      setSaveStatus('saved', 'Saved');
      await refreshListQuiet();
      renderSuggestions();
    } catch (e) {
      if (e.code === 'SUGGESTION_STALE') {
        showBanner('warn', 'Those suggestions are out of date because the profile changed, so nothing was applied. Ask the guide again for fresh suggestions.');
        await loadDiscovery();
      } else if (e.code === 'REVISION_CONFLICT') {
        try {
          const res = await getProject(state.project.id);
          adoptServerProject(res.data.project);
          showBanner('warn', 'The project changed elsewhere, so nothing was applied. Review the suggestions again.');
          await loadDiscovery();
        } catch (e2) { showBanner('error', describeError(e2)); }
      } else if (e.code === 'SESSION_REQUIRED' || e.code === 'PROJECT_NOT_FOUND') {
        handleMissing(e);
      } else {
        showBanner('error', `${describeError(e)} Nothing was applied.`);
      }
    }
  }

  async function dismissBatch() {
    const batch = state.batch;
    if (!batch) return;
    try {
      await dismissDiscoverySuggestion(state.project.id, batch.id, { requestId: newRequestId() });
      state.batch = null;
      renderSuggestions();
      $('replyInput').focus();
    } catch (e) {
      if (e.code === 'SUGGESTION_STALE') { await loadDiscovery(); return; }
      showBanner('error', describeError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // Init

  function bind() {
    $('projectSelect').addEventListener('change', (e) => openProject(e.target.value));
    $('newProjectBtn').addEventListener('click', openNewDialog);
    $('emptyNewBtn').addEventListener('click', openNewDialog);
    $('newForm').addEventListener('submit', submitNew);
    $('newCancel').addEventListener('click', () => $('newDialog').close());
    $('saveBtn').addEventListener('click', () => save());
    $('discardBtn').addEventListener('click', discard);
    $('reviewBtn').addEventListener('click', reviewReadiness);
    $('exploreBtn').addEventListener('click', explore);
    $('archiveBtn').addEventListener('click', toggleArchive);
    $('deleteBtn').addEventListener('click', removeProject);
    $('replyForm').addEventListener('submit', submitReply);
    $('replyRetry').addEventListener('click', retryLast);
    $('tabGuide').addEventListener('click', () => selectTab('guide'));
    $('tabProfile').addEventListener('click', () => selectTab('profile'));
    for (const id of ['tabGuide', 'tabProfile']) {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          selectTab(id === 'tabGuide' ? 'profile' : 'guide', true);
        }
      });
    }
    window.addEventListener('beforeunload', (e) => {
      if (state.project && isDirty() && !readOnly()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function init() {
    setSaveStatus('saving', 'Loading projects…');
    try {
      await refreshList();
    } catch (e) {
      setSaveStatus('error', 'Could not load projects');
      showBanner('error', describeError(e), [{ label: 'Try again', onClick: () => init() }]);
      return;
    }
    const wanted = new URLSearchParams(location.search).get('id') || storageGet('pw:lastProject');
    if (wanted) {
      await openProject(wanted, { silent: true });
    } else if (state.list.length) {
      await openProject(state.list[0].id, { silent: true });
    } else {
      setSaveStatus('saved', '');
      showEmpty();
    }
  }

  bind();
  init();
})();
