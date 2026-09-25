/**
 * tests/pipeline-builder-hydration.test.js — the Settings → Pipelines builder
 * must never write a config it seeded from the UNHYDRATED company profile
 * (docs/pro/js/pipeline-builder.js).
 *
 * The bug (fail-open audit, 2026-09-18): window._companyProfile holds the bare
 * NBD defaults — no `pipelines` key — until _loadCompanyProfile's getDoc
 * succeeds, and a failed read leaves _companyProfileLoaded unset for the whole
 * session. openBuilder() snapshotted _cfg from whatever was in memory when the
 * tab opened, so an early open seeded {stages:{}, views:{}}; the first edit +
 * Save then setDoc-merged it. Empty nested maps REPLACE on a merge write, so a
 * rename wiped every per-view order and a reorder wiped every custom stage —
 * for every rep, with a "Pipelines saved" toast.
 *
 * The fix, driven here through the REAL code path (vm-load the IIFE, open it
 * via the switchSettingsTab hook it installs, fire events at the delegated
 * root listeners — same idiom as pipeline-builder-delete.test.js):
 *   - openBuilder awaits _loadCompanyProfile() when not hydrated ("Loading…"),
 *     then snapshots; a failed load ends in a Retry prompt, never an editor.
 *   - loadCfg records _cfgHydrated AT SNAPSHOT TIME.
 *   - save() (Reset goes through it) refuses unless the snapshot AND the live
 *     profile are hydrated — so a profile that finishes loading after an
 *     unhydrated snapshot still can't bless the stale defaults.
 *   - the switchSettingsTab hook handles the now-async openBuilder's rejection.
 *   - canEdit() treats absent claims as unknown (read-only), not "solo owner".
 *   - a refused/failed Reset no longer force-clears the in-memory board config.
 *
 * Zero deps. Run: node tests/pipeline-builder-hydration.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/pipeline-builder.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const unhandled = [];
process.on('unhandledRejection', (r) => { unhandled.push(r); });
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── a small resolver standing in for crm-stages.js resolvePipelineConfig ──
const DEFAULT_META = {
  new:       { label: 'New',       role: 'new',    color: '#9ca3af' },
  contacted: { label: 'Contacted', role: 'active', color: '#4a9eff' },
  won:       { label: 'Won',       role: 'won',    color: '#22c55e' },
  lost:      { label: 'Lost',      role: 'lost',   color: '#e05252' },
};
const DEFAULT_VIEWS = { insurance: { label: 'Insurance', stages: ['new', 'contacted', 'won', 'lost'] } };
function resolvePipelineConfig(cfg) {
  cfg = cfg || {};
  const stageMeta = {};
  Object.keys(DEFAULT_META).forEach((k) => { stageMeta[k] = Object.assign({}, DEFAULT_META[k]); });
  Object.keys(cfg.stages || {}).forEach((k) => {
    stageMeta[k] = Object.assign({}, stageMeta[k], cfg.stages[k], DEFAULT_META[k] ? {} : { custom: true });
  });
  const views = {};
  Object.keys(DEFAULT_VIEWS).forEach((vk) => {
    const ov = cfg.views && cfg.views[vk];
    const order = (ov && Array.isArray(ov.stages)) ? ov.stages : DEFAULT_VIEWS[vk].stages;
    views[vk] = { label: DEFAULT_VIEWS[vk].label, stages: order.filter((s) => stageMeta[s]) };
  });
  return { views, stageMeta };
}

// The tenant's REAL saved config: a custom won-role stage placed mid-board and
// a renamed built-in. Any write seeded from defaults loses both.
const REAL = {
  stages: { custom_paid: { label: 'Paid In Full', role: 'won', color: '#00ff00' }, new: { label: 'Fresh Lead' } },
  views: { insurance: { stages: ['new', 'custom_paid', 'contacted', 'won', 'lost'] } },
};

function loadBuilder(opts) {
  opts = opts || {};
  const state = { throwOnRoot: false, loadCalls: 0, applied: 0 };
  const root = {
    innerHTML: '', _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    querySelector() { return null; },
    // The builder reaches every Save copy (header + the bottom save bar,
    // 2026-09-25) through querySelectorAll; nothing is rendered here, so none.
    querySelectorAll() { return []; },
  };
  const toasts = [], warns = [], saves = [];
  const win = {
    _companyProfile: opts.profile || {},
    _companyProfileLoaded: opts.loaded,
    _userClaims: ('claims' in opts) ? opts.claims : { role: 'company_admin', companyId: 'co1' },
    _user: { uid: 'u1' },
    _leads: [], _leadsLoaded: true,
    showToast: (m, k) => { toasts.push({ m: String(m), k }); },
    nbdConfirm: async () => true,
    __NBD_CALL_REGISTRY: {
      resolvePipelineConfig,
      STAGE_ROLE: { NEW: 'new', ACTIVE: 'active', JOB: 'job', WON: 'won', LOST: 'lost' },
      applyPipelineConfig: () => { state.applied++; },
    },
    _saveCompanyProfile: async (o) => {
      saves.push(clone(o));
      if (opts.saveRejects) throw new Error('client is offline');
      return win._companyProfile;
    },
    switchSettingsTab: function (tab) { return 'orig:' + tab; },
  };
  if (opts.loadImpl) {
    win._loadCompanyProfile = function () { state.loadCalls++; return opts.loadImpl(win, state.loadCalls); };
  }
  win.window = win;
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) {
      if (id === 'pipelineBuilderRoot') { if (state.throwOnRoot) throw new Error('dom boom'); return root; }
      return null;
    },
    createElement() { return { style: {} }; },
    head: { appendChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const sandbox = { window: win, document, console: { log() {}, warn: (...a) => { warns.push(a.map(String).join(' ')); }, error() {} } };
  vm.runInNewContext(SRC, sandbox, { filename: 'pipeline-builder.js' });

  const btn = (attrs) => { const b = { getAttribute: (k) => (k in attrs ? attrs[k] : null) }; b.closest = () => b; return b; };
  const fire = async (type, target) => {
    const ev = { target, preventDefault() {} };
    await Promise.all((root._listeners[type] || []).map((fn) => fn(ev)));
    await flush();
  };
  return {
    win, root, toasts, warns, saves, state,
    open: () => win.switchSettingsTab('pipelines'),
    click: (attrs) => fire('click', btn(attrs)),
    rename: (stage, value) => fire('input', Object.assign(btn({ 'data-pb-action': 'rename', 'data-stage': stage }), { value })),
    hasEditor: () => root.innerHTML.indexOf('data-pb-action="save"') !== -1,
    lastToast: () => (toasts.length ? toasts[toasts.length - 1].m : ''),
  };
}

(async () => {
  console.log('PIPELINE BUILDER — company-profile hydration gate');

  // ── 1. hydrated profile: the legitimate edit + save path still works ──
  {
    const b = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) }, loadImpl: async () => {} });
    const r = b.open();
    assert('hook still returns switchSettingsTab\'s own result synchronously', r === 'orig:pipelines');
    await flush();
    assert('hydrated: editor renders with the tenant\'s custom stage', b.hasEditor() && b.root.innerHTML.indexOf('Paid In Full') !== -1);
    assert('hydrated: no redundant _loadCompanyProfile call', b.state.loadCalls === 0);
    await b.rename('contacted', 'Called');
    await b.click({ 'data-pb-action': 'save' });
    assert('hydrated: save writes exactly once', b.saves.length === 1);
    const p = b.saves[0] && b.saves[0].pipelines;
    assert('hydrated: write keeps the custom stage + view order and carries the rename',
      !!p && !!p.stages.custom_paid && p.stages.custom_paid.label === 'Paid In Full'
      && JSON.stringify(p.views.insurance.stages) === JSON.stringify(REAL.views.insurance.stages)
      && p.stages.contacted && p.stages.contacted.label === 'Called');
    assert('hydrated: success toast', /Pipelines saved/.test(b.lastToast()));
  }

  // ── 2. unhydrated at open, load SUCCEEDS: Loading… then the REAL config ──
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const b = loadBuilder({
      loaded: undefined, profile: {},
      loadImpl: async (win) => { await gate; win._companyProfile = { pipelines: clone(REAL) }; win._companyProfileLoaded = true; },
    });
    b.open();
    await flush();
    assert('awaiting hydration: shows Loading, no editor, no Save button',
      /Loading your saved pipelines/.test(b.root.innerHTML) && !b.hasEditor());
    assert('awaiting hydration: openBuilder asked the profile to load', b.state.loadCalls === 1);
    await b.click({ 'data-pb-action': 'save' });
    assert('awaiting hydration: a save attempt writes nothing', b.saves.length === 0);
    // _cfg is null while loading: stray edit events must be ignored, not throw.
    let threw = false;
    try {
      await b.rename('contacted', 'Early');
      await b.click({ 'data-pb-action': 'up', 'data-view': 'insurance', 'data-stage': 'won' });
    } catch (_) { threw = true; }
    assert('awaiting hydration: stray edit events are ignored (no TypeError on the null working copy)', threw === false);
    release();
    await flush();
    assert('after hydration: editor renders the tenant\'s REAL config, not defaults',
      b.hasEditor() && b.root.innerHTML.indexOf('Paid In Full') !== -1);
    await b.click({ 'data-pb-action': 'down', 'data-view': 'insurance', 'data-stage': 'new' });
    await b.click({ 'data-pb-action': 'save' });
    const p = b.saves[0] && b.saves[0].pipelines;
    assert('after hydration: a reorder save keeps custom_paid in stages AND in the view order',
      b.saves.length === 1 && !!p && !!p.stages.custom_paid
      && p.views.insurance.stages.indexOf('custom_paid') !== -1
      && p.views.insurance.stages[0] === 'custom_paid');
  }

  // ── 3. load FAILS (flag stays unset) over a stale device cache ──
  //      Render refuses; every write path refuses; Reset leaves memory alone.
  {
    const STALE = { stages: { custom_old: { label: 'Old Cached', role: 'active' } }, views: { insurance: { stages: ['new', 'custom_old', 'won', 'lost'] } } };
    const b = loadBuilder({
      loaded: undefined, profile: { pipelines: clone(STALE) },
      loadImpl: async () => { throw new Error('client is offline'); },
    });
    b.open();
    await flush();
    assert('failed load: no editor, a Retry prompt instead',
      !b.hasEditor() && /data-pb-action="retry"/.test(b.root.innerHTML) && /Couldn.t load your saved pipelines/.test(b.root.innerHTML));
    assert('failed load: the load rejection is swallowed, not unhandled', unhandled.length === 0);
    await b.rename('contacted', 'Hacked');
    await b.click({ 'data-pb-action': 'up', 'data-view': 'insurance', 'data-stage': 'won' });
    await b.click({ 'data-pb-action': 'save' });
    assert('failed load: save writes nothing', b.saves.length === 0);
    assert('failed load: save tells the user why', /Still loading your saved pipelines/.test(b.lastToast()));
    await b.click({ 'data-pb-action': 'reset' });
    assert('failed load: Reset writes nothing', b.saves.length === 0);
    assert('failed load: Reset does NOT force-clear the in-memory board config',
      JSON.stringify(b.win._companyProfile.pipelines) === JSON.stringify(STALE) && b.state.applied === 0);
  }

  // ── 4. snapshot taken UNHYDRATED, profile finishes loading AFTER the tab
  //      opened (the boot's own in-flight read lands later). A save-time-only
  //      `_companyProfileLoaded === true` check would pass here and write the
  //      defaults-seeded working copy; the snapshot flag must block it. ──
  {
    const b = loadBuilder({ loaded: undefined, profile: {}, loadImpl: async () => { /* read failed: flag stays unset */ } });
    b.open();
    await flush();
    assert('late hydration: builder opened on the unhydrated profile shows Retry', !b.hasEditor());
    b.win._companyProfile = { pipelines: clone(REAL) };
    b.win._companyProfileLoaded = true;          // lands after the snapshot
    await b.click({ 'data-pb-action': 'save' });
    assert('late hydration: save of the pre-hydration snapshot writes nothing', b.saves.length === 0);
    await b.click({ 'data-pb-action': 'retry' });
    assert('late hydration: Retry re-snapshots from the now-loaded profile',
      b.hasEditor() && b.root.innerHTML.indexOf('Paid In Full') !== -1);
    await b.click({ 'data-pb-action': 'save' });
    const p = b.saves[0] && b.saves[0].pipelines;
    assert('late hydration: after Retry the save carries the REAL config',
      b.saves.length === 1 && !!p && !!p.stages.custom_paid);
  }

  // ── 5. Retry re-attempts the load itself ──
  {
    const b = loadBuilder({
      loaded: undefined, profile: {},
      loadImpl: async (win, n) => { if (n === 1) throw new Error('offline'); win._companyProfile = { pipelines: clone(REAL) }; win._companyProfileLoaded = true; },
    });
    b.open();
    await flush();
    assert('retry: first load failed → Retry prompt', !b.hasEditor());
    await b.click({ 'data-pb-action': 'retry' });
    assert('retry: second load attempted and succeeded → editor', b.state.loadCalls === 2 && b.hasEditor());
  }

  // ── 6. a stale (superseded) open can't re-snapshot over a newer one ──
  //      Open #1's load is slow; the user leaves and reopens (#2), which
  //      hydrates, and starts editing. When #1's load finally settles it must
  //      not re-run loadCfg() and silently throw away the in-progress edit.
  {
    let releaseFirst;
    const first = new Promise((r) => { releaseFirst = r; });
    const b = loadBuilder({
      loaded: undefined, profile: {},
      loadImpl: async (win, n) => {
        if (n === 1) { await first; return; }               // slow
        win._companyProfile = { pipelines: clone(REAL) }; win._companyProfileLoaded = true;
      },
    });
    b.open();                  // #1: pending
    await flush();
    b.open();                  // #2: succeeds
    await flush();
    assert('superseded open: the newer open rendered the editor', b.hasEditor());
    await b.rename('contacted', 'Called');
    releaseFirst();
    await flush();
    assert('superseded open: the older open did not clobber the panel', b.hasEditor());
    await b.click({ 'data-pb-action': 'save' });
    const p = b.saves[0] && b.saves[0].pipelines;
    assert('superseded open: the edit made after the newer open survives to the save',
      b.saves.length === 1 && !!p && !!p.stages.contacted && p.stages.contacted.label === 'Called');
  }

  // ── 7. async openBuilder failure is handled by the hook (no unhandled rejection) ──
  {
    const before = unhandled.length;
    const b = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) } });
    b.state.throwOnRoot = true;
    let threw = false, r;
    try { r = b.open(); } catch (_) { threw = true; }
    await flush();
    assert('hook: an openBuilder failure does not throw out of switchSettingsTab', !threw && r === 'orig:pipelines');
    assert('hook: the failure is logged', b.warns.some((w) => /\[pipelines\] open failed/.test(w)));
    assert('hook: no unhandled promise rejection', unhandled.length === before);
  }

  // ── 8. canEdit(): claims not loaded yet = read-only, not "solo owner" ──
  {
    const b = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) }, claims: undefined });
    b.open();
    await flush();
    assert('no claims: builder renders read-only (no Save button)', !b.hasEditor() && /permissions load/.test(b.root.innerHTML));
    await b.click({ 'data-pb-action': 'save' });
    assert('no claims: a save attempt writes nothing', b.saves.length === 0);
    const solo = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) }, claims: {} });
    solo.open();
    await flush();
    assert('solo owner (claims loaded, no companyId) still edits', solo.hasEditor());
  }

  // ── 9. Reset: only force-clears memory when the write LANDED ──
  {
    const bad = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) }, saveRejects: true });
    bad.open();
    await flush();
    await bad.click({ 'data-pb-action': 'reset' });
    assert('reset + failed write: the write was attempted', bad.saves.length === 1);
    assert('reset + failed write: in-memory config is NOT cleared, board not re-applied',
      JSON.stringify(bad.win._companyProfile.pipelines) === JSON.stringify(REAL) && bad.state.applied === 0);
    assert('reset + failed write: the working copy is restored (editor still shows the custom stage)',
      bad.hasEditor() && bad.root.innerHTML.indexOf('Paid In Full') !== -1);

    const good = loadBuilder({ loaded: true, profile: { pipelines: clone(REAL) } });
    good.open();
    await flush();
    await good.click({ 'data-pb-action': 'reset' });
    assert('reset + hydrated: writes the explicit empty config',
      good.saves.length === 1 && JSON.stringify(good.saves[0].pipelines) === JSON.stringify({ stages: {}, views: {} }));
    assert('reset + hydrated: in-memory config cleared and the board re-applied',
      JSON.stringify(good.win._companyProfile.pipelines) === '{}' && good.state.applied >= 1);
  }

  await flush();
  assert('no unhandled promise rejections anywhere in the run', unhandled.length === 0);

  console.log('');
  if (failed) {
    console.log('FAIL — ' + passed + ' passed, ' + failed + ' failed:');
    fails.forEach((f) => console.log('   ✗ ' + f));
    process.exit(1);
  } else {
    console.log('PASS — ' + passed + ' assertions');
  }
})().catch((e) => { console.log('FAIL — harness error: ' + (e && e.stack || e)); process.exit(1); });
