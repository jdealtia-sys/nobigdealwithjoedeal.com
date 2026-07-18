/**
 * customer-estimate-rows.js — customer-facing display rows for a SAVED estimate.
 *
 * The customer-portal estimate export (exportCustomerEstimate in
 * customer-bootstrap.module.js) used to print est.rows verbatim. Post-sweep V2
 * saves persist the RETAIL price in rows[].rate/total (+ rows[].retailTotal),
 * but V2/insurance docs saved BEFORE the 2026-07-18 money-math sweep wrote the
 * raw COST basis (material+labor, no markup, no O&P) there — so the portal PDF
 * showed the contractor's cost under a retail total and exposed the margin to
 * the homeowner/adjuster.
 *
 * buildDisplayRows(est) mirrors InvoicePipeline.buildRowItems (which customer
 * pages don't load) with the same ladder, per row:
 *   1. rows[].retailTotal when present            → post-sweep saves, exact
 *   2. materialTotal×(1+markup) + laborTotal      → older V2 docs w/ cost split
 *      (rows whose split is all-zero — SVC pass-through fees — stay at face)
 *   3. rows[].total verbatim                      → classic rows: already the
 *      all-in customer price; rate keeps its display string ('$595/SQ')
 * plus the same two structural rules:
 *   - per-SQ docs return NO rows: their rows are the internal cost basis and
 *     can never foot to the selected-tier grandTotal (the invoice bills these
 *     as one summary line; the server quote suppresses lines the same way)
 *   - V2 docs with an O&P ladder get an 'Overhead & Profit (N%)' row appended
 *     so the printed lines foot to the subtotal, matching the signed scope.
 *
 * Pure + dependency-free: unit-tested in tests/customer-estimate-rows.test.js.
 */
(function () {
  'use strict';

  // First numeric token out of a value — qty/rate/total may be display strings
  // ('20.00 SQ', '$595/SQ'); a bare parseFloat would NaN on the '$' forms.
  function numFrom(v) {
    if (typeof v === 'number') return v;
    const m = String(v == null ? '' : v).match(/-?\d[\d,]*\.?\d*/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * @param {object} est saved estimate doc (classic or V2 shape)
   * @returns {Array<{code:string,desc:string,qty:string,rate:string,total:number}>}
   */
  function buildDisplayRows(est) {
    if (!est) return [];
    // Per-SQ: rows are internal cost lines; the tier price is the only
    // customer number. Same detection as InvoicePipeline.createInvoiceFromEstimate.
    if (est.priceMode === 'per-sq' || est.prices != null) return [];

    const markup = Number(est.materialMarkupPct);
    const hasV2Pricing = Number.isFinite(markup);

    const rows = (est.rows || []).map(function (row) {
      const explicitRetail = (row.retailTotal != null && Number.isFinite(Number(row.retailTotal)))
        ? Number(row.retailTotal) : null;
      const hasSplit = hasV2Pricing && (row.materialTotal != null || row.laborTotal != null);
      let total;
      if (explicitRetail != null) {
        total = explicitRetail;
      } else if (hasSplit) {
        const mat = Number(row.materialTotal) || 0;
        const lab = Number(row.laborTotal) || 0;
        total = (mat === 0 && lab === 0) ? numFrom(row.total) : mat * (1 + markup) + lab;
      } else {
        total = numFrom(row.total);
      }
      total = Number.isFinite(total) ? round2(total) : 0;

      let rate;
      if (explicitRetail != null || hasSplit) {
        // Retail-priced row: derive the unit rate from the retail total — the
        // saved rate string on pre-sweep docs is the COST rate, never print it.
        const qty = numFrom(row.qty);
        const unit = (Number.isFinite(qty) && qty !== 0) ? total / qty : total;
        rate = '$' + round2(unit).toFixed(2);
      } else {
        rate = row.rate == null ? '' : String(row.rate);
      }

      return {
        code: row.code == null ? '' : String(row.code),
        desc: String(row.desc || row.description || ''),
        qty: row.qty == null ? '' : String(row.qty),
        rate: rate,
        total: total
      };
    });

    const ohp = (Number(est.overhead) || 0) + (Number(est.profit) || 0);
    if (hasV2Pricing && ohp > 0 && rows.length) {
      const pct = Math.round(((Number(est.overheadPct) || 0) + (Number(est.profitPct) || 0)) * 100);
      rows.push({
        code: 'O&P',
        desc: 'Overhead & Profit' + (pct ? ' (' + pct + '%)' : ''),
        qty: '',
        rate: '',
        total: round2(ohp)
      });
    }
    return rows;
  }

  const _api = { buildDisplayRows: buildDisplayRows, numFrom: numFrom };
  if (typeof window !== 'undefined') {
    window.NBDCustomerEstimateRows = _api;
  }
  // Node (unit tests) require() this file; expose the same API via CommonJS.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
  }
})();
