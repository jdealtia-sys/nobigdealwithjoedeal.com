/**
 * monthly-overhead-logic.js — PURE helpers for the monthly overhead
 * alert cron. No firebase imports, so it runs in a bare-node unit test
 * (mirrors lead-bridge-logic.js / plan-limits.js). The cron shell
 * (monthly-overhead-alert.js) does the Firestore/Auth/email_queue I/O.
 */

'use strict';

const TZ = 'America/New_York';

// Firestore Timestamp | Date | string → 'YYYY-MM-DD' in ET, or null.
function etYmd(d) {
  if (d == null) return null;
  const js = typeof d.toDate === 'function' ? d.toDate() : new Date(d);
  if (isNaN(js.getTime())) return null;
  return js.toLocaleDateString('en-CA', { timeZone: TZ });
}

function monthKeyOf(ymd) { return ymd ? ymd.slice(0, 7) : null; }

// Given "now" (Date), the month that just ended and the one before it,
// plus a query lower bound buffered 2 days before the prior month starts.
function monthKeysAt(now) {
  const ymd = etYmd(now);
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  const anchor = n => new Date(Date.UTC(y, m - 1 - n, 1));
  const key = d => d.toISOString().slice(0, 7);
  const last = anchor(1), prior = anchor(2);
  return {
    lastKey: key(last),
    priorKey: key(prior),
    lastLabel: last.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    queryStart: new Date(prior.getTime() - 2 * 24 * 60 * 60 * 1000),
  };
}

function fmtCents(cents) {
  return (Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 'phone_internet' → 'Phone Internet'. functions/ deliberately holds no
// copy of the client label map — category KEYS are the contract, labels
// are cosmetic and derivable.
function prettyCategory(key) {
  return String(key || 'uncategorized')
    .split('_').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * Bucket raw expense docs into per-company overhead summaries.
 * docs: [{companyId, costType, category, amountCents, date}], roughly
 * range-limited by the query; precise month membership decided here.
 * Returns Map cid → { totalCents, count, byCategory, priorTotalCents }.
 */
function summarizeOverhead(docs, lastKey, priorKey) {
  const perCompany = new Map();
  for (const e of docs || []) {
    if (!e || e.costType !== 'overhead') continue;
    const cid = e.companyId;
    if (!cid) continue;
    const mk = monthKeyOf(etYmd(e.date));
    if (mk !== lastKey && mk !== priorKey) continue;
    const cents = parseInt(e.amountCents, 10) || 0;
    if (cents <= 0) continue;
    let row = perCompany.get(cid);
    if (!row) { row = { totalCents: 0, count: 0, byCategory: {}, priorTotalCents: 0 }; perCompany.set(cid, row); }
    if (mk === lastKey) {
      row.totalCents += cents;
      row.count += 1;
      const cat = e.category || 'uncategorized';
      row.byCategory[cat] = (row.byCategory[cat] || 0) + cents;
    } else {
      row.priorTotalCents += cents;
    }
  }
  return perCompany;
}

/** One company's summary → { subject, bodyHtml, bodyPlain }. */
function buildEmail(summary, lastLabel) {
  const cats = Object.entries(summary.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, cents]) => ({ label: prettyCategory(k), cents }));
  const deltaCents = summary.totalCents - summary.priorTotalCents;
  const deltaTxt = summary.priorTotalCents > 0
    ? (deltaCents >= 0 ? '+' : '−') + fmtCents(Math.abs(deltaCents)) + ' vs the month before (' + fmtCents(summary.priorTotalCents) + ')'
    : 'no overhead recorded the month before';

  const subject = 'Overhead spend — ' + fmtCents(summary.totalCents) + ' in ' + lastLabel;
  const bodyPlain = [
    'Monthly overhead summary for ' + lastLabel + ':',
    'Total: ' + fmtCents(summary.totalCents) + ' across ' + summary.count + ' expense' + (summary.count === 1 ? '' : 's'),
    deltaTxt,
    '',
    ...cats.map(c => '  ' + c.label + ': ' + fmtCents(c.cents)),
    '',
    'Full breakdown: open Expenses in your NBD PRO dashboard (#/expenses).',
  ].join('\n');
  const bodyHtml = [
    '<div style="font-family:Arial,sans-serif;max-width:560px;">',
    '<h2 style="margin:0 0 4px;">Overhead spend — ' + escapeHtml(lastLabel) + '</h2>',
    '<div style="font-size:24px;font-weight:700;margin:8px 0;">' + fmtCents(summary.totalCents) + '</div>',
    '<div style="color:#555;margin-bottom:14px;">' + escapeHtml(deltaTxt) + ' · ' + summary.count + ' expense' + (summary.count === 1 ? '' : 's') + '</div>',
    '<table style="border-collapse:collapse;width:100%;font-size:13px;">',
    ...cats.map(c =>
      '<tr><td style="padding:4px 8px;border-top:1px solid #eee;">' + escapeHtml(c.label) + '</td>' +
      '<td style="padding:4px 8px;border-top:1px solid #eee;text-align:right;">' + fmtCents(c.cents) + '</td></tr>'),
    '</table>',
    '<div style="margin-top:16px;font-size:11px;color:#888;">Auto-generated monthly from your expense ledger. Source: <code>functions/monthly-overhead-alert.js</code>.</div>',
    '</div>',
  ].join('\n');
  return { subject, bodyHtml, bodyPlain };
}

module.exports = {
  TZ, etYmd, monthKeyOf, monthKeysAt, fmtCents, escapeHtml, prettyCategory,
  summarizeOverhead, buildEmail,
};
