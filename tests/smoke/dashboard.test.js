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
const { ROOT, PRO_JS, FUNCTIONS, read, readDashboard, readDashboardStyles, readCustomer, readDashboardMain, readCrm, readMaps, readD2DLive, readFunctionsIndex, syntaxCheck } = require('./_shared');

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
  path.join(PRO_JS, 'maps-customers.js'),
  path.join(PRO_JS, 'maps-routing.js'),
  // Step 4f split — d2d-tracker-2026b core + ui modules must each parse.
  path.join(PRO_JS, 'd2d-tracker-core-2026b.js'),
  path.join(PRO_JS, 'd2d-tracker-ui-2026b.js'),
  path.join(PRO_JS, 'd2d-tracker-2026b.js'),
  // Step 4f split — sales-training engine + ui modules + shim must each parse.
  path.join(PRO_JS, 'sales-training-engine.js'),
  path.join(PRO_JS, 'sales-training-ui.js'),
  path.join(PRO_JS, 'sales-training.js'),
  path.join(PRO_JS, 'estimates.js'),
  path.join(PRO_JS, 'estimate-v2-ui.js'),
  path.join(PRO_JS, 'estimate-finalization.js'),
  path.join(PRO_JS, 'nbd-doc-viewer.js'),
  // Boot-path prefs (de-moji, sizing, fonts, sidebar hidden-prefs) — a
  // parse error here silently kills every boot-applied UI pref at once.
  path.join(PRO_JS, 'dashboard-ui-prefs-boot.js'),
  // FCM Web Push token registration + its config slot — a parse error here
  // silently disables every push notification (the backend has no recipients).
  path.join(PRO_JS, 'push-registration.js'),
  path.join(PRO_JS, 'dashboard-fcm-config.js'),
  path.join(FUNCTIONS, 'index.js')
];
for (const f of syntaxFiles) {
  const result = syntaxCheck(f);
  assert('parses ' + path.relative(ROOT, f), result.ok, result.err && result.err.split('\n')[0]);
}

