/**
 * money-dashboard.js — the #/money P&L capstone.
 *
 * A consolidated financial snapshot that ties together the subsystems built
 * across the expense initiative: paid invoices (cash in), the expense ledger
 * (COGS + overhead), won-job contract value + per-job margin, supplier spend,
 * outstanding A/R, and the 1099 worklist.
 *
 * Exposes: window.MoneyDashboard
 *
 * Two clearly-labelled lenses to avoid the revenue-basis trap:
 *   - CASH (this year): collected (paid invoices, by paidAt) vs spent (expenses
 *     by date) -> net cash. Date-reliable, cash basis.
 *   - JOB PROFITABILITY: won-job contract value (jobValue) vs direct costs ->
 *     gross margin. Same basis as the Expenses view's per-job margin.
 *
 * computePnL() is pure (no DOM/Firebase) and exported for unit tests. Reads
 * costType denormalized off each expense doc (no ExpenseConfig dependency in
 * the compute), and the supplier's stored is1099Eligible flag.
 */
(function () {
  'use strict';

  function uid() { return (window._user && window._user.uid) || null; }
  function claims() { return window._userClaims || {}; }
  function companyId() { return claims().companyId || uid(); }
  function isStaff() { var r = claims().role; return r === 'company_admin' || r === 'manager' || r === 'admin'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toJSDate(v) { if (!v) return null; if (typeof v.toDate === 'function') return v.toDate(); if (v.seconds) return new Date(v.seconds * 1000); var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  function fmt(cents) {
    var n = (parseInt(cents, 10) || 0) / 100;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }
  function invoiceCents(inv) { return Math.round((parseFloat(inv.total) || 0) * 100); }
  // Cash actually collected on an invoice = total - balanceDue (so a paid
  // invoice with a residual write-off, or a partial payment, counts the real
  // cash, not the full face value). QA finding.
  function collectedCentsOf(inv) {
    var total = parseFloat(inv.total) || 0;
    var bal = (inv.balanceDue != null) ? (parseFloat(inv.balanceDue) || 0) : 0;
    return Math.round(Math.max(0, total - bal) * 100);
  }
  // Canonicalize a vendor name for 1099 matching (mirrors ExpenseConfig.normVendor;
  // inlined to keep this a dependency-free single-module bundle).
  function normVendor(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[.,#&]/g, ' ')
      .replace(/\b(inc|llc|l\.l\.c|co|corp|company|ltd)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Calendar YEAR of a date in the house timezone (America/New_York) — the same
  // convention the monthly-overhead cron uses (monthly-overhead-logic.js), so
  // the client dashboard and the server bucket a date into the same period
  // instead of drifting by the viewer's local offset near year boundaries.
  // Accepts a Date or a raw/Firestore value; null for a null/invalid date. (#11)
  function etYear(v) {
    var d = (v && typeof v.getTime === 'function') ? v : toJSDate(v);
    if (!d || isNaN(d.getTime())) return null;
    return Number(d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 4));
  }

  var WON_STAGES = ['closed', 'install_complete', 'final_photos', 'final_payment', 'deductible_collected', 'Complete'];
  // Role-aware (freeform-pipeline foundation): prefer the denormalized
  // _stageRole (custom-stage-safe), fall back to WON_STAGES for un-stamped leads.
  function isWon(l) {
    var won = (l && l._stageRole) ? l._stageRole === 'won' : WON_STAGES.indexOf((l && (l._stageKey || l.stage)) || '') !== -1;
    return won && !!l && !l.deleted;
  }
  // 1099-NEC threshold by tax year (OBBBA: $2,000 for 2026+). Cents.
  function thresholdCents(year) { var t = { 2024: 60000, 2025: 60000, 2026: 200000 }; return t[year] || 200000; }

  // ── Pure P&L computation (exported for tests) ───────────────────────
  function computePnL(data) {
    var leads = data.leads || [], expenses = data.expenses || [],
        invoices = data.invoices || [], suppliers = data.suppliers || [];
    var year = data.year || etYear(new Date());

    // Cash basis (dated): collected (paid invoices) vs spent (expenses) this year.
    // Year membership is decided in ET (house convention), same as the expense
    // + 1099 buckets below, so nothing straddles the boundary inconsistently.
    var collectedCents = 0;
    invoices.forEach(function (inv) {
      // Attribute collected cash by the DATE it was received. paidAt is only
      // stamped on full payoff, so a partial deposit (real cash in hand, with
      // balanceDue reduced) was invisible here — understating Collected/Net
      // Cash by every open job's deposit. lastPaymentAt (stamped on every
      // payment incl. partials by markPaid + the Stripe webhook) is the real
      // receipt date; fall back to paidAt for legacy docs.
      var payDate = inv.lastPaymentAt != null ? inv.lastPaymentAt : inv.paidAt;
      if (etYear(toJSDate(payDate)) === year) collectedCents += collectedCentsOf(inv);
    });
    var outstandingCents = 0;
    invoices.forEach(function (inv) {
      if (inv.status === 'paid') return;
      outstandingCents += Math.round((parseFloat(inv.balanceDue) || parseFloat(inv.total) || 0) * 100);
    });

    var spentCents = 0, cogsCents = 0, overheadCents = 0;
    var directByLead = {}, supplierCents = {};
    expenses.forEach(function (e) {
      var d = toJSDate(e.date);
      if (etYear(d) !== year) return;
      // Cash out + COGS = the tax-INCLUDED total (amount + tax): you paid the
      // tax to the supplier, so it's real spend and belongs in job cost
      // (product decision 2026-07-08). Same rule in profit-tracker.js +
      // expenses.js aggregate(). NOTE: the 1099 YTD below stays PRE-tax.
      var c = (parseInt(e.amountCents, 10) || 0) + (parseInt(e.taxCents, 10) || 0);
      spentCents += c;
      if (e.costType === 'direct') { cogsCents += c; if (e.leadId) directByLead[e.leadId] = (directByLead[e.leadId] || 0) + c; }
      else overheadCents += c;
      // Group suppliers by NORMALIZED vendor so "ABC Supply" and "abc supply "
      // collapse to one row (same normVendor used for the 1099 match below).
      var supRaw = (e.supplier || '').trim() || 'Unknown';
      var supKey = normVendor(supRaw) || 'unknown';
      if (!supplierCents[supKey]) supplierCents[supKey] = { label: supRaw, cents: 0 };
      supplierCents[supKey].cents += c;
    });
    var netCashCents = collectedCents - spentCents;

    // Job profitability (jobValue basis), costed won jobs only — uncosted jobs
    // would inflate margin (the trap a unit test caught in the Insights cards).
    var wonLeads = leads.filter(isWon);
    var wonContractCents = 0, wonDirectCents = 0, costedJobs = 0;
    wonLeads.forEach(function (l) {
      var revC = Math.round((parseFloat(l.jobValue) || 0) * 100);
      var dc = directByLead[l.id] || 0;
      if (revC > 0 && dc > 0) { wonContractCents += revC; wonDirectCents += dc; costedJobs += 1; }
    });
    var grossMargin = wonContractCents > 0 ? Math.round(((wonContractCents - wonDirectCents) / wonContractCents) * 100) : null;

    // Top suppliers (this-year spend), grouped by normalized vendor above.
    var topSuppliers = Object.keys(supplierCents).map(function (k) { return { supplier: supplierCents[k].label, cents: supplierCents[k].cents }; })
      .sort(function (a, b) { return b.cents - a.cents; }).slice(0, 5);

    // 1099 worklist: eligible class (stored flag) + W-9 on file + YTD service
    // spend (matched by name) >= the year's threshold.
    var th = thresholdCents(year);
    var due1099 = 0, due1099Cents = 0;
    suppliers.forEach(function (s) {
      if (!s.is1099Eligible) return;
      if (s.w9Status !== 'received' && s.w9Status !== 'verified') return;
      var nm = normVendor(s.displayName);
      var ytd = expenses.reduce(function (sum, e) {
        if (e.category !== 'subcontractor' && e.category !== 'direct_labor') return sum;
        if (normVendor(e.supplier) !== nm) return sum;
        // 1099 box 1 = amounts paid for SERVICES, PRE-tax (sales tax is not
        // nonemployee compensation) — deliberately amountCents only, unlike the
        // cash/COGS totals above which include tax.
        return (etYear(toJSDate(e.date)) === year) ? sum + (parseInt(e.amountCents, 10) || 0) : sum;
      }, 0);
      if (ytd >= th) { due1099 += 1; due1099Cents += ytd; }
    });

    return {
      year: year,
      collectedCents: collectedCents, spentCents: spentCents, netCashCents: netCashCents,
      cogsCents: cogsCents, overheadCents: overheadCents, outstandingCents: outstandingCents,
      wonContractCents: wonContractCents, wonDirectCents: wonDirectCents, grossMargin: grossMargin,
      costedJobs: costedJobs, wonJobs: wonLeads.length,
      topSuppliers: topSuppliers, supplierCount: Object.keys(supplierCents).length,
      due1099: due1099, due1099Cents: due1099Cents, thresholdCents: th,
    };
  }

  // ── Data fetch ──────────────────────────────────────────────────────
  async function fetchData() {
    var db = window.db || window._db, u = uid();
    var out = { leads: window._leads || [], expenses: [], invoices: [], suppliers: [], year: new Date().getFullYear() };
    if (!db || !u || !window.getDocs) return out;
    var col = window.collection, q = window.query, where = window.where, getDocs = window.getDocs;
    var staff = isStaff() && claims().companyId;
    var jobs = [
      // expenses + suppliers: staff -> companyId, else userId (rule-safe)
      getDocs(staff ? q(col(db, 'expenses'), where('companyId', '==', companyId())) : q(col(db, 'expenses'), where('userId', '==', u)))
        .then(function (s) { out.expenses = s.docs.map(function (d) { return d.data(); }); }).catch(function () {}),
      getDocs(staff ? q(col(db, 'suppliers'), where('companyId', '==', companyId())) : q(col(db, 'suppliers'), where('userId', '==', u)))
        .then(function (s) { out.suppliers = s.docs.map(function (d) { return d.data(); }); }).catch(function () {}),
      // invoices: createdBy (their own historical ownership field)
      getDocs(q(col(db, 'invoices'), where('createdBy', '==', u)))
        .then(function (s) { out.invoices = s.docs.map(function (d) { return d.data(); }); }).catch(function () {}),
    ];
    await Promise.all(jobs);
    return out;
  }

  // ── Render ──────────────────────────────────────────────────────────
  function card(label, value, sub, color) {
    return '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;border-top:2px solid ' + color + ';">' +
      '<div style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">' + esc(label) + '</div>' +
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:26px;font-weight:800;color:' + color + ';margin:2px 0;">' + value + '</div>' +
      '<div style="font-size:10px;color:var(--m,#9ca3af);">' + esc(sub) + '</div></div>';
  }
  function grid(cards) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">' + cards.join('') + '</div>';
  }

  function render(m) {
    var scroll = document.querySelector('#view-money .view-scroll');
    if (!scroll) return;
    var netColor = m.netCashCents >= 0 ? '#16a34a' : '#dc2626';
    var marginColor = m.grossMargin == null ? 'var(--h,#fff)' : m.grossMargin >= 40 ? '#16a34a' : m.grossMargin >= 25 ? '#eab308' : '#dc2626';
    var html = '';
    html += '<div style="margin-bottom:18px;"><h2 style="margin:0;font-family:\'Barlow Condensed\',sans-serif;font-size:26px;font-weight:800;color:var(--h,#fff);">💵 Money — ' + m.year + '</h2>' +
      '<div style="font-size:12px;color:var(--m,#9ca3af);margin-top:2px;">' + (isStaff() && claims().companyId ? 'Team-wide' : 'Your books') + ' · live snapshot</div></div>';

    // Cash (this year)
    html += '<div style="font-size:12px;font-weight:700;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Cash — ' + m.year + ' (collected vs spent)</div>';
    html += grid([
      card('Collected', fmt(m.collectedCents), 'paid invoices', '#16a34a'),
      card('Spent', fmt(m.spentCents), 'COGS + overhead', '#e8720c'),
      card('Net Cash', fmt(m.netCashCents), m.netCashCents >= 0 ? 'in the black' : 'in the red', netColor),
      card('Outstanding A/R', fmt(m.outstandingCents), 'unpaid invoices', '#3b82f6'),
    ]);

    // Job profitability
    html += '<div style="font-size:12px;font-weight:700;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Job profitability (won jobs)</div>';
    html += grid([
      card('Contract Value', fmt(m.wonContractCents), m.costedJobs + ' of ' + m.wonJobs + ' won jobs costed', '#3b82f6'),
      card('Direct Costs', fmt(m.wonDirectCents), 'materials, labor, subs', '#e8720c'),
      card('Gross Margin', m.grossMargin == null ? '—' : m.grossMargin + '%', 'before overhead & commission', marginColor),
      card('Overhead', fmt(m.overheadCents), 'operating costs YTD', '#8b5cf6'),
    ]);

    // Two-column: top suppliers + 1099
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">';
    html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">Top Suppliers — ' + m.year + '</h3>';
    if (!m.topSuppliers.length) html += '<div style="font-size:12px;color:var(--m,#9ca3af);">No spend logged yet.</div>';
    else {
      var max = m.topSuppliers[0].cents || 1;
      m.topSuppliers.forEach(function (s) {
        var w = Math.max(4, Math.round(s.cents / max * 100));
        html += '<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--h,#fff);"><span>' + esc(s.supplier) + '</span><span style="font-weight:700;">' + fmt(s.cents) + '</span></div>' +
          '<div style="height:6px;background:var(--s2,rgba(255,255,255,.06));border-radius:4px;overflow:hidden;margin-top:4px;"><div style="height:100%;width:' + w + '%;background:#e8720c;"></div></div></div>';
      });
    }
    html += '</div>';
    html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">1099 Worklist — ' + m.year + '</h3>' +
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:40px;font-weight:800;color:' + (m.due1099 ? '#e8720c' : 'var(--h,#fff)') + ';">' + m.due1099 + '</div>' +
      '<div style="font-size:12px;color:var(--m,#9ca3af);">supplier(s) need a 1099-NEC · ' + fmt(m.due1099Cents) + ' in service payments</div>' +
      '<div style="font-size:10px;color:var(--m,#9ca3af);margin-top:8px;">Eligible + W-9 on file + ≥ ' + fmt(m.thresholdCents) + ' (' + m.year + ' threshold). Manage in Expenses → Suppliers.</div>' +
      '</div>';
    html += '</div>';

    scroll.innerHTML = html;
  }

  var _loaded = false;
  async function refreshAndRender() {
    var scroll = document.querySelector('#view-money .view-scroll');
    if (scroll && !_loaded) scroll.innerHTML = '<div style="padding:40px;text-align:center;color:var(--m,#9ca3af);">Loading your books…</div>';
    var data = await fetchData();
    _loaded = true;
    try { render(computePnL(data)); }
    catch (e) { console.warn('[money] render failed', e); if (scroll) scroll.innerHTML = '<div style="padding:40px;text-align:center;color:var(--m,#9ca3af);">Could not load the money dashboard.</div>'; }
  }
  function init() { refreshAndRender(); }

  window.MoneyDashboard = {
    init: init,
    render: render,
    refresh: refreshAndRender,
    computePnL: computePnL, // pure — exported for unit tests
  };
})();
