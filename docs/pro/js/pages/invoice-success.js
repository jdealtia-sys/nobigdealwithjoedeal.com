// Invoice payment success page (homeowner-facing landing after a Stripe
// payment-link completion — createStripePaymentLink's after_completion redirect).
//
// SECURITY: this page deliberately fetches NOTHING. The invoiceId in the URL is
// treated as an opaque display-only reference, never used to query invoice
// details — a public/unauthenticated read-by-id would be an IDOR. We only echo a
// charset-validated id via textContent (no innerHTML, no reflected-XSS surface).
(function () {
  try {
    var params = new URLSearchParams(window.location.search || '');
    var raw = params.get('invoiceId') || '';
    // Firestore doc ids / our invoice ids are conservative alphanumerics.
    // Anything outside the allowlist (or over-length) → hide the reference row
    // rather than render attacker-influenced junk.
    if (raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw)) {
      var val = document.getElementById('refValue');
      var line = document.getElementById('refLine');
      if (val && line) {
        val.textContent = raw;         // textContent, not innerHTML — inert
        line.style.display = '';
      }
    }
  } catch (_) {
    // Never let a display nicety break the confirmation page.
  }
})();
