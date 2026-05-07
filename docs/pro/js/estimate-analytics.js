/**
 * estimate-analytics.js — Wave 147 (Estimate analytics summary band)
 *
 * Reads from window._estimates (populated by loadEstimates) and
 * renders a compact stat band into #estStats on the estimates view.
 *
 * Stats:
 *   - Total estimates + status breakdown (draft / sent / signed / lost)
 *   - Close rate (signed / sent), with absolute counts
 *   - Average ticket per signed estimate
 *   - View → sign conversion (signed / viewed)
 *   - Tier breakdown of signed estimates (Good / Better / Best %)
 *   - Time-to-sign (median days from sentAt → signedAt)
 *   - Top 3 leaderboard: highest-grandTotal signed estimates
 *
 * Auto-refreshes on every `nbd:data-refreshed` event so a fresh
 * loadEstimates() or W146 viewedAt-bump reflects immediately.
 *
 * Path-gated to dashboard.html (only place #estStats lives).
 *
 * Public API:
 *   window.NBDEstimateAnalytics.render()
 *   window.NBDEstimateAnalytics.compute()  // returns the raw stats
 */
(function () {
  'use strict';
  if (window.NBDEstimateAnalytics
      && window.NBDEstimateAnalytics.__sentinel === 'nbd-est-analytics-v1') return;

  const TARGET_ID = 'estStats';

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _money(n) {
    const v = Number(n);
    if (!isFinite(v)) return '$0';
    if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (v >= 10_000)    return '$' + Math.round(v / 1000) + 'k';
    return '$' + Math.round(v).toLocaleString();
  }
  function _pct(num, den) {
    if (!den || den === 0) return '—';
    return Math.round((num / den) * 100) + '%';
  }
  function _toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts.toMillis === 'function') {
      try { return ts.toMillis(); } catch (_) { return 0; }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
  }

  // ─── Compute summary stats from window._estimates ──────────────
  function compute() {
    const list = Array.isArray(window._estimates) ? window._estimates : [];
    const out = {
      total:        list.length,
      draft:        0,
      sent:         0,
      viewed:       0,
      signed:       0,
      lost:         0,
      signedTotal:  0,
      signedTickets: [],
      tierCounts:   { good: 0, better: 0, best: 0 },
      timeToSignDays: [],
      topSigned:    [],
    };
    for (const e of list) {
      if (!e || e.deleted) continue;
      const status = String(e.status || (e.signedAt ? 'signed' : 'draft')).toLowerCase();
      const tier = String(e.tier || '').toLowerCase();
      const grandTotal = Number(e.grandTotal || e.total || 0) || 0;
      const sentMs = _toMillis(e.sentAt);
      const viewedMs = _toMillis(e.viewedAt);
      const signedMs = _toMillis(e.signedAt);

      if (status === 'draft' && !sentMs) out.draft++;
      else if (status === 'lost' || status === 'rejected') out.lost++;
      else if (signedMs || status === 'signed') {
        out.signed++;
        out.signedTotal += grandTotal;
        out.signedTickets.push(grandTotal);
        if (tier === 'good' || tier === 'better' || tier === 'best') {
          out.tierCounts[tier]++;
        }
        if (sentMs && signedMs && signedMs > sentMs) {
          const days = (signedMs - sentMs) / 86_400_000;
          if (days >= 0 && days <= 365) out.timeToSignDays.push(days);
        }
        out.topSigned.push({
          id: e.id,
          owner: e.owner || ((e.firstName || '') + ' ' + (e.lastName || '')).trim() || '(no name)',
          addr: e.addr || e.address || '',
          tier: tier || 'better',
          grandTotal,
        });
      }
      else if (sentMs) {
        out.sent++;
        if (viewedMs) out.viewed++;
      }
    }

    out.avgTicket = out.signed
      ? Math.round(out.signedTotal / out.signed)
      : 0;
    out.medianTimeToSign = _median(out.timeToSignDays);
    out.closeRate = out.sent + out.signed > 0
      ? out.signed / (out.sent + out.signed)
      : 0;
    out.viewToSignRate = out.viewed > 0
      ? out.signed / out.viewed
      : 0;
    out.topSigned.sort((a, b) => b.grandTotal - a.grandTotal);
    out.topSigned = out.topSigned.slice(0, 3);
    return out;
  }

  function _median(arr) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // ─── Render into #estStats ─────────────────────────────────────
  function render() {
    const host = document.getElementById(TARGET_ID);
    if (!host) return;
    const list = Array.isArray(window._estimates) ? window._estimates : [];
    if (list.length === 0) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'block';
    const s = compute();

    // Stat tile factory — keeps the markup tidy below.
    const tile = (label, value, sub) =>
      '<div style="background:var(--s, #13171d);border:1px solid var(--br, #2a2f35);border-radius:7px;padding:10px 12px;min-width:120px;">' +
        '<div style="font-size:10px;color:var(--m, #888);letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:3px;">' + _esc(label) + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:var(--t, #e8eaf0);font-variant-numeric:tabular-nums;line-height:1.1;">' + _esc(value) + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--m, #888);margin-top:3px;">' + _esc(sub) + '</div>' : '') +
      '</div>';

    // Tier mix bar — proportional fill of the three colors so
    // a "70% Better" mix is obvious at a glance.
    const totalTiered = s.tierCounts.good + s.tierCounts.better + s.tierCounts.best;
    let tierBar = '';
    if (totalTiered > 0) {
      const goodPct = (s.tierCounts.good / totalTiered) * 100;
      const betterPct = (s.tierCounts.better / totalTiered) * 100;
      const bestPct = (s.tierCounts.best / totalTiered) * 100;
      tierBar =
        '<div style="background:var(--s, #13171d);border:1px solid var(--br, #2a2f35);border-radius:7px;padding:10px 12px;flex:2;min-width:240px;">' +
          '<div style="font-size:10px;color:var(--m, #888);letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Signed tier mix</div>' +
          '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg, #0a0c0f);margin-bottom:6px;">' +
            (goodPct ? '<div style="width:' + goodPct + '%;background:#3b82f6;" title="Good"></div>' : '') +
            (betterPct ? '<div style="width:' + betterPct + '%;background:#9b6dff;" title="Better"></div>' : '') +
            (bestPct ? '<div style="width:' + bestPct + '%;background:#10b981;" title="Best"></div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;font-size:10px;color:var(--m, #888);font-variant-numeric:tabular-nums;">' +
            '<span><span style="color:#3b82f6;">●</span> Good ' + Math.round(goodPct) + '%</span>' +
            '<span><span style="color:#9b6dff;">●</span> Better ' + Math.round(betterPct) + '%</span>' +
            '<span><span style="color:#10b981;">●</span> Best ' + Math.round(bestPct) + '%</span>' +
          '</div>' +
        '</div>';
    }

    const topSignedList = s.topSigned.length
      ? s.topSigned.map(t =>
          '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:11px;">' +
            '<span style="color:var(--m, #888);">🏆 ' + _esc(t.owner) + ' <span style="opacity:0.7;">' + _esc(t.tier) + '</span></span>' +
            '<span style="font-weight:700;font-variant-numeric:tabular-nums;color:var(--green, #2ecc8a);">' + _money(t.grandTotal) + '</span>' +
          '</div>'
        ).join('')
      : '';

    host.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;">' +
        tile('Total', s.total, s.draft + ' draft · ' + s.sent + ' sent · ' + s.signed + ' signed' + (s.lost ? ' · ' + s.lost + ' lost' : '')) +
        tile('Close rate', _pct(s.signed, s.sent + s.signed), s.signed + ' / ' + (s.sent + s.signed) + ' sent+signed') +
        tile('Avg ticket', _money(s.avgTicket), 'across ' + s.signed + ' signed') +
        tile('View → sign', _pct(s.signed, s.viewed), s.viewed + ' viewed → ' + s.signed + ' signed') +
        tile('Median time-to-sign', s.medianTimeToSign ? Math.round(s.medianTimeToSign) + 'd' : '—', s.timeToSignDays.length + ' samples') +
        tierBar +
      '</div>' +
      (topSignedList ? (
        '<div style="background:var(--s, #13171d);border:1px solid var(--br, #2a2f35);border-radius:7px;padding:10px 12px;margin-top:8px;">' +
          '<div style="font-size:10px;color:var(--m, #888);letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Top signed</div>' +
          topSignedList +
        '</div>'
      ) : '');
  }

  function _bootstrap() {
    render();
    window.addEventListener('nbd:data-refreshed', render);
    // Defer one more render after window-level loadEstimates has had
    // time to populate window._estimates on first dashboard load.
    setTimeout(render, 1200);
    setTimeout(render, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDEstimateAnalytics = {
    __sentinel: 'nbd-est-analytics-v1',
    render,
    compute,
  };
})();
