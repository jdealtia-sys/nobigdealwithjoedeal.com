/**
 * script-loader.js — lazy-load view-specific bundles
 *
 * The dashboard historically eager-loaded ~65 deferred scripts on every
 * page open. Most of those (academy, storm, close-board, rep-os, etc.)
 * are only relevant to one specific view, yet they still cost parse +
 * execution time at first paint.
 *
 * This loader lets us keep the critical boot path lean (crm, home,
 * widgets, auth, maps, ui, ai) while deferring view-only modules until
 * the user actually navigates to that view. Scripts are cached after
 * first load so subsequent visits to a view are instant.
 *
 * The loader is a DROP-IN addition — it does not take over the <script
 * defer> tags. Dashboard.html hooks it into goTo() so each view
 * preload runs before its init callback.
 *
 * Public API:
 *   ScriptLoader.load(src)            → Promise<void> — load one file
 *   ScriptLoader.loadBundle(name)     → Promise<void> — load a named group
 *   ScriptLoader.preloadForView(name) → Promise<void> — load all bundles for a view
 *   ScriptLoader.isLoaded(name)       → boolean
 *   ScriptLoader.markLoaded(src)      → void — mark a src as pre-loaded
 *                                     (for files already in the defer list)
 */
// CSP fix: the Google Fonts preload->stylesheet swap lived in an inline
// onload attribute, which script-src-attr 'none' blocks — so the 14 theme
// font families NEVER applied in prod (every themed surface fell back to
// system fonts). Flip rel from JS instead; load-listener plus a short
// failsafe covers the already-loaded race.
(function () {
  var l = document.querySelector('link[data-nbd-font-swap]');
  if (!l) return;
  var done = false;
  var flip = function () { if (done) return; done = true; l.rel = 'stylesheet'; };
  l.addEventListener('load', flip, { once: true });
  setTimeout(flip, 3000);
})();

