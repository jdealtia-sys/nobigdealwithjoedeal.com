/**
 * NBD Pro - Performance Optimization: Script Loader
 * Implements lazy loading for JavaScript modules — load only what's needed per view
 * Replaces brute-force script tag approach with on-demand loading
 *
 * Exposes: window.ScriptLoader
 * Usage:
 *   ScriptLoader.load('js/estimates.js')           // Returns Promise
 *   ScriptLoader.loadBundle('estimates')           // Load bundle by name
 *   ScriptLoader.preloadForView('estimates')       // Load all bundles for a view
 *   ScriptLoader.isLoaded('estimates')             // Check if loaded
 */

(function() {
  'use strict';

  // Track loaded scripts to avoid duplicate loads
  const loadedScripts = new Set();
  const loadingPromises = new Map();

  // Define script bundles
  const bundles = {
    core: [
      'js/crm.js',
      'js/ui.js',
      'js/maps.js'
    ],
    d2d: [
      'js/d2d-tracker.js'
    ],
    estimates: [
      'js/estimates.js',
      'js/advanced_builder_ui.js',
      'js/template_library.js',
      'js/advanced_pdf_generator.js'
    ],
    documents: [
      'js/document-generator.js',
      'js/document-generator-templates.js'
    ],
    themes: [
      'js/theme-engine.js',
      'js/theme-overlays.js',
      'js/theme-sounds.js',
      'js/theme-achievements.js',
      'js/theme-builder.js'
    ],
    academy: [
      'js/academy-insurance-tree.js',
      'js/academy-retail-tree.js',
      'js/academy-courses.js',
      'js/academy-admin.js',
      'js/real-deal-academy.js'
    ],
    reporting: [
      'js/reporting-dashboard.js',
      'js/report-export.js'
    ],
    comms: [
      'js/nbd-comms.js',
      'js/email_system.js',
      'js/email-drip.js'
    ],
    billing: [
      'js/stripe-billing.js'
    ],
    offline: [
      'js/offline-manager.js'
    ],
    push: [
      // push-notifications.js requires type="module" — loaded separately when needed
    ],
    company: [
      'js/company-admin.js'
    ],
    property: [
      'js/property-intel.js'
    ],
    invoice: [
      'js/invoice-pipeline.js'
    ],
    supplier: [
      'js/supplier-pricing.js'
    ],
    insurance: [
      'js/insurance-claim.js'
    ],
    scoring: [
      'js/lead-scoring.js'
    ],
    storm: [
      'js/storm-alerts.js'
    ],
    products: [
      'js/product-library.js'
    ],
    photos: [
      'js/photo-report.js',
      'js/photo-engine.js',
      'js/photo-editor.js'
    ],
    reviews: [
      'js/review-engine.js'
    ],
    gallery: [
      'js/share-gallery.js'
    ],
    ai: [
      'js/claude-proxy.js',
      'js/ai.js',
      'js/ai_review_system.js'
    ],
    inspection: [
      'js/inspection-report-engine.js'
    ],
    materials: [
      'js/material-calculator.js',
      'js/material_catalog.js'
    ],
    tasks: [
      'js/tasks.js'
    ],
    demo: [
      'js/demo.js'
    ],
    analytics: [
      'js/analytics-kpi.js'
    ],
    crew: [
      'js/crew-calendar.js'
    ]
  };

  // Map views to required bundles
  const viewBundles = {
    'home': ['core'],
    'dash': ['core', 'analytics'],
    'pipeline': ['core'],
    'kanban': ['core'],
    'crm': ['core'],
    'd2d': ['core', 'd2d'],
    'est': ['core', 'estimates'],
    'estimates': ['core', 'estimates'],
    'docs': ['core', 'documents'],
    'documents': ['core', 'documents'],
    'academy': ['core', 'academy'],
    'training': ['core', 'academy'],
    'settings': ['core', 'themes', 'billing', 'push', 'company', 'comms'],
    'storm': ['core', 'storm'],
    'photos': ['core', 'photos'],
    'draw': ['core', 'photos'],
    'map': ['core'],
    'products': ['core', 'products'],
    'reports': ['core', 'reporting'],
    'reporting': ['core', 'reporting'],
    'team': ['core', 'company'],
    'invoices': ['core', 'invoice'],
    'insurance': ['core', 'insurance'],
    'scoring': ['core', 'scoring'],
    'reviews': ['core', 'reviews'],
    'tasks': ['core', 'tasks'],
    'crew': ['core', 'crew'],
    'analytics': ['core', 'analytics'],
    'joe': ['ai'],
    'closeboard': ['core'],
    'repos': ['core'],
    'board': ['core'],
    'schedule': ['core', 'crew']
  };

  /**
   * Load a single script file
   * Returns Promise that resolves when script is loaded
   */
  function load(src) {
    // Return cached promise if already loading
    if (loadingPromises.has(src)) {
      return loadingPromises.get(src);
    }

    // Return immediately if already loaded
    if (loadedScripts.has(src)) {
      return Promise.resolve();
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src + (src.includes('?') ? '&' : '?') + 'v=' + Math.random().toString(36).substring(2, 8);
      script.async = true;
      script.defer = false;

      script.onload = function() {
        loadedScripts.add(src);
        loadingPromises.delete(src);
        resolve();
      };

      script.onerror = function() {
        console.warn('[ScriptLoader] Failed to load:', src);
        loadingPromises.delete(src);
        // Don't reject — allow app to continue
        resolve();
      };

      document.head.appendChild(script);
    });

    loadingPromises.set(src, promise);
    return promise;
  }

  /**
   * Load multiple scripts in parallel
   */
  function loadMultiple(srcs) {
    return Promise.all(srcs.map(src => load(src)));
  }

  /**
   * Load a named bundle
   */
  function loadBundle(name) {
    const scripts = bundles[name];
    if (!scripts) {
      console.warn('[ScriptLoader] Unknown bundle:', name);
      return Promise.resolve();
    }
    return loadMultiple(scripts);
  }

  /**
   * Load all bundles for a given view
   */
  function preloadForView(viewName) {
    const bundleNames = viewBundles[viewName];
    if (!bundleNames) {
      console.warn('[ScriptLoader] Unknown view:', viewName);
      return Promise.resolve();
    }

    const allScripts = [];
    bundleNames.forEach(bundleName => {
      const scripts = bundles[bundleName];
      if (scripts) {
        allScripts.push(...scripts);
      }
    });

    return loadMultiple(allScripts);
  }

  /**
   * Check if a bundle is loaded
   */
  function isLoaded(name) {
    const scripts = bundles[name];
    if (!scripts) return false;
    return scripts.every(src => loadedScripts.has(src));
  }

  /**
   * Get list of loaded scripts
   */
  function getLoaded() {
    return Array.from(loadedScripts);
  }

  /**
   * Get bundle definitions (for debugging)
   */
  function getBundles() {
    return Object.assign({}, bundles);
  }

  /**
   * Get view mappings (for debugging)
   */
  function getViewBundles() {
    return Object.assign({}, viewBundles);
  }

  /**
   * Debug helper
   */
  function debug() {
    console.group('ScriptLoader Debug Info');
    console.log('Loaded Scripts:', getLoaded());
    console.log('Available Bundles:', Object.keys(bundles));
    console.log('View Mappings:', getViewBundles());
    console.groupEnd();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.ScriptLoader = {
    load,
    loadMultiple,
    loadBundle,
    preloadForView,
    isLoaded,
    getLoaded,
    getBundles,
    getViewBundles,
    debug,

    // Expose bundles and viewBundles as properties for convenience
    bundles,
    viewBundles
  };

  console.log('[ScriptLoader] Initialized. Load scripts dynamically with:');
  console.log('  ScriptLoader.load(src)');
  console.log('  ScriptLoader.loadBundle(name)');
  console.log('  ScriptLoader.preloadForView(viewName)');
  console.log('Call ScriptLoader.debug() for more info.');

})();
