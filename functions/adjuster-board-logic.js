/**
 * adjuster-board-logic.js — pure aggregation behind the getAdjusterTacticBoard
 * callable (idea #2 follow-up). Dependency-free (no firebase) so tests can
 * require() it and the handler shares the exact same code path.
 *
 * voiceConsumer (idea #2, #1051) denormalizes each call's redFlags/objections
 * onto the LEAD but drops the carrier/adjuster association. The adjuster-tactic
 * board needs that association back: it rolls up the RECORDING-level
 * summary.insuranceDetails.{carrier,adjuster} correlated with objections[] /
 * redFlags[] across all a tenant's calls, so a rep can see "State Farm's
 * adjusters push back on X 8 times out of 10." This module does that bucketing
 * from an array of recording docs (each carrying a `summary`).
 */
'use strict';

function clean(s) { return typeof s === 'string' ? s.trim() : ''; }
function keyOf(s) { return clean(s).toLowerCase(); }

// Trimmed, deduped (case-insensitive), non-empty list.
function uniqList(arr) {
  const seen = new Set();
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    const v = clean(x);
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
}

function bump(map, label) {
  const k = keyOf(label);
  if (!k) return;
  const e = map.get(k) || { text: clean(label), count: 0 };
  e.count++;
  map.set(k, e);
}

// Rank a tally Map (label→{text,count}) into a capped, count-desc array.
function rankTally(map, max) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, max);
}

function getBucket(map, name) {
  const k = keyOf(name);
  let b = map.get(k);
  if (!b) {
    b = { name: clean(name), calls: 0, objections: new Map(), redFlags: new Map(), adjusters: new Set() };
    map.set(k, b);
  }
  return b;
}

// Rank carrier/adjuster buckets → capped, calls-desc, with their top signals.
function rankBuckets(map, max, maxSignals) {
  return [...map.values()]
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((b) => ({
      name: b.name,
      calls: b.calls,
      adjusterCount: b.adjusters ? b.adjusters.size : 0,
      topObjections: rankTally(b.objections, maxSignals),
      topRedFlags: rankTally(b.redFlags, maxSignals),
    }));
}

/**
 * Aggregate an array of recording docs into the adjuster-tactic board.
 * Each recording contributes its summary.insuranceDetails.{carrier,adjuster}
 * and summary.objections[] / summary.redFlags[]. Never throws on odd input.
 */
function aggregateAdjusterBoard(recordings, opts) {
  const max = (opts && opts.maxRows) || 12;
  const maxSignals = (opts && opts.maxSignals) || 5;

  const carriers = new Map();
  const adjusters = new Map();
  const objTally = new Map();
  const flagTally = new Map();
  let totalCalls = 0;
  let withInsurance = 0;

  (Array.isArray(recordings) ? recordings : []).forEach((rec) => {
    const summary = rec && rec.summary;
    if (!summary || typeof summary !== 'object') return;
    totalCalls++;

    const det = summary.insuranceDetails || {};
    const carrier = clean(det.carrier);
    const adjuster = clean(det.adjuster);
    const objs = uniqList(summary.objections);
    const flags = uniqList(summary.redFlags);

    // Global tallies (every call, insured or not).
    objs.forEach((o) => bump(objTally, o));
    flags.forEach((f) => bump(flagTally, f));

    if (carrier) {
      withInsurance++;
      const c = getBucket(carriers, carrier);
      c.calls++;
      objs.forEach((o) => bump(c.objections, o));
      flags.forEach((f) => bump(c.redFlags, f));
      if (adjuster) c.adjusters.add(keyOf(adjuster));
    }
    if (adjuster) {
      const a = getBucket(adjusters, adjuster);
      a.calls++;
      objs.forEach((o) => bump(a.objections, o));
      flags.forEach((f) => bump(a.redFlags, f));
    }
  });

  return {
    totalCalls,
    withInsurance,
    byCarrier: rankBuckets(carriers, max, maxSignals),
    byAdjuster: rankBuckets(adjusters, max, maxSignals),
    topObjections: rankTally(objTally, max),
    topRedFlags: rankTally(flagTally, max),
  };
}

module.exports = { aggregateAdjusterBoard, uniqList };
