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
      'js/academy-insurance-tree.js?v=1',
      'js/academy-retail-tree.js?v=1',
      'js/academy-courses.js?v=1',
      'js/academy-admin.js?v=2',
      'js/real-deal-academy-lab.js?v=1',
      'js/real-deal-academy.js?v=2'
    ],
    training: [
      'js/sales-training.js?v=1'
    ],
    storm: [
      'js/storm-center.js?v=1',
      'js/storm-integration.js?v=1'
    ],
    closeboard: [
      'js/close-board.js?v=1'
    ],
    repos: [
      'js/rep-os.js?v=1'
    ],
    decision: [
      'js/decision-engine.js?v=1'
    ],
    reports: [
      'js/rep-report-generator.js?v=4'
    ],
    // Warranty cert wizard — opened from the Docs view only.
    warranty: [
      'js/warranty-cert.js?v=4'
    ]
  };

  // View → bundle mapping. Routes hit by goTo(name) trigger these.
  const VIEW_BUNDLES = {
    docs:        ['warranty'],
    documents:   ['warranty'],
    academy:     ['academy'],
    training:    ['training'],
    storm:       ['storm'],
    closeboard:  ['closeboard'],
    repos:       ['repos'],
    aitree:      ['decision'],
    understand:  ['decision'],
    reports:     ['reports']
  };

  function load(src) {
    if (loaded.has(src)) return Promise.resolve();
    if (pending.has(src)) return pending.get(src);

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
    return bundle.reduce((prev, src) => prev.then(() => load(src)), Promise.resolve());
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
