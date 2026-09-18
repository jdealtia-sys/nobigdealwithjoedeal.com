// Show/hide the insurance overlay based on the mode selector.
// Kept tiny so it runs regardless of script order. It ships as a <script src>
// inside dashboard.html's <template id="tpl-view-est"> and re-executes when
// _hydrateViewTemplate swaps that template in — the registry write below is
// idempotent, so a re-run just re-registers the same function.
//
// Globals Tranche 3 T3-C (2026-09-18): IIFE-wrapped and registry-only — no
// longer a window global. Its two callers both resolve the registry:
// #estMode's data-on-after (dashboard-ui.js _nbdResolveCall, registry-first)
// and dashboard-widgets.js viewEstimate. The Object.assign form is what the
// smoke markup-wiring audit reads to see the data-on-after name as resolvable.
(function () {
  function toggleInsuranceOverlay() {
    var m = document.getElementById('estMode');
    var b = document.getElementById('estInsuranceBlock');
    if (m && b) b.style.display = (m.value === 'insurance') ? 'block' : 'none';
  }
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, { toggleInsuranceOverlay: toggleInsuranceOverlay });
})();
