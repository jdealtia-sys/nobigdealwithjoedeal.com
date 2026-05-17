/**
 * tests/smoke/dashboard.test.js — dashboard chrome, ScriptLoader,
 * AdminManager, UI wire-ins, theme system, mobile chrome, Wave 2/3/4/5,
 * Phase C.4/C.6 inline-handler refactors, view template hydration,
 * Sentry config, NBDStore, syntax checks for dashboard-adjacent JS.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ROOT, PRO_JS, FUNCTIONS, read, readDashboard, readDashboardMain, readCrm, readMaps, readFunctionsIndex, syntaxCheck } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section, bumpPassed, bumpFailed } = ctx;

// ── Syntax sanity on the files we care about ────────────────
section('Syntax checks');
const syntaxFiles = [
  path.join(PRO_JS, 'script-loader.js'),
  path.join(PRO_JS, 'admin-manager.js'),
  path.join(PRO_JS, 'crm.js'),
  // Step 4b split — the four sibling modules must each parse.
  path.join(PRO_JS, 'crm-leads.js'),
  path.join(PRO_JS, 'crm-pipeline.js'),
  path.join(PRO_JS, 'crm-snooze.js'),
  path.join(PRO_JS, 'crm-portal-bridge.js'),
  path.join(PRO_JS, 'maps.js'),
  // Step 4d split — the three sibling modules must each parse.
  path.join(PRO_JS, 'maps-core.js'),
  path.join(PRO_JS, 'maps-overlays.js'),
  path.join(PRO_JS, 'maps-routing.js'),
  path.join(PRO_JS, 'estimates.js'),
  path.join(PRO_JS, 'estimate-v2-ui.js'),
  path.join(PRO_JS, 'estimate-finalization.js'),
  path.join(PRO_JS, 'nbd-doc-viewer.js'),
  path.join(FUNCTIONS, 'index.js')
];
for (const f of syntaxFiles) {
  const result = syntaxCheck(f);
  assert('parses ' + path.relative(ROOT, f), result.ok, result.err && result.err.split('\n')[0]);
}

// ── ScriptLoader public API ──────────────────────────────────
section('ScriptLoader contract');
{
  const src = read(path.join(PRO_JS, 'script-loader.js'));
  assert('registers window.ScriptLoader', /window\.ScriptLoader\s*=/.test(src));
  assert('exposes load()',            /\bload\s*[,:]/.test(src));
  assert('exposes loadBundle()',      /\bloadBundle\s*[,:]/.test(src));
  assert('exposes preloadForView()',  /\bpreloadForView\s*[,:]/.test(src));
  assert('exposes markLoaded()',      /\bmarkLoaded\s*[,:]/.test(src));
  assert('defines BUNDLES table',     /const\s+BUNDLES\s*=/.test(src));
  assert('defines VIEW_BUNDLES map',  /const\s+VIEW_BUNDLES\s*=/.test(src));

  // Every view in VIEW_BUNDLES must reference a bundle that exists
  const bundleMatch  = src.match(/const BUNDLES\s*=\s*\{([\s\S]*?)\};/);
  const viewsMatch   = src.match(/const VIEW_BUNDLES\s*=\s*\{([\s\S]*?)\};/);
  const bundleNames  = bundleMatch ? [...bundleMatch[1].matchAll(/^\s*(\w+):\s*\[/gm)].map(m => m[1]) : [];
  const viewRefs     = viewsMatch  ? [...viewsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(n => !/^[a-z]+_bundles$/.test(n)) : [];
  // Crude but effective: every bareword quoted string in VIEW_BUNDLES that
  // appears AFTER `[` should be a bundle name. Walk each line and compare.
  const orphans = [];
  for (const line of viewsMatch ? viewsMatch[1].split('\n') : []) {
    const inBrackets = line.match(/\[([^\]]*)\]/);
    if (!inBrackets) continue;
    const refs = [...inBrackets[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const r of refs) if (!bundleNames.includes(r)) orphans.push(r);
  }
  assert('all view bundles reference real bundles', orphans.length === 0, orphans.join(', '));
}

// ── AdminManager public API ──────────────────────────────────
section('AdminManager contract');
{
  const src = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('registers window.AdminManager', /window\.AdminManager\s*=/.test(src));
  for (const fn of ['init', 'refresh', 'openCreate', 'closeCreate', 'submitCreate',
                    'closeEdit', 'submitEdit', 'toggleDeactivate', 'applyGate']) {
    // Match shorthand property (`fn,` or `fn\n  }`) or longhand (`fn: ...`).
    assert('exposes ' + fn + '()', new RegExp('\\b' + fn + '\\s*[,:\\s]*\\}?').test(src));
  }
  assert('invokes listTeamMembers callable', /callable\(['"]listTeamMembers['"]\)/.test(src));
  assert('invokes createTeamMember callable', /callable\(['"]createTeamMember['"]\)/.test(src));
  assert('invokes updateUserRole callable',   /callable\(['"]updateUserRole['"]\)/.test(src));
  assert('invokes deactivateUser callable',   /callable\(['"]deactivateUser['"]\)/.test(src));
}

// ── H-2: iframe sandbox drops allow-same-origin ─────────────
section('H-2: iframe sandbox');
{
  const src = read(path.join(PRO_JS, 'nbd-doc-viewer.js'));
  assert("sandbox does not contain 'allow-same-origin'",
    !/allow-same-origin/.test(src.match(/sandbox[^'"]*['"][^'"]*['"]/)?.[0] || ''));
  assert('print listener injected via wrapWithPrintListener',
    /function wrapWithPrintListener/.test(src));
  assert('PDF path uses DOMParser (no contentDocument access)',
    /new DOMParser\(\)\.parseFromString/.test(src));
  assert('PDF path scrubs <script> and on* attrs',
    /querySelectorAll\('script, iframe, object, embed'\)[\s\S]{0,200}removeAttribute/.test(src));
}

section('UI-B: BoldSign send-for-signature + badges');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('Send-for-signature button present', /data-action="send-for-signature"/.test(src));
  assert('sendForSignature() wired', /async function sendForSignature\(/.test(src));
  assert('stores saved estimate id on window for signature flow',
    /window\._v2SavedEstimateId\s*=\s*savedId/.test(src));
  // Audit batch 10: search across dashboard.html + dashboard-main.js
  // since the inline handlers moved into the extracted file.
  const dash = readDashboard();
  assert('signature badge rendered on estimate cards',
    /signatureStatus === 'signed'/.test(dash) && /SIGNED/.test(dash));
  assert('sigTag injected into est-card-chips',
    /leadTag \+ builderTag \+ sigTag/.test(dash));
}

section('UI-C: Regrid wire-in to property-intel');
{
  const src = read(path.join(PRO_JS, 'property-intel.js'));
  assert('_regridToIntel mapper defined', /function _regridToIntel/.test(src));
  assert('fetchPropertyIntel tries NBDIntegrations.lookupParcel',
    /NBDIntegrations\.lookupParcel/.test(src));
  assert('Regrid path short-circuits on hit',
    /renderIntelCard\(targetElId, intel, countyClean, fullAddr\);\s*return;/.test(src));
}

section('UI-E: Cal.com in Settings');
{
  // CSP hotfix: _saveSettings lives in dashboard-bootstrap.module.js
  // after extraction, so use readDashboard() (HTML + all shards).
  const dash = readDashboard();
  assert('settingsCalcom input present', /id="settingsCalcom"/.test(dash));
  assert('settingsCalcomPreview anchor present',
    /id="settingsCalcomPreview"/.test(dash));
  assert('_saveSettings persists calcomUsername',
    /calcomUsername/.test(dash) && /setDoc[\s\S]{0,200}users[\s\S]{0,200}calcomUsername/.test(dash));
}

section('Wave A4: rotateAccessCodes button');
{
  const adm = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('AdminManager.rotateAccessCodes defined',
    /async function rotateAccessCodes/.test(adm));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('Team Manager header renders rotate button',
    /data-target="AdminManager\.rotateAccessCodes"/.test(dash));
}

// ── Null-guard smoke: hot-spot functions use guards ──────────
section('Null guards on hot paths');
{
  // Step 4b: crm.js was split into 4 modules + a shim — concat them
  // via readCrm() so these null-guard assertions find their patterns
  // regardless of which split file the code landed in.
  const crm = readCrm();
  assert('openLeadModal checks modal existence',
    /function openLeadModal[\s\S]{0,200}if \(!modal\) return/.test(crm));
  assert('saveLead guards modal elements',
    /saveLead[\s\S]{0,400}if\s*\(\s*!mErr\s*\|\|\s*!mOk/.test(crm));

  // Step 4d: openPinConfirm now lives in maps-overlays.js, recalcGutters
  // in maps-routing.js. readMaps() concats the split modules so the
  // existing regex assertions keep finding the functions.
  const maps = readMaps();
  assert('openPinConfirm guards dot/lbl/coord/notes',
    /function openPinConfirm[\s\S]{0,400}if\s*\(\s*dot\s*\)/.test(maps));
  assert('recalcGutters guards total+ds',
    /function recalcGutters[\s\S]{0,300}if\s*\(\s*totalEl\s*\)/.test(maps));

  const est = read(path.join(PRO_JS, 'estimates.js'));
  assert('startNewEstimateOriginal bails on missing builder',
    /startNewEstimateOriginal[\s\S]{0,400}if\s*\(!builder\)/.test(est));
  assert('buildReview guards reviewEl',
    /function buildReview[\s\S]{0,2000}if\s*\(\s*!reviewEl\s*\)/.test(est));
}

// ── Inline HTML <script> syntax ─────────────────────────────
// Guards against the class of bug where an inline <script> inside an
// HTML file has a syntax error (unclosed brace, etc.) — browsers
// silently log it to console and the page renders but every JS
// feature on the page is dead. Full fixture-based suite at
// tests/inline-html-scripts.test.js; we gate on it passing.
try {
  execSync('node ' + JSON.stringify(path.join(__dirname, '..', 'inline-html-scripts.test.js')), {
    stdio: 'inherit',
    cwd: ROOT,
  });
  bumpPassed();
} catch (e) {
  bumpFailed('inline-html-scripts.test.js — inline <script> in docs/ has syntax error (see output above)');
}

// ── CSP: strict pages stay free of inline event handlers ────
// firebase.json ships tight per-page CSPs (script-src-attr 'none')
// for the pages below. That header BLOCKS any onclick=/onsubmit=/
// onfocus= handler in the HTML — which is what we want, but the
// blocking is silent, so a stray inline handler just breaks the page
// without a visible error. This check refuses to let a new inline
// handler land on those files.
section('CSP: strict-CSP pages have zero inline event handlers');
{
  const STRICT_PAGES = [
    'docs/pro/login.html',
    'docs/pro/register.html',
    'docs/pro/stripe-success.html',
    'docs/pro/analytics.html',
    'docs/pro/leaderboard.html',
    'docs/pro/ask-joe.html',
    'docs/pro/diagnostic.html',
    'docs/pro/understand.html',
    'docs/pro/ai-tree.html',
  ];
  const INLINE_HANDLER_RE = /\son(click|submit|change|input|load|focus|blur|keyup|keydown|mouseover|mouseout|mouseenter|mouseleave|drag|drop|touchstart|touchend)\s*=/;
  for (const p of STRICT_PAGES) {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, 'utf8');
    const match = html.match(INLINE_HANDLER_RE);
    assert(p + ' has no inline event handlers (strict CSP)',
      !match,
      match ? 'found: ' + match[0] + ' at offset ' + match.index : '');
  }
}

// ── A11y: main landmark + skip-link on public pages ─────────
// These are the pages users touch before authentication. Screen-reader
// and keyboard users need a "skip to main content" target + a
// <main id="main"> landmark to jump to. The test is tight — we only
// gate the public auth-entry pages so adding landmarks to the rest of
// the app can happen incrementally without breaking CI.
section('A11y: main landmark + skip-link on public pages');
{
  const PAGES = ['docs/pro/login.html', 'docs/pro/register.html', 'docs/pro/pricing.html'];
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert(p + ' has <main id="main">',  /<main[^>]*id=["']main["']/.test(html));
    assert(p + ' has skip-to-main link',
      /href=["']#main["']/.test(html) && /Skip to main content/i.test(html));
  }
}

// ── Perf: no new oversized images ───────────────────────────
// Guard against someone dropping an uncompressed PNG/JPEG into the
// build. Anything > 1MB is almost always a mistake (should be a WebP
// under 200KB or a sized JPEG). The existing known offenders
// (roofivent product shots) are whitelisted — the guard is specifically
// for NEW regressions, not for retro-cleaning binaries we can't edit
// in this worktree.
section('Perf: oversized image regression guard');
{
  const MAX_IMAGE_BYTES = 1 * 1024 * 1024;  // 1 MB
  const WHITELIST = new Set([
    // Existing product imagery — documented large, lazy-loaded on
    // /services/roofivent/ below the fold, converted to WebP/AVIF
    // in a follow-up perf pass.
    'docs/assets/roofivent/ivent-roto.png',
    'docs/assets/roofivent/ivent-eco.png',
  ]);
  function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(entry.name)) out.push(full);
    }
    return out;
  }
  const imgs = walk(path.join(ROOT, 'docs'), []);
  const offenders = [];
  for (const abs of imgs) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const size = fs.statSync(abs).size;
    if (size > MAX_IMAGE_BYTES && !WHITELIST.has(rel)) {
      offenders.push(rel + ' (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
    }
  }
  assert('Perf: no new image > 1MB (' + imgs.length + ' scanned, ' + WHITELIST.size + ' whitelisted)',
    offenders.length === 0,
    offenders.length ? 'offenders: ' + offenders.join(', ') : '');
}

section('Visual regression baseline (Playwright pixel-diff)');
{
  const spec = read(path.join(ROOT, 'tests/e2e/visual-regression.spec.js'));
  const pkg  = JSON.parse(read(path.join(ROOT, 'tests/package.json')));
  // Suite covers public pages only — auth pages need a session.
  assert('visual-regression.spec.js covers login/register/pricing/landing',
    /\/pro\/login/.test(spec)
    && /\/pro\/register/.test(spec)
    && /\/pro\/pricing/.test(spec)
    && /name:\s*['"]landing['"]/.test(spec));
  // Three viewports — mobile/tablet/desktop. The mobile-375 snapshot
  // is the one Joe lives in (iPhone in the field).
  assert('three viewports configured (375 / 768 / 1280)',
    /width:\s*375/.test(spec)
    && /width:\s*768/.test(spec)
    && /width:\s*1280/.test(spec));
  // Animations must be neutralized before screenshot — fail-loud
  // if someone removes the disable-transitions style block, because
  // mid-animation pixels would flake the diff forever.
  assert('animations + transitions disabled before screenshot',
    /transition:\s*none\s*!important[\s\S]{0,80}animation:\s*none\s*!important/.test(spec));
  // Mask hooks for high-entropy regions — keeps live-counter pages
  // (pricing carousels, "as of" timestamps) from flaking.
  assert('mask hooks for live-timestamp + data-mask-visual',
    /mask:\s*\[[\s\S]{0,200}\.live-timestamp/.test(spec)
    && /\[data-mask-visual\]/.test(spec));
  // npm scripts wired so CI + local can run + update baselines.
  assert('test:e2e:visual + test:e2e:visual:update npm scripts',
    !!(pkg.scripts && pkg.scripts['test:e2e:visual'])
    && !!(pkg.scripts && pkg.scripts['test:e2e:visual:update']));
}

section('NBDStore — pub/sub state store + first-slice migration');
{
  const store    = read(path.join(ROOT, 'docs/pro/js/state-store.js'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const dash     = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const pkg      = JSON.parse(read(path.join(ROOT, 'tests/package.json')));

  // Public surface — these names are the migration contract; renaming
  // any of them silently breaks every call site that adopts the store.
  assert('state-store exports create + get + set + subscribe + bind on window.NBDStore',
    /window\.NBDStore\s*=\s*api/.test(store)
    && /create:\s*create/.test(store)
    && /get:\s*singleton\.get/.test(store)
    && /set:\s*singleton\.set/.test(store)
    && /subscribe:\s*singleton\.subscribe/.test(store)
    && /bind:\s*singleton\.bind/.test(store));

  // Identity-equality short-circuit — if this regresses, every legacy
  // call site that does `set.add(x); store.set('photos.selected', set)`
  // would silently fail to notify subscribers and the bulk-bar would
  // never re-render. Test directly in state-store.test.js; smoke just
  // pins the comparison line so a refactor can't drop it.
  assert('set short-circuits when prev === value',
    /if \(prev === value\) return false;/.test(store));

  // Subscriber-throw isolation — a single buggy listener must not
  // break every other listener for the same path.
  assert('notify catches subscriber throws and continues',
    /try \{[\s\S]{0,80}listeners\[i\]\(value, path\);[\s\S]{0,200}console\.error/.test(store));

  // bind() is one-way (store → window). Two-way would let legacy
  // direct writes to window._foo bypass subscribers entirely, so the
  // doc + the impl must both refuse it.
  assert('state-store documents one-way window mirror',
    /NOT a two-way sync/.test(store));

  // Both pages load the module BEFORE any feature script that might
  // want to subscribe (sentry-init seeds error reporting; everything
  // after that can read the store).
  assert('customer.html loads state-store.js after sentry-init',
    /sentry-init\.js[\s\S]{0,400}state-store\.js/.test(customer));
  assert('dashboard.html loads state-store.js after sentry-init',
    /sentry-init\.js[\s\S]{0,400}state-store\.js/.test(dash));

  // First slice migrated — photos.selected. The customer page wires
  // selection state into the store, binds it to the legacy global
  // for backward compat, and re-emits to updateBulkBarUI via a
  // subscriber so call sites don't need to know about the bar.
  assert('customer.html seeds photos.selected slice in NBDStore',
    /NBDStore\.set\(['"]photos\.selected['"], new Set\(\)\)/.test(customer));
  assert('customer.html binds _photoSelected → photos.selected (one-way)',
    /NBDStore\.bind\(['"]_photoSelected['"], ['"]photos\.selected['"]\)/.test(customer));
  assert('customer.html subscribes bulk-bar render to photos.selected',
    /NBDStore\.subscribe\(['"]photos\.selected['"][\s\S]{0,200}updateBulkBarUI/.test(customer));

  // Mutations now go through the helper that swaps the Set ref —
  // mutate-in-place would skip the identity check above and never
  // notify subscribers.
  assert('updatePhotoSelection swaps Set ref to trigger notify',
    /function updatePhotoSelection\(mutate\)[\s\S]{0,400}var next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]photos\.selected['"], next\)/.test(customer));

  // Test runner is wired so CI runs the unit suite.
  assert('test:state npm script runs state-store.test.js',
    !!(pkg.scripts && pkg.scripts['test:state'] === 'node ./state-store.test.js'));
  assert('top-level test runs npm run test:state',
    /npm run test:state/.test(pkg.scripts.test || ''));
}

section('Sentry — DSN config wired across high-value pages');
{
  const sentryConfig = read(path.join(ROOT, 'docs/pro/js/sentry-config.js'));
  // Config exposes the two globals sentry-init.js looks for.
  assert('sentry-config.js exposes window.__NBD_SENTRY_DSN',
    /window\.__NBD_SENTRY_DSN\s*=\s*NBD_SENTRY_DSN/.test(sentryConfig));
  assert('sentry-config.js exposes window.__NBD_RELEASE',
    /window\.__NBD_RELEASE\s*=\s*['"]web@/.test(sentryConfig));
  // Pages that need error reporting load BOTH the config and the SDK
  // shim, in that order. Config must come first so the DSN is on the
  // window before sentry-init reads it.
  ['dashboard.html', 'customer.html', 'login.html', 'register.html'].forEach(function (page) {
    var html = read(path.join(ROOT, 'docs/pro', page));
    assert(page + ' loads sentry-config.js before sentry-init.js',
      /sentry-config\.js[\s\S]{0,400}sentry-init\.js/.test(html),
      'sentry-config must come before sentry-init in ' + page);
  });
  // dashboard.html no longer hardcodes the DSN inline (it lives in
  // sentry-config.js now — single source of truth).
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard.html no longer inlines window.__NBD_SENTRY_DSN',
    !/window\.__NBD_SENTRY_DSN\s*=\s*"[^"]*";/.test(dash));
}

section('Audit batch 6 — repos.js wired into dashboard write path');
{
  // CSP hotfix: lead-create write path is in dashboard-bootstrap.module.js
  // now. We need raw HTML for the <script defer src="js/repos.js"> assertion
  // (that's about HTML structure, not JS content), so we keep both.
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const dash = readDashboard();
  const repos = read(path.join(ROOT, 'docs/pro/js/repos.js'));

  assert('dashboard.html loads repos.js in defer chain',
    /<script defer src="js\/repos\.js/.test(dashHtml),
    'expected <script defer src="js/repos.js" ...> in dashboard.html');

  assert('repos.js exposes window.NBDRepos.leads / photos / estimates',
    /window\.NBDRepos\s*=/.test(repos)
      && /leads:\s*leads/.test(repos)
      && /photos:\s*photos/.test(repos),
    'NBDRepos must export the lead + photo repositories');

  assert('repos.js falls back to uid when no companyId on claims (solo-operator support)',
    /\|\|\s*uid;/.test(repos) || /||\s*uid;/.test(repos),
    'companyId resolution must fall through to uid for solo operators');

  assert('dashboard.html lead-create migrated to NBDRepos.leads.create',
    /window\.NBDRepos\.leads\.create/.test(dash),
    'expected the lead-create write path to prefer NBDRepos.leads.create');
}

section('Audit batch 4 — admin function role-check drift guard');
{
  // Every Cloud Function the FUNCTIONS_INDEX.md classifies as ADMIN
  // must keep its role check. If someone refactors and drops the check
  // (no client caller would notice because admin functions have no
  // public client wrapper), the function silently becomes callable by
  // any authenticated user. CI catches that here.
  const indexPath = path.join(ROOT, 'functions/FUNCTIONS_INDEX.md');
  assert('functions/FUNCTIONS_INDEX.md exists',
    fs.existsSync(indexPath),
    'canonical functions taxonomy must exist');

  // Parse the ADMIN table out of the doc. Each row starts with
  // | `functionName` | ...
  const md = fs.existsSync(indexPath) ? read(indexPath) : '';
  const adminSection = md.match(/## ADMIN[\s\S]*?(?=\n## |$)/);
  const adminNames = adminSection
    ? Array.from(adminSection[0].matchAll(/\|\s*`(\w+)`\s*\|/g)).map(m => m[1])
    : [];
  assert('FUNCTIONS_INDEX lists at least 10 admin functions',
    adminNames.length >= 10,
    'expected the admin section to enumerate all admin exports');

  // The 5 known admin-gating patterns we accept anywhere in the file
  // that defines the function. Mostly we look at functions/index.js
  // because that's where the inline definitions live; for the few
  // admin functions exported from sub-modules we look at the source.
  const PATTERNS = [
    /role\s*===\s*['"]admin['"]/,
    /adminOnly:\s*true/,
    /requireTeamAdmin\s*\(/,
    /isAdmin\s*\(\)/,
    // integrationStatus uses an includes()-style allowlist —
    // `['admin', 'company_admin'].includes(callerRole)` — which the
    // original walker accidentally matched via the NEXT handler
    // (getAdminAnalytics) being within 8000 chars in the old monolithic
    // index.js. Step 4c split that out into its own handler file, so we
    // need an explicit pattern for the includes shape.
    /\[\s*['"]admin['"][^\]]*\]\.includes\(\s*[a-zA-Z_]+Role\s*\)/,
  ];

  // Scan every .js in functions/ (skip node_modules) for definitions
  // of each admin function. If we find one, assert at least one of the
  // patterns appears within 200 lines of the export.
  function adminGateOk(name) {
    const candidates = ['functions/index.js'];
    // Cheap: assume any sub-module that re-exports is the definition site
    const subFiles = fs.readdirSync(path.join(ROOT, 'functions'))
      .filter(f => f.endsWith('.js') && f !== 'index.js')
      .map(f => 'functions/' + f);
    candidates.push(...subFiles);
    // Step 4c: inline handlers moved to functions/handlers/<area>.js.
    // The definition site for setStorageCors, getAdminAnalytics,
    // integrationStatus, etc. is now inside that subdirectory.
    const handlersDir = path.join(ROOT, 'functions/handlers');
    if (fs.existsSync(handlersDir)) {
      const handlerFiles = fs.readdirSync(handlersDir)
        .filter(f => f.endsWith('.js'))
        .map(f => 'functions/handlers/' + f);
      candidates.push(...handlerFiles);
    }
    for (const c of candidates) {
      const full = path.join(ROOT, c);
      if (!fs.existsSync(full)) continue;
      const src = read(full);
      const declRe = new RegExp('(?:exports\\.' + name + '\\s*=|function\\s+' + name + '\\s*\\()', '');
      const m = src.match(declRe);
      if (!m) continue;
      // Look at the 200 lines after the declaration for an admin pattern.
      const idx = m.index;
      const window = src.slice(idx, idx + 8000);
      if (PATTERNS.some(p => p.test(window))) return true;
    }
    return false;
  }

  const skipped = new Set([
    // E2E test helpers — admin-gated but the pattern shows up in helper code
    // they're allowed.
  ]);
  const missing = [];
  for (const name of adminNames) {
    if (skipped.has(name)) continue;
    if (!adminGateOk(name)) missing.push(name);
  }
  assert('every admin function in FUNCTIONS_INDEX has a role/admin gate',
    missing.length === 0,
    missing.length ? 'admin gate missing from: ' + missing.join(', ') : '');
}

section('Rock 4 rollback fallback (Phase 3 prep)');
{
  // CSP hotfix (2026-05-16): the redirect script was inline; now it
  // lives in docs/pro/js/dashboard-legacy-redirect.js. dashboard.html
  // still ships the <script src> reference, and readDashboard() rolls
  // in the new shard so the body assertions still match.
  const dash = readDashboard();
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const legacyPath = path.join(ROOT, 'docs/pro/dashboard.legacy.html');
  // 1. dashboard ships the ?legacy=1 redirect logic (inline or external).
  assert('dashboard.html has ?legacy=1 redirect to dashboard.legacy.html',
    /URLSearchParams\(location\.search\)\.has\(['"]legacy['"]\)[\s\S]{0,200}location\.replace\(['"]\/pro\/dashboard\.legacy\.html/.test(dash),
    'expected a <script> (inline or external) that redirects when ?legacy=1 is present');
  // 2. The redirect's pathname guard prevents an infinite loop on the
  //    legacy snapshot itself. The script must compare against
  //    '/pro/dashboard' (no .legacy suffix) so that location.pathname
  //    of '/pro/dashboard.legacy' fails the check and the page renders.
  assert('dashboard.html redirect guards against /pro/dashboard.legacy loop',
    /p === ['"]\/pro\/dashboard['"]/.test(dash),
    'pathname check must be strict equality with /pro/dashboard (not startsWith)');
  // 3. The legacy snapshot must exist and be non-trivial.
  assert('dashboard.legacy.html exists and is non-empty',
    fs.existsSync(legacyPath) && fs.statSync(legacyPath).size > 100000,
    'expected docs/pro/dashboard.legacy.html with >100KB of content');
  // 4. dashboard.html itself still references the redirect script, so
  //    the rollback path can never silently disappear in a future edit.
  assert('dashboard.html references the legacy-redirect script',
    /dashboard-legacy-redirect\.js/.test(dashHtml) ||
    /URLSearchParams\(location\.search\)\.has\(['"]legacy['"]\)/.test(dashHtml),
    'expected dashboard.html to ship the redirect either inline or via <script src>');
}

section('Wave 6b (A.2) — Pro Chrome on login.html + vault.html');
{
  const login = read(path.join(ROOT, 'docs/pro/login.html'));
  const vault = read(path.join(ROOT, 'docs/pro/vault.html'));
  // 1. login.html supplies its own --accent-fg + --accent-ring (it keeps
  //    --orange fixed for brand consistency, so it can't inherit per-theme
  //    overrides; the contract lives locally).
  assert('login.html defines --accent-fg + --accent-ring',
    /:root\{[\s\S]{0,800}--accent-fg:#fff[\s\S]{0,200}--accent-ring/.test(login),
    'expected login.html :root to declare --accent-fg + --accent-ring');
  // 2. login.html primary action surfaces consume the contract.
  assert('login.html .tab-btn.active uses var(--accent-fg)',
    /\.tab-btn\.active\{[^}]*background:var\(--orange\)[^}]*color:var\(--accent-fg\)/.test(login),
    'expected .tab-btn.active to color: var(--accent-fg)');
  assert('login.html .btn-main uses var(--accent-fg) + inset --accent-ring',
    /\.btn-main\{[^}]*color:var\(--accent-fg\)[\s\S]{0,500}box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(login),
    'expected .btn-main to use --accent-fg + inset --accent-ring boundary');
  // 3. vault.html does the same.
  assert('vault.html declares --accent-fg + --accent-ring',
    /--accent-fg:#fff[\s\S]{0,200}--accent-ring:rgba/.test(vault),
    'expected vault.html to declare the accent tokens locally');
  assert('vault.html .btn-save / .btn-gold use var(--accent-fg)',
    /\.btn-save \{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(vault)
    && /\.btn-gold \{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(vault),
    'expected vault.html primary-action buttons to consume --accent-fg');
  // 4. Both files retired hardcoded NBD-orange rgba literals.
  for (const [name, body] of [['login.html', login], ['vault.html', vault]]) {
    assert(name + ': no hardcoded rgba(232,114,12,...) left',
      !/rgba\(232,\s*114,\s*12/.test(body),
      name + ' should use color-mix(in srgb, var(--orange) ...) instead of literal NBD-orange rgba');
  }
}

section('Wave 6 (A.1) — Pro Chrome on customer.html via shared theme-system.css');
{
  const themeCSS = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Shared contract lives in theme-system.css now.
  assert('theme-system.css defines :root --accent-fg default #fff',
    /:root\s*\{[\s\S]{0,200}--accent-fg\s*:\s*#fff/.test(themeCSS),
    'expected --accent-fg default in shared theme-system.css');
  assert('theme-system.css defines :root --accent-ring default',
    /:root\s*\{[\s\S]{0,200}--accent-ring\s*:\s*rgba/.test(themeCSS),
    'expected --accent-ring default in shared theme-system.css');
  // 2. Per-theme overrides moved into the shared file. Some themes
  //    share a group selector (paper + ghost + easter etc. → one
  //    --accent-fg block), so we just check the theme name appears in
  //    a selector that sits above an --accent-fg declaration.
  for (const theme of ['paper','obsidian','steel','slate','neon','gold','batman','pokemon','zelda','blueprint-art']) {
    assert('theme-system.css overrides --accent-fg for ' + theme,
      new RegExp(':root\\[data-theme="' + theme + '"\\][^{]{0,800}\\{[\\s\\S]{0,400}--accent-fg').test(themeCSS),
      'expected theme-system.css to override --accent-fg for ' + theme);
  }
  // 3. dashboard.html no longer duplicates the contract.
  assert('dashboard.html no longer duplicates --accent-fg/--accent-ring defaults',
    !/  --accent-fg:#fff;\s*\n\s*--accent-ring:rgba\(0,0,0,\.35\)/.test(dash),
    'dashboard.html should inherit accent tokens from theme-system.css');
  // 4. customer.html .btn-orange consumes the contract.
  assert('customer.html .btn-orange uses var(--accent-fg)',
    /\.btn-orange\s*\{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(customer),
    'expected customer.html .btn-orange to color: var(--accent-fg)');
  assert('customer.html .btn-orange has var(--accent-ring) inset boundary',
    /\.btn-orange\s*\{[\s\S]{0,400}inset 0 0 0 1px var\(--accent-ring\)/.test(customer),
    'expected customer.html .btn-orange to include inset boundary using --accent-ring');
  // 5. customer.html hardcoded NBD-orange rgba retired.
  assert('customer.html: no hardcoded rgba(232,114,12,...) left',
    !/rgba\(232,\s*114,\s*12/.test(customer),
    'customer.html should use color-mix(in srgb, var(--orange) ...) instead of literal rgba');
}

section('Wave 5c — .crm-hdr-actions side-scroller affordance');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Fade gradient + snap-type — search whole file since there are
  //    multiple .crm-hdr-actions rule blocks (one outer, one inside an
  //    @media), and the new behavior lives in the wider block.
  assert('.crm-hdr-actions has a mask-image fade on the right edge',
    /mask-image:\s*linear-gradient\(to right,\s*#000\s+calc\(100% - 24px\),\s*transparent\)/.test(dash),
    'expected mask-image right-edge fade so scrollability is visually communicated');
  assert('.crm-hdr-actions uses scroll-snap-type x proximity',
    /scroll-snap-type:\s*x\s+proximity/.test(dash),
    'expected scroll-snap-type:x proximity for cleaner momentum stops');
  // 2. Children become snap targets.
  assert('.crm-hdr-btn / .crm-icon-btn become scroll-snap targets',
    /\.crm-hdr-actions > \.crm-icon-btn,\s*\.crm-hdr-actions > \.crm-hdr-btn[\s\S]{0,80}scroll-snap-align:\s*start/.test(dash),
    'expected scroll-snap-align:start on the action-row children');
  // 3. Scrollbar is visible (6px) and tinted with the accent.
  assert('.crm-hdr-actions scrollbar is 6px tall',
    /\.crm-hdr-actions::-webkit-scrollbar\{\s*height:\s*6px/.test(dash),
    'expected the webkit scrollbar height of 6px for affordance visibility');
  assert('.crm-hdr-actions scrollbar thumb uses --orange-tinted color',
    /\.crm-hdr-actions::-webkit-scrollbar-thumb\{[\s\S]{0,200}var\(--orange\)/.test(dash),
    'expected scrollbar thumb tinted with --orange');
  // 4. Old 3px height rule retired.
  assert('old 3px scrollbar override retired',
    !/\.crm-hdr-actions::-webkit-scrollbar\{\s*height:\s*3px/.test(dash),
    'found leftover .crm-hdr-actions::-webkit-scrollbar height:3px — should be replaced by the Wave 5c 6px treatment');
}

section('Wave 5b — Gradient flatten + bulk accent-fg migration');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. .btn-orange no longer uses a linear-gradient for its base fill.
  const btnStart = dash.indexOf('.btn-orange {');
  const btnBlock = dash.slice(btnStart, btnStart + 600);
  assert('.btn-orange base background is solid (no linear-gradient)',
    /\.btn-orange\s*\{\s*background:\s*var\(--orange\)/.test(btnBlock),
    'expected solid background:var(--orange) on .btn-orange — gradient was muddy on forest/neon themes');
  // 2. .kview-btn.active uses --accent-fg.
  assert('.kview-btn.active uses var(--accent-fg)',
    /\.kview-btn\.active\{background:var\(--orange\);color:var\(--accent-fg\)/.test(dash),
    'expected .kview-btn.active color: var(--accent-fg)');
  // 3. No remaining text-on-accent pairings using var(--t). Regex
  //    bounded by `"{};` so it stays within a single CSS rule or
  //    inline style attribute (the earlier unbounded version greedy-
  //    matched 10K chars across unrelated elements).
  assert('no remaining text-on-accent surfaces using var(--t)',
    !/background:\s*var\(--orange\)[^"{};]{0,200};\s*[^"{}]{0,80}color:\s*var\(--t\)/.test(dash),
    'found a text-on-orange surface still using var(--t) — should be var(--accent-fg) for theme contrast');
}

section('Wave 5 — Theme-aware accent + contrast tokens');
{
  // Wave 6 (A.1) moved the tokens themselves into the shared
  // theme-system.css — the Wave 6 section above asserts that. Here we
  // only check that dashboard.html still CONSUMES the contract.
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 3. .btn-orange consumes the tokens.
  assert('.btn-orange uses var(--accent-fg) for color',
    /\.btn-orange\s*\{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(dash),
    'expected .btn-orange to color: var(--accent-fg)');
  assert('.btn-orange paints an inset 1px ring via --accent-ring',
    /\.btn-orange\s*\{[\s\S]{0,400}inset 0 0 0 1px var\(--accent-ring\)/.test(dash),
    'expected .btn-orange inset boundary using --accent-ring');
  // 4. Other static-accent surfaces upgraded.
  assert('#addLeadFab uses var(--accent-fg) + var(--accent-ring)',
    /#addLeadFab\{[\s\S]{0,400}color:\s*var\(--accent-fg\)[\s\S]{0,200}border:[^;]*var\(--accent-ring\)/.test(dash),
    'expected #addLeadFab to consume the new tokens');
  assert('.mn-item.mn-fab uses var(--accent-ring) border',
    /\.mn-item\.mn-fab\s*\{[\s\S]{0,400}border:[^;]*var\(--accent-ring\)/.test(dash),
    'expected .mn-item.mn-fab to use --accent-ring');
  {
    const shutter = dash.indexOf('.m-shutter-fab{');
    const shutterBlock = dash.slice(shutter, shutter + 800);
    assert('.m-shutter-fab uses var(--accent-fg)',
      /color:\s*var\(--accent-fg\)/.test(shutterBlock),
      'expected .m-shutter-fab to color: var(--accent-fg)');
    assert('.m-shutter-fab uses var(--accent-ring) border',
      /border:[^;]*var\(--accent-ring\)/.test(shutterBlock),
      'expected .m-shutter-fab to border via --accent-ring');
  }
  // 5. Hardcoded `rgba(232,114,12,...)` glow strings retired in favor
  //    of --og (the per-theme tinted glow). Spot-check on #addLeadFab.
  const fab = dash.indexOf('#addLeadFab{');
  const fabBlock = dash.slice(fab, fab + 500);
  assert('#addLeadFab no longer uses rgba(232,114,12) glow',
    !/rgba\(232,114,12/.test(fabBlock),
    '#addLeadFab still has a hardcoded NBD-orange glow — should use var(--og)');
}

section('Wave 4 — Design tokens (type / spacing / radius / tap-targets)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Type scale.
  for (const tok of ['--fs-2xs','--fs-xs','--fs-sm','--fs-md','--fs-base','--fs-lg','--fs-xl','--fs-2xl','--fs-3xl','--fs-4xl']) {
    assert('type token ' + tok + ' defined at :root',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 2. Spacing scale.
  for (const tok of ['--sp-0','--sp-1','--sp-2','--sp-4','--sp-6','--sp-8','--sp-12','--sp-16']) {
    assert('spacing token ' + tok + ' defined',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 3. Radius scale.
  for (const tok of ['--r-xs','--r-sm','--r-md','--r-lg','--r-xl','--r-full']) {
    assert('radius token ' + tok + ' defined',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 4. Tap-target + transition tokens.
  assert('tap-target token --tap-min defined (44px Apple HIG)',
    /--tap-min\s*:\s*44px/.test(dash),
    'expected --tap-min:44px');
  assert('transition tokens (--t-fast/--t-mid/--t-slow) defined',
    /--t-fast\s*:[\s\S]{0,80}--t-mid\s*:[\s\S]{0,80}--t-slow\s*:/.test(dash),
    'expected --t-fast/--t-mid/--t-slow definitions');
  // 5. Sample applications: tokens are actually being used by the
  //    new mobile components, not just defined.
  assert('.m-jd-name uses var(--fs-4xl)',
    /\.m-jd-name[\s\S]{0,400}font-size:\s*var\(--fs-4xl\)/.test(dash),
    'expected .m-jd-name to consume var(--fs-4xl)');
  assert('.m-create-row-lbl uses var(--fs-lg)',
    /\.m-create-row-lbl[\s\S]{0,200}font-size:\s*var\(--fs-lg\)/.test(dash),
    'expected .m-create-row-lbl to consume var(--fs-lg)');
}

section('Wave 3 — Kanban polish (column header + hover-reveal arrows)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Column header was tightened (padding 7px 12px + 1px border).
  assert('.kcol-header padding tightened to 7px 12px',
    /\.kcol-header\{\s*padding:\s*7px\s+12px\s*!important/.test(dash),
    'expected .kcol-header padding rule of 7px 12px !important');
  assert('.kcol-header border-bottom dropped to 1px',
    /\.kcol-header[\s\S]{0,400}border-bottom:\s*1px\s+solid\s+currentColor\s*!important/.test(dash),
    'expected .kcol-header border-bottom: 1px solid currentColor !important');
  // 2. Hover-reveal: default low-opacity (works on hybrid-touch desktops),
  //    full opacity on hover/focus, force-on inside @media (hover:none).
  assert('.kc-arrow default opacity is .35 (de-emphasized but visible)',
    /\.kc-arrow\{\s*opacity:\s*\.35/.test(dash),
    'expected .kc-arrow default opacity:.35 (Wave 3 hotfix replaced opacity:0 / pointer:fine gating)');
  assert('.k-card:hover .kc-arrow lifts to opacity:1',
    /\.k-card:hover\s+\.kc-arrow[\s\S]{0,200}opacity:\s*1/.test(dash),
    'expected .k-card:hover .kc-arrow → opacity:1');
  assert('@media (hover: none) forces .kc-arrow opacity:1',
    /@media\s*\(hover:\s*none\)[\s\S]{0,200}\.kc-arrow\{\s*opacity:\s*1/.test(dash),
    'expected touch-device override to keep arrows fully visible');
}

section('Phase orange-rgba — 7 deferred JS files reviewed');
{
  // Theme-aware surfaces converted to color-mix(in srgb, var(--orange) X%, transparent).
  for (const [file, opts] of [
    ['docs/pro/js/estimate-finalization.js', {expect: 0, kind: 'theme-aware (selected estimate card)'}],
    ['docs/pro/js/nbd-doc-viewer.js',        {expect: 0, kind: 'theme-aware (.nbdv-action-btn hover)'}],
    ['docs/pro/js/rep-report-generator.js',  {expect: 1, kind: 'partial — line ~497 converted; line ~1441 stays as literal (PDF narrative-badge brand-pin)'}],
  ]) {
    const src = read(path.join(ROOT, file));
    const n = (src.match(/rgba\(\s*232\s*,/g) || []).length;
    assert(file + ' has ' + opts.expect + ' rgba(232,…) literals — ' + opts.kind,
      n === opts.expect,
      'expected ' + opts.expect + ' rgba(232,…) in ' + file + '; got ' + n);
  }
  // Brand-pinned files keep their literals — these surfaces should NOT
  // theme-shift (PDFs, customer-facing auth + share, theme-engine config).
  for (const [file, expectedCount, reason] of [
    ['docs/pro/js/document-generator-templates.js', 1, 'PDF template box-shadow — brand-pin (PDFs do not theme-shift)'],
    ['docs/pro/js/share-gallery.js',                1, 'customer-facing share gallery — brand-pin per Phase A'],
    ['docs/pro/js/nbd-auth.js',                     3, 'auth screen border + bg — brand-pin per Phase A'],
    ['docs/pro/js/theme-engine.js',                 2, 'theme-engine defaults (rgba(232,114,12,...)) — config, not styling'],
  ]) {
    const src = read(path.join(ROOT, file));
    const n = (src.match(/rgba\(\s*232\s*,\s*114\s*,\s*12\s*,/g) || []).length;
    assert(file + ' keeps ' + expectedCount + ' brand-pinned orange-rgba — ' + reason,
      n === expectedCount,
      'expected ' + expectedCount + ' rgba(232,114,12,…) in ' + file + '; got ' + n);
  }
}

section('Phase C.6 — inline-style sweep + utility-class layer');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const theme = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));

  // The utility-class layer is declared in theme-system.css.
  for (const cls of ['dn','mb-md','mb-lg','meta-11','meta-10','f1','eyebrow','bc-chip',
                     'row-tight','body-13','btn-11','fs-11','bc-meta-cp','row-card',
                     'cp','cell','cell-t','cell-m','bb','w-full','mt-14',
                     'fs-12','fs-14','heading-13','flex-g8','fwgap-8',
                     'fg-orange','eyebrow-9','card-7','btn-input-40','kbd-input',
                     'pos-rel','ac-orange','chip-green','chip-blue']) {
    assert("theme-system.css declares ." + cls,
      new RegExp("\\." + cls + "\\s*\\{").test(theme),
      'expected utility class .' + cls + ' in theme-system.css');
  }

  // Hard upper bound — we cleaned up at least ~400 of the original 1,187
  // inline styles. Truly dynamic / one-off styles can remain, but the
  // count must not regress above 850 (was 1,187 before this sweep).
  const remaining = (dash.match(/style="[^"]+"/g) || []).length;
  assert('inline style count cut to ≤850 (was 1,187)',
    remaining <= 850,
    'expected ≤850 inline style attrs after C.6; got ' + remaining);

  // .dn class must hide WITHOUT !important — JS toggling style.display='block'
  // must still win over the class rule.
  assert('.dn rule uses display:none (no !important — keeps JS show/hide working)',
    /\.dn\{display:none;\}/.test(theme),
    '.dn should be display:none (no !important)');

  // Spot-check: the 7-property eyebrow / 8-property row-card declarations
  // are present and match exactly the strings the sweep replaced.
  assert('.eyebrow has the 7-property uppercase label declaration',
    /\.eyebrow\{font-size:10px;font-weight:700;letter-spacing:\.1em;text-transform:uppercase;color:var\(--m\);display:block;margin-bottom:6px;\}/.test(theme),
    'expected .eyebrow with the full 7-property declaration');
  assert('.row-card has the bordered row declaration',
    /\.row-card\{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var\(--s2\);border:1px solid var\(--br\);border-radius:7px;cursor:pointer;\}/.test(theme),
    'expected .row-card with the full row declaration');
}

section('Phase C.4 finale + C.5 — long-tail delegate + script-src tightening');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  const firebaseJson = read(path.join(ROOT, 'firebase.json'));

  // Zero inline onclicks left in dashboard.html.
  const remaining = (dash.match(/onclick=/g) || []).length;
  assert('dashboard.html has zero inline onclick handlers',
    remaining === 0,
    'expected 0 inline onclicks; got ' + remaining);

  // New generic delegate branches all present.
  for (const action of ['call','module','windowOpen','signOut','reload','closeOpen','clickProxy','hideEl','stopProp','removeSelf','removeParent','removeClosest','modalBackdropClose']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Allowlist Set declared and has a reasonable lower bound.
  assert('_NBD_CALL_ALLOWLIST Set declared with allowed call targets',
    /_NBD_CALL_ALLOWLIST\s*=\s*new Set\(\[/.test(mainJs),
    'expected _NBD_CALL_ALLOWLIST = new Set([...]) declaration');

  // Spot-check that key wrappers exist as window globals.
  for (const fn of ['cdaReport','cdaEnrich','cdaPhotos','cdaInvoice','cdaInspection','cdaInspectionDeep','cdaMjdAct','cdaEditLead','cdaOpenMobileInspection','cdaVoiceMemo','cdaSharePortalLink','cdaRevokePortalLink','cdaConfirmPromote','cdaOpenTaskModal','mCreateFabRoute','openDailyProgramFromMore','openCrewCalendarFromMore','mQuickAddRoute','restartOnboardingTour','openDecisionPicker','openD2DOrGo','clearAccentTheme','openSettingsTab','openPhotoEngineOrClickProxy','openReportGenerator','enrichReportData','openPhotoEngineCurrentLead','openInspectionBuilderCurrentLead','closeInspectionBuilder','hideFollowUpAlerts','goToD2DFromMaps','openCalBookingUrl','hardResetTest','gstaticTest','modeLineDraw']) {
    assert('window.' + fn + ' defined',
      new RegExp('window\\.' + fn + '\\s*=\\s*function').test(mainJs),
      'expected window.' + fn + ' = function(...)');
  }

  // C.5 — script-src 'unsafe-inline' dropped from line-44 enforcing CSP.
  // The Report-Only policy already lacked it; now the enforcing one matches.
  const csps = firebaseJson.match(/"Content-Security-Policy",\s*"value":\s*"([^"]+)"/g) || [];
  assert('at least one enforcing CSP declared',
    csps.length >= 1, 'expected ≥1 Content-Security-Policy in firebase.json');
  // The PRO route (line 44) is the only one with script-src 'unsafe-inline';
  // assert that NO enforcing CSP includes "script-src 'self' 'unsafe-inline'".
  assert("no enforcing CSP retains script-src 'self' 'unsafe-inline'",
    !/script-src\s+'self'\s+'unsafe-inline'/.test(firebaseJson) ||
      /script-src\s+'self'\s+'unsafe-inline'/.test(firebaseJson.match(/Content-Security-Policy-Report-Only[\s\S]*?(?=\}\s*,|\}\s*\])/) || ''),
    "expected script-src to drop 'unsafe-inline' on enforcing CSP");
  // The enforcing CSP also adds script-src-attr 'none' to block any
  // inline event-handler attribute that could be reintroduced.
  assert("enforcing CSP declares script-src-attr 'none'",
    /script-src-attr\s+'none'/.test(firebaseJson),
    "expected script-src-attr 'none' in enforcing CSP");
}

section('Phase C.4 kanban + zone-color + pin-status — 3 picker clusters');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  for (const action of ['kanbanView','zoneColor','selectPin']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  const kv = (dash.match(/data-action="kanbanView"\s+data-target="[a-z]+"/g) || []).length;
  assert('kanbanView conversions: 7 (Ins/Cash/Fin/War/Svc/Jobs/All)',
    kv === 7, 'expected 7 kanbanView data-actions; got ' + kv);

  const zc = (dash.match(/data-action="zoneColor"\s+data-target="[^"]+"/g) || []).length;
  assert('zoneColor conversions: 6 (D2D zone swatches)',
    zc === 6, 'expected 6 zoneColor data-actions; got ' + zc);

  const sp = (dash.match(/data-action="selectPin"\s+data-target="[a-z-]+"\s+data-color="[^"]+"/g) || []).length;
  assert('selectPin conversions: 8 (D2D pin status buttons)',
    sp === 8, 'expected 8 selectPin data-actions; got ' + sp);

  const remaining =
    (dash.match(/onclick="switchKanbanView\(/g) || []).length +
    (dash.match(/onclick="selectZoneColor\(/g) || []).length +
    (dash.match(/onclick="selectPin\(/g) || []).length;
  assert('no inline onclicks remain for these 3 clusters',
    remaining === 0,
    'expected 0 inline onclicks across the 3 clusters; got ' + remaining);

  // The kanban buttons preserve their data-view attribute (other code
  // reads it for filtering); confirm we didn't strip it.
  assert('kanban buttons preserve data-view alongside the new data-action',
    /data-view="insurance"[\s\S]{0,80}data-action="kanbanView"/.test(dash) ||
      /data-action="kanbanView"[\s\S]{0,80}data-view="insurance"/.test(dash),
    'expected data-view="insurance" preserved on the Ins kanban button');
}

section('Phase C.4 line-type — selLT via selLineType action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='selLineType'",
    /if \(action === 'selLineType'\)/.test(mainJs),
    'expected selLineType branch in _nbdActionDelegate');
  assert("selLineType branch dispatches selLT(idx, el)",
    /selLT\(idx, el\)/.test(mainJs),
    'expected selLT(idx, el) dispatch');

  const count = (dash.match(/data-action="selLineType"\s+data-target="\d+"/g) || []).length;
  assert('selLineType conversions: 11 (one per draw-tool line type)',
    count === 11,
    'expected 11 selLineType data-actions; got ' + count);

  const remaining = (dash.match(/onclick="selLT\(/g) || []).length;
  assert('no inline selLT onclicks remain',
    remaining === 0,
    'expected 0 inline selLT onclicks; got ' + remaining);
}

section('Phase C.4 settings-tab — switchSettingsTab via settingsTab action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='settingsTab'",
    /if \(action === 'settingsTab'\)/.test(mainJs),
    'expected settingsTab branch in _nbdActionDelegate');
  assert("settingsTab branch dispatches switchSettingsTab(target)",
    /switchSettingsTab\(target\)/.test(mainJs),
    'expected switchSettingsTab(target) dispatch');

  const count = (dash.match(/data-action="settingsTab"\s+data-target="[a-z]+"/g) || []).length;
  assert('settingsTab conversions: 10 (one per Settings tab)',
    count === 10,
    'expected 10 settingsTab data-actions; got ' + count);

  const remaining = (dash.match(/onclick="switchSettingsTab\(/g) || []).length;
  assert('no inline switchSettingsTab onclicks remain',
    remaining === 0,
    'expected 0 inline switchSettingsTab onclicks; got ' + remaining);
}

section('Phase C.4 docgen — NBDDocGen.fillAndGenerate via docgen action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='docgen'",
    /if \(action === 'docgen'\)/.test(mainJs),
    'expected docgen branch in _nbdActionDelegate');
  assert("docgen branch dispatches NBDDocGen.fillAndGenerate(target)",
    /window\.NBDDocGen\.fillAndGenerate\(target\)/.test(mainJs),
    'expected NBDDocGen.fillAndGenerate(target) dispatch');

  const docgenCount = (dash.match(/data-action="docgen"\s+data-target="[a-zA-Z_]+"/g) || []).length;
  assert('docgen conversions: 24 (every Templates view row)',
    docgenCount === 24,
    'expected 24 docgen data-actions; got ' + docgenCount);

  const remaining = (dash.match(/onclick="NBDDocGen\.fillAndGenerate/g) || []).length;
  assert('no inline NBDDocGen.fillAndGenerate onclicks remain',
    remaining === 0,
    'expected 0 inline NBDDocGen onclicks; got ' + remaining);
}

section('Phase C.4 mobile-nav — bottom-nav and More-drawer items');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='mobileNav'",
    /if \(action === 'mobileNav'\)/.test(mainJs),
    'expected mobileNav branch in _nbdActionDelegate');
  assert("mobileNav branch dispatches mobileNav(target)",
    /if \(typeof mobileNav === 'function'\) mobileNav\(target\)/.test(mainJs),
    'expected mobileNav(target) dispatch');
  assert("mobileNav branch honors data-close-more flag",
    /el\.hasAttribute\('data-close-more'\)[\s\S]{0,120}closeMobileMore\(\)/.test(mainJs),
    'expected closeMobileMore() called when data-close-more present');

  // 3 bottom-nav items (mn-item) plus 19 More-drawer items = 22 total
  // mobileNav data-actions in the markup. (Crew-calendar More item
  // intentionally remains inline — defensive existence check.)
  const mnCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"/g) || []).length;
  assert('mobileNav conversions: 22 (3 bottom-nav + 19 more-drawer)',
    mnCount === 22,
    'expected 22 mobileNav data-actions; got ' + mnCount);

  const closeMoreCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"\s+data-close-more/g) || []).length;
  assert('19 mobileNav items carry data-close-more (More-drawer items)',
    closeMoreCount === 19,
    'expected 19 data-close-more flags; got ' + closeMoreCount);

  // C.4 finale: every mobileNav handler is delegated. The crew-calendar
  // compound is now routed through window.openCrewCalendarFromMore.
  const remaining = (dash.match(/onclick="mobileNav\(/g) || []).length;
  assert('zero inline mobileNav onclicks remain (all delegated)',
    remaining === 0,
    'expected exactly 0 inline mobileNav onclicks; got ' + remaining);
}

section('Phase C.4 cluster 5 — arg-bearing toggle handlers');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  for (const action of ['navSection','mapSidebar','mapOverlay','tradeChip','crmToolsMenu']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Markup counts
  const navSec = (dash.match(/data-action="navSection"\s+data-target="[a-z-]+"/g) || []).length;
  assert('navSection conversions: 3',
    navSec === 3,
    'expected 3 navSection conversions; got ' + navSec);

  const mapSb = (dash.match(/data-action="mapSidebar"\s+data-target="[a-z-]+"/g) || []).length;
  assert('mapSidebar conversions: 2',
    mapSb === 2,
    'expected 2 mapSidebar conversions; got ' + mapSb);

  const mapOv = (dash.match(/data-action="mapOverlay"\s+data-target="[a-z]+"/g) || []).length;
  assert('mapOverlay conversions: 5 (heat/jobs/pins/storm/weather)',
    mapOv === 5,
    'expected 5 mapOverlay conversions; got ' + mapOv);

  // Inline arg-bearing toggles retired (except the documented ternary).
  const argRemain = (dash.match(/onclick="toggle(NavSection|MapSidebar|Overlay|TradeChip|CrmToolsMenu)\(/g) || []).length;
  assert('no inline arg-bearing toggle onclicks remain (besides the mobileCreatePopover ternary)',
    argRemain === 0,
    'expected 0 arg-bearing toggle onclicks; got ' + argRemain);
}

section('Phase C.4 cluster 4 — no-arg toggle handlers via toggle action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='toggle' via _NBD_TOGGLE_FNS",
    /if \(action === 'toggle'\)[\s\S]{0,400}_NBD_TOGGLE_FNS\[target\]/.test(mainJs),
    'expected toggle branch + _NBD_TOGGLE_FNS registry');

  for (const target of ['bulkMode','kanbanFullscreen','sidebarCollapse','engagementSort','needsAttention','showSnoozed','staleShares','notifications','mobileMore']) {
    assert('_NBD_TOGGLE_FNS registers ' + target,
      new RegExp("\\b" + target + ":\\s+'toggle").test(mainJs),
      'expected ' + target + ' in the toggle registry');
  }

  const conversions = (dash.match(/data-action="toggle"\s+data-target="\w+"/g) || []).length;
  assert('≥15 data-action="toggle" conversions present',
    conversions >= 15,
    'expected ≥15 toggle conversions; got ' + conversions);

  // Simple inline toggle onclicks should be retired (defensive form too)
  const simpleRemain = (dash.match(/onclick="toggle[A-Z]\w*\(\)"/g) || []).length;
  const defensiveRemain = (dash.match(/onclick="window\.toggle\w+\s*&&\s*window\.toggle\w+\(\)"/g) || []).length;
  assert('0 inline simple onclick="toggleXxx()" remain',
    simpleRemain === 0,
    'expected 0 simple toggle onclicks; got ' + simpleRemain);
  assert('0 inline defensive onclick="window.toggleXxx && window.toggleXxx()" remain',
    defensiveRemain === 0,
    'expected 0 defensive-form toggle onclicks; got ' + defensiveRemain);
}

section('Phase C.4 cluster 3 — modal-close handlers via closeModal action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  assert("delegate handles action='closeModal'",
    /if \(action === 'closeModal'\)[\s\S]{0,400}_NBD_MODAL_CLOSE_FNS\[target\]/.test(mainJs),
    'expected closeModal branch in _nbdActionDelegate using _NBD_MODAL_CLOSE_FNS registry');

  // Registry exposes the function mapping
  for (const target of ['leadModal','taskModal','photoModal','propertyIntelModal','quickAddModal','docViewerModal','cardDetailModal','comparisonModal']) {
    assert('_NBD_MODAL_CLOSE_FNS registers ' + target,
      new RegExp("\\b" + target + ":\\s+'close").test(mainJs),
      'expected ' + target + ' in the registry');
  }

  // Markup: ≥30 data-action="closeModal" elements (we converted 33)
  const conversions = (dash.match(/data-action="closeModal"\s+data-target="\w+"/g) || []).length;
  assert('≥30 data-action="closeModal" conversions present',
    conversions >= 30,
    'expected ≥30 closeModal conversions; got ' + conversions);

  // 0 simple inline closeXxx onclicks remain
  const remaining = (dash.match(/onclick="close[A-Z][A-Za-z]+\(\)"/g) || []).length;
  assert('0 inline onclick="closeXxx()" handlers remain',
    remaining === 0,
    'expected 0 remaining; got ' + remaining);
}

section('Phase C.4 cluster 2 — compound goTo handlers (newEstimate / filterByStage / toolMenuGoTo)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  // Action handlers wired in the delegate switch.
  for (const action of ['newEstimate','filterByStage','toolMenuGoTo']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Markup conversions
  const newEst = (dash.match(/data-action="newEstimate"/g) || []).length;
  assert('data-action="newEstimate" appears 2× (the two + New Estimate buttons)',
    newEst === 2,
    'expected 2 newEstimate conversions; got ' + newEst);

  const stages = (dash.match(/data-action="filterByStage"\s+data-stage="[a-z_]+"/g) || []).length;
  assert('data-action="filterByStage" appears 6× (one per dashboard stage box)',
    stages === 6,
    'expected 6 filterByStage conversions; got ' + stages);

  const tools = (dash.match(/data-action="toolMenuGoTo"\s+data-target="[a-z]+"/g) || []).length;
  assert('data-action="toolMenuGoTo" appears 7× (CRM tools menu items)',
    tools === 7,
    'expected 7 toolMenuGoTo conversions; got ' + tools);

  // C.4 finale: every inline goTo() is delegated; the d2d maps-redirect
  // compound is routed through window.goToD2DFromMaps.
  const remaining = (dash.match(/onclick="goTo\(/g) || []).length;
  assert('zero inline onclick="goTo(..." remain (all delegated)',
    remaining === 0,
    'expected exactly 0 inline goTo onclicks; got ' + remaining);
}

section('Phase C.4 starter — body-level data-action delegate (goTo cluster)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  // 1. Delegate is wired in dashboard-main.js — listens for [data-action]
  //    clicks at the document level and dispatches goTo when matched.
  assert('document-level click delegate registered for [data-action]',
    /document\.addEventListener\('click',\s*function _nbdActionDelegate/.test(mainJs),
    'expected the _nbdActionDelegate function bound to document click');
  assert('delegate handles action="goTo" → calls goTo(target)',
    /if \(action === 'goTo'\)[\s\S]{0,400}goTo\(target\)/.test(mainJs),
    'expected the goTo branch in the action delegate');

  // 2. dashboard.html now carries data-action="goTo" elements (≥40 — we
  //    converted 54 simple onclick="goTo(...)" handlers).
  const goToActions = (dash.match(/data-action="goTo"\s+data-target="[a-z][a-z0-9-]*"/g) || []).length;
  assert('dashboard.html carries ≥40 data-action="goTo" data-target="..." elements',
    goToActions >= 40,
    'expected ≥40 data-action goTo conversions; got ' + goToActions);

  // 3. Simple form `onclick="goTo('xxx')"` is fully retired (the only
  //    remaining onclick="goTo(...)" calls should be compound forms
  //    with multiple statements).
  const simpleGoTo = (dash.match(/onclick="goTo\('[a-z][a-z0-9-]*'\)"/g) || []).length;
  assert('no simple onclick="goTo(\'xxx\')" handlers remain in dashboard.html',
    simpleGoTo === 0,
    'expected 0 simple inline goTo handlers; got ' + simpleGoTo);
}

section('Phase C.6 step 2 — JS-file orange-rgba sweep');
{
  const SAFE_FILES = [
    'docs/pro/js/close-board.js',
    'docs/pro/js/d2d-tracker.js',
    'docs/pro/js/d2d-tracker-2026b.js',
    'docs/pro/js/doc-preflight.js',
    'docs/pro/js/help-icon.js',
    'docs/pro/js/mobile-nav-customizer.js',
    'docs/pro/js/photo-engine.js',
    'docs/pro/js/real-deal-academy-lab.js',
    'docs/pro/js/ui.js',
    'docs/pro/js/dashboard-main.js',
  ];
  for (const p of SAFE_FILES) {
    const body = read(path.join(ROOT, p));
    assert(p + ': no hardcoded rgba(232,114,12,...)',
      !/rgba\(232,\s*114,\s*12/.test(body),
      p + ' should use color-mix(in srgb, var(--orange) X%, transparent)');
  }
}

section('Phase C.6 starter — retire hardcoded NBD-orange rgba in dashboard.html');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Same contract we already enforce on customer/login/vault.
  assert('dashboard.html: no hardcoded rgba(232,114,12,...) NBD-orange literals',
    !/rgba\(232,\s*114,\s*12/.test(dash),
    'expected dashboard.html to use color-mix(in srgb, var(--orange) X%, transparent) — not literal NBD-orange rgba');
  // Spot-check that the conversions used the right pattern (sample
  // a known-converted opacity).
  assert('dashboard.html now consumes color-mix(--orange) for theme-tinted decorations',
    /color-mix\(in srgb,\s*var\(--orange\)\s+\d+%,\s*transparent\)/.test(dash),
    'expected color-mix(in srgb, var(--orange) X%, transparent) usages');
}

section('Phase C.3 finish-finish — crm + map + docs');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  for (const v of ['crm','map','docs']) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }
  // Sanity: only view-est should remain as an inline (non-template) view.
  const inlineMatches = dash.match(/class="view"[^>]*id="view-[a-z]+"[^>]*>(?!<\/div>)/g) || [];
  // Strict count of "still-inline" views = those whose mount doesn't
  // carry data-view-template attribute.
  const stillInline = [];
  const reAll = /class="view"[^>]*id="view-([a-z]+)"([^>]*)>/g;
  let m;
  while ((m = reAll.exec(dash)) !== null) {
    if (!/data-view-template/.test(m[2])) stillInline.push(m[1]);
  }
  assert('only view-est remains inline (Rock 2 dep deferred)',
    stillInline.length === 1 && stillInline[0] === 'est',
    'expected only view-est inline; got: ' + stillInline.join(','));
}

section('Phase C.3 finish — view-prospects + D.1 plumbing');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const testsPkg = read(path.join(ROOT, 'tests/package.json'));
  assert('view-prospects is an empty mount with data-view-template',
    /<div class="view" id="view-prospects"\s+data-view-template="tpl-view-prospects"><\/div>/.test(dash),
    'expected mount div for view-prospects');
  assert('<template id="tpl-view-prospects"> exists',
    /<template id="tpl-view-prospects">/.test(dash),
    'expected tpl-view-prospects template element');
  // D.1 — engines pin so future Node-version drift doesn't break the
  // playwright transitive install in fresh containers.
  assert('tests/package.json declares engines.node ≥22',
    /"engines":\s*\{\s*"node":\s*">=22"\s*\}/.test(testsPkg),
    'expected engines.node pin to >=22 in tests/package.json');
}

section('Phase C.3 wave 2 — draw + dash + reports + settings');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  // Each of the 4 big views: empty mount + matching template.
  for (const v of ['draw','dash','reports','settings']) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // _hydrateViewTemplate now re-executes inline <script> blocks.
  assert('_hydrateViewTemplate re-executes inline scripts after cloning',
    /view\.querySelectorAll\('script'\)\.forEach[\s\S]{0,500}createElement\('script'\)[\s\S]{0,300}replaceChild/.test(mainJs),
    'expected the helper to swap each cloned <script> for a fresh executable one');

  // CSP hotfix (2026-05-16): the inline scripts inside tpl-view-draw
  // and tpl-view-settings were extracted to external files
  // (dashboard-accessory-panel-init.js + the appearance/team/billing/
  // hotkey/sidebar shards). _hydrateViewTemplate handles both inline
  // AND external scripts (createElement copies all attributes including
  // src), so the readyState guard logic now lives in
  // dashboard-accessory-panel-init.js.
  assert('tpl-view-draw script handles both initial-load and post-hydration',
    /tpl-view-draw[\s\S]*?dashboard-accessory-panel-init\.js/.test(dash) ||
    /tpl-view-draw[\s\S]*?_drawInit[\s\S]*?document\.readyState === 'loading'[\s\S]*?DOMContentLoaded[\s\S]*?_drawInit/.test(dash),
    'expected dashboard-accessory-panel-init.js inside tpl-view-draw, or the _drawInit pattern inline');

  // Confirm the extracted file still carries the readyState guard.
  const drawInit = fs.existsSync(path.join(ROOT, 'docs/pro/js/dashboard-accessory-panel-init.js'))
    ? read(path.join(ROOT, 'docs/pro/js/dashboard-accessory-panel-init.js')) : '';
  assert('dashboard-accessory-panel-init.js carries readyState/_drawInit guard',
    /_drawInit[\s\S]*?document\.readyState === 'loading'[\s\S]*?DOMContentLoaded[\s\S]*?_drawInit/.test(drawInit),
    'expected the extracted file to keep the readyState/DOMContentLoaded guard');

  // view-settings' 5 (formerly inline) scripts all live inside the
  // template now — either as inline or external references. Count
  // BOTH styles. Previously checked for `<script>` (5 inline blocks);
  // after CSP extraction these are `<script src="dashboard-*.js?v=1">`.
  {
    const tplStart = dash.indexOf('<template id="tpl-view-settings">');
    const tplEnd = dash.indexOf('</template><!-- /tpl-view-settings -->', tplStart);
    assert('tpl-view-settings is closed by a matching </template> tag',
      tplStart > -1 && tplEnd > tplStart,
      'expected </template><!-- /tpl-view-settings --> to close the settings template');
    const settingsBody = dash.slice(tplStart, tplEnd);
    // Count all <script ...> opening tags (inline or external) inside
    // the template. Inline = `<script>`; external = `<script src=...>`.
    const scriptCount = (settingsBody.match(/<script[\s>]/g) || []).length;
    assert('tpl-view-settings carries 5 <script> blocks (inline or external)',
      scriptCount === 5,
      'expected 5 scripts inside the settings template, got ' + scriptCount);
  }
}

section('Wave 5e (A.5) — second-pass theme contrast audit');
{
  const themeCSS = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));
  // Programmatic luminance check — every theme's --orange should give
  // white text ≥ 3.5:1 contrast OR have an explicit --accent-fg
  // override. Parser pulls each theme's --orange value and per-theme
  // --accent-fg presence; assertion fails any theme that fails BOTH.
  const reTheme = /:root\[data-theme="([^"]+)"\][^{]*\{\s*--orange:\s*(#[0-9a-fA-F]{6})/g;
  const reFg = /:root\[data-theme="([^"]+)"\][^{]*\{[\s\S]*?--accent-fg/g;
  const themes = {};
  let m;
  while ((m = reTheme.exec(themeCSS)) !== null) themes[m[1]] = m[2];
  // Also parse the group-selector overrides (paper, ghost, etc.)
  const groupRe = /:root\[data-theme="[^"]+"\][^{]*(?:,\s*:root\[data-theme="[^"]+"\][^{]*)*\{\s*--accent-fg/g;
  const overridden = new Set();
  let g;
  while ((g = groupRe.exec(themeCSS)) !== null) {
    const sel = g[0];
    const names = [...sel.matchAll(/data-theme="([^"]+)"/g)].map(x => x[1]);
    names.forEach(n => overridden.add(n));
  }
  function lum(hex){
    const r=parseInt(hex.slice(1,3),16)/255;
    const gr=parseInt(hex.slice(3,5),16)/255;
    const b=parseInt(hex.slice(5,7),16)/255;
    const f=v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
    return 0.2126*f(r)+0.7152*f(gr)+0.0722*f(b);
  }
  // nbd-original is the canonical NBD brand — white-on-orange is the
  // identity, so it's explicitly grandfathered here (3.07 contrast).
  const BRAND_GRANDFATHERED = new Set(['nbd-original']);
  const failingWithoutOverride = [];
  for (const [name, hex] of Object.entries(themes)) {
    if (BRAND_GRANDFATHERED.has(name)) continue;
    const oL = lum(hex);
    const cWhite = 1.05 / (oL + 0.05);
    if (cWhite < 3.5 && !overridden.has(name)) {
      failingWithoutOverride.push(`${name} (${hex}, white-contrast ${cWhite.toFixed(2)})`);
    }
  }
  assert('every sub-3.5 white-contrast theme has an explicit --accent-fg override',
    failingWithoutOverride.length === 0,
    'these themes still need --accent-fg overrides: ' + failingWithoutOverride.join(' | '));
  // Spot-check: A.5's 11 newly-covered themes are present.
  for (const t of ['forest','arctic','deep-space','glow','retro','vaporwave','halloween','android','ios26','candlelit','midnight-oil']) {
    assert('A.5 override present for theme "' + t + '"',
      new RegExp(':root\\[data-theme="' + t + '"\\][^{]*\\{[\\s\\S]{0,200}--accent-fg').test(themeCSS),
      'expected A.5 to override --accent-fg for ' + t);
  }
}

section('Wave 5d (A.4) — accent contract on remaining toggle-active states');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Step 4b: search-highlight + saveBtn cssText assertions cross
  // the split — concat via readCrm() so the regexes match
  // regardless of which split file the inline-style strings landed in.
  const crmJs = readCrm();
  // 1. .crm-icon-btn.active gains the inset --accent-ring boundary.
  assert('.crm-icon-btn.active includes box-shadow inset --accent-ring',
    /\.crm-icon-btn\.active\{[\s\S]{0,400}box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(dash),
    'expected .crm-icon-btn.active to carry the inset --accent-ring boundary');
  // 2. JS-driven inline orange surfaces in crm.js use --accent-fg.
  assert('crm.js search-highlight <mark> uses var(--accent-fg)',
    /<mark style="background:var\(--orange\);color:var\(--accent-fg\)/.test(crmJs),
    'expected the search-highlight <mark> to color via --accent-fg');
  assert('crm.js saveBtn.style.cssText uses var(--accent-fg) + accent-ring',
    /saveBtn\.style\.cssText\s*=\s*'background:var\(--orange\);border:1px solid var\(--orange\);color:var\(--accent-fg\);box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(crmJs),
    'expected saveBtn inline cssText to use --accent-fg + inset --accent-ring');
}

section('Wave 2E.3 (A.3) — m-modal-bar on the last 5 dashboard modals');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const cases = [
    { id: 'quickAddModal',              eyebrow: 'Quick Add', titleId: null,                closeFn: 'closeQuickAddLead' },
    { id: 'warrantyCertModal',          eyebrow: 'NBD Guarantee', titleId: null,            closeFn: null },
    { id: 'docViewerModal',             eyebrow: 'Document Template', titleId: 'docViewerTitle', closeFn: 'closeDocViewer' },
    { id: 'cardDetailModal',            eyebrow: null, titleId: 'cardDetailName',           closeFn: 'closeCardDetailModal' },
    { id: 'propertyIntelConfirmModal',  eyebrow: 'Intel', titleId: null,                    closeFn: 'closePropertyIntelConfirmModal' },
  ];
  for (const c of cases) {
    const start = dash.indexOf('id="' + c.id + '"');
    const block = dash.slice(start, start + 3500);
    assert(c.id + ' inner .modal carries .m-modal-has-bar',
      /class="modal m-modal-has-bar"/.test(block),
      'expected ' + c.id + ' .modal class to include m-modal-has-bar');
    assert(c.id + ' renders an .m-modal-bar element',
      /class="m-modal-bar"/.test(block),
      'expected ' + c.id + ' to contain an .m-modal-bar element');
    if (c.eyebrow) {
      assert(c.id + ' eyebrow renders "' + c.eyebrow + '"',
        new RegExp('class="m-modal-bar-eyebrow"[^>]*>' + c.eyebrow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<').test(block),
        'expected eyebrow text "' + c.eyebrow + '" inside ' + c.id);
    }
    if (c.titleId) {
      assert(c.id + ' preserves id="' + c.titleId + '" on the bar title span',
        new RegExp('class="m-modal-bar-title"[^>]*id="' + c.titleId + '"').test(block),
        c.titleId + ' should move to the m-modal-bar-title span');
    }
    if (c.closeFn) {
      // C.4 cluster 3: the bar X was migrated from inline
      //   onclick="closeFn()"
      // to the body delegate:
      //   data-action="closeModal" data-target="<modal-id>"
      // We just verify the bar X carries the delegate hook; the
      // closeFn → modal-target mapping is locked by the
      // _NBD_MODAL_CLOSE_FNS registry assertions in the C.4 cluster 3
      // section above.
      assert(c.id + ' bar X uses data-action="closeModal"',
        /class="m-modal-bar-x"[^>]*data-action="closeModal"[^>]*data-target="[A-Za-z]+"/.test(block),
        'expected the bar X to carry data-action="closeModal" + data-target');
    }
  }
  // cardDetailModal got special treatment — kindLabel + name + stage
  // chip all moved into the bar, and the duplicate block below was
  // retired.
  const cd = dash.indexOf('id="cardDetailModal"');
  const cdBlock = dash.slice(cd, cd + 4000);
  assert('cardDetailModal: kindLabel migrated into m-modal-bar-eyebrow',
    /class="m-modal-bar-eyebrow" id="cardDetailKindLabel"/.test(cdBlock),
    'expected #cardDetailKindLabel to live on the eyebrow span');
  assert('cardDetailModal: stage chip carried into bar with id="cardDetailStage"',
    /class="m-modal-bar"[\s\S]{0,1200}id="cardDetailStage"/.test(cdBlock),
    'expected #cardDetailStage to live inside the m-modal-bar');
}

section('Wave 2E.2 — m-modal-bar applied to task / photo / propertyIntel');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Each modal must:
  //   1. have .m-modal-has-bar on its inner .modal
  //   2. contain an .m-modal-bar element
  //   3. have an eyebrow + title pair within it
  //   4. keep its existing id="*ModalTitle" if one existed (so JS still binds)
  const cases = [
    { id: 'taskModal',          eyebrow: 'Tasks',  titleId: 'taskModalTitle',  closeFn: 'closeTaskModal' },
    { id: 'photoModal',         eyebrow: 'Photos', titleId: 'photoModalTitle', closeFn: 'closePhotoModal' },
    { id: 'propertyIntelModal', eyebrow: 'Intel',  titleId: null,              closeFn: 'closePropertyIntelModal' },
  ];
  for (const c of cases) {
    const start = dash.indexOf('id="' + c.id + '"');
    const block = dash.slice(start, start + 2200);
    assert(c.id + ' .modal has class m-modal-has-bar',
      /class="modal m-modal-has-bar"/.test(block),
      'expected .modal class to carry m-modal-has-bar on ' + c.id);
    assert(c.id + ' contains an m-modal-bar',
      /class="m-modal-bar"/.test(block),
      'expected .m-modal-bar inside ' + c.id);
    assert(c.id + ' eyebrow renders "' + c.eyebrow + '"',
      new RegExp('class="m-modal-bar-eyebrow"[^>]*>' + c.eyebrow + '<').test(block),
      'expected eyebrow text "' + c.eyebrow + '" inside ' + c.id);
    // C.4 cluster 3: bar X migrated to the closeModal delegate.
    // closeFn → modal-target mapping is enforced by the
    // _NBD_MODAL_CLOSE_FNS registry assertion in the C.4 cluster 3
    // section above.
    assert(c.id + ' bar close button uses data-action="closeModal"',
      /class="m-modal-bar-x"\s+data-action="closeModal"\s+data-target="[A-Za-z]+"/.test(block),
      'expected the bar X to carry data-action="closeModal" + data-target');
    if (c.titleId) {
      assert(c.id + ' preserves id="' + c.titleId + '" on the bar title span',
        new RegExp('class="m-modal-bar-title"[^>]*id="' + c.titleId + '"').test(block),
        c.titleId + ' should move to the m-modal-bar-title span');
    }
  }
}

section('Wave 2E — m-modal-bar standardization');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Pattern CSS exists.
  for (const cls of ['m-modal-bar','m-modal-bar-x','m-modal-bar-titles','m-modal-bar-eyebrow','m-modal-bar-title','m-modal-bar-action','m-modal-has-bar']) {
    assert('CSS class .' + cls + ' is defined',
      new RegExp('\\.' + cls.replace(/-/g,'\\-') + '\\b').test(dash),
      'expected .' + cls + ' rule');
  }
  // 2. .m-modal-has-bar hides the floating .modal-close.
  assert('.m-modal-has-bar hides floating .modal-close',
    /\.modal\.m-modal-has-bar\s*>\s*\.modal-close\s*\{\s*display:\s*none/.test(dash),
    'expected .modal-close hidden when .m-modal-has-bar applied');
  // 3. leadModal adopts the new pattern.
  const lmStart = dash.indexOf('<div class="modal-bg" id="leadModal">');
  const lmBlock = dash.slice(lmStart, lmStart + 1500);
  assert('leadModal applies .m-modal-has-bar to inner .modal',
    /class="modal m-modal-has-bar"/.test(lmBlock),
    'leadModal inner .modal should carry .m-modal-has-bar');
  assert('leadModal renders an .m-modal-bar header',
    /class="m-modal-bar"/.test(lmBlock),
    'leadModal should contain a .m-modal-bar element');
  assert('leadModal bar carries the "CRM" eyebrow',
    /class="m-modal-bar-eyebrow"[^>]*>CRM</.test(lmBlock),
    'expected the CRM eyebrow inside the m-modal-bar');
  assert('leadModal bar keeps id="leadModalTitle" on the title span',
    /class="m-modal-bar-title"[^>]*id="leadModalTitle"/.test(lmBlock),
    'leadModalTitle id should move to the bar title span so existing JS still finds it');
}

section('Wave 2D — Mobile inspection overlay');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  // 1. Overlay DOM exists.
  assert('m-inspection overlay element exists',
    /<div class="m-inspection" id="mInspection"/.test(dash),
    'expected <div class="m-inspection" id="mInspection">');
  assert('inspection overlay contains #mInspectionContainer',
    /id="mInspectionContainer"/.test(dash),
    'expected the engine mount point #mInspectionContainer');
  // 2. Close button wired via C.4 closeModal delegate
  //    (data-action="closeModal" data-target="mobileInspection").
  assert('inspection overlay has close button wired to closeModal delegate',
    /id="mInspBack"[\s\S]*data-action="closeModal"[\s\S]*data-target="mobileInspection"/.test(dash),
    'expected close button in m-inspection top bar to use the closeModal delegate');
  // 3. Entry CTA in mobile job-detail Activity tab.
  assert('mobile job-detail Activity tab has a .m-jd-cta Start Inspection button',
    /class="m-jd-cta"[\s\S]*data-action="call" data-fn="cdaOpenMobileInspection"/.test(dash),
    'expected a .m-jd-cta wired to cdaOpenMobileInspection');
  // 4. JS hooks exposed.
  for (const fn of ['openMobileInspection','closeMobileInspection']) {
    assert('window.' + fn + ' exposed',
      new RegExp('window\\.' + fn + '\\s*=').test(mainJs),
      'expected window.' + fn);
  }
  // 5. openMobileInspection delegates to InspectionReportEngine.openBuilder.
  assert('openMobileInspection mounts the existing InspectionReportEngine',
    /InspectionReportEngine\.openBuilder\(['"]mInspectionContainer['"]/.test(mainJs),
    'expected the mobile overlay to host InspectionReportEngine.openBuilder()');
  // 6. Desktop force-hide guard.
  assert('@media (min-width:769px) hides .m-inspection',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,400}\.m-inspection\s*\{\s*display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-inspection');
}

section('Wave 2C.2 — Camera FAB + native share');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  // 1. Sprite has the new shutter + share glyphs.
  assert('sprite has nbd-icon-shutter',
    /<symbol id="nbd-icon-shutter"/.test(dash),
    'expected sprite symbol nbd-icon-shutter');
  assert('sprite has nbd-icon-share',
    /<symbol id="nbd-icon-share"/.test(dash),
    'expected sprite symbol nbd-icon-share');
  // 2. Camera FAB exists inside view-photos.
  const vp = dash.indexOf('id="view-photos"');
  const vpClose = dash.indexOf('<!-- ══ INSPECTION REPORT BUILDER OVERLAY', vp);
  const vpBlock = dash.slice(vp, vpClose === -1 ? vp + 8000 : vpClose);
  assert('view-photos contains the m-shutter-fab',
    /class="m-shutter-fab"[\s\S]*id="mShutterFab"/.test(vpBlock),
    'expected #mShutterFab button inside view-photos');
  // 3. Share button in mobile job-detail top bar.
  assert('mobile job-detail has #mJdShare button wired to _mJdShare',
    /id="mJdShare"[\s\S]*data-action="call" data-fn="_mJdShare"/.test(dash),
    'expected the share icon button in the mobile job-detail top bar');
  // 4. JS handler exposed.
  assert('window._mJdShare exposed',
    /window\._mJdShare\s*=/.test(mainJs),
    'expected window._mJdShare to be exported');
  // 5. _mJdShare prefers navigator.share().
  assert('_mJdShare uses navigator.share when available',
    /navigator\.share\(\{\s*title:[^}]*url:\s*portal/.test(mainJs),
    'expected _mJdShare to call navigator.share() with title/text/url');
  // 6. Desktop force-hide guard for the FAB.
  assert('@media (min-width:769px) hides .m-shutter-fab',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,200}\.m-shutter-fab[\s\S]{0,80}display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-shutter-fab');
}

section('Wave 2C.1 — Mobile create popover');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  // 1. Popover DOM + backdrop exist.
  assert('mCreatePopover element exists',
    /<div class="m-create-popover" id="mCreatePopover"/.test(dash),
    'expected <div class="m-create-popover" id="mCreatePopover">');
  assert('mCreateBackdrop element exists',
    /<div class="m-create-backdrop" id="mCreateBackdrop"/.test(dash),
    'expected the backdrop div');
  // 2. Five create rows wired (via data-action="call" data-fn="_mCreate").
  for (const kind of ['lead','photo','task','knock','note']) {
    assert('create row wires _mCreate(\'' + kind + '\') via delegate',
      new RegExp('data-action="call"\\s+data-fn="_mCreate"\\s+data-arg="' + kind + '"').test(dash),
      'missing _mCreate(' + kind + ') row');
  }
  // 3. Hidden camera-capture input present.
  assert('hidden camera input #mCreatePhotoInput with capture=environment',
    /<input type="file" id="mCreatePhotoInput"[^>]*capture="environment"/.test(dash),
    'expected hidden <input type="file" capture="environment"> for the Photo row');
  // 4. window handlers exposed in dashboard-main.js.
  for (const fn of ['openMobileCreatePopover','closeMobileCreatePopover','toggleMobileCreatePopover','_mCreate']) {
    assert('window.' + fn + ' exposed',
      new RegExp('window\\.' + fn.replace(/_/g,'_') + '\\s*=').test(mainJs),
      'expected window.' + fn);
  }
  // 5. Center FAB routes through mCreateFabRoute (toggleMobileCreatePopover
  //    with an openLeadModal fallback, defined as a single global).
  assert('mobile-nav center FAB routes through mCreateFabRoute',
    /data-action="call" data-fn="mCreateFabRoute"/.test(dash) &&
    /mCreateFabRoute\s*=\s*function/.test(mainJs),
    'expected the FAB onclick to test for toggleMobileCreatePopover and fall back to openLeadModal');
  // 6. Desktop force-hide guard.
  assert('@media (min-width:769px) hides .m-create-popover',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,400}\.m-create-popover[\s\S]{0,100}display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide the popover');
}

section('Wave 2B — Mobile job-detail screen');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  // Step 4b: handleCardClick (asserted below) lives in crm-pipeline.js
  // post-split — concat via readCrm() so the assertion finds it.
  const crmJs = readCrm();
  // 1. Overlay DOM is present with the expected anchors.
  assert('m-jobdetail overlay element exists with id=mJobDetail',
    /<div class="m-jobdetail" id="mJobDetail"/.test(dash),
    'expected <div class="m-jobdetail" id="mJobDetail"...>');
  for (const id of ['mJdStatus','mJdName','mJdAddr','mJdHero','mJdStorm','mJdValue']) {
    assert('mobile job-detail has #' + id,
      new RegExp('id="' + id + '"').test(dash),
      '#' + id + ' missing from mobile job-detail');
  }
  // 2. The 5 action buttons exist.
  for (const id of ['mJdCall','mJdText','mJdEmail','mJdPhotos','mJdEstimate']) {
    assert('mobile job-detail action button #' + id,
      new RegExp('id="' + id + '"').test(dash),
      '#' + id + ' action button missing');
  }
  // 3. The 3 tabs exist.
  assert('mobile job-detail has 3 tabs (Activity/Photos/Details)',
    /data-tab="activity"[\s\S]*?data-tab="photos"[\s\S]*?data-tab="details"/.test(dash),
    'expected 3 tabs in order: activity, photos, details');
  // 4. CSS hides .m-jobdetail on desktop (≥769px).
  assert('@media (min-width:769px) hides .m-jobdetail',
    /@media\s*\(min-width:\s*769px\)\s*\{[\s\S]*?\.m-jobdetail\s*\{\s*display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-jobdetail');
  // 5. JS hooks exposed on window.
  for (const fn of ['openMobileJobDetail','closeMobileJobDetail','openLeadDetail','_mJdSwitchTab','_mJdAct']) {
    assert('window.' + fn + ' exposed in dashboard-main.js',
      new RegExp('window\\.' + fn.replace(/_/g,'_') + '\\s*=').test(mainJs),
      'expected window.' + fn + ' to be exported');
  }
  // 6. openLeadDetail picks mobile vs desktop via matchMedia.
  assert('openLeadDetail routes via matchMedia(max-width:768px)',
    /matchMedia\(['"]\(max-width:\s*768px\)['"]\)/.test(mainJs),
    'expected matchMedia gate in openLeadDetail');
  // 7. crm.js's handleCardClick was rewired to openLeadDetail.
  assert('crm.js handleCardClick calls openLeadDetail (not openCardDetailModal directly)',
    /openLeadDetail\(id\)/.test(crmJs) && !/openCardDetailModal\(id\)/.test(crmJs),
    'expected handleCardClick to call openLeadDetail(id), removing the direct openCardDetailModal(id) call');
  // 8. Storm chip ⛈ is rendered via CSS ::before content (NBD differentiator).
  assert('mobile job-detail storm chip uses ⛈ glyph via CSS',
    /\.m-jd-storm::before\s*\{\s*content:\s*['"]⛈['"]/.test(dash),
    'expected .m-jd-storm::before with ⛈ content');
}

section('Wave 2A — Mobile chrome (nav SVG glyphs + centered FAB)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Sprite now ships the mobile-nav glyphs.
  for (const id of ['nbd-icon-home','nbd-icon-board','nbd-icon-plus','nbd-icon-more','nbd-icon-chat']) {
    assert('sprite has <symbol id="' + id + '">',
      new RegExp('<symbol id="' + id + '"').test(dash),
      'expected mobile-nav sprite symbol ' + id);
  }
  // 2. The bottom nav was rewritten — emoji glyphs gone.
  const navOpen = dash.indexOf('<nav id="mobile-nav">');
  const navClose = dash.indexOf('</nav>', navOpen);
  const navBlock = dash.slice(navOpen, navClose);
  for (const glyph of ['📊','🗺','👥','🤖','⋯']) {
    assert('mobile-nav no longer contains emoji glyph ' + glyph,
      !navBlock.includes(glyph),
      '#mobile-nav still has emoji ' + glyph + ' — should be SVG sprite ref');
  }
  // 3. The center "+" FAB exists.
  assert('mobile-nav has center FAB (.mn-fab) wired to a create handler',
    /class="mn-item mn-fab"[\s\S]{0,200}id="mni-create"/.test(navBlock),
    'expected an orange center "+" FAB with id="mni-create"');
  // 4. Sprite refs are present on every primary nav item.
  assert('mobile-nav primary items reference sprite via <use href="#nbd-icon-*"/>',
    (navBlock.match(/<use href="#nbd-icon-(home|board|plus|chat|more)"\/>/g) || []).length >= 5,
    'expected ≥5 sprite refs across the 5 nav items');
}

section('Pro Chrome — icon system + header consolidation');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. SVG sprite ships with the 5 chrome icons we replaced emoji with.
  for (const id of ['nbd-icon-clock','nbd-icon-bell','nbd-icon-palette','nbd-icon-gear','nbd-icon-book']) {
    assert('sprite has <symbol id="' + id + '">',
      new RegExp('<symbol id="' + id + '"').test(dash),
      'expected an inline SVG sprite symbol for ' + id);
  }
  // 2. The five .hdr-tool buttons are present and reference the sprite.
  assert('global header uses .hdr-tool wrappers (≥5 instances)',
    (dash.match(/class="hdr-tool"/g) || []).length >= 5,
    'expected at least 5 .hdr-tool buttons in the global header');
  assert('header tools reference the sprite via <use href="#nbd-icon-*"/>',
    /<use href="#nbd-icon-(clock|bell|palette|gear|book)"\/>/.test(dash),
    'expected header buttons to <use> sprite symbols');
  // 3. The five raw-emoji glyphs the old buttons rendered must no longer
  //    appear inside the global <header>. We slice the header block and
  //    check it. (Decorative emoji elsewhere in the file — card chips,
  //    stage headers, settings tabs — are out of scope for this PR and
  //    intentionally untouched.)
  const headerOpen = dash.indexOf('<header>');
  const headerClose = dash.indexOf('</header>', headerOpen);
  const headerBlock = dash.slice(headerOpen, headerClose);
  for (const glyph of ['🕒','🔔','🎨','⚙','📖']) {
    // 🕒 = \u{1F552} clock, 🔔 = bell, 🎨 = palette,
    // ⚙ = gear, 📖 = book
    assert('header chrome no longer contains raw emoji ' + glyph,
      !headerBlock.includes(glyph),
      'global <header> still has emoji ' + glyph + ' — should be SVG sprite ref now');
  }
  // 4. The notif badge keeps working via the new .hdr-tool-badge class
  // (and may carry the .dn utility from the C.6 sweep when count=0).
  assert('notif button keeps its #notifBadge under .hdr-tool-badge',
    /<button class="hdr-tool"[^>]*id="notifBtn"[\s\S]{0,500}id="notifBadge" class="hdr-tool-badge( dn)?"/.test(dash),
    'expected #notifBadge inside the .hdr-tool#notifBtn with .hdr-tool-badge class');
  // 5. The CRM action row was given group dividers (3 .crm-hdr-sep spans).
  assert('CRM action row has ≥3 .crm-hdr-sep dividers between groups',
    (dash.match(/class="crm-hdr-sep"/g) || []).length >= 3,
    'expected at least 3 .crm-hdr-sep elements inside .crm-hdr-actions');
}

section('Rock 4 Phase 3 — view-storm lazy hydration');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();
  // 1. The active view DIV is now an empty mount carrying the template ref.
  assert('view-storm is an empty mount div with data-view-template',
    /<div class="view" id="view-storm" data-view-template="tpl-view-storm"><\/div>/.test(dash),
    'expected: <div class="view" id="view-storm" data-view-template="tpl-view-storm"></div>');
  // 2. The original markup lives inside a <template> sibling.
  assert('tpl-view-storm template exists with stormCenterContainer inside',
    /<template id="tpl-view-storm">[\s\S]*?id="stormCenterContainer"[\s\S]*?<\/template>/.test(dash),
    'expected <template id="tpl-view-storm"> wrapping the original view markup');
  // 3. The hydration helper is defined.
  assert('_hydrateViewTemplate helper defined in dashboard-main.js',
    /function _hydrateViewTemplate\(name\)/.test(mainJs),
    'expected function _hydrateViewTemplate(name) in dashboard-main.js');
  // 4. goTo() calls the helper before the view-active update.
  assert('goTo() calls _hydrateViewTemplate(name) before reading view-' + 'name',
    /_hydrateViewTemplate\(name\)[\s\S]{0,400}document\.getElementById\(['"]view-['"]\+name\)/.test(mainJs),
    'expected _hydrateViewTemplate(name) to run before the view-active update');
}

};
