
  // photo-report.js is LAZY on this page (ScriptLoader 'photos' bundle) as of
  // 2026-09-06. It used to be eager at customer.html:2191 purely to out-race a
  // rival definition of window.generatePhotoReport in
  // customer-photo-report-generator.js — that dead rival is now deleted, so the
  // eager tag went with it. Both customer-page entry points resolve the global
  // by NAME at click time — pickPhotoReport() below, and the "📋 Generate
  // Report" button (customer-bootstrap.module.js:1354, data-action=
  // "generatePhotoReport") — so a load-then-run stub is sufficient. Without it
  // the button is a SILENT no-op: the action dispatcher just logs an unknown
  // action and nothing visible happens.
  //
  // Guarded on typeof so this never clobbers a real implementation (the
  // dashboard installs its own stub in dashboard-actions.js and is unaffected).
  if (typeof window.generatePhotoReport !== 'function') {
    window.generatePhotoReport = function () {
      var args = arguments;
      if (!(window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function')) {
        if (typeof showToast === 'function') showToast('Report module unavailable — refresh and try again', 'error');
        return;
      }
      if (typeof showToast === 'function') showToast('Preparing photo report…', 'info');
      return window.ScriptLoader.loadBundle('photos').then(function () {
        var fn = window.generatePhotoReport;
        // photo-report.js overwrites the global on arrival; if it is still the
        // stub, the fetch failed (load() never rejects) — say so rather than recursing.
        if (typeof fn === 'function' && !fn.__nbdLazyPhotoReportStub) return fn.apply(null, args);
        if (typeof showToast === 'function') showToast('Report module failed to load — try again', 'error');
      });
    };
    window.generatePhotoReport.__nbdLazyPhotoReportStub = true;
  }

  window.openPhotoReportPicker = function() {
    if (!window._customerId) {
      if (typeof showToast === 'function') showToast('No customer loaded yet', 'error');
      return;
    }
    window.nbdModal.open('photoReportPicker');
  };
  window.closePhotoReportPicker = function() {
    window.nbdModal.close('photoReportPicker');
  };
  window.pickPhotoReport = function(mode) {
    closePhotoReportPicker();
    if (typeof generatePhotoReport === 'function') {
      generatePhotoReport(window._customerId, mode);
    } else if (typeof showToast === 'function') {
      showToast('Report module not loaded yet — try again in a moment', 'error');
    }
  };
  // Backdrop click + Esc dismiss are handled by nbdModal (batch-4 consolidation).
  // Phase 5: auto-open the picker when arriving from photo-review.html
  // with a #photo-report hash. Defer until _customerId is populated.
  function maybeAutoOpenFromHash() {
    if (window.location.hash !== '#photo-report') return;
    if (!window._customerId) { setTimeout(maybeAutoOpenFromHash, 250); return; }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    openPhotoReportPicker();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(maybeAutoOpenFromHash, 600); });
  } else {
    setTimeout(maybeAutoOpenFromHash, 600);
  }
