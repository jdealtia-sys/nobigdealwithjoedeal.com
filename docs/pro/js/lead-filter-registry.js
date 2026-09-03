// ══════════════════════════════════════════════════════════════
// NBD Pro — lead-filter-registry.js (window.NBDLeadFilters)
//
// THE BUG THIS CLOSES (2026-09-03)
// ───────────────────────────────
// needs-attention-filter.js and stale-shares-filter.js each kept a PRIVATE
// `active` boolean and each wrote the shared board state directly. Their
// deactivate path was:
//
//     if (!active) { window._filteredLeads = null; renderLeads(leads, null); }
//
// — unconditional. So turning Stale Shares OFF cleared the board even when
// Needs Attention was still on, with its button still lit. Both modules then
// re-apply on 'nbd:data-refreshed' AND on their own 60s setInterval, so
// moments later the still-active filter silently re-applied and leads
// disappeared from the pipeline with no user action at all. Two toggles, two
// sources of truth, one shared surface.
//
// That is the kind of bug that makes a rep stop trusting the pipeline count,
// which is worse than the missing leads.
//
// THE FIX
// ───────
// One owner. A filter registers a name, a compute() and a paint-my-button
// callback, and never touches board state again. The registry decides what is
// active, and it is the only thing that calls renderLeads() on their behalf.
//
// Mutual exclusion is deliberate: the UI presents two independent-looking
// toggles over one board, so activating one deactivates the other and says so
// by unlighting its button. (If these ever need to compose, intersect the
// active subsets in apply() — the shape below already localises that decision
// to one function.)
//
// NOTE ON OWNERSHIP OF window._filteredLeads: renderLeads() in crm-pipeline.js
// already sets that global from its own second argument. The filter modules
// were ALSO assigning it, which is what made "who owns this?" unanswerable.
// This registry never assigns it — it passes `filtered` to renderLeads and
// lets the one existing owner keep owning it.
// ══════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (window.NBDLeadFilters) return; // single owner

  // name -> { compute(): Array, paint(active: boolean): void }
  const filters = new Map();
  let activeName = null;

  function paintAll() {
    filters.forEach(function (f, name) {
      try { f.paint(name === activeName); }
      catch (e) { console.error('[lead-filters] paint failed for ' + name, e); }
    });
  }

  // The single place board state changes. `subset` null means "no filter".
  function render(subset) {
    if (typeof window.renderLeads !== 'function') return;
    // renderLeads(leads, null) is the documented "unfiltered" call and is what
    // resets window._filteredLeads. Passing undefined would mean the same
    // thing to it, but null is explicit about intent at the call site.
    window.renderLeads(window._leads, subset);
  }

  function computeFor(name) {
    const f = filters.get(name);
    if (!f) return null;
    try { return f.compute() || []; }
    catch (e) {
      console.error('[lead-filters] compute failed for ' + name, e);
      return [];
    }
  }

  const api = {
    /**
     * @param {string} name
     * @param {{compute: function(): Array, paint: function(boolean): void}} impl
     */
    register: function (name, impl) {
      if (!name || !impl || typeof impl.compute !== 'function') return;
      filters.set(name, {
        compute: impl.compute,
        paint: typeof impl.paint === 'function' ? impl.paint : function () {},
      });
      // A filter that registers after another is already active must paint
      // itself OFF rather than inherit a stale lit button from a re-init.
      try { impl.paint(name === activeName); } catch (_) {}
    },

    isActive: function (name) { return activeName === name; },
    activeFilter: function () { return activeName; },

    /** Turn `name` on, turning off whatever else was on. */
    activate: function (name) {
      if (!filters.has(name)) return;
      activeName = name;
      const subset = computeFor(name);
      render(subset);
      paintAll();
      return subset;
    },

    /**
     * Turn `name` off — but ONLY if it is the one that is on. This guard is
     * the whole point of the registry: an inactive filter asking to
     * deactivate used to blank the board out from under the active one.
     */
    deactivate: function (name) {
      if (activeName !== name) { paintAll(); return; }
      activeName = null;
      render(null);
      paintAll();
    },

    toggle: function (name) {
      if (activeName === name) api.deactivate(name);
      else api.activate(name);
      return activeName === name;
    },

    /**
     * Data changed underneath us (a refresh, or a poll). Recompute ONLY the
     * active filter. A filter that is off must never reach the board here —
     * that was the silent re-apply.
     * @returns {Array|null} the recomputed subset, or null when nothing is on
     */
    refresh: function () {
      if (!activeName) { paintAll(); return null; }
      const subset = computeFor(activeName);
      render(subset);
      paintAll();
      return subset;
    },
  };

  window.NBDLeadFilters = api;
})();
