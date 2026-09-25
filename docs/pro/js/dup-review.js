/**
 * dup-review.js — Possible-duplicates review for the pipeline (2026-09-24).
 *
 * LeadDedup (lead-dedup.js) only checks a lead as it is SAVED, so duplicates
 * already in the book were never surfaced (a live review found the same
 * Thumbtack customers entered twice). This scans the loaded leads, groups
 * likely duplicates, and lets the rep resolve each group by hand:
 *   - Open any lead;
 *   - Move a lead to the Deleted bin through the EXISTING deleteLead flow
 *     (its confirm dialog, the soft delete, the restorable bin);
 *   - "Not duplicates" hides that group for good on this device.
 * Nothing is merged or hard-deleted automatically: v1 is review, not repair.
 *
 * Matching reuses LeadDedup.findDuplicates (same phone, same address, or
 * same name on the same street) with one extra guard: Thumbtack hands out
 * masked 669 proxy numbers, so a phone-only match on one of those also has
 * to share a name before it counts.
 *
 * Entry point: Pipeline ••• Tools menu → "Find duplicates"
 * (data-fn="openDupReview", allowlisted in dashboard-state.js).
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['dup-review']) return;
  __NBD_LOADED['dup-review'] = true;

  // Dismissed groups, keyed by their sorted lead ids. Kept through logout
  // (nbd-auth.js KEEP) because re-reviewing the same "not a duplicate"
  // pair after every sign-in is exactly the chore this is meant to end.
  const DISMISS_KEY = 'nbd-dup-dismissed';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _name(l) {
    return ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || l.name || '(no name)';
  }
  function _digits(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
  function _isProxy(l) { return /thumbtack/i.test(String(l.source || '')) && _digits(l.phone).slice(0, 3) === '669'; }
  function _sameName(a, b) {
    const n = (l) => ((l.firstName || '') + ' ' + (l.lastName || '')).trim().toLowerCase().replace(/\s+/g, ' ');
    return !!n(a) && n(a) === n(b);
  }
  function _loadDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch (_) { return new Set(); }
  }
  function _saveDismissed(set) {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch (_) {}
  }
  const _groupKey = (ids) => ids.slice().sort().join('|');

  // Union-find over pairwise matches → groups of 2+ leads. Pure: takes the
  // lead list and the matcher so it can be tested without a DOM.
  function findGroups(leads, findDuplicates) {
    const live = (leads || []).filter((l) => l && l.id && !l.deleted);
    const parent = new Map(live.map((l) => [l.id, l.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const reasons = new Map();
    for (const lead of live) {
      for (const m of findDuplicates(lead, live) || []) {
        const other = m.lead;
        if (!other || !parent.has(other.id)) continue;
        if (m.reason === 'Same phone number' && (_isProxy(lead) || _isProxy(other)) && !_sameName(lead, other)) continue;
        const a = find(lead.id), b = find(other.id);
        if (a !== b) parent.set(a, b);
        const r = find(lead.id);
        if (!reasons.has(r)) reasons.set(r, new Set());
        reasons.get(r).add(m.reason);
      }
    }
    const groups = new Map();
    for (const l of live) {
      const r = find(l.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(l);
    }
    const out = [];
    for (const [root, members] of groups) {
      if (members.length < 2) continue;
      // Reasons were recorded against whichever root existed at the time;
      // collect every reason any member's root ever held.
      const why = new Set();
      for (const [r, set] of reasons) if (find(r) === root) set.forEach((x) => why.add(x));
      out.push({ key: _groupKey(members.map((m) => m.id)), leads: members, reasons: [...why] });
    }
    return out;
  }

  function _fmtDate(v) {
    try {
      const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
      return d && !isNaN(d) ? d.toLocaleDateString() : '';
    } catch (_) { return ''; }
  }

  function _close() {
    const o = document.getElementById('dupReviewOverlay');
    if (o) o.remove();
  }

  function render() {
    const LD = window.LeadDedup;
    let o = document.getElementById('dupReviewOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'dupReviewOverlay';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.setAttribute('aria-label', 'Possible duplicate leads');
      // One below --z-overlay-top (10001): the delete-confirm dialog that
      // "Move to trash" opens must stack ABOVE this review, not under it.
      o.style.cssText = 'position:fixed;inset:0;z-index:calc(var(--z-overlay-top, 10001) - 1);background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;';
      o.addEventListener('click', (e) => {
        if (e.target === o) { _close(); return; }
        const t = e.target.closest && e.target.closest('[data-dup-act]');
        if (!t) return;
        const act = t.getAttribute('data-dup-act');
        if (act === 'close') _close();
        else if (act === 'trash' && typeof window.deleteLead === 'function') {
          // The existing confirm dialog + soft delete + Deleted bin. The list
          // refreshes when the bin write lands (nbd:data-refreshed).
          window.deleteLead(t.getAttribute('data-id'));
        } else if (act === 'dismiss') {
          const set = _loadDismissed();
          set.add(t.getAttribute('data-key'));
          _saveDismissed(set);
          render();
        }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _close(); });
      document.body.appendChild(o);
    }
    if (!LD || typeof LD.findDuplicates !== 'function') {
      o.innerHTML = '<div style="background:var(--s);color:var(--t);border-radius:12px;padding:20px;max-width:520px;">Duplicate check isn\'t loaded yet. Try again in a moment. <button data-dup-act="close" class="btn btn-ghost">Close</button></div>';
      return;
    }
    if (!window._leadsLoaded && !(window._leads || []).length) {
      o.innerHTML = '<div style="background:var(--s);color:var(--t);border-radius:12px;padding:20px;max-width:520px;">Leads are still loading. Try again in a moment. <button data-dup-act="close" class="btn btn-ghost">Close</button></div>';
      return;
    }
    const dismissed = _loadDismissed();
    const groups = findGroups(window._leads || [], LD.findDuplicates).filter((g) => !dismissed.has(g.key));

    const card = (l, key) => {
      const open = '/pro/customer?id=' + encodeURIComponent(l.id);
      return '<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-top:1px solid var(--br);flex-wrap:wrap;">'
        + '<div style="min-width:0;flex:1 1 200px;">'
        +   '<div style="font-weight:700;color:var(--t);overflow-wrap:anywhere;">' + _esc(_name(l)) + '</div>'
        +   '<div style="font-size:12px;color:var(--m);overflow-wrap:anywhere;">' + _esc(l.address || 'No address')
        +     ' · ' + _esc(l.phone || 'No phone') + '</div>'
        +   '<div style="font-size:11px;color:var(--m);">' + _esc(l.stage || 'new') + (l.source ? ' · ' + _esc(l.source) : '')
        +     (_fmtDate(l.createdAt) ? ' · added ' + _esc(_fmtDate(l.createdAt)) : '') + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px;">'
        +   '<a class="btn btn-ghost" style="min-height:40px;display:inline-flex;align-items:center;" href="' + open + '">Open</a>'
        +   '<button class="btn btn-ghost" style="min-height:40px;" data-dup-act="trash" data-id="' + _esc(l.id) + '">Move to trash</button>'
        + '</div></div>';
    };
    const body = groups.length
      ? groups.map((g) => '<div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-top:12px;">'
          + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">'
          +   '<div style="font-size:12px;font-weight:700;color:var(--orange);">' + _esc(g.reasons.join(' · ')) + ' — ' + g.leads.length + ' leads</div>'
          +   '<button class="btn btn-ghost" style="min-height:40px;" data-dup-act="dismiss" data-key="' + _esc(g.key) + '">Not duplicates</button>'
          + '</div>'
          + g.leads.map((l) => card(l, g.key)).join('')
          + '</div>').join('')
      : '<div style="padding:18px 0;color:var(--m);">No likely duplicates found. Clean book.</div>';
    o.innerHTML = '<div style="background:var(--s);color:var(--t);border:1px solid var(--br);border-radius:12px;padding:16px;width:100%;max-width:640px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
      +   '<div><div style="font-weight:800;font-size:16px;">Possible duplicates</div>'
      +   '<div style="font-size:12px;color:var(--m);">' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + '. Nothing is merged automatically; trash is restorable from Deleted leads.</div></div>'
      +   '<button class="btn btn-ghost" style="min-height:40px;" data-dup-act="close" aria-label="Close">✕</button>'
      + '</div>' + body + '</div>';
  }

  function openDupReview() {
    const menu = document.getElementById('crmToolsMenu');
    if (menu) menu.classList.remove('open');
    render();
  }
  // Re-render in place when a trash write lands, so the group updates.
  window.addEventListener('nbd:data-refreshed', () => {
    if (document.getElementById('dupReviewOverlay')) render();
  });

  window.openDupReview = openDupReview;
  // Exposed for tests only.
  window.__NBD_DUP_REVIEW = { findGroups };
})();
