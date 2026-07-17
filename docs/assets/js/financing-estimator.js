/* financing-estimator.js — illustrative monthly-payment estimator for the
 * /services/financing page (T9).
 *
 * COMPLIANCE: this is an ILLUSTRATION, not an offer of credit. NBD is not a
 * lender and makes no credit decisions. The APR band (11.49%–19.99%) and
 * term range (2–15 yr) are the Acorn Finance marketplace's published ranges;
 * a homeowner's real rate/term/payment are set by a third-party lender on
 * approved credit. All of that is disclosed in-widget (.fe-cap / .fe-disc)
 * and in the page's financing small print. No inline handlers (CSP-safe).
 */
(function () {
  'use strict';
  var APR_LO = 0.1149, APR_HI = 0.1999;
  var amt = document.getElementById('fe-amount');
  var group = document.getElementById('fe-term-group');
  if (!amt || !group) return;
  var years = 5;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  // Fixed fully-amortizing payment: P·r / (1 − (1+r)^−n); r = monthly rate.
  function pay(P, apr, n) { var r = apr / 12; return r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n)); }
  function render() {
    var P = +amt.value, n = years * 12;
    $('fe-amt').textContent = fmt(P);
    $('fe-lo').textContent = fmt(pay(P, APR_LO, n));
    $('fe-hi').textContent = fmt(pay(P, APR_HI, n));
  }
  amt.addEventListener('input', render);
  group.addEventListener('click', function (e) {
    var b = e.target.closest('.fe-term[data-yrs]'); if (!b) return;
    years = +b.getAttribute('data-yrs');
    var tiles = group.querySelectorAll('.fe-term');
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('sel', tiles[i] === b);
    render();
  });
  render();
})();
