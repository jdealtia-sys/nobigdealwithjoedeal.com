/**
 * stale-shares-filter.js — Wave 54 (Stale shares recovery filter)
 *
 * Composes Wave 44's lastSharedAt tracking with the customer-side
 * estimate signals to surface a different kind of recovery list
 * than Almost There (W45). Two distinct follow-up shapes:
 *
 *   Almost There (W45): customer VIEWED an estimate but didn't
 *                       respond → high engagement, ready to close
 *   Stale Shares (W54): customer was SENT the link 5+ days ago
 *                       and either never opened it OR never
 *                       responded → no engagement, needs a nudge
 *
 * Each calls for a different rep posture: Almost There is a
 * 30-second close call; Stale Shares is a "did you have a chance
 * to look at the link I sent you?" check-in.
 *
 * Mirrors the W25 Needs Attention pattern: single header button
 * with a count badge, click toggles a filter, the existing
 * renderLeads(leads, filtered) hook in crm.js handles the rest.
 *
 * Exposes: window.StaleShares.{compute, isActive, toggle, recount}
 *          window.toggleStaleShares (for inline onclick)
 */
(function () {
  'use strict';

  if (window.StaleShares
      && window.StaleShares.__sentinel === 'nbd-stale-shares-v1') return;

  const STALE_SHARE_DAYS = 5;        // shared >=5 days ago = stale
  const TERMINAL_STAGES = new Set([
    'closed', 'lost', 'Lost', 'Complete',
    'final_payment', 'deductible_collected',
  ]);

  let active = false;

  // ─── Helpers ─────────────────────────────────────────────────────
  function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function')   return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }

  function stageKey(lead) {
    if (lead._stageKey) return lead._stageKey;
    if (typeof window.normalizeStage === 'function') return window.normalizeStage(lead.stage);
    return lead.stage || 'new';
  }

  // Returns true when this lead has a "stale share" signal worth
  // recovering. The filter is intentionally narrow:
  //   - lastSharedAt set (rep actually sent something)
  //   - lastSharedAt is at least STALE_SHARE_DAYS old
  //   - No customer-side response (no estimate.respondedAt)
  //   - Skip terminal stages (closed/lost/etc.) and prospects
  //   - Skip snoozed leads (W35 — rep deferred them by design)
  function isStaleShare(lead, estimates, now) {
    if (!lead || lead.deleted || lead.isProspect) return false;
    const sk = stageKey(lead);
    if (TERMINAL_STAGES.has(sk)) return false;
    if (window.LeadSnooze && window.LeadSnooze.isSnoozed(lead)) return false;

    const sharedAt = toMillis(lead.lastSharedAt);
    if (!sharedAt) return false;
    const cutoff = now - STALE_SHARE_DAYS * 86400000;
    if (sharedAt > cutoff) return false; // shared recently — not stale

    // If any of the lead's estimates has been responded to, the
    // customer DID engage — drop out of stale-shares (they belong
    // in Almost There or are already converting).
    if (Array.isArray(estimates)) {
      for (const e of estimates) {
        if (!e || e.leadId !== lead.id) continue;
        if (e.respondedAt) return false;
      }
    }
    return true;
  }

  function compute() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    const now = Date.now();
    return leads.filter(l => isStaleShare(l, estimates, now));
  }

  function count() { return compute().length; }

  // ─── Button rendering / state ───────────────────────────────────
  function updateButton() {
    const btn = document.getElementById('staleSharesBtn');
    const badge = document.getElementById('staleSharesCountBadge');
    if (!btn || !badge) return;
    const c = count();
    badge.textContent = c;
    badge.style.display = c > 0 ? 'inline-block' : 'none';

    if (active) {
      btn.style.background = 'rgba(155,109,255,0.18)';
      btn.style.borderColor = '#9b6dff';
      btn.style.color = '#cab8ff';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
  }

  function applyFilter() {
    if (!active) {
      window._filteredLeads = null;
      window._staleSharesActive = false;
      if (typeof window.renderLeads === 'function') {
        window.renderLeads(window._leads, null);
      }
      updateButton();
      return;
    }
    const subset = compute();
    window._filteredLeads = subset;
    window._staleSharesActive = true;
    if (typeof window.renderLeads === 'function') {
      window.renderLeads(window._leads, subset);
    }
    updateButton();

    if (subset.length === 0 && typeof window.showToast === 'function') {
      window.showToast('No stale shares — every shared link has been responded to or is fresh.', 'success');
    }
  }

  function toggle() {
    active = !active;
    applyFilter();
  }

  function recount() {
    if (active) applyFilter();
    else updateButton();
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    updateButton();
    window.addEventListener('nbd:data-refreshed', recount);
    setInterval(recount, 60_000);
  }

  window.StaleShares = {
    __sentinel: 'nbd-stale-shares-v1',
    compute,
    count,
    isActive: () => active,
    toggle,
    recount,
    isStaleShare,
  };
  window.toggleStaleShares = toggle;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();
