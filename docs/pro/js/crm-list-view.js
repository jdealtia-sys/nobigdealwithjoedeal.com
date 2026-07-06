/**
 * crm-list-view.js — Lean triage list for the pipeline (2026-07-06).
 *
 * Jo's call (option: "lean triage list"): a Board/List toggle on the
 * pipeline, where List is a deliberately LEAN sortable table — the
 * kanban answers "what stage is everything in"; the list answers
 * "what's my biggest deal" and "what haven't I touched longest".
 * Modeled on the Prospects page's kanban/list toggle (prospects.js),
 * the in-product precedent for this exact pattern.
 *
 * Scope contract (v1, deliberate exclusions — see PR discussion):
 *   - NO bulk mode, photo thumbnails, engagement badges, or drag —
 *     those stay kanban-only so the list never becomes a second
 *     feature-parity surface to maintain.
 *   - Stage changes go through the SAME window.moveCard the kanban
 *     drop handler uses, so stage history, gating prompts, and the
 *     lost-reason flow all still fire.
 *   - The list renders the SAME `list` renderLeads narrowed (search,
 *     type filter, job-type view, prospects/snoozed toggles, rep
 *     scoping) — zero filter logic of its own. crm-pipeline.js calls
 *     CrmListView.render(list) at the column-build point when the
 *     mode is active.
 *
 * Mode persists per device in localStorage ('nbd-crm-view-mode');
 * body.crm-list-mode gates visibility CSS-side (kanban stays rendered
 * underneath so toggling back is instant and every renderLeads side
 * effect — stats, counts, badges — keeps running unchanged).
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['crm-list-view']) return;
  __NBD_LOADED['crm-list-view'] = true;

  const LS_KEY = 'nbd-crm-view-mode'; // 'board' (default) | 'list'
  let _sortKey = 'activity';          // name | stage | value | age | activity
  let _sortDir = 1;                   // 1 asc, -1 desc
  let _lastList = [];                 // cache for header-click re-sorts

  function isActive() {
    try { return localStorage.getItem(LS_KEY) === 'list'; } catch (_) { return false; }
  }

  function _applyMode() {
    const active = isActive();
    document.body.classList.toggle('crm-list-mode', active);
    const b = document.getElementById('crmViewBoardBtn');
    const l = document.getElementById('crmViewListBtn');
    if (b) b.classList.toggle('active', !active);
    if (l) l.classList.toggle('active', active);
  }

  function _setMode(mode) {
    try { localStorage.setItem(LS_KEY, mode); } catch (_) {}
    _applyMode();
    // Re-render so the newly-visible surface is fresh. renderLeads
    // re-runs the whole narrowing pipeline and calls back into
    // render() below when list mode is on.
    if (typeof window.renderLeads === 'function') {
      try { window.renderLeads(window._leads, window._filteredLeads); } catch (_) {}
    }
  }

  // data-action="call" entry points (allowlisted in dashboard-state.js)
  window.crmViewBoard = function () { _setMode('board'); };
  window.crmViewList  = function () { _setMode('list'); };

  // ── Row data helpers ─────────────────────────────────────
  function _toDate(v) {
    if (!v) return null;
    if (v.toDate) { try { return v.toDate(); } catch (_) { return null; } }
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function _created(l)  { return _toDate(l.createdAt); }
  function _activity(l) { return _toDate(l.updatedAt) || _toDate(l.createdAt); }
  function _ageDays(d)  { return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; }
  function _name(l) {
    const n = ((l.firstName || '') + ' ' + (l.lastName || '')).trim();
    return n || l.name || '(no name)';
  }
  function _stageKeyOf(l) {
    const norm = window.normalizeStage;
    return l._stageKey || (norm ? norm(l.stage) : (l.stage || 'new'));
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const _SORTS = {
    name:     (l) => _name(l).toLowerCase(),
    stage:    (l) => {
      const keys = window._stageKeys || [];
      const i = keys.indexOf(_stageKeyOf(l));
      return i === -1 ? keys.length : i;   // pipeline order, unknowns last
    },
    value:    (l) => Number(l.jobValue) || 0,
    age:      (l) => { const d = _created(l);  return d ? d.getTime() : 0; },
    activity: (l) => { const d = _activity(l); return d ? d.getTime() : 0; },
  };

  function _sorted(list) {
    const key = _SORTS[_sortKey] ? _sortKey : 'activity';
    const dec = list.map((l, i) => ({ l, i, k: _SORTS[key](l) }));
    dec.sort((a, b) => {
      if (a.k < b.k) return -1 * _sortDir;
      if (a.k > b.k) return  1 * _sortDir;
      return a.i - b.i; // stable
    });
    return dec.map(d => d.l);
  }

  function _sortBy(key) {
    if (_sortKey === key) _sortDir = -_sortDir;
    else { _sortKey = key; _sortDir = (key === 'value' || key === 'activity' || key === 'age') ? -1 : 1; }
    render(_lastList);
  }

  // ── Render ───────────────────────────────────────────────
  function clear() {
    const wrap = document.getElementById('crmListWrap');
    if (wrap && wrap.childNodes.length) wrap.textContent = '';
  }

  function render(list) {
    const wrap = document.getElementById('crmListWrap');
    if (!wrap) return;
    _lastList = Array.isArray(list) ? list : [];
    const stageKeys = window._stageKeys || [];
    const labelFor = (k) => (typeof window.stageLabel === 'function' ? window.stageLabel(k) : k);

    if (!_lastList.length) {
      wrap.innerHTML = '<div class="crm-list-empty">No leads match the current view and filters.</div>';
      return;
    }

    const arrow = (key) => _sortKey === key ? (_sortDir === 1 ? ' ▲' : ' ▼') : '';
    const rows = _sorted(_lastList).map((l) => {
      const sk = _stageKeyOf(l);
      const val = Number(l.jobValue) || 0;
      const created = _created(l);
      const act = _activity(l);
      const ageD = _ageDays(created);
      const actD = _ageDays(act);
      const phone = (l.phone || '').trim();
      const opts = stageKeys.map((k) =>
        '<option value="' + _esc(k) + '"' + (k === sk ? ' selected' : '') + '>' + _esc(labelFor(k)) + '</option>'
      ).join('');
      return '<tr class="crm-list-row" data-id="' + _esc(l.id) + '">'
        + '<td class="cl-name"><a href="/pro/customer?id=' + encodeURIComponent(l.id) + '">' + _esc(_name(l)) + '</a>'
        +   '<div class="cl-addr">' + _esc(l.address || '') + '</div></td>'
        + '<td class="cl-stage"><select class="cl-stage-select" data-id="' + _esc(l.id) + '" aria-label="Stage">' + opts + '</select></td>'
        + '<td class="cl-value">' + (val > 0 ? '$' + val.toLocaleString() : '—') + '</td>'
        + '<td class="cl-age">' + (ageD == null ? '—' : ageD + 'd') + '</td>'
        + '<td class="cl-activity">' + (actD == null ? '—' : (actD === 0 ? 'today' : actD + 'd ago')) + '</td>'
        + '<td class="cl-actions">'
        +   (phone ? '<a class="cl-call" href="tel:' + _esc(phone.replace(/[^\d+]/g, '')) + '" title="Call ' + _esc(phone) + '">📞</a>' : '')
        +   '<a class="cl-open" href="/pro/customer?id=' + encodeURIComponent(l.id) + '" title="Open customer">Open →</a>'
        + '</td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML =
      '<table class="crm-list-table">'
      + '<thead><tr>'
      +   '<th data-sort="name">Customer' + arrow('name') + '</th>'
      +   '<th data-sort="stage">Stage' + arrow('stage') + '</th>'
      +   '<th data-sort="value">Value' + arrow('value') + '</th>'
      +   '<th data-sort="age">Age' + arrow('age') + '</th>'
      +   '<th data-sort="activity">Last activity' + arrow('activity') + '</th>'
      +   '<th></th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody></table>';

    // Header sorts
    wrap.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => _sortBy(th.dataset.sort));
    });
    // Stage changes ride the SAME moveCard path as a kanban drop —
    // history entry, stage-gate prompts, and lost-reason flow intact.
    // moveCard re-renders (renderLeads) which calls back into render(),
    // so a gated/cancelled move snaps the select back to truth.
    wrap.querySelectorAll('.cl-stage-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (typeof window.moveCard === 'function') window.moveCard(sel.dataset.id, sel.value);
      });
    });
  }

  window.CrmListView = { isActive, render, clear };

  // Apply the persisted mode on boot — the toggle buttons live in the
  // lazily-hydrated CRM view template, so re-apply when they appear.
  _applyMode();
  document.addEventListener('DOMContentLoaded', _applyMode);
  const _t = setInterval(() => {
    if (document.getElementById('crmViewBoardBtn')) { _applyMode(); clearInterval(_t); }
  }, 500);
  setTimeout(() => clearInterval(_t), 30000);
})();
