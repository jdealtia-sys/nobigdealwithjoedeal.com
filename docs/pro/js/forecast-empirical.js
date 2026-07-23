/**
 * NBD Pro — Empirical Forecast Engine
 *
 * forecasting.js multiplies each open deal's jobValue by a STATIC industry
 * stage-probability table. But every stage move already writes a timestamped
 * stageHistory[] entry ({from,to,timestamp,user}) that nothing reads. This
 * module turns that history into each TENANT'S OWN numbers:
 *
 *   • computeEmpiricalRates — of the leads that ever entered stage X and have
 *     since resolved (won or lost), what fraction WON → P(win | reached X).
 *   • blendedProbability   — Bayesian shrinkage of that empirical rate toward
 *     the industry prior, so a tenant with 3 closed deals doesn't get wild
 *     0%/100% swings and a tenant with 300 gets their real numbers.
 *   • stageVelocity        — median COMPLETED days in each stage, from the
 *     gaps between consecutive history events (a true time-in-stage, unlike
 *     bottleneck-widget.js which measures only leads sitting in a stage NOW —
 *     survivorship-biased). Exposed for reuse; bottleneck-widget can adopt it.
 *
 * Pure + dependency-free (dual browser/node export) so tests/forecast-empirical
 * .test.js can require() it. The caller supplies isWon/isLost so this works
 * with tenant CUSTOM pipelines (pass predicates built from window.stageRole).
 */
(function (root) {
  'use strict';

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  function parseTs(v) {
    // history timestamps are ISO strings; tolerate Firestore Timestamp shapes.
    if (v == null) return NaN;
    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
  }
  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

  // The ordered set of distinct stages a lead has occupied, oldest first.
  function stagesEntered(lead) {
    const out = [];
    const seen = new Set();
    const add = (k) => { if (k && !seen.has(k)) { seen.add(k); out.push(k); } };
    const hist = Array.isArray(lead.stageHistory) ? lead.stageHistory : [];
    if (hist.length) {
      const sorted = hist.filter((e) => e && (e.from || e.to))
        .slice().sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
      if (sorted[0] && sorted[0].from) add(sorted[0].from);
      sorted.forEach((e) => add(e.to));
    }
    add(lead._stageKey || lead.stage);
    return out;
  }

  /**
   * Empirical P(win | reached stage) per stage, from RESOLVED leads only.
   * @param leads  window._leads-style array.
   * @param opts.isWon/isLost  (stageKey)=>bool terminal predicates (required
   *   for correct tenant-custom behaviour; default to a no-op that resolves
   *   nothing, which safely yields prior-only forecasts).
   */
  function computeEmpiricalRates(leads, opts) {
    opts = opts || {};
    const isWon = typeof opts.isWon === 'function' ? opts.isWon : function () { return false; };
    const isLost = typeof opts.isLost === 'function' ? opts.isLost : function () { return false; };
    const byStage = Object.create(null);
    let totalResolved = 0, totalWon = 0;

    (Array.isArray(leads) ? leads : []).forEach((lead) => {
      if (!lead || lead.deleted || lead.isProspect) return;
      const current = lead._stageKey || lead.stage;
      const won = isWon(current), lost = isLost(current);
      if (!won && !lost) return; // still open — hasn't resolved, contributes no rate
      totalResolved++; if (won) totalWon++;
      stagesEntered(lead).forEach((stage) => {
        if (isWon(stage) || isLost(stage)) return; // don't forecast FROM a terminal stage
        const s = byStage[stage] || (byStage[stage] = { stage: stage, resolved: 0, won: 0, closeRate: 0 });
        s.resolved++; if (won) s.won++;
      });
    });
    Object.keys(byStage).forEach((k) => { const s = byStage[k]; s.closeRate = s.resolved ? s.won / s.resolved : 0; });
    return { byStage: byStage, totalResolved: totalResolved, totalWon: totalWon };
  }

  /**
   * Beta-binomial shrinkage toward `prior`. With `resolved` samples and `won`
   * wins: (won + k*prior) / (resolved + k). k is a pseudocount = the strength
   * of the prior. resolved 0 → exactly prior; resolved >> k → empirical.
   */
  function blendedProbability(stageKey, model, prior, opts) {
    const k = (opts && opts.pseudocount > 0) ? opts.pseudocount : 15;
    const p = (Number.isFinite(prior) ? prior : 0.10);
    const s = model && model.byStage && model.byStage[stageKey];
    if (!s || !s.resolved) return p;
    const blended = (s.won + k * p) / (s.resolved + k);
    return Math.max(0, Math.min(1, blended));
  }

  /**
   * Median/avg COMPLETED days in each stage, from the gap between the event
   * that entered a stage and the event that left it. Only fully-completed
   * occupancies count (the current, still-open stage is excluded — that's
   * what bottleneck-widget's snapshot covers).
   */
  function stageVelocity(leads) {
    const buckets = Object.create(null);
    (Array.isArray(leads) ? leads : []).forEach((lead) => {
      if (!lead || lead.deleted || lead.isProspect) return;
      const hist = (Array.isArray(lead.stageHistory) ? lead.stageHistory : [])
        .filter((e) => e && e.to && parseTs(e.timestamp) === parseTs(e.timestamp))
        .slice().sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
      for (let i = 0; i < hist.length - 1; i++) {
        const stage = hist[i].to;
        const days = (parseTs(hist[i + 1].timestamp) - parseTs(hist[i].timestamp)) / 86400000;
        if (!stage || !Number.isFinite(days) || days < 0) continue;
        (buckets[stage] || (buckets[stage] = [])).push(days);
      }
    });
    const byStage = Object.create(null);
    let slowest = null;
    Object.keys(buckets).forEach((stage) => {
      const arr = buckets[stage];
      const row = { stage: stage, samples: arr.length, medianDays: median(arr), avgDays: avg(arr) };
      byStage[stage] = row;
      if (!slowest || (row.avgDays || 0) > (slowest.avgDays || 0)) slowest = row;
    });
    return { byStage: byStage, slowest: slowest };
  }

  const api = { computeEmpiricalRates: computeEmpiricalRates, blendedProbability: blendedProbability, stageVelocity: stageVelocity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.ForecastEmpirical = api;
})(typeof window !== 'undefined' ? window : this);