(function () {
  'use strict';

  if (window.ScriptLoader && window.ScriptLoader.__sentinel === 'nbd-script-loader-v2') return;

  const loaded = new Set();
  const pending = new Map();

  // Files we ship on-demand. Anything NOT listed here stays in the
  // eager <script defer> list in dashboard.html. Each bundle is a
  // list of files that load together (parallel fetch).
  const BUNDLES = {
    // Academy / training — never loaded unless the user enters an
    // academy or training tab. Biggest single lazy win (~150KB).
    academy: [
      'js/academy-insurance-tree-data.js?v=1',
      'js/academy-insurance-tree.js?v=2',
      'js/academy-retail-tree.js?v=1',
      'js/academy-courses.js?v=1',
      'js/academy-admin.js?v=2',
      'js/real-deal-academy-lab.js?v=1',
      'js/real-deal-academy.js?v=2'
    ],
    training: [
      // Step 4f (2026-05-17): sales-training.js split into engine +
      // ui modules + thin shim. Load order: engine → ui → shim.
      'js/sales-training-engine.js?v=1',
      'js/sales-training-ui.js?v=2',
      'js/sales-training.js?v=2'
    ],
    storm: [
      'js/storm-center.js?v=1',
      'js/storm-integration.js?v=1'
    ],
    closeboard: [
      'js/close-board.js?v=1'
    ],
    // Expenses & supplier-spend view — only loaded on the Expenses tab.
    // expense-config.js (the shared category/money source of truth) MUST load
    // before expenses.js, which reads window.ExpenseConfig at render time.
    // profit-tracker.js is NOT loaded anywhere else on dashboard.html (only
    // customer.html loads it), and expenses.js's per-job margin calls
    // window.ProfitTracker.computeJobPLWithExpenses at render — so it must ride
    // this bundle or the margin silently degrades to "set Job Value".
    expenses: [
      'js/expense-config.js?v=1',
      'js/profit-tracker.js?v=1',
      'js/expenses.js?v=1'
    ],
    // Money / P&L capstone — self-contained (reads doc fields directly, no
    // ExpenseConfig dependency), so it's a single-module bundle.
    money: [
      'js/money-dashboard.js?v=1'
    ],
    repos: [
      'js/rep-os.js?v=1'
    ],
    decision: [
      'js/decision-engine.js?v=1'
    ],
    reports: [
      // ApexCharts must load BEFORE rep-report-generator.js, which calls
      // `new ApexCharts(...)` when the Rep Report view renders its charts.
      // It was eager in dashboard.html (~150 KB gzipped on every boot);
      // PR 2a moved it here so it loads only when the reports view opens.
      // loadBundle() runs entries sequentially (async=false), so the
      // ApexCharts global is defined before the generator executes. If the
      // CDN fetch fails, load() resolves anyway and the generator's existing
      // `typeof ApexCharts === 'undefined'` guard degrades gracefully.
      '/assets/vendor/apexcharts/apexcharts.min.js',
      'js/rep-report-generator.js?v=4'
    ],
    // Doc-generation cluster (PR 2b). Only needed when the rep generates a
    // document — from a lead-card doc chip (_generateDocWithPreflight) or
    // inside the Docs view. ~420 KB off the boot path. Order matters:
    // nbd-logo-asset + document-generator define the globals that
    // document-generator-templates augments and doc-preflight consumes.
    docgen: [
      'js/nbd-logo-asset.js?v=2',
      'js/document-generator.js?v=7',
      'js/document-generator-templates.js?v=7',
      'js/doc-preflight.js?v=1'
    ],
    // Estimate engine (PR 2c). The revenue-critical builder + its product/
    // catalog data. Only needed when the rep builds an estimate, opens the
    // Estimates/Products view, or the estimate-defaults settings tab. ~530 KB
    // off the boot path. ORDER IS load-bearing and verified by
    // tests/e2e/estimate-engine.spec.js (snapshot: 222 products / 298 merged
    // catalog keys / 270 xactimate):
    //   product-data → roofivent-catalog (merges into NBD_PRODUCTS) →
    //   catalog-costs (merges the private cost/labor half back in) →
    //   product-library (reads NBD_* + defines _productLib, before estimates.js) →
    //   estimate-builder-v2 (defines EstimateBuilderV2.CATALOG) BEFORE
    //   estimate-catalog-xactimate (merges 270 items into that CATALOG at load) →
    //   estimates (window.R, startNewEstimate) → finalization → v2-ui (last).
    // estimate-config, review-engine, property-intel stay EAGER.
    //
    // catalog-costs MUST sit between the catalogs and product-library: the
    // catalog files no longer carry cost/labor (they are public files on a
    // public repo), and product-library seeds localStorage synchronously at
    // load. Its cache-first pass patches window.NBD_PRODUCTS in time on any
    // device that has hydrated before; the async fetch behind it calls
    // _productLib.applyCostSeed for the cold-device case.
    //
    // catalog-costs ALSO feeds the job-template custom-item bridge
    // (2026-08-18). job-templates-data.js no longer carries the 84 custom
    // items' materialCost/laborCost either; job-templates.js reads them from
    // NBDCatalogCosts.jobItem() at its own load time. It sits fourteen entries
    // BELOW catalog-costs here, so on a warm device the book is already in
    // memory when registerAllCustomItems() runs; on a cold device
    // catalog-costs calls JobTemplates.applyJtCostSeed() once Firestore
    // answers, which re-registers every item and drops the UI band cache.
    // 'job-templates': ['estimates'] below is the ONLY entry point, so there
    // is no page where job templates load without the cost book.
    estimates: [
      'js/product-data.js?v=2',
      'js/roofivent-catalog.js?v=2',
      'js/catalog-costs.js?v=2',
      'js/product-library.js?v=4',
      'js/estimate-labor-catalog.js?v=1',
      'js/estimate-builder-v2.js?v=5',
      'js/estimate-catalog-xactimate.js?v=1',
      'js/estimate-logic-engine.js?v=5',
      'js/estimates.js?v=7',
      // Rock 2 PR 6: the New-Estimate front door (chooser) split out of
      // estimates.js. Loads after it — showNewEstimateChooser falls back to
      // estimates.js's showEstimateTypeSelector when V2 is missing.
      'js/estimate-entry.js?v=1',
      // Rock 2 PR 6: the estimates-list row actions (Firestore CRM ops, no
      // pricing math) split out of estimates.js.
      'js/estimate-crm-ops.js?v=1',
      'js/estimate-finalization.js?v=2',
      'js/estimate-v2-ui.js?v=14',
      'js/estimate-supplement.js?v=1',
      'js/supplement-ui.js?v=1',
      // Job templates ride the estimates bundle: data is inert, the engine
      // resolves through EstimateLogic + registers custom items into
      // EstimateBuilderV2.CATALOG (so it must load after both), and the UI
      // inserts into the V2 builder — end-of-bundle satisfies all three.
      // entity-resolver.js (the lead search/quick-create picker) must load
      // before job-templates-ui.js, which calls it from paintModal.
      'js/job-templates-data.js?v=2',
      'js/job-templates.js?v=3',
      'js/entity-resolver.js?v=1',
      'js/job-templates-ui.js?v=4'
    ],
    // Photo + inspection engine (PR 2d). Camera capture / gallery / lightbox /
    // bulk-analyze (photo-engine), the photo-report doc (photo-report), and the
    // inspection report builder (inspection-report-engine). ~200 KB off boot.
    // Only needed on the Photos view or the card-detail photo/camera/inspection
    // buttons. Every consumer guards on the global, and the entry points have
    // load-then-run stubs in dashboard-actions.js, so a click before the bundle
    // loads still works.
    photos: [
      'js/photo-engine.js?v=6',
      'js/inspection-report-engine.js?v=5',
      'js/photo-report.js?v=3'
    ],
    // D2D tracker (PR 2e). The door-to-door knock tracker — only the D2D
    // view uses it. ~180 KB off boot. Load order locked: core publishes
    // window._D2DState, ui extends it, the shim composes window.D2D from both.
    // goTo('d2d')'s existing waitForD2D() poller handles the late load; the one
    // other consumer (crm-pipeline.js) guards on window.D2D. The maps engine
    // stays eager — maps.js doubles as the theme/font appearance engine.
    d2d: [
      'js/d2d-tracker-core-2026b.js?v=5',
      'js/d2d-tracker-ui-2026b.js?v=2',
      'js/d2d-tracker-2026b.js?v=2'
    ],
    // PDF export libs (PR 2b2). jsPDF + html2pdf — ~1.1 MB combined (html2pdf
    // bundles html2canvas + its own jsPDF). The ONLY dashboard consumer is the
    // doc-viewer's "Download PDF" handler (nbd-doc-viewer.js handlePdf), which
    // load-then-runs this bundle on demand. Standalone jsPDF is unused on the
    // dashboard (only customer.html instantiates it) but kept here for safety.
    pdfexport: [
      '/assets/vendor/jspdf/jspdf.umd.min.js',
      '/assets/vendor/html2pdf/html2pdf.bundle.min.js'
    ],
    // Warranty cert wizard — opened from the Docs view only.
    warranty: [
      'js/warranty-cert.js?v=4'
    ],
    // Theme engine cluster (2026-08-07). The 189-theme engine (162 KB) + its
    // four cosmetic companions were eager on every boot; they are a Settings/
    // picker concern. dashboard-state.js kicks this bundle at boot for users
    // with a saved theme (fetch off the parse path); default-theme users load
    // it with the Settings view or the theme picker. Order: engine first —
    // companions read window.ThemeEngine at init. After this bundle resolves,
    // loadBundle() calls window._nbdInitThemeStack (dashboard-ui.js owns the
    // init sequence; the hook is idempotent).
    theme: [
      'js/theme-engine.js?v=2',
      'js/theme-overlays.js?v=1',
      'js/theme-sounds.js?v=1',
      'js/theme-achievements.js?v=1',
      'js/theme-gx.js?v=1'
    ],
    // Leaflet vendor stack (~225 KB, 2026-08-07) — was eager on every boot for
    // a Maps view most sessions never open. Order is load-bearing: plugins
    // extend window.L. Consumers already tolerate late arrival: goTo('map'/
    // 'draw') sits behind waitForLeaflet(), storm-center's initMap self-polls,
    // d2d retries with a friendly failure state, and the two home widgets
    // (weather-radar, territory-mini) load-then-run via widgets.js
    // _withLeaflet. The maps *app* chain (maps-core→…→maps.js) stays eager —
    // maps.js doubles as the theme/font appearance engine.
    mapvendor: [
      '/assets/vendor/leaflet/leaflet.js',
      '/assets/vendor/leaflet-draw/leaflet.draw.js',
      '/assets/vendor/leaflet-heat/leaflet-heat.js',
      '/assets/vendor/leaflet-markercluster/leaflet.markercluster.js'
    ]
  };

  // View → bundle mapping. Routes hit by goTo(name) trigger these.
  const VIEW_BUNDLES = {
    docs:        ['warranty', 'docgen'],
    documents:   ['warranty', 'docgen'],
    est:         ['estimates'],
    products:    ['estimates'],
    'job-templates': ['estimates'],
    photos:      ['photos'],
    d2d:         ['mapvendor', 'd2d'],
    academy:     ['academy'],
    training:    ['training'],
    storm:       ['mapvendor', 'storm'],
    closeboard:  ['closeboard'],
    expenses:    ['expenses'],
    money:       ['money'],
    repos:       ['repos'],
    aitree:      ['decision'],
    understand:  ['decision'],
    reports:     ['reports'],
    map:         ['mapvendor'],
    draw:        ['mapvendor'],
    settings:    ['theme']
  };

  function load(src) {
    if (loaded.has(src)) return Promise.resolve();
    if (pending.has(src)) return pending.get(src);
    // A page may already ship this file as an eager <script> tag
    // (dashboard.legacy.html keeps Leaflet + the theme cluster eager) —
    // never double-inject. If the eager tag is still queued (defer), the
    // consumer's own guard/poll covers the gap, same as a slow fetch.
    try {
      if (document.querySelector('script[src="' + src + '"]')) {
        loaded.add(src);
        return Promise.resolve();
      }
    } catch (e) {}

    const p = new Promise((resolve) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = false; // preserve execution order within a bundle
      el.onload = () => {
        loaded.add(src);
        pending.delete(src);
        resolve();
      };
      el.onerror = () => {
        // Never reject — a missing lazy module shouldn't break the app.
        // Individual views already tolerate missing modules (they log
        // and render an empty state).
        console.warn('[ScriptLoader] failed to load:', src);
        pending.delete(src);
        resolve();
      };
      document.head.appendChild(el);
    });
    pending.set(src, p);
    return p;
  }

  function loadBundle(name) {
    const bundle = BUNDLES[name];
    if (!bundle) return Promise.resolve();
    // Sequential load to preserve dependency order (engine before UI).
    const p = bundle.reduce((prev, src) => prev.then(() => load(src)), Promise.resolve());
    // Theme cluster needs a one-shot init after arrival, whichever path
    // loaded it (boot kick, Settings view, picker). dashboard-ui.js owns
    // the sequence and the hook is idempotent.
    if (name === 'theme') {
      return p.then(() => {
        try { if (window._nbdInitThemeStack) window._nbdInitThemeStack(); } catch (e) {}
      });
    }
    return p;
  }

  function preloadForView(name) {
    const bundleNames = VIEW_BUNDLES[name];
    if (!bundleNames || !bundleNames.length) return Promise.resolve();
    return Promise.all(bundleNames.map(loadBundle));
  }

  function isLoaded(name) {
    if (loaded.has(name)) return true; // raw src
    const bundle = BUNDLES[name];
    if (!bundle) return false;
    return bundle.every(src => loaded.has(src));
  }

  // Let the boot path mark scripts it already included via <script
  // defer> so the loader doesn't fetch them twice if a view asks
  // for them later.
  function markLoaded(src) { loaded.add(src); }

  function debug() {
    console.group('[ScriptLoader]');
    console.log('loaded:', Array.from(loaded));
    console.log('pending:', Array.from(pending.keys()));
    console.log('bundles:', Object.keys(BUNDLES));
    console.log('views:', Object.keys(VIEW_BUNDLES));
    console.groupEnd();
  }

  window.ScriptLoader = {
    __sentinel: 'nbd-script-loader-v2',
    load,
    loadBundle,
    preloadForView,
    isLoaded,
    markLoaded,
    debug,
    bundles: BUNDLES,
    views: VIEW_BUNDLES
  };
})();
