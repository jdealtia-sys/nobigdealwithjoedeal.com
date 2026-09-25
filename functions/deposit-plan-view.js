/**
 * deposit-plan-view.js — the homeowner-safe view of an estimate's deposit plan.
 *
 * WHY (2026-09-25): the deposit rule lives in ONE place,
 * docs/pro/js/deposit-rule.js (cash under $2,000 no deposit, cash $2,000+ 50%
 * at signing, insurance the deductible + the ACV payment). The rep's builder
 * stamps its answer onto the saved estimate as `depositPlan` (display strings
 * + integer cents, never a cost figure). The homeowner portal and
 * /pro/estimate-view print that stamp, so they say exactly what the quote,
 * contract and invoice say — without a second copy of the rule running here.
 *
 * This file only VALIDATES and WHITELISTS the stamp:
 *   • cents are integers and deposit + balance === total;
 *   • the plan's total matches the estimate's current price — a total edited
 *     after the stamp (e.g. doc pre-flight's line-item save-back) makes the
 *     plan stale, and a stale deposit is worse than none, so it is dropped;
 *   • strings are length-capped; nothing rep-only (repNote, override detail)
 *     crosses to the homeowner.
 * Anything off → null, and the portal simply prints no deposit line (what it
 * did for every estimate before this change).
 */
'use strict';

function _int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function _str(v, max) {
  return (typeof v === 'string') ? v.slice(0, max) : '';
}

function safeDepositPlan(est) {
  const p = est && est.depositPlan;
  if (!p || typeof p !== 'object') return null;
  const total = _int(p.totalCents);
  const dep = _int(p.depositCents);
  const bal = _int(p.balanceCents);
  if (!(total > 0) || dep == null || bal == null || dep < 0 || bal < 0 || dep + bal !== total) return null;
  const price = Number(est.grandTotal != null ? est.grandTotal : est.total);
  if (!Number.isFinite(price) || Math.round(price * 100) !== total) return null;
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 6).map((r) => ({
    label: _str(r && r.label, 120),
    due: _str(r && r.due, 160),
    amountCents: (r && r.amountCents != null) ? _int(r.amountCents) : null,
    amountText: _str(r && r.amountText, 60),
  })) : [];
  return {
    totalCents: total,
    depositCents: dep,
    balanceCents: bal,
    label: _str(p.label, 60),
    valueText: _str(p.valueText, 60),
    summary: _str(p.summary, 600),
    rows,
  };
}

module.exports = { safeDepositPlan };