// ── FCM Web Push registration (client ↔ server contract) ─────
// The backend (push-functions.js) sends to users/{uid}/fcmTokens, but for a
// long time NOTHING on the client wrote that subcollection, so every push had
// zero recipients. These guards keep the registration path wired end-to-end.
section('FCM push registration');
{
  const pr = read(path.join(PRO_JS, 'push-registration.js'));
  const fcmCfg = read(path.join(PRO_JS, 'dashboard-fcm-config.js'));
  const dash = read(path.join(PRO_JS, '..', 'dashboard.html'));
  const sw = read(path.join(PRO_JS, '..', 'firebase-messaging-sw.js'));
  const pushFns = read(path.join(FUNCTIONS, 'push-functions.js'));

  // Client mints + persists a token to the exact path the server reads.
  assert('push-registration mints an FCM token (getToken)', /getToken\s*\(/.test(pr));
  assert('push-registration reads the VAPID key from config', /__NBD_VAPID_KEY/.test(pr) && /vapidKey/.test(pr));
  assert('push-registration registers the messaging service worker',
    /serviceWorker\.register\(/.test(pr) && /['"]\/pro\/firebase-messaging-sw\.js['"]/.test(pr));
  // The messaging SW must NOT register at scope /pro/ — sw.js (offline/PWA)
  // owns that scope, and a scope holds one SW, so /pro/ would clobber offline.
  assert('push-registration uses a dedicated SW scope (not /pro/, avoids clobbering sw.js)',
    /firebase-cloud-messaging-push-scope/.test(pr) && !/scope:\s*['"]\/pro\/['"]/.test(pr));
  assert('push-registration writes users/{uid}/fcmTokens', /['"]fcmTokens['"]/.test(pr) && /setDoc\s*\(/.test(pr));
  assert('push-registration only prompts on a user gesture (no page-load requestPermission)',
    /requestPermission/.test(pr) && /data-action="enable-notifications"/.test(pr));
  assert('push-registration wires a foreground onMessage handler', /onMessage\s*\(/.test(pr));
  assert('push-registration no-ops without a VAPID key (graceful)', /no-vapid/.test(pr));

  // The config slot exists and ships empty (so a real key is never committed).
  assert('dashboard-fcm-config sets window.__NBD_VAPID_KEY', /window\.__NBD_VAPID_KEY\s*=/.test(fcmCfg));
  // The VAPID public key (applicationServerKey) is public by design — committed,
  // not secret. Guard that a well-formed key is present (base64url, ~87 chars):
  // an empty/typo'd key silently disables push, and gitleaks allowlists it by
  // exact value in .gitleaks.toml.
  assert('dashboard-fcm-config carries a well-formed VAPID public key',
    /window\.__NBD_VAPID_KEY\s*=\s*["'][A-Za-z0-9_-]{80,100}["']/.test(fcmCfg));

  // Both scripts are loaded by dashboard.html (config classic+early, engine deferred).
  assert('dashboard.html loads dashboard-fcm-config.js', /src="js\/dashboard-fcm-config\.js/.test(dash));
  assert('dashboard.html loads push-registration.js (deferred)',
    /defer\s+src="js\/push-registration\.js/.test(dash));

  // The service worker the client registers actually handles background pushes.
  assert('messaging SW handles background messages', /onBackgroundMessage\s*\(/.test(sw));

  // Server still reads the same subcollection the client writes (contract).
  assert('server getUserFCMTokens reads users/{uid}/fcmTokens',
    /collection\(\s*['"]fcmTokens['"]\s*\)/.test(pushFns));
}

// ── QA sweep regression guards (Audit #4: F4/F5) ──────────
section('QA sweep fixes (F4/F5)');
{
  // F1 (template-suite writeBatch) retired — template-suite.js was removed
  // entirely (dead code: its UI was only reachable via a guard on a method
  // that never existed, and nothing consumed its API or synced data).
  const auth = read(path.join(PRO_JS, 'nbd-auth.js'));
  assert('F4: nbd-auth falls back client role to the custom claim', /_claimRole/.test(auth) && /userData\.role\s*\|\|\s*_claimRole/.test(auth));
  for (const s of ['seed-access-codes.js', 'grant-admin-claim.js', 'grant-demo-claim.js']) {
    const src = read(path.join(ROOT, 'scripts', s));
    assert('F5: ' + s + ' resolves firebase-admin from functions/', /require\.resolve\(['"]firebase-admin['"]/.test(src));
  }
}

// ── Template-suite removal + Message Templates wiring ──────────
// template-suite.js (NBDTemplateSuite) was deleted as dead code: its UI was
// gated on window.NBDTemplateSuite.render, a method it never exposed (the
// real name was renderTemplateLibrary), so the branch never fired — and had
// it fired it would have clobbered the curated docgen docs view. Nothing
// consumed its API, localStorage seed, or Firestore sync. The live snippet
// engine is templates-library.js (TemplatesLibrary), which IS consumed
// (portal-link-helpers pickAndRender, smart-followup apply) and whose
// manager UI is now reachable from the docs view header.
section('Template-suite removal + TemplatesLibrary manager wiring');
{
  const dash = readDashboard();
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const legacyHtml = read(path.join(ROOT, 'docs/pro/dashboard.legacy.html'));
  const tl = read(path.join(PRO_JS, 'templates-library.js'));

  // 1. The dead module stays dead — no file, no script tag, no guard branch.
  assert('template-suite.js stays deleted',
    !fs.existsSync(path.join(PRO_JS, 'template-suite.js')),
    'template-suite.js came back — its UI was unreachable dead code, see PR');
  assert('dashboard.html does not load template-suite.js', !/template-suite\.js/.test(dashHtml));
  assert('dashboard.legacy.html does not load template-suite.js (deleted file would 404 the rollback snapshot)',
    !/template-suite\.js/.test(legacyHtml));
  assert('no NBDTemplateSuite references remain in dashboard shards', !/NBDTemplateSuite/.test(dash));

  // 2. The docs view header wires the TemplatesLibrary manager via the
  //    CSP-safe module dispatch (no inline handlers, no registry entry —
  //    module dispatch resolves window.TemplatesLibrary.openManager).
  assert('docs view header opens TemplatesLibrary.openManager via module dispatch',
    /data-action="module"\s+data-target="TemplatesLibrary\.openManager"/.test(dashHtml),
    'expected a Message Templates button in tpl-view-docs using data-action="module"');
  assert('templates-library.js exports openManager on window.TemplatesLibrary',
    /window\.TemplatesLibrary\s*=\s*\{[\s\S]{0,600}openManager/.test(tl),
    'module dispatch target must exist or the button silently no-ops');
  assert('dashboard.html loads templates-library.js (manager must load on the page that dispatches it)',
    /src="js\/templates-library\.js/.test(dashHtml));
}

// ── QA sweep behavior guards (F2/F3/F6/F8: verified working-as-intended) ──
// These four were flagged during functional QA but proved to be NON-bugs on
// code review — headless/eval-timing artifacts (F2 screenshot-never-idles,
// F6 checked before the 1200ms redirect) and intentional design (F3 fail-open,
// F8 create-opener clears the edit-id). Guard the intended behavior so a
// future refactor can't silently regress it into the bug it merely resembled.
section('QA sweep behaviors (F2/F3/F6/F8)');
{
  const gx = read(path.join(PRO_JS, 'theme-gx.js'));
  assert('F2: theme-gx pauses the animated bg when the tab is hidden',
    /visibilitychange/.test(gx) && /document\.hidden/.test(gx) && /cancelAnimationFrame/.test(gx));

  // F3: softGate must NOT enforce limits before the plan loads — eager gating
  // would falsely nag paying users whose subscription doc hasn't synced yet.
  const bill = read(path.join(PRO_JS, 'billing-gate.js'));
  assert('F3: billing softGate fails open before the plan loads',
    /if\s*\(\s*!_loaded\s*\)\s*return true/.test(bill));

  const reg = read(path.join(PRO_JS, 'pages', 'register.js'));
  assert('F6: register signs in + redirects to the dashboard after account creation',
    /signInWithCustomToken/.test(reg) && /\/pro\/dashboard\.html/.test(reg));

  const leads = read(path.join(PRO_JS, 'crm-leads.js'));
  assert('F8: openLeadModal clears the lead edit-id on open (no create/edit state-bleed)',
    /function openLeadModal/.test(leads) && /lEditId/.test(leads) && /editId\.value\s*=\s*['"]{2}/.test(leads));
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

  // PR 2a (perf): ApexCharts moved off the eager boot path into the lazy
  // `reports` bundle (~524 KB raw / ~137 KB gzipped saved per dashboard
  // load). Guard BOTH halves so a future merge can't silently re-add the
  // eager <script> tag or drop it from the bundle — the latter would break
  // the Rep Report view's charts. The CDN URL (not the word "ApexCharts",
  // which survives in a breadcrumb comment) is the precise signal here.
  const dashRaw = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('PR 2a: ApexCharts is NOT eager-loaded in dashboard.html',
    !/cdn\.jsdelivr\.net\/npm\/apexcharts/.test(dashRaw),
    'ApexCharts CDN must not be an eager <script src> in dashboard.html — it belongs in the ScriptLoader reports bundle');
  const reportsBundleSrc = (src.match(/reports:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  assert('PR 2a: ApexCharts IS lazy-loaded via the reports bundle',
    /apexcharts/i.test(reportsBundleSrc),
    'ApexCharts CDN URL must be in the reports bundle in script-loader.js so the Rep Report view still loads it');

  // PR 2b (perf): the doc-generation cluster (~419 KB) moved off the eager
  // boot path into the lazy `docgen` bundle, triggered load-then-run from the
  // lead-card doc chips (_generateDocWithPreflight) and the Docs view. Guard
  // that none of the four modules is eager in dashboard.html and that all
  // four are registered in the bundle.
  const DOCGEN = ['nbd-logo-asset.js', 'document-generator.js', 'document-generator-templates.js', 'doc-preflight.js'];
  const docgenBundleSrc = (src.match(/docgen:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  for (const m of DOCGEN) {
    assert('PR 2b: ' + m + ' is NOT eager in dashboard.html',
      !new RegExp('<script[^>]+src="js/' + m.replace(/\./g, '\\.') + '\\?').test(dashRaw),
      m + ' must be lazy-loaded via the docgen bundle, not an eager <script> in dashboard.html');
    assert('PR 2b: ' + m + ' IS in the docgen bundle',
      docgenBundleSrc.includes(m),
      m + ' must be listed in the docgen bundle in script-loader.js');
  }
  // The Docs view must preload the docgen bundle (the click handlers also
  // load-then-run as a backstop, but preloading avoids the first-click wait).
  assert("PR 2b: docs view preloads the docgen bundle",
    /docs:\s*\[[^\]]*'docgen'/.test(src),
    "VIEW_BUNDLES['docs'] must include 'docgen' so opening the Docs view preloads it");

  // PR 2c (perf): the estimate engine (~530 KB, 12 modules) moved off the eager
  // boot path into the lazy `estimates` bundle, triggered load-then-run from the
  // startNewEstimate / openEstimateV2Builder stubs and preloaded on the est /
  // products views. estimate-config / review-engine / property-intel stay eager.
  // Verified end-to-end by tests/e2e/estimate-engine.spec.js (engine assembles
  // to 222 products / 298 merged catalog keys / 270 xactimate).
  const ESTMODS = ['estimates.js', 'product-data.js', 'product-library.js',
    'estimate-builder-v2.js', 'estimate-catalog-xactimate.js', 'estimate-v2-ui.js'];
  const estBundleSrc = (src.match(/estimates:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  for (const m of ESTMODS) {
    assert('PR 2c: ' + m + ' is NOT eager in dashboard.html',
      !new RegExp('<script[^>]+src="js/' + m.replace(/\./g, '\\.') + '\\?').test(dashRaw),
      m + ' must be lazy-loaded via the estimates bundle, not an eager <script> in dashboard.html');
    assert('PR 2c: ' + m + ' IS in the estimates bundle',
      estBundleSrc.includes(m),
      m + ' must be listed in the estimates bundle in script-loader.js');
  }
  // estimate-builder-v2 MUST precede estimate-catalog-xactimate (load-time
  // CATALOG merge); the xactimate merge produced the 298-key baseline.
  assert('PR 2c: builder-v2 loads before xactimate in the bundle (merge order)',
    estBundleSrc.indexOf('estimate-builder-v2.js') > -1 &&
    estBundleSrc.indexOf('estimate-builder-v2.js') < estBundleSrc.indexOf('estimate-catalog-xactimate.js'),
    'estimate-builder-v2.js must come before estimate-catalog-xactimate.js in the estimates bundle');
  // estimate-config stays eager (prerequisite read at load by the builder).
  assert('PR 2c: estimate-config stays eager',
    /<script[^>]+src="js\/estimate-config\.js\?/.test(dashRaw),
    'estimate-config.js must remain an eager <script> in dashboard.html');
  assert('PR 2c: est + products views preload the estimates bundle',
    /est:\s*\['estimates'\]/.test(src) && /products:\s*\['estimates'\]/.test(src),
    "VIEW_BUNDLES must map est + products to the estimates bundle");

  // Expense subsystem: the #/expenses view lazy-loads expense-config (the
  // category/money source of truth), profit-tracker (window.ProfitTracker —
  // NOT loaded anywhere else on dashboard.html; expenses.js's per-job margin
  // calls computeJobPLWithExpenses at render), then expenses.js. Order is
  // load-bearing: a missing/late profit-tracker silently degrades margin to
  // "set Job Value" (caught only by live browser verification, not unit tests).
  const EXPMODS = ['expense-config.js', 'profit-tracker.js', 'expenses.js'];
  const expBundleSrc = (src.match(/expenses:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  for (const m of EXPMODS) {
    assert('expenses bundle includes ' + m, expBundleSrc.includes(m),
      m + ' must be listed in the expenses bundle in script-loader.js');
  }
  assert('expenses bundle order: config + profit-tracker before expenses.js',
    expBundleSrc.indexOf('expense-config.js') < expBundleSrc.indexOf('expenses.js') &&
    expBundleSrc.indexOf('profit-tracker.js') < expBundleSrc.indexOf('expenses.js'),
    'expense-config.js and profit-tracker.js must load before expenses.js');
  assert('expenses view preloads the expenses bundle',
    /expenses:\s*\['expenses'\]/.test(src),
    "VIEW_BUNDLES must map expenses to the expenses bundle");

  // Money / P&L capstone view — lazy single-module bundle + preload mapping.
  const moneyBundleSrc = (src.match(/money:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  assert('money bundle includes money-dashboard.js', moneyBundleSrc.includes('money-dashboard.js'),
    'money-dashboard.js must be in the money bundle in script-loader.js');
  assert('money view preloads the money bundle',
    /money:\s*\['money'\]/.test(src),
    "VIEW_BUNDLES must map money to the money bundle");

  // PR 2d (perf): the photo + inspection engine (~200 KB) moved off the eager
  // boot path into the lazy `photos` bundle, with load-then-run stubs at the
  // entry points (camera / gallery / inspection builder / photo report).
  const PHOTOMODS = ['photo-engine.js', 'inspection-report-engine.js', 'photo-report.js'];
  const photosBundleSrc = (src.match(/photos:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  for (const m of PHOTOMODS) {
    assert('PR 2d: ' + m + ' is NOT eager in dashboard.html',
      !new RegExp('<script[^>]+src="js/' + m.replace(/\./g, '\\.') + '\\?').test(dashRaw),
      m + ' must be lazy-loaded via the photos bundle, not an eager <script> in dashboard.html');
    assert('PR 2d: ' + m + ' IS in the photos bundle',
      photosBundleSrc.includes(m),
      m + ' must be listed in the photos bundle in script-loader.js');
  }
  assert('PR 2d: photos view preloads the photos bundle',
    /photos:\s*\['photos'\]/.test(src),
    "VIEW_BUNDLES must map photos to the photos bundle");

  // PR 2e (perf): the D2D tracker (~180 KB) moved off the eager boot path into
  // the lazy `d2d` bundle, preloaded on the D2D view (goTo's waitForD2D poller
  // handles the late load). The maps engine intentionally stays eager because
  // maps.js doubles as the theme/font appearance engine (applies the theme at
  // boot + powers the Settings theme picker).
  const D2DMODS = ['d2d-tracker-core-2026b.js', 'd2d-tracker-ui-2026b.js', 'd2d-tracker-2026b.js'];
  const d2dBundleSrc = (src.match(/d2d:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  for (const m of D2DMODS) {
    assert('PR 2e: ' + m + ' is NOT eager in dashboard.html',
      !new RegExp('<script[^>]+src="js/' + m.replace(/\./g, '\\.') + '\\?').test(dashRaw),
      m + ' must be lazy-loaded via the d2d bundle, not an eager <script> in dashboard.html');
    assert('PR 2e: ' + m + ' IS in the d2d bundle',
      d2dBundleSrc.includes(m),
      m + ' must be listed in the d2d bundle in script-loader.js');
  }
  assert('PR 2e: d2d view preloads the d2d bundle',
    /d2d:\s*\['d2d'\]/.test(src),
    "VIEW_BUNDLES must map d2d to the d2d bundle");
  // The maps engine MUST stay eager — maps.js applies the saved theme/font at
  // boot (nbdBoot) and powers the theme picker; deferring it would break theming.
  assert('PR 2e: maps.js stays eager (it is also the theme engine)',
    /<script[^>]+src="js\/maps\.js\?/.test(dashRaw),
    'maps.js must remain an eager <script> in dashboard.html (applies the theme at boot)');

  // PR 2b2 (perf): jsPDF + html2pdf (~1.1 MB) moved off the eager boot path into
  // the lazy `pdfexport` bundle, loaded on demand by the doc-viewer's PDF
  // download handler (nbd-doc-viewer.js handlePdf).
  assert('PR 2b2: html2pdf is NOT eager in dashboard.html',
    !/cdnjs\.cloudflare\.com\/ajax\/libs\/html2pdf/.test(dashRaw),
    'html2pdf must not be an eager <script> in dashboard.html — it belongs in the pdfexport bundle');
  assert('PR 2b2: jsPDF is NOT eager in dashboard.html',
    !/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/.test(dashRaw),
    'standalone jsPDF must not be an eager <script> in dashboard.html — it belongs in the pdfexport bundle');
  const pdfBundleSrc = (src.match(/pdfexport:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  assert('PR 2b2: pdfexport bundle contains jsPDF + html2pdf',
    /jspdf/i.test(pdfBundleSrc) && /html2pdf/i.test(pdfBundleSrc),
    'the pdfexport bundle must list jsPDF + html2pdf');
  assert('PR 2b2: doc-viewer handlePdf load-then-runs the pdfexport bundle',
    /loadBundle\(['"]pdfexport['"]\)/.test(read(path.join(PRO_JS, 'nbd-doc-viewer.js'))),
    'nbd-doc-viewer.js must ScriptLoader.loadBundle("pdfexport") before using html2pdf');

  // PR 2b3 (perf): same pdfexport deferral applied to customer.html. jsPDF +
  // html2pdf (~1.1 MB) no longer eager — the two inline export handlers
  // load-then-run the bundle, and NBDDocViewer.handlePdf (already lazy) covers
  // the html2pdf path.
  const custRaw = read(path.join(PRO_JS, '..', 'customer.html'));
  assert('PR 2b3: jsPDF is NOT eager in customer.html',
    !/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/.test(custRaw),
    'jsPDF must not be an eager <script> in customer.html — load via the pdfexport bundle');
  assert('PR 2b3: html2pdf is NOT eager in customer.html',
    !/cdnjs\.cloudflare\.com\/ajax\/libs\/html2pdf/.test(custRaw),
    'html2pdf must not be an eager <script> in customer.html — load via the pdfexport bundle');
  assert('PR 2b3: customer.html loads ScriptLoader',
    /<script[^>]+src="js\/script-loader\.js/.test(custRaw),
    'customer.html must load script-loader.js to lazy-load the pdfexport bundle');
  assert('PR 2b3: customer.html PDF handlers load-then-run pdfexport',
    (readCustomer().match(/loadBundle\(['"]pdfexport['"]\)/g) || []).length >= 2,
    'both jsPDF export handlers must ScriptLoader.loadBundle("pdfexport") before window.jspdf — they live in the extracted customer-*.js shards since the 2026-07-02 CSP extraction, hence readCustomer()');
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
  const customer = readCustomer();
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

section('Hotkey scope fix — isHotkeyEnabled defined in the module');
{
  // Regression guard: isHotkeyEnabled is defined inside an IIFE in
  // dashboard-hotkey-toggles.js, invisible to this ES module. The keydown
  // handler must define its own (reading the same localStorage flag) or it
  // throws ReferenceError on every keypress and all shortcuts break.
  const boot = read(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'));
  assert('dashboard-bootstrap.module.js defines isHotkeyEnabled in module scope',
    /const isHotkeyEnabled\s*=\s*\(id\)\s*=>/.test(boot),
    'the keydown handler references isHotkeyEnabled; it must be defined in this module (the hotkey-toggles copy is IIFE-scoped and invisible)');
  assert('the keydown handler still gates the N shortcut on isHotkeyEnabled',
    /addEventListener\('keydown'[\s\S]*?isHotkeyEnabled\('hk_n'\)/.test(boot));
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
  const customer = readCustomer();
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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

section('Add Lead revival (2026-07-06) — pipeline affordances cannot silently die again');
{
  // History this section exists to prevent repeating: the 2026-05-14
  // header cleanup removed the inline ＋ Add button because "the FAB is
  // the primary add action" — but the FAB was ALREADY dead: dashboard-ui
  // executes before dashboard-actions (which defines goTo), and
  // setupAddLeadFab's old `typeof goTo !== 'function' → return` guard
  // silently disabled it. Result: a pipeline with zero add-lead entry
  // points and no error anywhere.
  const ui = read(path.join(PRO_JS, 'dashboard-ui.js'));
  assert('setupAddLeadFab survives boot order (install() + retry, no bare bail)',
    /setupAddLeadFab[\s\S]{0,2500}if \(!install\(\)\)/.test(ui)
    && !/setupAddLeadFab[\s\S]{0,600}if \(typeof _origGoTo !== 'function'\) return;/.test(ui));

  const dashHtml = readDashboard();
  assert('pipeline header carries the restored ＋ Add Lead button (wired to openLeadModal)',
    /id="crmAddLeadBtn"[^>]*data-fn="openLeadModal"/.test(dashHtml));
  assert('#addLeadFab still present and wired to openLeadModal',
    /id="addLeadFab"[^>]*data-fn="openLeadModal"/.test(dashHtml));

  const styles = readDashboardStyles();
  assert('FAB is restacked ABOVE the capture-inbox FAB (196px slot, stack z-index)',
    /#addLeadFab\{[\s\S]{0,300}bottom:calc\(196px[\s\S]{0,200}z-index:9999/.test(styles));
  assert('FAB has no mobile bottom:80px override (collided with the capture FAB at 84px)',
    !/#addLeadFab\{\s*bottom:80px/.test(styles));

  const coord = read(path.join(PRO_JS, 'fab-stack-coordinator.js'));
  assert('fab-stack-coordinator hides addLeadFab with the rest of the stack',
    /FAB_IDS = \[[\s\S]{0,300}'addLeadFab'/.test(coord));
  assert('coordinator treats leadModal + quickAddModal as class-toggled blockers',
    /_CLASS_TOGGLED = new Set\(\[[^\]]*'leadModal'[^\]]*'quickAddModal'/.test(coord)
    && /BLOCKING_MODAL_IDS = \[[\s\S]{0,1800}'leadModal'/.test(coord));
  // nbd-picker-modal is STATIC in dashboard.html and class-toggled:
  // classifying it as display-toggled made "presence = open" hide the
  // whole FAB stack (mic/capture/inbox) on EVERY dashboard load (Wave
  // 149 regression, found 2026-07-06 by the add-lead revival E2E whose
  // restore assertion could never pass).
  assert('coordinator classifies the static appearance picker as class-toggled',
    /_CLASS_TOGGLED = new Set\(\[[^\]]*'nbd-picker-modal'/.test(coord));
  assert('coordinator observes class flips on the persistent class-toggled modals',
    /_CLASS_TOGGLED\.forEach[\s\S]{0,200}attributeFilter: \['class'\]/.test(coord));
}

section('Mobile FAB speed-dial (2026-07-06, Jo\'s pick) — one launcher, tools fan out');
{
  // Supersedes the same-day interim that display:none'd the field
  // tools on phones. Contract: phones show ⋯ (#nbd-fab-dial) + ＋ Add
  // Lead above it; the mic/capture/inbox FABs park faded at their fan
  // slots and appear only while body.nbd-dial-open. Desktop never
  // shows the launcher and keeps the classic vertical stack.
  const dial = read(path.join(PRO_JS, 'fab-speed-dial.js'));
  const styles = readDashboardStyles();
  const dashHtml = readDashboard();
  const coord = read(path.join(PRO_JS, 'fab-stack-coordinator.js'));

  assert('dashboard loads fab-speed-dial.js',
    /<script defer src="js\/fab-speed-dial\.js\?v=\d+"><\/script>/.test(dashHtml));
  assert('launcher toggles body.nbd-dial-open',
    /OPEN_CLASS = 'nbd-dial-open'/.test(dial)
    && /classList\.toggle\(OPEN_CLASS, open\)/.test(dial));
  assert('coordinator hides the launcher with the rest of the stack',
    /FAB_IDS = \[[\s\S]{0,400}'nbd-fab-dial'/.test(coord));

  // The mic swaps its glyph to ⏹ while recording; folding the dial
  // then would leave an unstoppable recording. Both dismiss paths and
  // the tool-tap fallthrough must respect it.
  assert('dismiss paths are recording-safe (⏹ guard + tool taps excluded)',
    /_micIsRecording[\s\S]{0,200}'⏹'/.test(dial)
    && /_onDocClick[\s\S]{0,400}_micIsRecording\(\)/.test(dial)
    && /_onDocClick[\s\S]{0,600}#nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab/.test(dial));

  // CSS contract — parked tools: opacity WITHOUT !important (the
  // fab-stack-coordinator's inline hide must still win during modals),
  // positions WITH !important (must outrank the modules' inline
  // cssText). Launcher hidden on desktop, shown ≤768px.
  assert('mobile parks the field tools faded at fan slots (no !important on opacity)',
    /#nbd-whisper-fab\{\s*opacity:0; pointer-events:none;\s*bottom:calc\(75px[^}]*!important/.test(styles)
    && /#nbd-qc-fab\{\s*opacity:0; pointer-events:none;\s*bottom:calc\(78px[^}]*!important/.test(styles)
    && /#nbd-qci-fab\{\s*opacity:0; pointer-events:none;\s*bottom:calc\(80px[^}]*!important/.test(styles));
  assert('body.nbd-dial-open fans the tools out',
    /body\.nbd-dial-open #nbd-whisper-fab,\s*body\.nbd-dial-open #nbd-qc-fab,\s*body\.nbd-dial-open #nbd-qci-fab\{\s*opacity:1; pointer-events:auto;/.test(styles));
  assert('＋ Add Lead floats ABOVE the launcher on mobile (138px slot)',
    /#addLeadFab\{\s*bottom:calc\(138px \+ env\(safe-area-inset-bottom, 0px\)\) !important;/.test(styles));
  assert('launcher styled at the bottom slot, desktop-hidden, shown on mobile gated views',
    /#nbd-fab-dial\{\s*display:none;\s*position:fixed;\s*bottom:calc\(78px/.test(styles)
    && /@media \(max-width:768px\)\{[\s\S]{0,400}body\.show-field-tools #nbd-fab-dial\{ display:flex; \}\s*\}/.test(styles));
  // Field-tools cluster is gated to CRM + D2D via body.show-field-tools
  // (dashboard-ui.js sets it next to show-add-lead-fab). On every OTHER view
  // the mic / quick-capture / inbox FABs are display:none so the fixed
  // bottom-right stack can't float over the Photos card VIEW/ADD buttons —
  // the overlap Jo flagged from his phone.
  assert('field tools hidden on non-gated views (body:not(.show-field-tools))',
    /body:not\(\.show-field-tools\) #nbd-whisper-fab,\s*body:not\(\.show-field-tools\) #nbd-qc-fab,\s*body:not\(\.show-field-tools\) #nbd-qci-fab\{\s*display:none !important;/.test(styles));
  // CRM *and* D2D (view-map): a rep dictates the note right after a knock,
  // so the tools must be reachable on the door-knocking view too.
  const uiSrc = read(path.join(PRO_JS, 'dashboard-ui.js'));
  assert('dashboard-ui gates show-field-tools to the CRM + D2D views',
    /view-map['"]\)\?\.classList\.contains\(['"]active['"]\)/.test(uiSrc)
    && /show-field-tools['"],\s*!!\(onCrm \|\| onMap\)/.test(uiSrc));
  assert('Add Lead FAB stays CRM-only (not widened to D2D)',
    /show-add-lead-fab['"],\s*!!onCrm/.test(uiSrc));
  // A .view-scroll view with no FAB over it (Photos, …) only needs the 62px
  // #mobile-nav clearance — not the launcher's ~126px reach.
  assert('mobile .view-scroll clears the mobile nav (~80px, no FAB to clear)',
    /\.view-scroll \{ min-height:auto!important; padding-bottom:calc\(80px \+ env\(safe-area-inset-bottom, 0px\)\)!important; \}/.test(styles));
  // …but D2D DOES host the launcher, so its scroll region must reserve the
  // launcher's full reach (≥126px) or the value/streak cards sit trapped
  // under it again. Regression guard for the exact bug in the screenshots.
  // The map's spyglass row goes full-width static on mobile, putting its
  // 📍 / Go buttons in the launcher's right-hand column — tap-blocked until
  // the row reserves that column. Horizontal (not vertical) clearance,
  // because the row is in normal flow and scrolls.
  assert('map spyglass row clears the launcher column when field tools are shown (≥64px)',
    /body\.show-field-tools \.map-spyglass-panel\{\s*padding-right:calc\((6[4-9]|[7-9]\d|\d{3,})px \+ env\(safe-area-inset-right, 0px\)\)!important;/.test(styles));
  assert('D2D scroll region clears the launcher when field tools are shown (≥126px)',
    /body\.show-field-tools #d2dContent \{ padding-bottom:calc\((1[3-9]\d|[2-9]\d\d)px \+ env\(safe-area-inset-bottom, 0px\)\)!important; \}/.test(styles));

  // ── Collision guard: REVERTED (see below) ────────────────────────
  // fab-collision-guard.js shipped in #1061 and was reverted the same
  // night — it measured by writing dodge:0 and re-applying, so the browser
  // painted the intermediate state ~11x/sec (visible flicker), and its
  // MutationObserver watched `style` on the whole body subtree while the
  // dodge itself WRITES style on a body descendant — re-triggering itself
  // in a rAF busy-loop that dropped taps. Both are fixable (measure
  // arithmetically from the applied offset instead of resetting; scope the
  // observer and ignore self-writes) but it must not ship again without a
  // real-device soak. This guard fails the build if it comes back without
  // that fix, so the same regression can't return by copy-paste.
  assert('collision guard stays out until the flicker + self-trigger loop are fixed',
    !/fab-collision-guard\.js/.test(dashHtml));
}

section('Pipeline one-row toolbar (2026-07-06) — three controls, ids intact');
{
  // Jo's call after the header grew button-by-button until it overflowed
  // the viewport: the action row is exactly Filters ▾ / Tools ⋯ /
  // ＋ Add Lead. The filter/sort/bulk/csv buttons MOVED into the
  // dropdowns keeping their ids — every filter module and the toggle
  // delegate bind by id, so these contracts pin id + new container.
  const dashHtml = readDashboard();
  const actionsStart = dashHtml.indexOf('<div class="crm-hdr-actions">');
  const filtersMenu = dashHtml.slice(dashHtml.indexOf('id="crmFiltersMenu"'),
                                     dashHtml.indexOf('id="crmToolsBtn"'));
  const toolsMenu   = dashHtml.slice(dashHtml.indexOf('id="crmToolsMenu"'),
                                     dashHtml.indexOf('id="crmAddLeadBtn"'));
  assert('actions row exists with the Filters trigger + badge',
    actionsStart > -1
    && /id="crmFiltersBtn"[^>]*data-action="crmFiltersMenu"/.test(dashHtml)
    && /id="crmFiltersActiveBadge"/.test(dashHtml));
  for (const id of ['needsAttentionBtn', 'staleSharesBtn', 'snoozedToggleBtn',
                    'engagementSortBtn', 'prospectsToggleBtn']) {
    assert('filter control #' + id + ' lives inside #crmFiltersMenu',
      new RegExp('id="' + id + '"').test(filtersMenu));
  }
  for (const frag of ['id="bulkModeBtn"', 'id="csvExportBtn"',
                      'data-fn="openDeletedDrawer"', 'id="loadSampleDataBtn"',
                      'id="sidebarToggleBtn"', 'id="kanbanFullscreenBtn"',
                      'id="kanbanDensityToggleBtn"']) {
    assert('tools control ' + frag + ' lives inside #crmToolsMenu',
      toolsMenu.includes(frag));
  }
  assert('the duplicate .crm-tools-menu-mobile cluster is gone',
    !dashHtml.includes('class="crm-tools-menu-mobile"'));
  assert('view switcher sits in its own .crm-hdr-viewrow row',
    /class="crm-hdr-viewrow"[\s\S]{0,600}id="kanbanViewSwitcher"/.test(dashHtml));

  const ui = read(path.join(PRO_JS, 'dashboard-ui.js'));
  assert('delegate handles the crmFiltersMenu action',
    /if \(action === 'crmFiltersMenu'\)/.test(ui));
  assert('filter toggles inside ANY dropdown close both menus after acting',
    /closest\('\.crm-tools-menu'\)/.test(ui)
    && /closeCrmFiltersMenu/.test(ui));
  // Every filter module stamps .active on its button synchronously
  // (added 2026-07-06 — none did before; the old mobile menu's active
  // mirrors were silently dead because of it), and the sync fn counts
  // those classes into the Filters badge.
  assert('sync function counts stamped .active classes into the badge',
    /crmFiltersActiveBadge/.test(ui)
    && /\['needsAttentionBtn', 'staleSharesBtn', 'snoozedToggleBtn', 'engagementSortBtn'\]/.test(ui));
  for (const [f, flag] of [['needs-attention-filter.js', 'active'], ['stale-shares-filter.js', 'active'],
                           ['lead-snooze.js', 'showing'], ['crm.js', 'on']]) {
    assert(f + " stamps .active on its filter button",
      new RegExp("classList\\.toggle\\('active', " + flag + "\\)").test(read(path.join(PRO_JS, f))));
  }

  const styles = readDashboardStyles();
  assert('menu-item normalization for moved .crm-hdr-btn/.crm-icon-btn',
    /\.crm-tools-menu \.crm-hdr-btn,\s*\.crm-tools-menu \.crm-icon-btn\{/.test(styles));
  assert('labels forced visible inside menus',
    /\.crm-tools-menu \.crm-hdr-btn-label\{ display:inline !important; \}/.test(styles));
  assert('mobile no longer id-hides the relocated filter buttons',
    !/#needsAttentionBtn,\s*#staleSharesBtn/.test(styles));
}

section('Pipeline lean triage list (2026-07-06) — Board/List toggle');
{
  // Jo's scope call: the list is a LEAN sortable table sharing the
  // kanban's fully-narrowed lead set — no bulk/thumbnails/drag (those
  // stay kanban-only), stage changes ride the same moveCard path.
  const lv = read(path.join(PRO_JS, 'crm-list-view.js'));
  assert('crm-list-view module exposes CrmListView + call-delegate entry points',
    /window\.CrmListView = \{ isActive, render, clear \}/.test(lv)
    && /window\.crmViewBoard = /.test(lv) && /window\.crmViewList\s*= /.test(lv));
  assert('stage select rides moveCard (history + gating intact)',
    /window\.moveCard\(sel\.dataset\.id, sel\.value\)/.test(lv));
  assert('mode persists in localStorage and gates body.crm-list-mode',
    /nbd-crm-view-mode/.test(lv) && /crm-list-mode/.test(lv));

  const dashHtml = readDashboard();
  assert('view row carries the Board/List toggle wired through the call delegate',
    /id="crmViewBoardBtn"[^>]*data-fn="crmViewBoard"/.test(dashHtml)
    && /id="crmViewListBtn"[^>]*data-fn="crmViewList"/.test(dashHtml));
  assert('list surface div sits beside the kanban board',
    /id="crmListWrap"[\s\S]{0,600}id="kanbanBoard"/.test(dashHtml));
  assert('crm-list-view.js ships as a script tag',
    /<script defer src="js\/crm-list-view\.js/.test(dashHtml));

  const state = read(path.join(PRO_JS, 'dashboard-state.js'));
  assert('call allowlist admits crmViewBoard/crmViewList',
    /'crmViewBoard', 'crmViewList'/.test(state));

  const pipe = read(path.join(PRO_JS, 'crm-pipeline.js'));
  assert('renderLeads hands the fully-narrowed list to CrmListView',
    /window\.CrmListView\.isActive\(\)\) window\.CrmListView\.render\(list\)/.test(pipe));

  const styles = readDashboardStyles();
  assert('body.crm-list-mode swaps the surfaces CSS-side',
    /body\.crm-list-mode #view-crm \.kanban-board\{ display:none !important; \}/.test(styles)
    && /body\.crm-list-mode \.crm-list-wrap\{ display:block/.test(styles));
}

section('Wave 4 — Design tokens (type / spacing / radius / tap-targets)');
{
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
    // share-gallery.js was DELETED 2026-07-27: it uploaded a text/html Blob to a
    // Storage path whose write rule requires isImage(), so the Share Gallery
    // button could never succeed, and it minted permanent unrevocable links with
    // hardcoded NBD brand strings — the pre-#698 pattern #702 retired for GDPR.
    // Share now routes through PortalLinkHelpers (revocable, tenant-aware).
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

  // (The on-window spot-check that used to live here is gone: the 14 cda*
  // wrappers converted in Tranche 2c-4a and the 20 one-off openers in Tranche
  // 2c-4c all moved OFF window into __NBD_CALL_REGISTRY. Their off-window +
  // registration guards live in the "Globals Tranches 0+1" and "Globals
  // Tranche 2c" sections below.)

  // C.5 — script-src 'unsafe-inline' dropped from line-44 enforcing CSP.
  // The Report-Only policy already lacked it; now the enforcing one matches.
  const csps = firebaseJson.match(/"Content-Security-Policy",\s*"value":\s*"([^"]+)"/g) || [];
  assert('at least one enforcing CSP declared',
    csps.length >= 1, 'expected ≥1 Content-Security-Policy in firebase.json');
  // Walk every enforcing-CSP entry and ensure none contain script-src
  // 'unsafe-inline' — EXCEPT entries inside a header block that carries
  // a FIXME(csp) _comment (documented temporary exception). Today the
  // only such exception is /pro/customer pending its inline-script
  // extraction (mirror of #398 dashboard.html work).
  const firebaseCfg = JSON.parse(firebaseJson);
  const headerEntries = (firebaseCfg.hosting?.headers || []);
  const offenders = [];
  for (const e of headerEntries) {
    const csp = (e.headers || []).find(h => h.key === 'Content-Security-Policy');
    if (!csp) continue;
    if (!/script-src\s+'self'\s+'unsafe-inline'/.test(csp.value)) continue;
    const cmt = e._comment || '';
    if (/FIXME\(csp\)/.test(cmt)) continue; // documented exception OK
    offenders.push(e.source || '<unknown source>');
  }
  assert("no enforcing CSP retains script-src 'self' 'unsafe-inline' (except documented FIXME(csp))",
    offenders.length === 0,
    offenders.length ? 'offending sources: ' + offenders.join(', ') : '');
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
  assert('settingsTab conversions: 11 (one per Settings tab, incl. Pipelines)',
    count === 11,
    'expected 11 settingsTab data-actions; got ' + count);

  const remaining = (dash.match(/onclick="switchSettingsTab\(/g) || []).length;
  assert('no inline switchSettingsTab onclicks remain',
    remaining === 0,
    'expected 0 inline switchSettingsTab onclicks; got ' + remaining);
}

section('Signature integration PR 2 — defaultSigners opt-in across contract-class templates');
{
  // Per [[signature-integration-v1]] design: nine templates declare
  // defaultSigners so the modal's Signers section auto-prechecks the
  // expected sign-set. This guards against future edits that silently
  // drop the field — losing a defaultSigners entry would mean the rep
  // has to re-add signers manually every time.
  const docGenSrc = read(path.join(ROOT, 'docs/pro/js/document-generator.js'));
  const TEMPLATES_WITH_SIGNERS = [
    'proposal', 'contract', 'inspectionHomeowner',
    'certificate_of_completion', 'scope_of_work', 'assignment_of_benefits',
    'change_order', 'work_authorization', 'payment_agreement'
  ];
  for (const tpl of TEMPLATES_WITH_SIGNERS) {
    // Match the template key followed (allow trailing chars/spaces) by an
    // object literal that contains defaultSigners. The trailing colon on
    // the literal key plus the rendered defaultSigners token is enough
    // to confirm the opt-in didn't get dropped by mistake.
    const re = new RegExp('^\\s*' + tpl + '\\s*:[\\s\\S]{0,500}defaultSigners:', 'm');
    assert("DOCUMENT_TYPES." + tpl + " declares defaultSigners",
      re.test(docGenSrc),
      'expected defaultSigners on ' + tpl + ' entry');
  }
  // Negative guard: a few templates intentionally stay off (per memory).
  // Templates without signers are single-line entries — match the ENTIRE
  // line and assert defaultSigners is absent from that line. (A greedier
  // regex would incorrectly catch defaultSigners from a neighboring
  // multi-line entry.)
  const SIGNER_OFF = ['invoice', 'customer_report', 'thank_you', 'door_hanger'];
  for (const tpl of SIGNER_OFF) {
    const lineRe = new RegExp('^\\s*' + tpl + '\\s*:.*$', 'm');
    const m = docGenSrc.match(lineRe);
    assert("DOCUMENT_TYPES." + tpl + " stays OFF (no defaultSigners)",
      m && !/defaultSigners/.test(m[0]),
      m ? ('found defaultSigners on ' + tpl + ' line: ' + m[0].slice(0, 120)) : (tpl + ' entry not found'));
  }
}

section('Signature integration PR 3a — saved-signature reuse store');
{
  // Per [[signature-integration-v1]] PR3 design: each captured signature
  // is persisted to leads/{leadId}/signatures/{role} so a future doc for
  // the same lead can offer "Use saved" (PR3b). PR3a builds the store.
  const widget = read(path.join(ROOT, 'docs/pro/js/signature-widget.js'));
  assert('widget finalize() surfaces the PNG per signer',
    /signedSigners\.push\(\{[^}]*png:\s*png/.test(widget));

  const docGen = read(path.join(ROOT, 'docs/pro/js/document-generator.js'));
  assert('onPersistFinalized writes leads/{id}/signatures/{role}',
    /setDoc\([\s\S]{0,120}window\.doc\(window\.db,\s*'leads',\s*_leadIdEarly,\s*'signatures'/.test(docGen));
  assert('saved sig write keyed by role with png',
    /'signatures',\s*String\(s\.role\)\)[\s\S]{0,200}png:\s*s\.png/.test(docGen));
  assert('doc metadata signedSigners stays lean (no png dataURLs)',
    /signedSigners:\s*Array\.isArray\(signedSigners\)[\s\S]{0,160}\.map\(s => \(\{ role: s\.role/.test(docGen));

  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('rules expose signatures subcollection (owner-scoped)',
    /match \/signatures\/\{sigRole\}/.test(rules));
  assert('signatures write requires lead ownership',
    /signatures\/\{sigRole\}[\s\S]{0,260}allow write: if isAuth\(\)[\s\S]{0,160}isOwner\(get\(\/databases/.test(rules));
}

section('Signature integration PR 3b — "Use saved" reuse UI');
{
  const widget = read(path.join(ROOT, 'docs/pro/js/signature-widget.js'));
  assert('widget accepts a savedSigs postMessage',
    /__nbd_sig === 'savedSigs'/.test(widget));
  assert('widget injects a "Use saved" button',
    /data-nbd-sig-action', 'use-saved'/.test(widget));
  assert('widget applies the saved PNG onto the pad',
    /function applySavedToPad/.test(widget) && /drawImage\(img/.test(widget));

  const viewer = read(path.join(ROOT, 'docs/pro/js/nbd-doc-viewer.js'));
  assert('viewer carries savedSigs on context',
    /savedSigs:\s*opts\.savedSigs/.test(viewer));
  assert('viewer posts savedSigs into the iframe on load',
    /addEventListener\('load'[\s\S]{0,160}__nbd_sig:\s*'savedSigs'/.test(viewer));

  const docGen = read(path.join(ROOT, 'docs/pro/js/document-generator.js'));
  assert('docgen fetches saved sigs from leads/{id}/signatures',
    /_fetchSavedSignatures[\s\S]{0,300}window\.collection\(window\.db,\s*'leads',\s*leadId,\s*'signatures'\)/.test(docGen));
  assert('docgen passes savedSigs to the viewer (only when signers present)',
    /hasSigners \? await this\._fetchSavedSignatures[\s\S]{0,200}savedSigs:\s*_savedSigs/.test(docGen));
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

  // 3 bottom-nav items (mn-item) plus 21 More-drawer items = 24 total
  // mobileNav data-actions in the markup. (Crew-calendar More item
  // intentionally remains inline — defensive existence check.)
  // (Expenses + Money More-drawer items added with the expense initiative.)
  const mnCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"/g) || []).length;
  assert('mobileNav conversions: 24 (3 bottom-nav + 21 more-drawer)',
    mnCount === 24,
    'expected 24 mobileNav data-actions; got ' + mnCount);

  const closeMoreCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"\s+data-close-more/g) || []).length;
  assert('21 mobileNav items carry data-close-more (More-drawer items)',
    closeMoreCount === 21,
    'expected 21 data-close-more flags; got ' + closeMoreCount);

  // C.4 finale: every mobileNav handler is delegated (no inline onclicks).
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
  assert('mapOverlay conversions: 6 (heat/pins/jobs/customers/storm/weather)',
    mapOv === 6,
    'expected 6 mapOverlay conversions; got ' + mapOv);

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
  // Step 5 (2026-05-17): legacy docs/pro/js/d2d-tracker.js was deleted
  // — only the d2d-tracker-2026b.js shards are live now.
  const SAFE_FILES = [
    'docs/pro/js/close-board.js',
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
    // Step 4f (2026-05-17): d2d-tracker-2026b.js was split into three
    // shards. Pull the concatenated post-split source so the assertion
    // catches orange-rgba in core or ui too, not just in the thin shim.
    const body = p === 'docs/pro/js/d2d-tracker-2026b.js'
      ? readD2DLive()
      : read(path.join(ROOT, p));
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
  // Sanity: NO view remains inline. view-est was the last raw view and
  // was templated by Rock 4 Phase 4 (commit b6cb61da) once the Rock 2
  // dep landed; this assertion previously allowed exactly ['est'].
  // Strict count of "still-inline" views = those whose mount doesn't
  // carry data-view-template attribute.
  const stillInline = [];
  const reAll = /class="view"[^>]*id="view-([a-z]+)"([^>]*)>/g;
  let m;
  while ((m = reAll.exec(dash)) !== null) {
    if (!/data-view-template/.test(m[2])) stillInline.push(m[1]);
  }
  assert('no view remains inline (Rock 4 Phase 4: view-est templated)',
    stillInline.length === 0,
    'expected zero inline views; got: ' + stillInline.join(','));
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
    // 6 → 7 on 2026-07-29: dashboard-connect-tab.js (Connect phase 2).
    const scriptCount = (settingsBody.match(/<script[\s>]/g) || []).length;
    assert('tpl-view-settings carries 7 <script> blocks (inline or external, incl. pipeline-builder)',
      scriptCount === 7,
      'expected 7 scripts inside the settings template, got ' + scriptCount);
    // The COUNT is a weak proxy for the thing that actually matters (CSP
    // extraction put these scripts inside the template, and a settings module
    // loaded OUTSIDE it runs before its markup exists). So also pin the intent:
    // every settings-tab module must be referenced from inside the template.
    // Bumping the number alone, next time, would satisfy the count and miss this.
    ['dashboard-custom-theme.js', 'dashboard-sidebar-customizer.js', 'pipeline-builder.js',
      'dashboard-team-tab.js', 'dashboard-billing-tab.js', 'dashboard-connect-tab.js',
      'dashboard-hotkey-toggles.js'].forEach((f) => {
      const insideCount = (settingsBody.match(new RegExp(f.replace(/\./g, '\\.'), 'g')) || []).length;
      const wholeFile = (dash.match(new RegExp('<script[^>]*' + f.replace(/\./g, '\\.'), 'g')) || []).length;
      assert(f + ' is loaded from INSIDE tpl-view-settings',
        insideCount > 0 && wholeFile === 1,
        'expected exactly one <script> for ' + f + ', inside the settings template');
    });
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
  // Step 4b: search-highlight + saveBtn cssText assertions cross
  // the split — concat via readCrm() so the regexes match
  // regardless of which split file the inline-style strings landed in.
  const crmJs = readCrm();
  // 1. .crm-icon-btn.active gains the inset --accent-ring boundary.
  assert('.crm-icon-btn.active includes box-shadow inset --accent-ring',
    /\.crm-icon-btn\.active\{[\s\S]{0,400}box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(dash),
    'expected .crm-icon-btn.active to carry the inset --accent-ring boundary');
  // 2. JS-driven inline orange surfaces in crm.js use --accent-fg.
  // CO-M-1: the kanban search highlight moved from a buildCard innerHTML
  // string (<mark style="...">) to a TreeWalker text-node highlighter
  // (_highlightCardMatches), which creates the <mark> via createElement +
  // style.cssText. The theme-contrast contract (color via --accent-fg) is
  // unchanged — only the construction form moved from HTML string to cssText.
  assert('crm.js search-highlight <mark> uses var(--accent-fg)',
    /mark\.style\.cssText\s*=\s*'background:var\(--orange\);color:var\(--accent-fg\)/.test(crmJs),
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  // Tranche 2c-4b: _mJdShare moved off window into the mobile IIFE and
  // registers in __NBD_CALL_REGISTRY (markup-dispatched, no window consumer).
  assert('_mJdShare registered in __NBD_CALL_REGISTRY and off window (2c-4b)',
    /_mJdShare:\s*_mJdShare/.test(mainJs) && !/window\._mJdShare\s*=/.test(mainJs),
    'expected _mJdShare registered and NOT window-exported');
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
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  // 4. Handler exposure — split by Tranche 2c-4b disposition.
  //   closeMobileCreatePopover + toggleMobileCreatePopover KEEP their window
  //   export (the first is _NBD_MODAL_CLOSE_FNS window[fn]-dispatched, the
  //   second is called by mCreateFabRoute outside the IIFE); _mCreate moved to
  //   the registry; openMobileCreatePopover is fully private (module-local).
  for (const fn of ['closeMobileCreatePopover','toggleMobileCreatePopover']) {
    assert('window.' + fn + ' exposed (2c-4b MUST-STAY)',
      new RegExp('window\\.' + fn + '\\s*=').test(mainJs),
      'expected window.' + fn);
  }
  assert('_mCreate registered in __NBD_CALL_REGISTRY (2c-4b, off window)',
    /_mCreate:\s*_mCreate/.test(mainJs) && !/window\._mCreate\s*=/.test(mainJs),
    'expected _mCreate registered and NOT window-exported');
  assert('openMobileCreatePopover is module-local (2c-4b PRIVATE — no window export)',
    !/window\.openMobileCreatePopover\s*=/.test(mainJs),
    'expected openMobileCreatePopover to have no window re-export');
  // 5. Center FAB routes through mCreateFabRoute (toggleMobileCreatePopover
  //    with an openLeadModal fallback). mCreateFabRoute moved OFF window in
  //    Tranche 2c-4c — it's now a module-local function registered in
  //    __NBD_CALL_REGISTRY, not window.mCreateFabRoute = function.
  assert('mobile-nav center FAB routes through mCreateFabRoute',
    /data-action="call" data-fn="mCreateFabRoute"/.test(dash) &&
    /mCreateFabRoute:\s*mCreateFabRoute/.test(mainJs),
    'expected the FAB data-fn wired + mCreateFabRoute registered in __NBD_CALL_REGISTRY');
  // 6. Desktop force-hide guard.
  assert('@media (min-width:769px) hides .m-create-popover',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,400}\.m-create-popover[\s\S]{0,100}display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide the popover');
}

section('Wave 2B — Mobile job-detail screen');
{
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
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
  //    Word-boundary regex so additional classes (e.g. the mobile
  //    .hdr-tools-desktop-only / .hdr-tools-mobile-only modifiers from
  //    PR #508) still count — the original literal `class="hdr-tool"`
  //    match missed any button that carried a sibling class.
  assert('global header uses .hdr-tool wrappers (≥5 instances)',
    (dash.match(/class="[^"]*\bhdr-tool\b[^"]*"/g) || []).length >= 5,
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
  // 5. (superseded 2026-07-06) The action row used to carry ≥3
  //    .crm-hdr-sep group dividers; the one-row toolbar reduced it to
  //    three controls (Filters ▾ / Tools ⋯ / ＋ Add Lead) with no seps.
  //    The toolbar's own contracts live in the "Pipeline one-row
  //    toolbar" smoke section; here we just pin that the old sep-heavy
  //    sprawl doesn't come back.
  assert('CRM action row stays sep-free (one-row toolbar)',
    (dash.match(/class="crm-hdr-sep"/g) || []).length === 0,
    'a .crm-hdr-sep crept back into the pipeline header — the one-row toolbar has no dividers');
}

section('Sidebar customizer — hidden prefs apply at real page boot');
{
  // The customizer (dashboard-sidebar-customizer.js) ships inside the
  // lazily-hydrated tpl-view-settings template, so its own apply only runs
  // once the user first opens Settings → Appearance — saved hidden-nav
  // prefs came back on every fresh page load until then.
  // dashboard-ui-prefs-boot.js (a real, non-template <script src> that
  // executes before the sidebar markup parses) re-applies them at boot:
  // pre-paint <style> hide, then an inline-style handoff at
  // DOMContentLoaded. Contract: boot READS nbd_sidebar_hidden; the
  // customizer remains the single WRITER.
  const prefsBoot = read(path.join(PRO_JS, 'dashboard-ui-prefs-boot.js'));
  const sidebarSrc = read(path.join(PRO_JS, 'dashboard-sidebar-customizer.js'));
  const dashRaw = read(path.join(ROOT, 'docs/pro/dashboard.html'));

  // 1. The boot apply exists and reads the saved prefs.
  assert('prefs-boot reads nbd_sidebar_hidden at boot',
    /localStorage\.getItem\('nbd_sidebar_hidden'\)/.test(prefsBoot),
    'the boot script must apply saved hidden-nav prefs without waiting for the settings template to hydrate');
  // 2. Single-writer contract: boot never writes the key…
  assert('prefs-boot stays read-only on nbd_sidebar_hidden (customizer is the single writer)',
    !/(setItem|removeItem)\('nbd_sidebar_hidden'/.test(prefsBoot),
    'only dashboard-sidebar-customizer.js may write the key');
  // 2b. …and the customizer still owns the writes (a key rename there
  //     must break this pin together with the boot reader above).
  assert('customizer still owns the nbd_sidebar_hidden writes',
    /setItem\('nbd_sidebar_hidden'/.test(sidebarSrc) && /removeItem\('nbd_sidebar_hidden'\)/.test(sidebarSrc));
  // 3. Pre-paint hide + DOMContentLoaded handoff. The handoff is the
  //    part a refactor could silently drop: a leftover stylesheet rule
  //    overrides applySidebarCustomizer()'s el.style.display='' un-hide
  //    and wedges items hidden until reload.
  assert('boot hide is pre-paint with a DOMContentLoaded inline-style handoff',
    /nbdSidebarBootHide/.test(prefsBoot)
      && /readyState === 'loading'/.test(prefsBoot)
      && /st\.remove\(\)/.test(prefsBoot),
    "the injected <style> must be swapped for inline display:none and removed once the DOM is ready");
  // 4. The boot script ships as a real script tag OUTSIDE (before) the
  //    lazy settings template — inside it, the fix would not fix anything.
  assert('dashboard.html loads prefs-boot before tpl-view-settings',
    dashRaw.indexOf('js/dashboard-ui-prefs-boot.js') !== -1
      && dashRaw.indexOf('js/dashboard-ui-prefs-boot.js') < dashRaw.indexOf('id="tpl-view-settings"'),
    'the boot apply only fixes the reload gap if the script executes at real page boot');
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

section('Hardening 2026-06-09 — settings-tab renderers (post-#597 live surface)');
{
  // PR #597's readyState-guard fix made the Settings-tab renderers run
  // for the first time. This section pins the two bug classes that
  // became reachable with them:
  //  1. XSS hardening — dashboard-team-tab.js renders Firestore member
  //     docs (semi-external strings) into innerHTML. Every member field
  //     must round through the file's _nbdEscHtml escaper.
  //  2. CSP — the /pro/ header ships script-src-attr 'none', so JS-built
  //     markup carrying an inline on*-handler attribute renders dead
  //     controls (same class as the C-1 saveLead no-op). The settings
  //     shards must use the data-on-change delegate, and the handler
  //     names must be on _NBD_CALL_ALLOWLIST or the delegate silently
  //     ignores them.
  const teamSrc = read(path.join(PRO_JS, 'dashboard-team-tab.js'));
  const sidebarSrc = read(path.join(PRO_JS, 'dashboard-sidebar-customizer.js'));
  const hotkeySrc = read(path.join(PRO_JS, 'dashboard-hotkey-toggles.js'));
  const billingSrc = read(path.join(PRO_JS, 'dashboard-billing-tab.js'));
  const stateSrc = read(path.join(PRO_JS, 'dashboard-state.js'));

  // 1a. The escaper exists (widgets.js esc() is IIFE-scoped and
  //     unreachable from this hydrated-template script).
  assert('dashboard-team-tab.js defines the _nbdEscHtml escaper',
    /function _nbdEscHtml\(/.test(teamSrc),
    'member rows render Firestore strings into innerHTML; the file must define its own escaper');
  // 1b. Both email interpolations (row line + avatar initial) escape.
  assert('team rows escape m.email through _nbdEscHtml',
    /_nbdEscHtml\(m\.email\s*\|\|\s*''\)/.test(teamSrc)
      && /_nbdEscHtml\(\(m\.email\s*\|\|\s*'\?'\)\[0\]/.test(teamSrc),
    'both the email line and the avatar initial must be escaped');
  // 1c. Role (both interpolations) + status escape. Status renders via
  // statusLabel (derived from m.status; may read 'invite expired' past the
  // 30-day TTL) — still tenant data, still must pass through the escaper.
  assert('team rows escape m.role and m.status through _nbdEscHtml',
    (teamSrc.match(/_nbdEscHtml\(\(m\.role\s*\|\|\s*'rep'\)/g) || []).length >= 2
      && /_nbdEscHtml\(statusLabel\)/.test(teamSrc)
      && /statusLabel = inviteExpired \? 'invite expired' : \(m\.status \|\| 'invited'\)/.test(teamSrc),
    'role renders twice (meta line + badge) and statusLabel once; all three must be escaped');
  // 1d. No raw member-field concatenation survives.
  assert('no unescaped member-field interpolation remains in team rows',
    !/\+\s*\(m\.(email|role|status)/.test(teamSrc),
    'every "+ (m.<field>" concatenation must be wrapped in _nbdEscHtml(...)');

  // 2a. Zero inline handler attributes in any of the four settings shards.
  [['dashboard-team-tab.js', teamSrc],
   ['dashboard-sidebar-customizer.js', sidebarSrc],
   ['dashboard-hotkey-toggles.js', hotkeySrc],
   ['dashboard-billing-tab.js', billingSrc]].forEach(function(pair) {
    assert(pair[0] + " has zero inline on*-handler attributes (script-src-attr 'none')",
      !/\son(click|change|input|submit|load|error|focus|blur)\s*=/.test(pair[1]),
      'inline handler attributes are CSP-dead on /pro/ — use the data-on-change / data-action delegates');
  });
  // 2b. The two checkbox grids ride the delegate with the checked+arg shape.
  assert('sidebar-customizer checkboxes use the data-on-change delegate',
    /data-on-change="toggleSidebarItem" data-on-pass="checked" data-on-arg="/.test(sidebarSrc),
    'expected data-on-change="toggleSidebarItem" data-on-pass="checked" data-on-arg="<nav id>"');
  assert('hotkey-toggles checkboxes use the data-on-change delegate',
    /data-on-change="toggleHotkey" data-on-pass="checked" data-on-arg="/.test(hotkeySrc),
    'expected data-on-change="toggleHotkey" data-on-pass="checked" data-on-arg="<hk id>"');
  // 2c. Delegate handlers are allowlisted (missing entry = silent no-op).
  assert('toggleSidebarItem + toggleHotkey are on _NBD_CALL_ALLOWLIST',
    /'toggleSidebarItem'/.test(stateSrc) && /'toggleHotkey'/.test(stateSrc),
    'the data-on-change delegate ignores names missing from the allowlist (C-1 class)');
  // 2d. Their handler signatures match the delegate call shape (checked, id).
  assert('toggleSidebarItem signature matches delegate (on, navId)',
    /function toggleSidebarItem\(on, navId\)/.test(sidebarSrc));
  assert('toggleHotkey signature matches delegate (on, id)',
    /function toggleHotkey\(on, id\)/.test(hotkeySrc));
}

section('Routing: no relative bare-.html nav on /pro pages (404 footgun)');
{
  // A /pro page is served at a canonical clean URL (/pro/customer), so a
  // relative `href="dashboard.html"` or `location.href='dashboard.html'`
  // resolves against the current path (+ a .html→clean redirect hop) and can
  // 404 (the customer→dashboard 404, PR #771). All /pro inter-page nav must be
  // absolute canonical (/pro/<page>). This guard keeps the class from recurring.
  const PRO_DIR = path.join(ROOT, 'docs/pro');
  // Matches href=/location nav whose target is a BARE word.html (relative).
  // Absolute "/pro/foo.html" and "https://…" don't match (the char after the
  // quote is "/" or the word is followed by ":", not ".html").
  const RELN = /(?:href=|location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*)["'][a-z0-9_-]+\.html/g;
  const offenders = [];
  for (const dir of [PRO_DIR, PRO_JS]) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(html|js)$/.test(f)) continue;
      const hits = read(path.join(dir, f)).match(RELN);
      if (hits) offenders.push(f + ' (' + hits.slice(0, 2).join(', ') + ')');
    }
  }
  assert('no relative bare-.html nav on /pro (use absolute /pro/<page>)',
    offenders.length === 0, offenders.join(' | '));
}


section('Ops P1 #4 — loadLeads completeness + kanban render cap');
{
  const boot = read(path.join(PRO_JS, 'dashboard-bootstrap.module.js'));
  // Stage A contract: the fetch pages by documentId and keeps going until
  // a short page — window._leads stays COMPLETE. 11 consumers (KPIs, money
  // dashboard, search, export, forecasting, ROI) compute over the cache
  // and would silently under-report if a fetch cap were introduced. Do not
  // page-and-stop without migrating those consumers to server aggregates.
  assert('loadLeads pages with limit(_PAGE) + startAfter', /startAfter\(cursor\)/.test(boot) && /limit\(_PAGE\)/.test(boot));
  assert('loadLeads drains ALL pages (breaks only on short page)', /pageSnap\.size < _PAGE/.test(boot));
  assert('loadLeads runaway guard present (page cap)', /page < 200/.test(boot));

  const pipe = read(path.join(PRO_JS, 'crm-pipeline.js'));
  // Render cap: the DOM paint is bounded even though the cache is not.
  assert('kanban render cap defined', /KANBAN_RENDER_CAP = \d+/.test(pipe));
  assert('both column render paths use renderColumnCards',
    (pipe.match(/renderColumnCards\(body, cards, stage/g) || []).length >= 2,
    'expected the new-stage AND legacy paths to route through the capped renderer');
  assert('show-all expander mounts the remainder', /k-show-all/.test(pipe) && /_kbShowAll\[stageKey\] = true/.test(pipe));
  // Column counts/$ totals must keep computing from the FULL array, not the slice.
  assert('column count uses full cards array', /count\.textContent = cards\.length/.test(pipe));
}

// ── Globals refactor Tranches 0+1 (2026-07-05) — provably-private globals off window ──
// Tranche 0: 40 one-global self-registering widgets moved their API objects
// to module scope; double-load idempotency moved from per-widget window
// objects (__sentinel convention) to one shared window.__NBD_LOADED registry
// keyed by file slug. Tranche 1: repo-wide safe frontier — 18 vestigial
// window.X = X alias exports deleted, 47 single-assignment globals (mostly
// bind-once _NBD_*_DELEGATE flags) made module-local, 13 of them deleted
// outright as write-only dead exports. Every name passed the three-way
// proof (no external refs incl. tests, no in-string refs in own file, not
// window[fnName]-dispatchable). These names must never be reassigned onto
// window — that silently re-grows the surface the tranches removed. See
// docs/dev/dashboard-decomposition-plan.md, caveat 4 execution plan.
section('Globals Tranches 0+1: converted names stay off window');
{
  const T1_NAMES = [
    // Tranche 2c-2 (2026-07-06): the maps-routing.js drawing-tool call
    // cluster — the whole file is IIFE-wrapped now; these 21 handlers
    // are module-scoped and dispatched via __NBD_CALL_REGISTRY (see the
    // "Globals Tranche 2c" section below for wiring guards). NOT here:
    // goToMyLocation (maps.js still re-states it on window — failed the
    // three-way proof) and the file's deliberate window exports
    // (initDrawMap, selLT, setDrawMode, the toggle/close-map targets, …).
    'acceptAutoDetect', 'addStructure', 'applySmartWaste',
    'cancelAutoDetect', 'exportXactimateESX', 'generateScopeFromDrawing',
    'handleComparisonFile', 'loadDrawingFromCustomer', 'openComparisonMode',
    'recalc', 'runSolarAnalysis', 'saveDrawingToCustomer', 'screenshotMap',
    'setHistoricalLayer', 'showAngles', 'showMaterialTakeoff',
    'startAutoDetect', 'startPresentation', 'startShadowPitch',
    'updateHistoryOpacity', 'zoomToFit',
    // Tranche 2c (2026-07-06): the dashboard-ui-prefs-boot.js call
    // cluster — module-scoped, dispatched via __NBD_CALL_REGISTRY
    // (see the "Globals Tranche 2c" section below for wiring guards).
    'nbdSetSize', 'nbdApplyLegacyFont', 'toggleProfessionalMode',
    'nbdSetSidebarLabels', 'nbdGxSetEnabled', 'nbdGxSetGlow',
    'nbdGxSetAnimatedBg', 'nbdGxSetAccent', 'nbdGxSetIntensityFromSlider',
    'nbdOverlaysSetEnabled', 'nbdSoundsSetEnabled', 'nbdComfortSetMotion',
    'nbdComfortSetProMode', 'nbdComfortSetCbSafe', 'nbdComfortSetAutoTheme',
    'nbdSetCrmSecHeaderEnabledT', 'nbdSetKanbanBoldHierarchyT',
    'nbdSetCrmAutoCollapseT', 'nbdSelectPhotoLead', 'nbdTogglePhotosOnly',
    'd2dSetDispoFilter', 'nbdSettingsUpdateCalcomPreview',
    // Tranche 2c-3 (2026-07-07): the crm-portal-bridge.js bulk-ops /
    // deleted-drawer / delete-confirm markup handlers — module-scoped now
    // (whole file IIFE-wrapped), dispatched via __NBD_CALL_REGISTRY. NOT
    // here: clearBulkSelection (lead-snooze.js calls it directly on window —
    // MUST-STAY, allowlisted like goToMyLocation) and this file's deliberate
    // window re-exports (editLead, deleteLead, showDeleteConfirm,
    // toggleBulkMode, toggleCardSelection, closeDeletedDrawer,
    // updateBulkToolbar, scrollToFollowUps, restoreCrmSearch, refreshTrashBadge).
    'selectAllVisibleLeads', 'openDeletedDrawer', 'confirmDeleteLead',
    'cancelDeleteConfirm', 'bulkSnoozeLeads', 'bulkMoveStage', 'bulkDelete',
    'bulkAssignSource', 'bulkAssignJobType', 'bulkAssignDamage', 'bulkAssignCarrier',
    // Tranche 2c-4a (2026-07-07): the dashboard-actions.js card-detail cluster
    // — 18 cda* / chip-picker / mobile photo-picker wrappers consolidated into
    // one IIFE and dispatched via __NBD_CALL_REGISTRY (see the "Globals Tranche
    // 2c" section below). NOT here: the file's MUST-STAY names (goTo router,
    // zone-draw, openLeadDetail, viewProspectOnMap, _mJdSwitchTab, the mobile
    // close-* handlers) which stay window-exported — see
    // docs/dev/dashboard-actions-globals-audit.md.
    'cdaReport', 'cdaEnrich', 'cdaPhotos', 'cdaInvoice', 'cdaInspection',
    'cdaInspectionDeep', 'cdPickStage', 'cdPickType', 'cdaMjdAct', 'cdaEditLead',
    'cdaOpenMobileInspection', 'cdaVoiceMemo', 'cdaOpenVoicemail',
    'cdaSharePortalLink', 'cdaRevokePortalLink', 'cdaConfirmPromote',
    'cdaOpenTaskModal', '_mCreatePhotoPicked',
    // Tranche 2c-4b (2026-07-07): the dashboard-actions.js mobile create/
    // job-detail cluster is IIFE-wrapped; these three lost their window export
    // (markup→registry for _mJdShare/_mCreate; openMobileCreatePopover is
    // private). NOT here: the 7 MUST-STAY window re-exports (_mJdSwitchTab,
    // _mJdAct, openMobileInspection, closeMobileInspection,
    // closeMobileCreatePopover, toggleMobileCreatePopover, openLeadDetail).
    '_mJdShare', '_mCreate', 'openMobileCreatePopover',
    // Tranche 2c-4c (2026-07-07): the 20 one-off compound-rewrite openers in
    // dashboard-actions.js (incl. the two 2c-4b mobile-routing tail names
    // mCreateFabRoute/mQuickAddRoute) moved OFF window into one in-file IIFE,
    // dispatched via __NBD_CALL_REGISTRY. All markup-only — none re-exported.
    'openDailyProgramFromMore', 'mCreateFabRoute', 'mQuickAddRoute',
    'restartOnboardingTour', 'openDecisionPicker', 'openD2DOrGo',
    'clearAccentTheme', 'openSettingsTab', 'openPhotoEngineOrClickProxy',
    'openReportGenerator', 'enrichReportData', 'openPhotoEngineCurrentLead',
    'openInspectionBuilderCurrentLead', 'closeInspectionBuilder',
    'hideFollowUpAlerts', 'goToD2DFromMaps', 'openCalBookingUrl',
    'hardResetTest', 'gstaticTest', 'modeLineDraw',
    // Tranche 2c-4d (2026-07-07): daily-program ds* cluster IIFE-wrapped. These
    // 6 are off window (3 registered + 3 private). NOT here: dsRemoveFloor
    // (keeps window.dsRemoveFloor — dashboard-ui.js:2208 bare call).
    'dsGetConfig', 'dsLoadConfig', 'dsDefaultFloors',
    'dsAddFloor', 'dsSaveConfig', 'dsResetDefaults',
    // Tranche 2c-4e (2026-07-07): customer-page handoff cluster IIFE-wrapped.
    // The 4 openers are off window (registered). NOT here:
    // _stashLeadForCustomerPage (keeps window export — 7 widget callers).
    'openPhotosForLead', 'openDocsForLead', 'openFullCustomerDetails',
    'editCardDetails',
    // Tranche 2b (2026-07-06): widgets.js radar-map handle + task
    // checkbox handler (delegate calls the bare fn), tasks.js checkTask
    // export (only caller is its own data-tk-action delegate).
    '_wRadarMap', '_wToggleTask', 'checkTask',
    'dismissNotification', 'notifAction',
    'renderDismissedNotifications', 'renderNotifications',
    'restoreNotification', 'showShortcutsHelp', 'closeHdrMobileMenu',
    'restoreCrmSecondary', 'seedDemoEstimates', '$id', 'nbdIcon',
    '_deleteTask', '_loadTasks', '_saveTask', '_toggleTask',
    'renderTodayTasks', 'toggleTodayTask', 'handleQMDrop',
    '_di', '_NBD_BG_DELEGATE', 'isClaudeProxyAvailable',
    'nbdCopyToClipboard', '_dismissedNotifications',
    'toggleCustomerPhotoReorder', '_galleryUrl', 'removeDocFromQueue',
    '_NBD_CP_DELEGATE', '_NBD_DA_DELEGATE', 'firebase_onAuthStateChanged',
    '_bootStartedAt', 'nbdDiag', '_NBD_DW_DELEGATE',
    '_NBD_DG_DELEGATE_BOUND', '$addClass', '$html', '$removeClass',
    '$text', '$val', 'nbdSafeHTML', 'nbdSetText', '_NBD_ES_DELEGATE',
    'calculateEstimateV2', '_NBD_EST_DELEGATE', '_NBD_IC_DELEGATE',
    '_NBD_IP_DELEGATE_BOUND', '_NBD_MO_DELEGATE_BOUND',
    '_NBD_MR_DELEGATE_BOUND', '_presentSteps', '_NBD_MP_DELEGATE',
    '__NBD_SENTRY_BOOTSTRAPPED', '_NBD_NC_DELEGATE', '__NBD_EMU_LOGGED',
    '_NBD_PT_DELEGATE', '_NBD_PI_DELEGATE', '_NBD_SC_DELEGATE', 'nbdAlert',
    '_NBD_TK_DELEGATE', '_NBD_VM_DELEGATE', '_NBD_WIDGETS_DELEGATE_BOUND',
    '_wAddTask', '_wAskJoe', '_wMiniHeat', '_wQuickAddLead', '_wQuickDraw',
    '_wQuickEst',
    // Tranche 1b — the 7 deferred multi-assign state vars, now converted:
    '_searchQuery', '_notifDropdownOpen', '_dismissedDrawerOpen',
    '_lightboxIndex', '_perimClosing', '_needsAttentionActive',
    'handleQMFile',
    // Tranche 2a — mobile-nav-customizer delegate-then-scope rewrite:
    '_ncmAddTab', '_ncmRemoveTab', '_ncmSave', '_ncmReset', '_ncmClose',
    '_ncmDragStart', '_ncmDragOver', '_ncmDrop', '_ncmDragEnd',
    '_ncmTouchStart', '_ncmTouchMove', '_ncmTouchEnd',
    'openNavCustomizer', '_NBD_MNC_DELEGATE_BOUND',
    // Tranche 2b — email_system + crm-snooze own-file-wired remnants:
    'openEmailModal', 'closeEmailModal', 'emailEstimatePDF',
    'emailFollowUp', '_emailAttachment', '_emailContext', '_emailLeadId',
    '__NBD_COMM_LOG_DELEGATE', '_notifUnsub', 'loadNotifications',
    // Tranche 2c-4g (2026-07-08): dashboard-ui.js leaf comfort/kanban handlers —
    // `function X` → `const X` + __NBD_CALL_REGISTRY. NOT here: setKanbanDensity /
    // setPhotoMode / nbdComfortSet (MUST-STAY — auto-global backing and/or real
    // cross-file consumers; keep allowlist + window export).
    'cycleKanbanDensity', 'nbdComfortSetWhisperHotkey', 'nbdComfortSetWhisperKey',
    // Tranche 2c-4h (Slice H1, 2026-07-08): the 9 dashboard-ui.js cal/photo/
    // template leaf handlers — `function X` → `const X` + __NBD_CALL_REGISTRY.
    // Each lived only in dashboard-ui.js with zero cross-file callers.
    'saveCalSettings', 'updateCalEmbed', 'copyCalLink', 'shareCalViaSMS',
    'shareCalViaEmail', 'filterPhotoLeads', 'tlToggleCat', 'tlFilterCat',
    'handleDocUpload',
    // Tranche 2c-4h (Slice H2, 2026-07-08): 6 entangled dashboard-ui.js names —
    // single-defined here but forward-ref re-exported by maps.js + dashboard-
    // actions.js (those shims removed this slice). `function X` → `const X` + registry.
    'spyglassSearch', 'spyglassGoToLocation', 'fabToggle', 'quickStormCheck',
    'openUploadDoc', 'printDoc',
    // Tranche 2c-4h (Slice H2 part 2, 2026-07-08): the 4 property-intel twins —
    // byte-identical dupes in dashboard-ui.js + property-intel.js; dashboard-ui.js
    // copies DELETED, property-intel.js owns + registers them.
    'pullIntelForModal', 'updatePropertyIntelCost', 'confirmPropertyIntelPull',
    'executePullPropertyIntel',
    // Tranche 2c-4f (2026-07-07): dashboard-bootstrap.module.js settings/debug/
    // export handlers — module-scoped (real ES module, no IIFE), dispatched via
    // __NBD_CALL_REGISTRY. NOT here (MUST-STAY window exports): loadSampleData
    // (dashboard-actions.js twin), _saveEstimateDefaultsV2 (self-read),
    // _loadCompanySettings / _loadCompanyProfileSettings (ui.js cross-file calls).
    'runLeadAction', 'retryLoadLeads', 'copyDebugInfo', 'testFirestoreRules',
    '_saveSettings', '_saveNotifSettings', '_saveCompanySettings', '_testNotif',
    '_resetEstimateDefaultsV2', '_saveSiteSlug', '_saveCompanyProfileSettings',
    '_resetCompanyProfileSettings', '_exportAllData', '_exportEstimates',
    '_exportPhotos'];
  const NAMES = [...T1_NAMES, 'ActivityFeed', 'AlmostThere', 'AskJoeProactive',
    'CustomerAiDraftsPanel', 'CustomerDnDUpload', 'CustomerLastSharedChip',
    'CustomerQuickActionBar', 'CustomerSiblingSnooze',
    'CustomerSmartFollowupPanel', 'CustomerSnoozeBanner', 'CustomerViewedChip',
    'DataExport', 'EngagementCohortWidget', 'GlobalSearch', 'HotLeads',
    'LeadImport', 'NBDFabStackCoordinator', 'NBDLeadAlert', 'NBDLeadScorePanel',
    'NBDOfflineBanner', 'NBDPush', 'NBDPwaInstall', 'NBDReportsDashboard',
    'NBDReportsTrends', 'NBDSig', 'NBDSupplementUI', 'NBDThemeAudit',
    'NBDWhatsNew', 'NBD_ICONS', 'NbdAiPersona', 'NeedsAttention', 'NotifBell',
    'OfflineManager', 'PWAInstallNudge', 'PipelineBottleneck', 'PrefsSync',
    'ROOFIVENT_CATALOG', 'ShortcutsHelp', 'SmartFollowupBriefing',
    'StaleSharesWidget'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fp); continue; }
      if (!/\.(js|html)$/.test(entry.name)) continue;
      const src = fs.readFileSync(fp, 'utf8');
      for (const n of NAMES) {
        // $-prefixed names must be escaped or the RegExp reads them as anchors
        const esc = n.replace(/\$/g, '\\$');
        if (new RegExp('window\\.' + esc + '\\b').test(src)) {
          offenders.push(path.relative(ROOT, fp) + ':' + n);
        }
      }
    }
  };
  walk(path.join(ROOT, 'docs'));
  assert('no window.<TrancheZeroName> references anywhere under docs/ — '
      + (offenders.slice(0, 5).join(', ') || 'clean'), offenders.length === 0);

  // The replacement idempotency convention: guarded widgets key into the
  // shared __NBD_LOADED registry instead of testing their own window object.
  const af = read(path.join(PRO_JS, 'activity-feed.js'));
  assert('activity-feed.js uses the __NBD_LOADED registry guard',
    /__NBD_LOADED\['activity-feed'\]/.test(af));
  const sig = read(path.join(PRO_JS, 'signature-widget.js'));
  assert('signature-widget.js migrated its bespoke sentinel to the registry',
    /__NBD_LOADED\['signature-widget'\]/.test(sig) && !/__NBDSig__sentinel/.test(sig));

  // Tranche 2a: mobile-nav-customizer's drag/touch handlers were wired
  // through GENERATED inline attributes (ontouchstart="window._ncm...").
  // script-src-attr 'none' in the prod CSP blocks those — reorder was
  // silently dead until the delegation rewrite. They must never return.
  const mnc = read(path.join(PRO_JS, 'mobile-nav-customizer.js'));
  assert('mobile-nav-customizer generates NO inline handler attributes (CSP script-src-attr none)',
    !/on(touchstart|touchmove|touchend|dragstart|dragover|drop|dragend|click)\s*=\s*"/.test(mnc));
  assert('mobile-nav-customizer binds drag/touch via modal-level delegation',
    /_bindDnd\(modal\)/.test(mnc) && /addEventListener\('touchmove'[\s\S]{0,80}passive: false/.test(mnc));

  // First-run punch list follow-up (2026-07-29): the customizer REBUILDS
  // #mobile-nav at boot, so the static markup's create FAB only exists if the
  // registry + defaults carry it. Without these pins a default-tab tweak
  // silently removes the ONLY add-lead control on the mobile home view.
  assert('mobile-nav-customizer: create FAB is a registry tab AND a default tab',
    /\{ id: 'create',[\s\S]{0,80}action: 'create'/.test(mnc)
    && /const DEFAULT_TABS = \['dash', 'crm', 'create', 'joe'\]/.test(mnc),
    'the mobile home view must always ship with an add-lead control by default');
  assert('mobile-nav-customizer renders the create FAB with the static markup identity',
    /class="mn-item mn-fab" id="mni-create" data-mnc-action="create"/.test(mnc),
    '.mn-fab CSS treatment + onboarding-tour #mni-create anchor depend on this shape');
  assert('mobile-nav-customizer dispatches create via __NBD_CALL_REGISTRY first',
    /case 'create':[\s\S]{0,400}__NBD_CALL_REGISTRY[\s\S]{0,200}mCreateFabRoute/.test(mnc),
    'mCreateFabRoute lives in the call registry, not on window (Tranche 2c-4c)');

  // CSP-dead handler audit (2026-07-05, post-2a sweep). Three more prod
  // breakages of the same class, all pinned here so they can't return:
  const bootSrc = read(path.join(PRO_JS, 'dashboard-bootstrap.module.js'));
  assert('kanban columns: no inline ondragover/ondrop (CSP-dead) — board-level delegation instead',
    !/on(dragover|drop)\s*=\s*"/.test(bootSrc) && /nbdDndBound/.test(bootSrc));
  // Raw HTML only — readDashboard() concatenates extracted JS shards whose
  // comments legitimately mention historical onclick="" patterns.
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard.html: ZERO inline handler attributes (incl. the old font-swap onload)',
    !/ on(load|click|change|error|input|submit|keydown)\s*=\s*"/.test(dashHtml));
  const sl = read(path.join(PRO_JS, 'script-loader.js'));
  assert('script-loader performs the CSP-safe font-swap for link[data-nbd-font-swap]',
    /data-nbd-font-swap/.test(sl) && /data-nbd-font-swap/.test(dashHtml));
  const toolsSrc = read(path.join(PRO_JS, 'tools.js'));
  assert('tools.js saveQuickLead selects the save button by data-fn (old [onclick=] selector crashed every save)',
    /button\[data-fn="saveQuickLead"\]/.test(toolsSrc) && !/button\[onclick="saveQuickLead/.test(toolsSrc));

  // Deal-room strict rewrite (option B): the generated customer page must
  // carry NO executable inline script and NO inline handlers — its logic
  // lives in the external /pro/deal-room.js, config in a JSON data island,
  // token/submit-URL in serve-time meta tags (deal-acceptance.js).
  const cb = read(path.join(PRO_JS, 'close-board.js'));
  assert('close-board deal template: zero inline handler attributes', !/on(click|touchstart|drag)\w*\s*=\s*"/.test(cb));
  assert('close-board deal template: config rides the nbd-deal-data JSON island (with < escaped)',
    /nbd-deal-data/.test(cb) && /u003c/.test(cb));
  assert('close-board deal template: references the external deal-room.js absolutely',
    /https:\/\/nobigdealwithjoedeal\.com\/pro\/deal-room\.js/.test(cb));
  assert('close-board deal template: the old inline logic <script> is gone',
    !/<script>\s*let selectedTier/.test(cb));
  const dr = read(path.join(ROOT, 'docs/pro/deal-room.js'));
  assert('deal-room.js wires tiers/financing/signature via delegation + reads meta token',
    /data-deal-tier/.test(dr) && /data-deal-action/.test(dr)
    && /nbd-deal-token/.test(dr) && /nbd-deal-data/.test(dr));
  const da = read(path.join(FUNCTIONS, 'deal-acceptance.js'));
  assert('getDealRoom injects CSP-safe meta tags for token + submit URL',
    /meta name="nbd-deal-token"/.test(da) && /meta name="nbd-deal-submit"/.test(da));

  // Mobile header safe-area (2026-07): global box-sizing:border-box means
  // a fixed height:48px INCLUDES the padding-top:env(safe-area-inset-top)
  // added for the notch — leaving negative content space so the logo/
  // icons/title spilled below the black bar on real iPhones (invisible to
  // headless CI, which has inset:0). The mobile header rule must reserve
  // the inset via min-height, never a bare fixed height.
  const appCss = read(path.join(PRO_JS, '..', 'css', 'dashboard-app.css'));
  const mobileHeader = (appCss.match(/@media\(max-width:768px\)\{[\s\S]*?\n\}/) || [''])[0];
  // Pull the specific header{...} declaration inside the 768 block.
  const hdrRule = (appCss.match(/  header\{padding:env\(safe-area-inset-top[^}]*\}/) || [''])[0];
  assert('mobile header reserves the notch inset via min-height calc (not a bare fixed height)',
    /min-height:calc\(48px \+ env\(safe-area-inset-top/.test(hdrRule)
    && /padding:env\(safe-area-inset-top/.test(hdrRule)
    && !/height:48px/.test(hdrRule));
}

// ── Globals Tranche 2c: the __NBD_CALL_REGISTRY dispatch layer ──
// prefs-boot's 22 markup-dispatched handlers moved into module scope and
// register in window.__NBD_CALL_REGISTRY; the dashboard-ui.js dispatchers
// resolve the registry BEFORE the allowlisted-window fallback. These
// guards pin (a) the resolver + all three dispatch sites, (b) every
// registration, (c) allowlist removal (a stale entry would re-route
// dispatch to a window global that no longer exists = silent dead
// control), and (d) a FULL markup↔dispatch wiring audit of dashboard.html
// — every data-fn / data-on-change / data-on-input / data-on-after name
// must be allowlisted or registered. (d) is the invariant whose violation
// produced the C-1 saveLead and H-4 21-dead-buttons classes.
section('Globals Tranche 2c: __NBD_CALL_REGISTRY dispatch layer');
{
  const T2C_NAMES = [
    'nbdSetSize', 'nbdApplyLegacyFont', 'toggleProfessionalMode',
    'nbdSetSidebarLabels', 'nbdGxSetEnabled', 'nbdGxSetGlow',
    'nbdGxSetAnimatedBg', 'nbdGxSetAccent', 'nbdGxSetIntensityFromSlider',
    'nbdOverlaysSetEnabled', 'nbdSoundsSetEnabled', 'nbdComfortSetMotion',
    'nbdComfortSetProMode', 'nbdComfortSetCbSafe', 'nbdComfortSetAutoTheme',
    'nbdSetCrmSecHeaderEnabledT', 'nbdSetKanbanBoldHierarchyT',
    'nbdSetCrmAutoCollapseT', 'nbdSelectPhotoLead', 'nbdTogglePhotosOnly',
    'd2dSetDispoFilter', 'nbdSettingsUpdateCalcomPreview'];

  const ui = read(path.join(PRO_JS, 'dashboard-ui.js'));
  assert('dashboard-ui.js defines the _nbdResolveCall registry-first resolver',
    /function _nbdResolveCall\(/.test(ui) && /__NBD_CALL_REGISTRY/.test(ui));
  assert('change/input delegate resolves via _nbdResolveCall',
    /_nbdResolveCall\(el\.getAttribute\(attrName\)\)/.test(ui));
  assert('data-on-after resolves via _nbdResolveCall',
    /_nbdResolveCall\(el\.getAttribute\('data-on-after'\)\)/.test(ui));
  assert('click `call` action resolves via _nbdResolveCall',
    /_nbdResolveCall\(el\.dataset\.fn\)/.test(ui));

  const prefsBoot = read(path.join(PRO_JS, 'dashboard-ui-prefs-boot.js'));
  const regBlock = (prefsBoot.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  for (const n of T2C_NAMES) {
    assert('prefs-boot registers ' + n + ' in __NBD_CALL_REGISTRY',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(regBlock));
  }

  const stateSrc = read(path.join(PRO_JS, 'dashboard-state.js'));
  for (const n of T2C_NAMES) {
    assert('allowlist no longer carries ' + n + ' (the registry entry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
  }

  // ── Tranche 2c-2: the maps-routing.js drawing-tool cluster ──
  // Same pattern, second module: 21 of its 22 allowlisted names register
  // in __NBD_CALL_REGISTRY and leave the allowlist. goToMyLocation is the
  // deliberate exception — the maps.js shim re-states it on window (real
  // cross-file reference), so it keeps its allowlist entry until the
  // shim's export block is unwound (Tranche 3).
  const T2C2_NAMES = [
    'acceptAutoDetect', 'addStructure', 'applySmartWaste',
    'cancelAutoDetect', 'exportXactimateESX', 'generateScopeFromDrawing',
    'handleComparisonFile', 'loadDrawingFromCustomer', 'openComparisonMode',
    'recalc', 'runSolarAnalysis', 'saveDrawingToCustomer', 'screenshotMap',
    'setHistoricalLayer', 'showAngles', 'showMaterialTakeoff',
    'startAutoDetect', 'startPresentation', 'startShadowPitch',
    'updateHistoryOpacity', 'zoomToFit'];

  const mapsRouting = read(path.join(PRO_JS, 'maps-routing.js'));
  const mrRegBlock = (mapsRouting.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  for (const n of T2C2_NAMES) {
    assert('maps-routing registers ' + n + ' in __NBD_CALL_REGISTRY',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(mrRegBlock));
  }
  for (const n of T2C2_NAMES) {
    assert('allowlist no longer carries ' + n + ' (the registry entry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
  }
  // goToMyLocation must stay BOTH allowlisted and window-exported — the
  // dispatcher reaches it as window[fn], and maps.js's shim line reads
  // the bare name at load time. Losing either half = dead button or a
  // maps.js boot ReferenceError.
  assert('goToMyLocation keeps its allowlist entry (failed the three-way proof)',
    /'goToMyLocation'/.test(stateSrc));
  assert('maps-routing re-exports goToMyLocation for the maps.js shim',
    /window\.goToMyLocation = goToMyLocation;/.test(mapsRouting));
  // The IIFE wrap must not orphan the toggle/close-map dispatch targets
  // or the cross-file bare-name consumers — those resolve as window[fn]
  // or bare globals (never via the registry), so each needs its explicit
  // export.
  for (const n of ['initDrawMap', 'selLT', 'renderAccessoryPanel',
    'setDrawMode', 'clearDraw', 'undoLine', 'exportDrawReport',
    'importToEstimate', 'perimChooseType', 'searchDraw', 'toggleDraw',
    'toggleMapLayer', 'toggleHistoricalImagery', 'toggleVoiceControl',
    'closeComparisonMode', 'closeHistoricalImagery']) {
    assert('maps-routing window-exports ' + n + ' (window[fn]-dispatched or bare-called cross-file)',
      new RegExp('window\\.' + n + ' = ' + n + ';').test(mapsRouting));
  }
  // drawMap must stay a top-level let OUTSIDE the module IIFE —
  // dashboard-actions/ui/sw-bootstrap read it as a bare global at runtime.
  assert('drawMap survives as a top-level global let',
    /^let drawMap;$/m.test(mapsRouting));

  // ── Tranche 2c-3: the crm-portal-bridge.js bulk-ops cluster ──
  // Same pattern, third module. The whole file is IIFE-wrapped; 11
  // markup-only handlers register in __NBD_CALL_REGISTRY and leave the
  // allowlist. clearBulkSelection is the deliberate exception — the same
  // MUST-STAY shape as goToMyLocation: lead-snooze.js calls
  // window.clearBulkSelection() OUTSIDE the registry-first dispatcher, so
  // it keeps BOTH its allowlist entry and a window re-export.
  const T2C3_NAMES = [
    'selectAllVisibleLeads', 'openDeletedDrawer', 'confirmDeleteLead',
    'cancelDeleteConfirm', 'bulkSnoozeLeads', 'bulkMoveStage', 'bulkDelete',
    'bulkAssignSource', 'bulkAssignJobType', 'bulkAssignDamage', 'bulkAssignCarrier'];
  const crmPortalBridge = read(path.join(PRO_JS, 'crm-portal-bridge.js'));
  const cpbRegBlock = (crmPortalBridge.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  assert('crm-portal-bridge.js is IIFE-wrapped (its top-level names leave window)',
    /^\(function \(\) \{$/m.test(crmPortalBridge) && /\}\)\(\);\s*$/.test(crmPortalBridge.trimEnd()));
  for (const n of T2C3_NAMES) {
    assert('crm-portal-bridge registers ' + n + ' in __NBD_CALL_REGISTRY',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(cpbRegBlock));
    assert('allowlist no longer carries ' + n + ' (the registry entry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
  }
  // clearBulkSelection MUST stay BOTH allowlisted and window-exported —
  // lead-snooze.js:773 calls window.clearBulkSelection() directly, and it
  // is NOT registered (would be redundant). Losing either half = a dead
  // best-effort bulk-exit after a snooze action.
  assert('clearBulkSelection keeps its allowlist entry (lead-snooze direct call)',
    /'clearBulkSelection'/.test(stateSrc));
  assert('crm-portal-bridge re-exports clearBulkSelection on window',
    /window\.clearBulkSelection = clearBulkSelection;/.test(crmPortalBridge));
  assert('clearBulkSelection is NOT registered (window path only)',
    !/\bclearBulkSelection:\s*clearBulkSelection\b/.test(cpbRegBlock));
  // The IIFE wrap must not orphan the cross-file consumers — these resolve
  // as bare globals, window.X(), or window[fn] dispatch (never via the
  // registry), so each needs an explicit re-export from this file now that
  // crm.js no longer provides it.
  for (const n of ['editLead', 'deleteLead', 'showDeleteConfirm',
    'toggleBulkMode', 'toggleCardSelection', 'closeDeletedDrawer',
    'updateBulkToolbar', 'scrollToFollowUps', 'restoreCrmSearch',
    'refreshTrashBadge']) {
    assert('crm-portal-bridge window-exports ' + n + ' (cross-file consumer)',
      new RegExp('window\\.' + n + ' = ' + n + ';').test(crmPortalBridge));
  }

  // ── Tranche 2c-4a: the dashboard-actions.js card-detail cluster ──
  // First slice of the dashboard-actions.js decomposition. 18 cda* /
  // chip-picker / mobile photo-picker wrappers are consolidated into ONE
  // in-file IIFE (the file is NOT wholly wrapped — the goTo router, zone-draw
  // shims and other MUST-STAY names stay as top-level window globals) and
  // register in __NBD_CALL_REGISTRY, leaving the allowlist. cdaMjdAct /
  // cdaOpenMobileInspection call the 2c-4b mobile cluster via window._mJdAct /
  // window.openMobileInspection so they survive when those callees go
  // module-local. See docs/dev/dashboard-actions-globals-audit.md.
  const T2C4A_NAMES = [
    'cdaReport', 'cdaEnrich', 'cdaPhotos', 'cdaInvoice', 'cdaInspection',
    'cdaInspectionDeep', 'cdPickStage', 'cdPickType', 'cdaMjdAct', 'cdaEditLead',
    'cdaOpenMobileInspection', 'cdaVoiceMemo', 'cdaOpenVoicemail',
    'cdaSharePortalLink', 'cdaRevokePortalLink', 'cdaConfirmPromote',
    'cdaOpenTaskModal', '_mCreatePhotoPicked'];
  const dashActions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  // dashboard-actions.js now carries MORE THAN ONE registry block (2c-4a card-
  // detail + 2c-4b mobile, and the 2c-4b block is physically earlier in the
  // file). A first-match .match() would silently grab only the 2c-4b block and
  // fail every 2c-4a assertion below — aggregate ALL blocks instead.
  const daRegBlock = [...dashActions.matchAll(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/g)].map(m => m[1]).join('\n');
  for (const n of T2C4A_NAMES) {
    assert('dashboard-actions registers ' + n + ' in __NBD_CALL_REGISTRY',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock));
    assert('allowlist no longer carries ' + n + ' (the registry entry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    // Off window: no file may reassign window.<cdaName> (would shadow-resurrect).
    assert('dashboard-actions no longer defines window.' + n,
      !new RegExp('window\\.' + n + '\\s*=\\s*function').test(dashActions));
  }
  // The cross-slice calls resolve via window.* — those callees (2c-4b) are
  // re-exported now, so cdaMjdAct / cdaOpenMobileInspection keep working and
  // will survive the mobile cluster going module-local.
  assert('cdaMjdAct calls the mobile handler via window._mJdAct (cross-slice-safe)',
    /window\._mJdAct\(actionType/.test(dashActions));
  assert('cdaOpenMobileInspection calls via window.openMobileInspection (cross-slice-safe)',
    /window\.openMobileInspection\(window\._cardDetailLeadId\)/.test(dashActions));
  assert('dashboard-actions window-exports _mJdAct for the cross-slice call',
    /window\._mJdAct = _mJdAct;/.test(dashActions));
  assert('dashboard-actions window-exports openMobileInspection for the cross-slice call',
    /window\.openMobileInspection = openMobileInspection;/.test(dashActions));
  // MUST-STAY: the goTo router keeps its allowlist entry (never converted).
  assert('goTo router stays allowlisted (MUST-STAY — 27 cross-file callers)',
    /'goTo'/.test(stateSrc));

  // ── Tranche 2c-4b: the dashboard-actions.js mobile create/job-detail cluster ──
  // Second slice: the contiguous mobile block is IIFE-wrapped. Three markup-
  // dispatched convertibles register in __NBD_CALL_REGISTRY and leave the
  // allowlist; seven names keep a window re-export for a cross-boundary consumer
  // (cross-slice 2c-4a call, _NBD_MODAL_CLOSE_FNS window[fn] dispatch, or a
  // bare cross-file caller). openMobileCreatePopover is private.
  const T2C4B_REG = ['_mJdSwitchTab', '_mJdShare', '_mCreate'];
  for (const n of T2C4B_REG) {
    assert('dashboard-actions registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4b)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4b — registry/vestigial)',
      !new RegExp("'" + n + "'").test(stateSrc));
  }
  // _mJdAct also leaves the allowlist (never markup-dispatched; reached via
  // window._mJdAct from the 2c-4a cdaMjdAct wrapper).
  assert("allowlist no longer carries _mJdAct (reached via window._mJdAct only)",
    !/'_mJdAct'/.test(stateSrc));
  // The 7 load-bearing window re-exports — each pinned to its consumer. Dropping
  // any one is a silent dead control (modal-close / cross-slice / bare caller),
  // invisible to the data-fn wiring audit.
  for (const [n, why] of [
    ['_mJdSwitchTab', 'dashboard-widgets.js bare call'],
    ['_mJdAct', '2c-4a cdaMjdAct window._mJdAct'],
    ['openMobileInspection', '2c-4a cdaOpenMobileInspection window.openMobileInspection'],
    ['closeMobileInspection', '_NBD_MODAL_CLOSE_FNS window[fn]'],
    ['closeMobileCreatePopover', '_NBD_MODAL_CLOSE_FNS window[fn]'],
    ['toggleMobileCreatePopover', 'mCreateFabRoute (outside IIFE)'],
    ['openLeadDetail', 'crm-pipeline.js bare call']]) {
    assert('dashboard-actions keeps window.' + n + ' re-export (' + why + ')',
      new RegExp('window\\.' + n + '\\s*=\\s*' + n + ';').test(dashActions));
  }
  // openMobileCreatePopover is private — no registry entry, no window export.
  assert('openMobileCreatePopover is neither registered nor window-exported (2c-4b private)',
    !/openMobileCreatePopover:\s*openMobileCreatePopover/.test(daRegBlock)
      && !/window\.openMobileCreatePopover\s*=/.test(dashActions));

  // ── Tranche 2c-4c: the dashboard-actions.js one-off compound-rewrite openers ──
  // Third slice: 20 markup-dispatched openers (incl. the 2c-4b mobile-routing
  // tail mCreateFabRoute/mQuickAddRoute) wrapped in one in-file IIFE. All
  // REGISTER_ONLY — register in __NBD_CALL_REGISTRY, leave the allowlist, no
  // window re-export. NOTE: hardResetTest/gstaticTest are dispatched from
  // GENERATED markup (dashboard-load-status-banner.js), so the dashboard.html
  // data-fn wiring audit below can't see them — these registry assertions are
  // their ONLY guard against a silent dead button.
  const T2C4C_NAMES = [
    'openDailyProgramFromMore', 'mCreateFabRoute', 'mQuickAddRoute',
    'restartOnboardingTour', 'openDecisionPicker', 'openD2DOrGo',
    'clearAccentTheme', 'openSettingsTab', 'openPhotoEngineOrClickProxy',
    'openReportGenerator', 'enrichReportData', 'openPhotoEngineCurrentLead',
    'openInspectionBuilderCurrentLead', 'closeInspectionBuilder',
    'hideFollowUpAlerts', 'goToD2DFromMaps', 'openCalBookingUrl',
    'hardResetTest', 'gstaticTest', 'modeLineDraw'];
  for (const n of T2C4C_NAMES) {
    assert('dashboard-actions registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4c)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4c — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-actions no longer defines window.' + n + ' (2c-4c off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*function').test(dashActions));
  }

  // ── Tranche 2c-4d: the dashboard-actions.js daily-program config cluster ──
  // Cluster + its callers (goTo settings-hook + DOMContentLoaded handler)
  // IIFE-wrapped. 3 registered; dsRemoveFloor WINDOW_ONLY (bare-called at
  // dashboard-ui.js:2208); 3 helpers private. The load-time typeof-guarded
  // ds* re-export block is deleted (would read undefined post-wrap).
  const T2C4D_REG = ['dsAddFloor', 'dsSaveConfig', 'dsResetDefaults'];
  for (const n of T2C4D_REG) {
    assert('dashboard-actions registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4d)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4d — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-actions no longer defines window.' + n + ' = ' + n + ' (2c-4d off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*' + n + '\\b').test(dashActions));
  }
  assert('dashboard-actions keeps window.dsRemoveFloor re-export (dashboard-ui.js:2208 bare call)',
    /window\.dsRemoveFloor = dsRemoveFloor;/.test(dashActions));
  assert('the load-time typeof-guarded ds* re-export block is gone (2c-4d)',
    !/typeof dsAddFloor!==/.test(dashActions) && !/typeof dsResetDefaults!==/.test(dashActions));
  for (const n of ['dsGetConfig', 'dsLoadConfig', 'dsDefaultFloors']) {
    assert(n + ' is private (2c-4d — not registered, not window-exported)',
      !new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock)
        && !new RegExp('window\\.' + n + '\\s*=').test(dashActions));
  }

  // ── Tranche 2c-4e: the dashboard-actions.js customer-page handoff cluster ──
  // 4 openers registered + off window; _stashLeadForCustomerPage WINDOW_ONLY
  // (7 typeof-guarded widget callers) keeps its export inside the wrap.
  const T2C4E_REG = ['openPhotosForLead', 'openDocsForLead', 'openFullCustomerDetails', 'editCardDetails'];
  for (const n of T2C4E_REG) {
    assert('dashboard-actions registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4e)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(daRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4e — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-actions no longer defines window.' + n + ' = ' + n + ' (2c-4e off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*' + n + '\\b').test(dashActions));
  }
  assert('dashboard-actions keeps window._stashLeadForCustomerPage re-export (7 widget callers)',
    /window\._stashLeadForCustomerPage = _stashLeadForCustomerPage;/.test(dashActions));

  // ── Tranche 2c-4g: dashboard-ui.js leaf handlers (the DISPATCHER file) ──
  // `function X` → `const X = function` (off window in this non-IIFE-wrapped
  // classic script) + registered in the file's own __NBD_CALL_REGISTRY block.
  // The 3 converted names are pure leaf UI handlers — none touches the resolver
  // / delegate / allowlist machinery that also lives in this file.
  const T2C4G_NAMES = ['cycleKanbanDensity', 'nbdComfortSetWhisperHotkey', 'nbdComfortSetWhisperKey'];
  const duRegBlock = (ui.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  for (const n of T2C4G_NAMES) {
    assert('dashboard-ui registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4g)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(duRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4g — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-ui no longer exposes window.' + n + ' (2c-4g off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*' + n + '\\b').test(ui));
  }
  // setKanbanDensity is the MUST-STAY sibling (auto-global backing + no clean
  // wrap-free form) — keeps BOTH its allowlist entry and window re-export.
  assert('setKanbanDensity keeps its allowlist entry + window export (2c-4g MUST-STAY)',
    /'setKanbanDensity'/.test(stateSrc) && /window\.setKanbanDensity = setKanbanDensity;/.test(ui));

  // ── Tranche 2c-4h: dashboard-ui.js Slice H1 (9 cal/photo/template leaves) ──
  // Same file + mechanism as 2c-4g: `function X` → `const X = function` (off
  // window in this non-IIFE classic script) + registered in the file's own
  // __NBD_CALL_REGISTRY block, allowlist entry dropped. All 9 are bare
  // auto-globals living ONLY in dashboard-ui.js with zero cross-file callers
  // (21-agent audit 2026-07-08). Reuses duRegBlock from the 2c-4g check above.
  const T2C4H_NAMES = ['saveCalSettings', 'updateCalEmbed', 'copyCalLink',
    'shareCalViaSMS', 'shareCalViaEmail', 'filterPhotoLeads', 'tlToggleCat',
    'tlFilterCat', 'handleDocUpload'];
  for (const n of T2C4H_NAMES) {
    assert('dashboard-ui registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4h)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(duRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4h — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-ui no longer exposes window.' + n + ' (2c-4h off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*' + n + '\\b').test(ui));
  }

  // ── Tranche 2c-4h Slice H2: dashboard-ui.js entangled names (6 of 10) ──
  // 6 names single-defined in dashboard-ui.js whose only entanglement was
  // forward-ref `window.X = X` re-export shims in maps.js + dashboard-actions.js
  // (those defeated the off-window move until removed in the SAME slice — the
  // shim resolves the name via the shared global lexical scope). `function X` →
  // `const X` + registered here; both shim sets deleted; allowlist dropped. The
  // other 4 H2 names (property-intel twins) are Slice H2 part 2 (a dedup +
  // property-intel.js ownership migration, not a shim removal).
  const T2C4H2_NAMES = ['spyglassSearch', 'spyglassGoToLocation', 'fabToggle',
    'quickStormCheck', 'openUploadDoc', 'printDoc'];
  const mapsSrc = read(path.join(PRO_JS, 'maps.js'));
  for (const n of T2C4H2_NAMES) {
    assert('dashboard-ui registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4h H2)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(duRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4h H2 — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('maps.js no longer re-exports window.' + n + ' (2c-4h H2 shim removed)',
      !new RegExp('window\\.' + n + '\\s*=').test(mapsSrc));
    assert('dashboard-actions no longer re-exports window.' + n + ' (2c-4h H2 shim removed)',
      !new RegExp('window\\.' + n + '\\s*=').test(dashActions));
  }
  // damagNearMe stays functional — the maps.js alias still assigns from the
  // spyglassGoToLocation const via the global lexical scope (must NOT be deleted).
  assert('maps.js keeps window.damagNearMe = spyglassGoToLocation (lexical-scope alias)',
    /window\.damagNearMe = spyglassGoToLocation;/.test(mapsSrc));

  // ── Tranche 2c-4h Slice H2 part 2: property-intel twin dedup (4 of 10) ──
  // The selective-pull cluster was byte-identical in dashboard-ui.js AND
  // property-intel.js (the latter loads last → already won on window). The
  // dashboard-ui.js twins are DELETED; property-intel.js is the sole owner and
  // registers them in ITS OWN __NBD_CALL_REGISTRY block; the dashboard-actions.js
  // forward-ref shims + allowlist entries are dropped.
  const T2C4H_PI_NAMES = ['pullIntelForModal', 'updatePropertyIntelCost',
    'confirmPropertyIntelPull', 'executePullPropertyIntel'];
  const piSrc = read(path.join(PRO_JS, 'property-intel.js'));
  const piRegBlock = (piSrc.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  for (const n of T2C4H_PI_NAMES) {
    assert('property-intel registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4h H2 pt2)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(piRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4h H2 pt2 — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-ui.js twin deleted — no `function ' + n + '` remains (2c-4h H2 pt2)',
      !new RegExp('function ' + n + '\\b').test(ui));
    assert('dashboard-actions no longer re-exports window.' + n + ' (2c-4h H2 pt2)',
      !new RegExp('window\\.' + n + '\\s*=').test(dashActions));
    assert('property-intel no longer window-exports ' + n + ' (off window, registry-only)',
      !new RegExp('window\\.' + n + '\\s*=').test(piSrc));
  }
  // ── Tranche 2c-4f: the dashboard-bootstrap.module.js settings cluster ──
  // First NON-dashboard-actions module in this tranche, and a real ES module —
  // so the 15 markup-dispatched settings/debug/export handlers just move from
  // window.X to a single __NBD_CALL_REGISTRY block (no IIFE). Three MUST-STAY
  // names keep BOTH window export + allowlist (self-read / ui.js cross-file);
  // loadSampleData also stays (dashboard-actions.js:913 exports its own twin).
  const T2C4F_NAMES = ['runLeadAction', 'retryLoadLeads', 'copyDebugInfo',
    'testFirestoreRules', '_saveSettings', '_saveNotifSettings', '_saveCompanySettings',
    '_testNotif', '_resetEstimateDefaultsV2', '_saveSiteSlug', '_saveCompanyProfileSettings',
    '_resetCompanyProfileSettings', '_exportAllData', '_exportEstimates', '_exportPhotos'];
  const bootReg = read(path.join(PRO_JS, 'dashboard-bootstrap.module.js'));
  const bootRegBlock = (bootReg.match(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/) || ['', ''])[1];
  for (const n of T2C4F_NAMES) {
    assert('dashboard-bootstrap registers ' + n + ' in __NBD_CALL_REGISTRY (2c-4f)',
      new RegExp('\\b' + n + ':\\s*' + n + '\\b').test(bootRegBlock));
    assert('allowlist no longer carries ' + n + ' (2c-4f — registry replaced it)',
      !new RegExp("'" + n + "'").test(stateSrc));
    assert('dashboard-bootstrap no longer exposes window.' + n + ' (2c-4f off window)',
      !new RegExp('window\\.' + n + '\\s*=\\s*' + n + '\\b').test(bootReg));
  }
  // MUST-STAY: still window-exported in the module AND still allowlisted.
  for (const [n, why] of [['_saveEstimateDefaultsV2', 'intra-module self-read'],
    ['_loadCompanySettings', 'ui.js:965-966'], ['_loadCompanyProfileSettings', 'ui.js:971-972']]) {
    assert('dashboard-bootstrap keeps window.' + n + ' (' + why + ')',
      new RegExp('window\\.' + n + '\\s*=').test(bootReg) && new RegExp("'" + n + "'").test(stateSrc));
  }

  // The resolver's window fallback is allowlist-gated; keep state ahead of
  // dashboard-ui in the defer queue so the gate exists when dispatch runs.
  const dashRaw = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard.html loads dashboard-state.js before dashboard-ui.js',
    dashRaw.indexOf('js/dashboard-state.js') !== -1
      && dashRaw.indexOf('js/dashboard-state.js') < dashRaw.indexOf('js/dashboard-ui.js'));

  // (d) FULL wiring audit — every markup-dispatched name in dashboard.html
  // must be resolvable: quoted in dashboard-state.js (allowlist/toggle/
  // modal maps) or registered in some __NBD_CALL_REGISTRY block under
  // docs/pro/js/. New markup wired to an unlisted, unregistered name is a
  // silently dead control (the delegate returns early).
  const registered = new Set();
  for (const file of fs.readdirSync(PRO_JS)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(PRO_JS, file), 'utf8');
    for (const m of src.matchAll(/Object\.assign\(window\.__NBD_CALL_REGISTRY,\s*\{([\s\S]*?)\}\);/g)) {
      for (const k of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) registered.add(k[1]);
    }
  }
  const dispatchNames = new Set();
  // data-enter-action is included: its keydown delegate (dashboard-ui.js) now
  // resolves registry-first via _nbdResolveCall, so an enter-action name that is
  // neither allowlisted nor registered is a silent dead control on Enter — the
  // exact gap that hid the spyglassSearch Enter-key regression (Tranche 2c-4h H2).
  for (const m of dashRaw.matchAll(/data-(?:fn|on-change|on-input|on-after|enter-action)="([A-Za-z_$][\w$]*)"/g)) {
    dispatchNames.add(m[1]);
  }
  const unresolved = [...dispatchNames].filter(n => !registered.has(n) && stateSrc.indexOf("'" + n + "'") === -1);
  assert('every markup-dispatched name in dashboard.html is allowlisted or registered — '
      + (unresolved.slice(0, 5).join(', ') || 'clean'), unresolved.length === 0);
  assert('wiring audit saw the real markup surface (sanity floor)', dispatchNames.size > 150);
}

section('Mobile lead detail — Estimate opens the lead; Activity shows estimates');
{
  const actions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  const widgets = read(path.join(PRO_JS, 'dashboard-widgets.js'));
  const css = read(path.join(ROOT, 'docs/pro/css/dashboard-app.css'));

  // Phase 1c: the ESTIMATE quick-action STAYS on the customer — it switches to
  // the embedded Estimates tab instead of closing the overlay and navigating to
  // the generic est view. The pre-1c version guessed at "the newest estimate for
  // this lead" and opened the full-screen builder, so a customer with two
  // estimates could only ever reach one of them from this button.
  const mJdAct = actions.slice(actions.indexOf('function _mJdAct('),
                              actions.indexOf('window._mJdAct = _mJdAct'));
  assert('_mJdAct estimate case switches to the embedded Estimates tab',
    /case 'estimate'[\s\S]{0,900}_mJdSwitchTab\('estimates'\)/.test(mJdAct));
  assert('_mJdAct estimate case no longer closes the overlay or navigates away',
    !/case 'estimate'[\s\S]{0,900}(closeMobileJobDetail\(\)|goTo\('est'\))/.test(mJdAct));
  assert('_mJdAct estimate case no longer relies on the dead _currentEstimateLeadId global',
    !/_currentEstimateLeadId/.test(mJdAct));

  // A specific estimate row is tappable via a registered call target.
  assert('_mJdOpenEstimate defined + registered (CSP-safe row open)',
    /function _mJdOpenEstimate\(estimateId\)[\s\S]{0,1200}viewEstimate\(estimateId\)/.test(actions) &&
    /_mJdOpenEstimate: _mJdOpenEstimate/.test(actions));

  // Bug A: openMobileJobDetail now populates the Activity tab (was a static
  // "No activity yet" stub) with the lead's estimates + stage history.
  const openFn = widgets.slice(widgets.indexOf('function openMobileJobDetail'),
                               widgets.indexOf('window.openMobileJobDetail'));
  assert('openMobileJobDetail builds the Activity list from estimates + stageHistory',
    /mJdTabActivity/.test(openFn) &&
    /m-jd-act-list/.test(openFn) &&
    /data-fn="_mJdOpenEstimate"/.test(openFn) &&
    /lead\.stageHistory/.test(openFn));
  assert('Activity list toggles the empty-state message',
    /emptyEl\.hidden = items\.length > 0/.test(openFn));
  // Uses in-memory data (no new Firestore reads on open).
  assert('Activity list reads window._estimates in-memory (no extra query)',
    /window\._estimates \|\| \[\]/.test(openFn));

  assert('m-jd Activity item styling present',
    /\.m-jd-act-item\{/.test(css) && /\.m-jd-act-list\{/.test(css));
}

section('Embedded per-customer estimate hub (CustomerEstimateHub)');
{
  const hub = read(path.join(PRO_JS, 'customer-estimate-hub.js'));
  const actions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  const widgets = read(path.join(PRO_JS, 'dashboard-widgets.js'));

  // ── The tab exists on BOTH dashboard twins, wired to the already-registered
  //    _mJdSwitchTab (no new call-registry entry needed).
  for (const page of ['dashboard.html', 'dashboard.legacy.html']) {
    const html = read(path.join(ROOT, 'docs/pro', page));
    assert(`${page}: Estimates tab button dispatches _mJdSwitchTab('estimates')`,
      /data-tab="estimates"[^>]*data-fn="_mJdSwitchTab" data-arg="estimates"/.test(html));
    assert(`${page}: #mJdTabEstimates panel exists for the hub to mount into`,
      /id="mJdTabEstimates"[^>]*role="tabpanel"/.test(html));
    assert(`${page}: loads customer-estimate-hub.js`,
      /customer-estimate-hub\.js/.test(html));
  }

  // ── Tab routing + lazy mount.
  assert('_mJdSwitchTab maps the estimates tab to #mJdTabEstimates',
    /estimates:'mJdTabEstimates'/.test(actions));
  assert('hub mounts lazily on the first switch to the Estimates tab',
    /if \(tab === 'estimates'\) _mountEstimateHub\(\);/.test(actions));
  assert('_mountEstimateHub mounts for the CURRENT overlay lead',
    /function _mountEstimateHub\(\)[\s\S]{0,700}window\._cardDetailLeadId[\s\S]{0,700}CustomerEstimateHub\.mount\(host, leadId/.test(actions));
  // Missing module must degrade to a message, never throw into the tab switch.
  assert('_mountEstimateHub degrades gracefully when the module is absent',
    /if \(!window\.CustomerEstimateHub\)[\s\S]{0,220}return;/.test(actions));

  // ── Stale-customer guard: opening lead B must never show lead A's money.
  const openFn = widgets.slice(widgets.indexOf('function openMobileJobDetail'),
                               widgets.indexOf('window.openMobileJobDetail'));
  assert('openMobileJobDetail unmounts the hub when the lead changes',
    /CustomerEstimateHub\.leadId\(\) !== leadId[\s\S]{0,120}\.unmount\(\)/.test(openFn));

  // ── Live refresh: the snapshot rebuild repaints the hub, and the hook sits
  //    ABOVE renderEstimatesList's estListWrap early-return (the CRM route has
  //    no wrapper, and that's exactly where the hub is used).
  const idxHook = widgets.indexOf('CustomerEstimateHub.isMounted()');
  const idxBail = widgets.indexOf("if (!wrap) return;");
  assert('renderEstimatesList refreshes a mounted hub', idxHook !== -1);
  assert('hub refresh hook precedes the estListWrap early-return', idxHook !== -1 && idxHook < idxBail);

  // ── Every action is wired to a REAL handler, not a stub. This is the whole
  //    point of the wave: the button did nothing but navigate before.
  for (const [act, fn] of [
    ['assign',    'assignEstimateAction'],
    ['archive',   'deleteEstimateAction'],
  ]) {
    assert(`hub '${act}' action calls ${fn}`,
      new RegExp(`case '${act}':\\s*withEstimates\\('${fn}'`).test(hub));
  }
  // 'duplicate' deliberately no longer routes through duplicateEstimateAction.
  // That path's _duplicateEstimate sets `leadId = null` so the copy can be
  // assigned from the dashboard estimates list — correct THERE, wrong here: this
  // hub lists BY leadId, so the copy was filtered straight out and the rep got a
  // "✓ Estimate duplicated" toast over an unchanged list. The hub now duplicates
  // and attaches to its own lead. See tests/estimate-hub-controls.test.js.
  assert("hub 'duplicate' uses the lead-attaching local handler",
    /case 'duplicate':\s*doDuplicate\(id\);/.test(hub)
    && /function doDuplicate\(id\)/.test(hub));
  assert("hub 'new' action opens the V2 builder prefilled with the lead",
    /function newEstimate\(\)[\s\S]{0,200}openEstimateV2Builder', \[\{ leadId: _leadId \}\]/.test(hub));
  assert('hub edit keeps V2 in-context and only navigates for Classic',
    /if \(isV2\(est\)\)[\s\S]{0,200}openEstimateV2Builder[\s\S]{0,300}goTo\('est'\)/.test(hub));
  // The estimate engine is lazy — actions must load the bundle, not no-op.
  assert('hub actions load the lazy estimates bundle before firing',
    /function withEstimates\([\s\S]{0,700}ScriptLoader\.loadBundle\('estimates'\)/.test(hub));
  assert('hub skips lazy-stub functions rather than calling them',
    /__nbdLazyEstimateStub/.test(hub));

  // ── make-primary write contract (mirrors customer-bootstrap setPrimaryEstimate):
  //    money fields ONLY. Switching which estimate counts is not a funnel event.
  const mp = hub.slice(hub.indexOf('function makePrimary('), hub.indexOf('function onClick('));
  assert('makePrimary writes jobValue + primaryEstimateId + lastEstimateAt',
    /jobValue: newVal[\s\S]{0,120}primaryEstimateId: estId[\s\S]{0,120}lastEstimateAt/.test(mp));
  assert('makePrimary NEVER touches stage or stageRole',
    !/stageRole|\bstage:/.test(mp));
  assert('makePrimary confirms before zeroing a live job value with a $0 draft',
    /newVal <= 0[\s\S]{0,200}ask\(/.test(mp));
  assert('makePrimary repaints the kanban (cards read lead.jobValue)',
    /renderLeads\(window\._leads/.test(mp));
  assert('makePrimary logs a communications note for the customer timeline',
    /type: 'note'[\s\S]{0,400}source: 'primary_switch'/.test(mp));

  // ── CSP + XSS: delegated listener only, every interpolation escaped.
  assert('hub has zero inline handlers',
    !/\son[a-z]+\s*=\s*["']/.test(hub) && !/javascript:/.test(hub));
  assert('hub routes clicks through one delegated data-ceh-act listener',
    /data-ceh-act/.test(hub) && /addEventListener\('click'/.test(hub));
  // Customer/estimate names are stored-XSS sources (public lead intake).
  assert('hub escapes the estimate title and customer name',
    /esc\(titleOf\(est\)\)/.test(hub) && /esc\(custName\)/.test(hub));
  assert('hub URL-encodes the address into the maps link',
    /encodeURIComponent\(addr\)/.test(hub));

  // ── Both estimate shapes render (V2 rows / Classic lineItems), same bug the
  //    preview sheet fixed — a V2 doc must not read as "$0, no lines".
  assert('hub normalizes V2 rows AND Classic lineItems',
    /est\.rows/.test(hub) && /est\.lineItems/.test(hub));
  assert('hub reads grandTotal | total | amount for the money figure',
    /grandTotal != null[\s\S]{0,140}est\.amount/.test(hub));
  // The strip must show the LEAD's jobValue (what pipeline/KPIs read), not a
  // recomputed sum that could disagree with the kanban card.
  assert('hub money strip shows lead.jobValue, not a recomputed sum',
    /var jobValue = Number\(lead\.jobValue\)/.test(hub));

  const css = read(path.join(ROOT, 'docs/pro/css/dashboard-app.css'));
  assert('4-tab job-detail still uses the flex tab row (no fixed 3-tab width)',
    /\.m-jd-tab\{[\s\S]{0,80}flex:1/.test(css));
}

section('Customer-surface sweep — blockers caught in review (regression pins)');
{
  const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // ── 1. Job Value round-trip. The field is type="number"; assigning a legacy
  //    display string ("$45,000") to it makes the browser sanitize .value to '',
  //    so an unrelated save then wrote jobValue:0 over a live deal. BOTH ends of
  //    the round-trip must strip.
  const editModal = read(path.join(PRO_JS, 'customer-edit-modal.js'));
  assert('edit-modal SEEDS Job Value as a bare number (legacy "$45,000" survives)',
    /replace\(\/\[\^0-9\.\\-\]\/g, ''\)[\s\S]{0,200}getElementById\('editJobValue'\)\.value =/.test(editModal));
  assert('edit-modal WRITES Job Value as a number, never a raw string',
    /jobValue: parseFloat\(String\(document\.getElementById\('editJobValue'\)\.value\)\.replace/.test(editModal));
  const custHtml = read(path.join(ROOT, 'docs/pro/customer.html'));
  assert('Job Value input is type="number"',
    /id="editJobValue"[^>]*type="number"|type="number"[^>]*id="editJobValue"/.test(custHtml));

  // ── 2. Lightbox handshake. setLightboxSource is a CURSOR SETTER — it displays
  //    nothing. Returning early on it left the lightbox permanently closed, and
  //    the arg order (url, desc, arr, idx) into a (srcArray, idx) setter nulled
  //    the source, forcing the ‹ › arrows back onto the wrong customer's array.
  const tasksUi = read(path.join(PRO_JS, 'customer-tasks-ui.js'));
  // Comments in this function NAME setLightboxSource while explaining the
  // ordering rule, so the ordering check has to run against code only.
  const openLb = decomment(tasksUi.slice(tasksUi.indexOf('window.openPhotoLightbox = function'),
                                         tasksUi.indexOf('window.openPhotoLightbox = function') + 1900));
  assert('openPhotoLightbox DISPLAYS before handing over the cursor',
    openLb.indexOf("classList.add('active')") !== -1 &&
    openLb.indexOf('setLightboxSource') !== -1 &&
    openLb.indexOf("classList.add('active')") < openLb.indexOf('setLightboxSource'));
  assert('openPhotoLightbox calls the setter with (srcArray, idx) — its real signature',
    /setLightboxSource\(srcArray, Number\(idx\) \|\| 0\)/.test(openLb));
  assert('openPhotoLightbox locks body scroll (pairs with the canonical closeLightbox reset)',
    /document\.body\.style\.overflow = 'hidden'/.test(openLb));
  const bootstrap = read(path.join(PRO_JS, 'customer-bootstrap.module.js'));
  assert('setLightboxSource really is a two-arg cursor setter',
    /window\.setLightboxSource = function\(srcArray, idx\)/.test(bootstrap));
  assert('exactly one closeLightbox definition survives (the one that unlocks scroll)',
    (read(path.join(PRO_JS, 'customer-tasks-ui.js')).split('window.closeLightbox =').length - 1) === 0
    && (bootstrap.split('window.closeLightbox =').length - 1) === 1);

  // ── 3. _mJdShare lives on the DASHBOARD, where customer-portal.js is never
  //    loaded — so PortalLinkHelpers.resolveUrl/copyForLead throw 'Portal module
  //    not loaded'. It must mint through the dashboard's own callable path.
  const actions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  const share = decomment(actions.slice(actions.indexOf('function _mJdShare()'),
                                        actions.indexOf('function _mJdAct(')));
  assert('_mJdShare mints via _mintPortalUrl (works on the dashboard)',
    /window\._mintPortalUrl\(id\)/.test(share));
  assert('_mJdShare does NOT use the customer-page-only PortalLinkHelpers minter',
    !/PortalLinkHelpers\.(resolveUrl|copyForLead)/.test(share));
  assert('_mJdShare still prefers the OS share sheet',
    /navigator\.share\(\{[\s\S]{0,200}url: portal/.test(share));
  assert('_mJdShare treats an AbortError as a dismissal, not a failure',
    /err\.name === 'AbortError'/.test(share));
  assert('_mJdShare records the share (feeds fresh pulse / stale-shares / engagement)',
    /recordShare\(id, 'share'\)/.test(share));
  const api = read(path.join(PRO_JS, 'dashboard-api.js'));
  // Scope to the minter's own body — _sharePortalLink sits directly below it
  // and legitimately does use the clipboard.
  const minter = decomment(api.slice(api.indexOf('window._mintPortalUrl = async function'),
                                     api.indexOf('window._sharePortalLink = async function')));
  assert('_mintPortalUrl is side-effect free (no clipboard/SMS/share-record in the minter)',
    minter.length > 0 &&
    !/navigator\.clipboard|window\.open\(|recordShare|showToast/.test(minter) &&
    /return location\.origin \+ '\/pro\/portal\.html\?token='/.test(minter));
  for (const page of ['dashboard.html', 'dashboard.legacy.html']) {
    assert(`${page} still does NOT load customer-portal.js (the minter must not depend on it)`,
      !/customer-portal\.js/.test(read(path.join(ROOT, 'docs/pro', page))));
  }

  // ── 4. The mobile quick-action bar must NOT send on tap. smsForLead mints a
  //    portal link, composes a fixed body and POSTs to Twilio with no preview —
  //    an irreversible customer-facing send behind a button labelled "Text".
  const qab = read(path.join(PRO_JS, 'customer-quick-action-bar.js'));
  assert('quick-action bar Text/Email open the OS composer, never auto-send',
    /href="sms:\$\{escapeAttr\(phone\)\}"/.test(qab) &&
    /href="mailto:\$\{escapeAttr\(email\)\}"/.test(qab));
  assert('quick-action bar does not call the auto-sending portal helpers',
    !/(smsForLead|emailForLead)/.test(decomment(qab)));
}

section('Embedded per-customer photo hub (CustomerPhotoHub)');
{
  const hub = read(path.join(PRO_JS, 'customer-photo-hub.js'));
  const actions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  const widgets = read(path.join(PRO_JS, 'dashboard-widgets.js'));
  const engine = read(path.join(PRO_JS, 'photo-engine.js'));

  // "Does this file CALL X" assertions must not match X appearing in a comment
  // that explains why the file deliberately does NOT call it. These modules
  // carry long rationale headers, so strip comments before those checks.
  const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hubCode = decomment(hub);

  // ── The PHOTOS action must STAY on the customer, like the estimate action.
  const mJdAct = actions.slice(actions.indexOf('function _mJdAct('),
                               actions.indexOf('window._mJdAct = _mJdAct'));
  assert("_mJdAct photos case switches to the embedded Photos tab",
    /case 'photos':[\s\S]{0,700}_mJdSwitchTab\('photos'\)/.test(mJdAct));
  assert("_mJdAct photos case no longer closes the overlay or navigates to the photos view",
    !/case 'photos':[\s\S]{0,700}(closeMobileJobDetail\(\)|goTo\('photos'\))/.test(mJdAct));
  // The dead handoff global that navigation used is no longer WRITTEN here
  // (nbdSelectPhotoLead still owns it for the standalone photos view).
  assert('_mJdAct no longer sets the _currentPhotoLeadId handoff global',
    !/_currentPhotoLeadId\s*=/.test(decomment(mJdAct)));

  assert('hub mounts lazily on the first switch to the Photos tab',
    /if \(tab === 'photos'\) _mountPhotoHub\(\);/.test(actions));
  assert('_mountPhotoHub mounts for the CURRENT overlay lead',
    /function _mountPhotoHub\(\)[\s\S]{0,700}window\._cardDetailLeadId[\s\S]{0,700}CustomerPhotoHub\.mount\(host, leadId/.test(actions));
  assert('_mountPhotoHub degrades gracefully when the module is absent',
    /function _mountPhotoHub[\s\S]{0,400}if \(!window\.CustomerPhotoHub\)[\s\S]{0,220}return;/.test(actions));

  // ── The old read-only grid is GONE from openMobileJobDetail; the hub owns
  //    that tab. Re-adding it would resurrect the un-tappable thumbnails.
  const openFn = widgets.slice(widgets.indexOf('function openMobileJobDetail'),
                               widgets.indexOf('window.openMobileJobDetail'));
  assert('openMobileJobDetail no longer paints the dead read-only photo grid',
    !/m-jd-photo-grid/.test(openFn));
  assert('openMobileJobDetail unmounts the photo hub when the lead changes',
    /CustomerPhotoHub\.leadId\(\) !== leadId[\s\S]{0,120}\.unmount\(\)/.test(openFn));

  // ── Both dashboards load it.
  for (const page of ['dashboard.html', 'dashboard.legacy.html']) {
    const html = read(path.join(ROOT, 'docs/pro', page));
    assert(`${page}: loads customer-photo-hub.js`, /customer-photo-hub\.js/.test(html));
  }

  // ── The tab is a WORKSPACE, not a gallery: every control does real work.
  for (const [act, marker] of [
    ['camera', 'doCamera'],
    ['upload', 'doUpload'],
    ['cover',  'doCover'],
    ['tag',    'doTag'],
    ['delete', 'doDelete'],
  ]) {
    assert(`hub '${act}' action is wired to ${marker}`,
      new RegExp(`case '${act}':\\s*${marker}\\(`).test(hub));
  }
  // Tiles are buttons now, not inert <img> — the reported dead-control.
  assert('photo tiles are tappable buttons carrying a photo id',
    /class="cph-tile[\s\S]{0,120}data-cph-act="open" data-cph-id="/.test(hub));

  // ── The photo engine is lazy; every engine-backed action must load it first.
  assert('hub loads the lazy photos bundle before engine calls',
    /function ensureEngine\([\s\S]{0,300}ScriptLoader\.loadBundle\('photos'\)/.test(hub));
  assert('hub camera/upload/delete/tag all route through ensureEngine',
    (hub.match(/ensureEngine\(\)\.then/g) || []).length >= 4);

  // ── Cover contract mirrors customer-tasks-ui.js: BOTH the id and the
  //    denormalized url, toggle-to-clear. Every consumer reads coverPhotoUrl.
  const cover = hub.slice(hub.indexOf('function doCover('), hub.indexOf('function doTag('));
  assert('cover write sets coverPhotoId AND the denormalized coverPhotoUrl',
    /coverPhotoId: id, coverPhotoUrl: url/.test(cover));
  assert('cover is toggle-to-clear (second tap nulls both fields)',
    /coverPhotoId: null, coverPhotoUrl: null/.test(cover));
  assert('cover repaints the kanban (card thumb strip reads coverPhotoUrl)',
    /renderLeads\(window\._leads/.test(cover));
  // A deleted photo must not remain the lead's cover.
  assert('deleting the cover photo clears the cover',
    /coverPhotoId === id\) clearCover/.test(hub));

  // ── Mutations keep _photoCache authoritative rather than re-querying:
  //    PhotoEngine.getPhotosForLead is userId-only and would NARROW a team
  //    member's view, so it must NOT be used as the hub's refresh path.
  assert('hub renders from the team-scoped window._photoCache',
    /window\._photoCache\[_leadId\]/.test(hubCode));
  assert('hub does not refresh via the userId-only getPhotosForLead',
    !/getPhotosForLead|getPhotosForReport/.test(hubCode));

  // ── Safety.
  assert('hub has zero inline handlers',
    !/\son[a-z]+\s*=\s*["']/.test(hubCode) && !/javascript:/.test(hubCode));
  assert('hub refuses non-http photo urls (no javascript: into src/href)',
    /function safeUrl\([\s\S]{0,200}\^https\?:\\\/\\\//.test(hub));
  assert('hub escapes interpolated photo fields',
    /esc\(sel\.description/.test(hub) && /esc\(p\.id\)/.test(hub));

  // ── Tenancy: uploads must be visible to teammates. The dashboard's photo
  //    cache queries userId==me OR companyId==my tenant; uploads that stamped
  //    only userId were invisible to every teammate.
  assert('photo uploads stamp companyId for team visibility',
    /companyId: window\._userClaims\.companyId/.test(engine));
  assert('companyId is omitted (not null) when the user has no company claim',
    /window\._userClaims && window\._userClaims\.companyId[\s\S]{0,120}: \{\}/.test(engine));
}

section('Load-status banner yields to full-screen overlays (max-z occlusion)');
{
  // The banner is fixed bottom-right at z-index 2147483646 — above EVERY
  // overlay in the app. A browser occlusion sweep (390x844) caught it
  // sitting on the V2 builder's mobile step bar, blocking the "② Items"
  // button and the live grand total; the same corner holds modal primary
  // actions generally. It must suppress itself while an overlay is open.
  const src = read(path.join(PRO_JS, 'dashboard-load-status-banner.js'));
  assert('_overlayOpen covers the builder, preview sheet, presentation + modals',
    /function _overlayOpen\(\)[\s\S]{0,600}#estV2Modal\.open[\s\S]{0,300}nbd-ep-overlay[\s\S]{0,300}v2Present[\s\S]{0,300}\.modal-bg\.open/.test(src));
  assert('_render bails early (hidden) while an overlay is open',
    /if \(_overlayOpen\(\)\) \{\s*if \(banner\) banner\.style\.display = 'none';/.test(src));
  // Hiding must not burn the 30s auto-dismiss clock — otherwise the banner
  // silently expires behind a modal and the rep never sees the retry.
  assert('auto-dismiss clock holds while suppressed',
    /if \(_overlayOpen\(\)\)[\s\S]{0,200}if \(_shownAt\) _shownAt = Date\.now\(\);/.test(src));
  // Suppression only — never a permanent dismiss, so it returns on close.
  assert('suppression does not set the user-dismissed flag',
    !/if \(_overlayOpen\(\)\)[\s\S]{0,200}_dismissedByUser = true/.test(src));
}

section('Storm Proof button: works before the lazy storm bundle loads');
{
  // The card-detail 🛡️ Storm Proof button dispatches data-action="call"
  // data-fn="verifyStormProofForLead", but the real function rides the lazy
  // 'storm' bundle — reachable-from-CRM taps hit an unresolved registry key
  // and the delegate no-ops silently (the reported dead button). The eager
  // stub in dashboard-actions.js must load the bundle on first tap.
  const actions = read(path.join(PRO_JS, 'dashboard-actions.js'));
  assert('eager stub loads the storm bundle then delegates to StormIntegration',
    /async function verifyStormProofForLeadLazy\(\)[\s\S]{0,900}ScriptLoader\.loadBundle\('storm'\)[\s\S]{0,600}StormIntegration\.verifyStormProofForLead\(\)/.test(actions));
  assert('stub registered under the button\'s data-fn name',
    /verifyStormProofForLead: verifyStormProofForLeadLazy,/.test(actions));
  const storm = read(path.join(PRO_JS, 'storm-integration.js'));
  assert('storm-integration replaces the stub with the real registration on load',
    /Object\.assign\(window\.__NBD_CALL_REGISTRY, \{\s*verifyStormProofForLead: verifyStormProofForLead\s*\}\)/.test(storm));
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('card-detail button dispatches via data-action=call (CSP-safe)',
    /data-action="call" data-fn="verifyStormProofForLead"/.test(dashHtml));
}

section('Metrics audit F1-F9: one honest definition per number');
{
  const widgets = read(path.join(PRO_JS, 'dashboard-widgets.js'));
  const api = read(path.join(PRO_JS, 'dashboard-api.js'));
  const crm = readCrm();
  const kpi = read(path.join(PRO_JS, 'analytics-kpi.js'));
  const ea = read(path.join(PRO_JS, 'estimate-analytics.js'));
  const rep = read(path.join(PRO_JS, 'rep-report-generator.js'));
  const d2d = read(path.join(PRO_JS, 'd2d-tracker-core-2026b.js'));

  // F1 — the "Pipeline Value" tile belongs to renderLeads alone. The old
  // estimate-sum write in renderEstimatesList was masked by boot ordering
  // and resurfaced on every live estimates-snapshot repaint.
  const rel = widgets.slice(widgets.indexOf('function renderEstimatesList'),
                            widgets.indexOf('function renderEstimatesList') + 2200);
  assert('F1: renderEstimatesList never writes #statVal',
    !/getElementById\('statVal'\)/.test(rel));

  // F2 — CRM pipeline value counts deals still in play only; a dollar lives
  // in exactly one bucket (pipeline until closed, closedRev after).
  assert('F2: pipeVal excludes closed/won money (active only)',
    /if\(!isLost && !isClosed\) pipeVal\+=v;/.test(crm));

  // F3 — close-date attribution uses stageStartedAt, not the updatedAt
  // proxy that re-attributed old closes to whatever month you last touched
  // the record.
  assert('F3: analytics-kpi attributes monthly revenue by stageStartedAt',
    /toJSDate\(l\.stageStartedAt \|\| l\.updatedAt\)/.test(kpi));
  assert('F3: rep report has a stageStartedAt-first stageDate helper',
    /const stageDate = \(lead\) => toDate\(lead\.stageStartedAt \|\| lead\.updatedAt \|\| lead\.createdAt\)/.test(rep));
  assert('F3: rep report core KPIs decide won/lost by stageDate',
    /const decidedInRange = leads\.filter\(l =>\s*inRange\(stageDate\(l\)/.test(rep));

  // F4 — leaderboard attributes by the lead's OWNER, and the viewer's knock
  // count lands on the viewer's own row (not "first rep in object order").
  const lb = api.slice(api.indexOf('async function renderLeaderboard'),
                       api.indexOf('async function renderLeaderboard') + 4200);
  assert('F4: leaderboard groups by lead.userId (owner), not display name',
    /const owner = l\.userId \|\| '\(unknown\)'/.test(lb)
    && !/const n = l\.repName \|\| window\._user/.test(lb));
  assert('F4: viewer\'s knocks land on the viewer\'s own row',
    /reps\[uid\]\.knocks = knockCount/.test(lb));

  // F4 follow-up (first-run audit 2026-07-28): the knocks enrichment used
  // to materialize the viewer's row unconditionally, which handed a
  // brand-new tenant a gold medal at 0 leads / 0 knocks and made the
  // authored empty state below it dead code.
  assert('leaderboard: viewer row is only materialized when knocks exist',
    /if \(knockCount > 0\) \{[\s\S]{0,400}if \(!reps\[uid\]\) reps\[uid\][\s\S]{0,300}reps\[uid\]\.knocks = knockCount;[\s\S]{0,50}\}/.test(lb));
  assert('leaderboard: no unconditional viewer-row insert after the knocks query',
    !/knockCount = snap\.size;\s*\n\s*if \(!reps\[uid\]\)/.test(lb));
  assert('leaderboard: zero-data empty state exists and is reachable',
    /No data yet\. Close deals to appear on the leaderboard/.test(lb));

  // F5 — viewed counts every opened estimate; View→Sign numerator is a
  // strict subset of its denominator (can't exceed 100%).
  assert('F5: viewed counted across all buckets + signedViewed numerator',
    /if \(viewedMs\) out\.viewed\+\+;/.test(ea)
    && /if \(viewedMs\) out\.signedViewed\+\+;/.test(ea)
    && /out\.signedViewed \/ out\.viewed/.test(ea)
    && /_pct\(s\.signedViewed, s\.viewed\)/.test(ea));

  // F6 — lost estimates stay in the close-rate denominator (no survivor bias).
  assert('F6: estimate close rate includes lost in the denominator',
    /out\.signed \/ \(out\.sent \+ out\.signed \+ out\.lost\)/.test(ea)
    && /_pct\(s\.signed, s\.sent \+ s\.signed \+ s\.lost\)/.test(ea));

  // F7 — the mobile KPI row's overdue count skips in-production leads, same
  // as the CRM's #12 definition.
  assert('F7: overdueFollowUps skips job-role leads',
    /if \(_isDecided\(l\) \|\| _isJob\(l\) \|\| !l\.followUp\) return false;/.test(kpi));

  // F8 — in-production (job role) money is closed-won everywhere, never
  // "active pipeline".
  assert('F8: analytics-kpi active pipeline excludes job-role leads',
    /return !_isDecided\(l\) && !_isJob\(l\) && !l\.deleted;/.test(kpi));
  assert('F8: analytics-kpi counts won OR job as closed-won',
    /function _isClosedWon\(l\) \{ return _isWon\(l\) \|\| _isJob\(l\); \}/.test(kpi));
  assert('F8: rep report isWon is role-aware (won or job)',
    /return r === 'won' \|\| r === 'job';/.test(rep));

  // F9 — expected-value calibration: dispo weights blend the static priors
  // with this tenant's own observed outcomes (Beta shrinkage), and the deal
  // size falls back D2D closes → CRM won average → industry default.
  assert('F9: calibratedDispoWeights blends observed outcomes with priors',
    /function calibratedDispoWeights\(\)/.test(d2d)
    && /CALIBRATION_PRIOR_STRENGTH = 12/.test(d2d)
    && /\(s\.won \+ out\[k\] \* CALIBRATION_PRIOR_STRENGTH\)\s*\/ \(s\.decided \+ CALIBRATION_PRIOR_STRENGTH\)/.test(d2d));
  assert('F9: pipeline valuation uses the calibrated weights',
    /const calibrated = calibratedDispoWeights\(\);/.test(d2d)
    && /pipelineValue \+= \(dispoWeights\[k\.disposition\] \|\| 0\) \* dealValue/.test(d2d));
  assert('F9: deal size averages ALL closes with CRM-won fallback',
    /const allClosedKnocks = state\.knocks\.filter\(k => k\.closedDealValue > 0\)/.test(d2d)
    && /const dealValue = avgDealSize \|\| crmAvgDeal \|\| DEFAULT_JOB_VALUE;/.test(d2d));
  assert('F9: revenue metrics expose calibration provenance',
    /dealValueSource: avgDealSize \? 'd2d-closes' : \(crmAvgDeal \? 'crm-won-avg' : 'default'\)/.test(d2d)
    && /calibratedDispos: calibrated\.calibratedCount/.test(d2d));
}

section('Search job cards: palette phone/email search + RoofLink-style result rows');
{
  const cp  = read(path.join(ROOT, 'docs/pro/js/command-palette.js'));
  const crm = read(path.join(ROOT, 'docs/pro/js/crm-pipeline.js'));

  // Phone search — digits vs digits, 3-digit floor, prefers the
  // canonical phoneDigits key with raw-phone fallback.
  assert('palette matches phone by normalized digits (3-digit floor, phoneDigits||phone)',
    /const qDigits = q\.replace\(\/\\D\/g, ''\)/.test(cp)
    && /qDigits\.length >= 3/.test(cp)
    && /l\.phoneDigits \|\| l\.phone/.test(cp)
    && /digits\.includes\(qDigits\)\) fuzzy = Math\.max\(fuzzy, 80\)/.test(cp));
  assert('palette matches email substring (3-char floor)',
    /email && email\.includes\(qLower\)\) fuzzy = Math\.max\(fuzzy, 70\)/.test(cp));

  // Job-card context — every source best-effort behind window guards.
  assert('lead rows carry card context: stage label/role color, jobType meta, thumb, value, assignee',
    /window\.stageLabel/.test(cp)
    && /window\.stageRole/.test(cp)
    && /_ROLE_COLORS\[role\]/.test(cp)
    && /window\.JOB_TYPE_META && lead\.jobType/.test(cp)
    && /window\._photoCache && window\._photoCache\[lead\.id\]/.test(cp)
    && /window\._repNames \|\| window\._teamNames/.test(cp));
  assert('photo thumb only renders http(s) URLs',
    /photos\.find\(p => \/\^https\?:\/i\.test\(String\(\(p && p\.url\) \|\| ''\)\)\)/.test(cp));
  assert('card rows render stage dot + chips, escaped, with compact fallback for actions',
    /const c = item\.card;/.test(cp)
    && /width:7px;height:7px;border-radius:50%/.test(cp)
    && /escHtml\(c\.thumb\)/.test(cp) && /escHtml\(c\.stage\)/.test(cp) && /escHtml\(c\.jobType\)/.test(cp));

  // CRM board search bar gets the same digit-normalized phone matching.
  assert('kanbanFilter matches digit-normalized phone with 3-digit floor',
    /const searchDigits = search\.replace\(\/\\D\/g, ''\)/.test(crm)
    && /searchDigits\.length >= 3 && phoneDigits\.includes\(searchDigits\)/.test(crm)
    && /l\.phoneDigits \|\| l\.phone/.test(crm));

  // Cache-bust: markup must load the upgraded palette.
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard loads command-palette v2+',
    /js\/command-palette\.js\?v=([2-9]|\d{2,})/.test(dash));
}

section('Canonical estimate money reader ships with its consumers');
{
  // customer-estimate-rows.js owns estimateValue() — the ONE reader that maps
  // both estimate shapes (V2 grandTotal / Classic total|amount) to a number.
  // Its consumers all guard with `window.NBDCustomerEstimateRows && ...` and
  // fall back to a weaker inline ladder, which makes a missing <script> tag
  // invisible: nothing throws, the numbers just quietly come out low or zero.
  //
  // It was loaded ONLY on customer.html, so every consumer on both dashboard
  // pages ran the fallback — including invoice-pipeline (a money path) and the
  // embedded estimate hub, whose ★ Primary button writes lead.jobValue, the
  // value the kanban $, KPIs and leaderboard all read.
  //
  // So: any page loading a consumer must also load the reader, BEFORE it.
  const CONSUMERS = [
    'customer-estimate-hub.js',
    'invoice-pipeline.js',
    'dashboard-widgets.js',
  ];
  const PAGES = ['docs/pro/dashboard.html', 'docs/pro/dashboard.legacy.html', 'docs/pro/customer.html'];

  for (const page of PAGES) {
    const html = read(path.join(ROOT, page));
    const used = CONSUMERS.filter((c) => html.includes(c));
    if (!used.length) continue;
    const readerAt = html.indexOf('customer-estimate-rows.js');
    assert(`${page} loads the canonical reader (consumers: ${used.join(', ')})`,
      readerAt > -1,
      'without it these consumers silently fall back to a weaker money ladder');
    // Order matters for the same reason nbd-url.js loads before its callers:
    // a consumer that runs first sees window.NBDCustomerEstimateRows undefined.
    for (const c of used) {
      assert(`${page} loads the reader before ${c}`,
        readerAt > -1 && readerAt < html.indexOf(c),
        'defer scripts execute in document order — a later reader is too late');
    }
  }

  // The hub keeps a local fallback for the case where the reader is absent.
  // It must parse display strings the way numFrom() does; Number('$14,500')
  // is NaN and collapses to 0, which is how a live deal gets zeroed.
  const hub = read(path.join(PRO_JS, 'customer-estimate-hub.js'));
  assert('hub totalOf prefers the canonical reader',
    /NBDCustomerEstimateRows[\s\S]{0,120}estimateValue/.test(hub));
  assert('hub totalOf fallback strips commas instead of Number()-ing a display string',
    /match\(\/-\?\\d\[\\d,\]\*\\\.\?\\d\*\//.test(hub) && /replace\(\/,\/g, ''\)/.test(hub));

  // Classic docs carry their value on `amount`; a ladder that stops at
  // grandTotal|total scores them 0 and drops the "· $X" suffix entirely.
  const dw = read(path.join(PRO_JS, 'dashboard-widgets.js'));
  assert('job-detail activity reads Classic `amount`, not just grandTotal|total',
    /estimateValue\(e\)/.test(dw) && /e\.amount/.test(dw));
}

section('First-run tour: anchors resolve + direction-aware skip (first-run audit 2026-07-28)');
{
  // The tour's "Tap the orange + button" tooltip floated centered with no
  // spotlight because every selector in the step-3 anchor list was
  // unresolvable (wrong id, CSP-dead [onclick*=], position:fixed rejected
  // by the offsetParent visibility test). These pins guard the three
  // contracts that prevent a recurrence.
  const tour = read(path.join(PRO_JS, 'onboarding-tour.js'));
  const pages = {
    'docs/pro/dashboard.html': read(path.join(ROOT, 'docs/pro/dashboard.html')),
    'docs/pro/dashboard.legacy.html': read(path.join(ROOT, 'docs/pro/dashboard.legacy.html')),
  };

  // (a) every #id anchor in the tour must exist in BOTH dashboard pages —
  // the exact class of markup drift that caused the defect.
  const anchorLiterals = [...tour.matchAll(/anchor:\s*'([^']+)'/g)].map((m) => m[1]);
  assert('tour declares anchored steps', anchorLiterals.length >= 2);
  for (const literal of anchorLiterals) {
    for (const sel of literal.split(',').map((s) => s.trim()).filter(Boolean)) {
      // (b) CSP sweep: no on*= attributes exist anywhere under /pro, so an
      // [onclick*=...] anchor can never resolve — ban the pattern outright.
      assert(`tour anchor "${sel}" is not an [onclick sniff (CSP: no on*= attrs)`,
        !sel.includes('[onclick'));
      const idMatch = sel.match(/^#([A-Za-z0-9_-]+)$/);
      if (!idMatch) continue;
      for (const [page, html] of Object.entries(pages)) {
        assert(`tour anchor #${idMatch[1]} exists in ${page}`,
          html.includes(`id="${idMatch[1]}"`));
      }
    }
  }
  // The one non-#id anchor (desktop Settings gear) must keep matching too.
  for (const [page, html] of Object.entries(pages)) {
    assert(`tour Settings anchor (.hdr-tool[data-target="settings"]) matches markup in ${page}`,
      /class="hdr-tool[^"]*"[^>]*data-target="settings"/.test(html));
  }

  // (c) visibility contract: findAnchor must judge visibility by layout box
  // + computed style — offsetParent is null for position:fixed elements
  // that ARE visible (the FAB, the mobile bottom nav) and non-null for
  // visibility:hidden ones.
  const fa = tour.slice(tour.indexOf('function findAnchor'),
                        tour.indexOf('function findAnchor') + 1100);
  assert('tour: findAnchor visibility uses rect + computed style',
    /getBoundingClientRect\(\)/.test(fa) && /getComputedStyle\(/.test(fa));
  assert('tour: findAnchor no longer relies on offsetParent',
    !/offsetParent/.test(tour));

  // (d) skip contract: an anchored step whose anchor can't be found is
  // skipped in the direction of travel (never rendered as a floating
  // centered tooltip). Loose regex on intent, not mechanism.
  const rs = tour.slice(tour.indexOf('function renderStep'),
                        tour.indexOf('function renderStep') + 1600);
  assert('tour: renderStep skips unresolvable anchored steps in the travel direction',
    /while\s*\(STEPS\[_stepIdx\][\s\S]{0,260}findAnchor\(STEPS\[_stepIdx\]\.anchor\)\)[\s\S]{0,160}_stepIdx \+= _dir/.test(rs));
  // Backward exhaustion clamps to step 0 — which therefore must stay an
  // unanchored placement:'center' step or the skip loop loses its
  // guaranteed landing spot.
  const firstStep = tour.slice(tour.indexOf('const STEPS = ['),
                               tour.indexOf('const STEPS = [') + 500);
  assert('tour: step 0 stays unanchored + centered (backward-skip clamp target)',
    /anchor:\s*null/.test(firstStep) && /placement:\s*'center'/.test(firstStep));

  // Public API unchanged — dashboard-actions' restartOnboardingTour guards
  // on forceRestart existing.
  assert('tour: public API start/stop/forceRestart intact',
    /window\.OnboardingTour = \{\s*start,\s*stop: complete,\s*forceRestart/.test(tour));
}

};
