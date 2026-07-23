/**
 * adjuster-tactic-card.js — idea #2 follow-up: adjuster-tactic board
 *
 * Renders a "By Carrier" tactic board on the analytics ('board') view, pulled
 * from the getAdjusterTacticBoard callable (a company-wide collectionGroup
 * rollup over call recordings). Shows, per insurance carrier, how many calls
 * touched them and the objections/red-flags that recur — so a rep walks into
 * the next adjuster call knowing the playbook. The browser never reads the
 * (transcript-heavy) recording docs; the callable does the scan.
 *
 * Mounted by dashboard-actions.js when the board view opens; result is cached
 * for the session so re-opening the view is instant.
 */
(function () {
  'use strict';
  if (window.AdjusterTacticCard
      && window.AdjusterTacticCard.__sentinel === 'nbd-adjuster-tactic-card-v1') return;

  let _cache = null;
  let _inflight = null;

  function callable(name) {
    if (!window._functions || !window._httpsCallable) return null;
    return window._httpsCallable(window._functions, name);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  async function fetchBoard() {
    if (_cache) return _cache;
    if (_inflight) return _inflight;
    const fn = callable('getAdjusterTacticBoard');
    if (!fn) return null;
    _inflight = fn({ windowDays: 365 })
      .then(res => { _cache = (res && res.data) || null; _inflight = null; return _cache; })
      .catch(e => { _inflight = null; console.warn('[AdjusterTacticCard] failed:', e && e.message); return null; });
    return _inflight;
  }

  function host() {
    const c = document.getElementById('analyticsContainer');
    if (!c) return null;
    let h = document.getElementById('adjusterTacticCard');
    if (!h) {
      h = document.createElement('div');
      h.id = 'adjusterTacticCard';
      c.appendChild(h);
    }
    return h;
  }

  const WRAP = 'background:rgba(46,204,138,.06);border:1px solid rgba(46,204,138,.30);border-radius:12px;padding:16px;margin:12px 0;';
  const HEAD = '<span style="font-size:17px;">🛡️</span><span style="font-weight:700;font-size:13px;color:var(--t,#e8eaf0);">Adjuster Tactics</span>';

  // A small chip list of "objection ×N" for a carrier row.
  function signals(list) {
    if (!list || !list.length) return '<span style="font-size:11px;color:var(--m,#9aa3b2);opacity:.7;">—</span>';
    return list.map(s =>
      '<span style="display:inline-block;background:rgba(255,255,255,.05);border:1px solid var(--br,#2a3344);'
      + 'border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:11px;color:var(--t,#e8eaf0);">'
      + esc(s.text) + ' <span style="color:var(--m,#9aa3b2);">×' + esc(s.count) + '</span></span>'
    ).join('');
  }

  function carrierRow(c) {
    const adj = c.adjusterCount ? (' · ' + esc(c.adjusterCount) + ' adjuster' + (c.adjusterCount === 1 ? '' : 's')) : '';
    return '<div style="padding:10px 0;border-top:1px solid var(--br,#2a3344);">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">'
      + '<span style="font-weight:700;font-size:13px;color:var(--t,#e8eaf0);">' + esc(c.name) + '</span>'
      + '<span style="font-size:11px;color:var(--m,#9aa3b2);">' + esc(c.calls) + ' call' + (c.calls === 1 ? '' : 's') + adj + '</span>'
      + '</div>'
      + (c.topObjections && c.topObjections.length
          ? '<div style="margin-top:6px;"><span style="font-size:10px;color:var(--m,#9aa3b2);text-transform:uppercase;letter-spacing:.04em;">Objections</span><div style="margin-top:3px;">' + signals(c.topObjections) + '</div></div>'
          : '')
      + (c.topRedFlags && c.topRedFlags.length
          ? '<div style="margin-top:6px;"><span style="font-size:10px;color:var(--m,#9aa3b2);text-transform:uppercase;letter-spacing:.04em;">Red flags</span><div style="margin-top:3px;">' + signals(c.topRedFlags) + '</div></div>'
          : '')
      + '</div>';
  }

  function renderInto(h, b) {
    if (!b || !b.totalCalls) {
      h.innerHTML = '<div style="' + WRAP + '">'
        + '<div style="display:flex;align-items:center;gap:8px;">' + HEAD + '</div>'
        + '<div style="font-size:12px;color:var(--m,#9aa3b2);margin-top:8px;">No analyzed calls yet — record calls with Voice Intelligence and their adjuster/carrier tactics roll up here.</div>'
        + '</div>';
      return;
    }
    const carriers = b.byCarrier || [];
    const body = carriers.length
      ? carriers.map(carrierRow).join('')
      : '<div style="font-size:12px;color:var(--m,#9aa3b2);margin-top:8px;padding:8px 0;">'
        + esc(b.totalCalls) + ' analyzed call' + (b.totalCalls === 1 ? '' : 's') + ', but none captured an insurance carrier yet.</div>';
    h.innerHTML = '<div style="' + WRAP + '">'
      + '<div style="display:flex;align-items:center;gap:8px;">' + HEAD
      + '<span style="font-size:11px;color:var(--m,#9aa3b2);">· last ' + esc(b.windowDays) + ' days · ' + esc(b.withInsurance) + '/' + esc(b.totalCalls) + ' calls w/ carrier</span>'
      + '</div>' + body + '</div>';
  }

  async function render() {
    const h = host();
    if (!h) return;
    if (!_cache) {
      h.innerHTML = '<div style="font-size:12px;color:var(--m,#9aa3b2);padding:12px 2px;">Loading adjuster tactics…</div>';
    }
    const b = await fetchBoard();
    const h2 = host();
    if (h2) renderInto(h2, b);
  }

  window.AdjusterTacticCard = {
    __sentinel: 'nbd-adjuster-tactic-card-v1',
    render,
    _clearCache: () => { _cache = null; }
  };
})();
