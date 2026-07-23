/**
 * voice-consumer-logic.js — pure transforms behind the voiceConsumer trigger
 * (idea #2). Dependency-free (no firebase) so tests/voice-consumer.test.js can
 * require() it directly and the trigger (voice-consumer.js) shares the exact
 * same code path — no logic mirror to drift.
 *
 * Turns a call recording's strict-JSON summary (voice-prompts.js
 * ANALYZE_OUTPUT_SCHEMA) into CRM actions. See voice-consumer.js for the
 * trigger + idempotency.
 */
'use strict';

const MAX_TASKS = 12;
const MAX_SIGNALS = 12;
const INS_FIELDS = [
  ['carrier', 'insCarrier'],
  ['claimNumber', 'claimNumber'],
  ['adjuster', 'adjuster'],
  ['deductible', 'deductible'],
];

function clean(s) { return typeof s === 'string' ? s.trim() : ''; }
function isBlank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

// A commitment/action `when` → 'YYYY-MM-DD' if it's a real date, else '' (the
// tasks UI treats '' as no due date). Relative phrases ("next week") aren't
// parsed — better an undated task than a wrong date.
function parseWhen(when) {
  const w = clean(when);
  if (!w) return '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(w)) return '';
  const t = Date.parse(w.length > 10 ? w : w + 'T12:00:00Z');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

// nextActions + commitments → task rows {text, dueDate}. Deduped, capped.
function tasksFromSummary(summary) {
  const out = [];
  const seen = new Set();
  const push = (text, dueDate) => {
    const t = clean(text);
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t.slice(0, 300), dueDate: dueDate || '' });
  };
  const s = summary || {};
  (Array.isArray(s.nextActions) ? s.nextActions : []).forEach((a) => push(a, ''));
  (Array.isArray(s.commitments) ? s.commitments : []).forEach((c) => {
    if (!c) return;
    const who = clean(c.who);
    const what = clean(c.what);
    if (!what) return;
    push((who ? who.charAt(0).toUpperCase() + who.slice(1) + ': ' : '') + what, parseWhen(c.when));
  });
  return out.slice(0, MAX_TASKS);
}

// Lead insurance patch — ONLY fields the lead leaves blank. Returns {} when
// there is nothing to fill (caller skips the write). NEVER overwrites a value
// the rep already typed.
function insuranceBackfill(lead, summary) {
  const det = (summary && summary.insuranceDetails) || {};
  const patch = {};
  INS_FIELDS.forEach(([src, dst]) => {
    const val = clean(det[src]);
    if (val && isBlank((lead || {})[dst])) patch[dst] = val;
  });
  return patch;
}

// redFlags / objections → capped, trimmed, deduped string arrays for the lead.
function denormalizeSignals(summary) {
  const s = summary || {};
  const norm = (arr) => {
    const seen = new Set();
    return (Array.isArray(arr) ? arr : [])
      .map(clean).filter(Boolean)
      .filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, MAX_SIGNALS);
  };
  return { callRedFlags: norm(s.redFlags), callObjections: norm(s.objections) };
}

module.exports = { tasksFromSummary, insuranceBackfill, denormalizeSignals, parseWhen, MAX_TASKS, MAX_SIGNALS };
