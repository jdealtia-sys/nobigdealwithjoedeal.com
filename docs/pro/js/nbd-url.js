/**
 * nbd-url.js — canonical URL builder for customer-scoped pages.
 *
 * One source of truth so future code can't accidentally re-introduce
 * the `?id=` vs `?lead=` inconsistency that bit photo-review's
 * "Review & Sort" button (PR #436).
 *
 * Exposes:
 *   window.NBDUrl.customer(id)     → /pro/customer.html?id=<encoded>
 *   window.NBDUrl.photoReview(id)  → /pro/photo-review.html?id=<encoded>
 *
 * Page-level param parsing on photo-review.html keeps accepting the
 * legacy `?lead=` form so old bookmarks / Slack links don't break,
 * but EVERY NEW caller in the codebase should route through this
 * helper. Smoke tests enforce that no raw `customer.html?lead=` or
 * `photo-review.html?lead=` string literals appear in source.
 *
 * Security note: customer-scope IDOR is enforced server-side by
 * Firestore rules at firestore.rules:73 — `allow read, update,
 * delete: if isOwner(resource.data.userId) || isAdmin();`. Even if a
 * user guesses another tenant's lead ID, the Firestore read fails
 * permission-denied. The URL pattern is purely a UX concern; no
 * obfuscation needed for safety.
 */
(function () {
  'use strict';

  if (window.NBDUrl && window.NBDUrl.__sentinel === 'nbd-url-v1') return;

  // Reject anything that obviously isn't a Firestore ID. Doesn't try
  // to validate format strictly — Firestore auto-IDs are 20-char
  // [a-zA-Z0-9], but custom IDs exist too. Just refuses empty /
  // non-string input so we never emit `?id=`-with-empty-value URLs.
  function _valid(id) {
    return typeof id === 'string' && id.length > 0;
  }

  function customer(id) {
    if (!_valid(id)) return null;
    return '/pro/customer.html?id=' + encodeURIComponent(id);
  }

  function photoReview(id) {
    if (!_valid(id)) return null;
    return '/pro/photo-review.html?id=' + encodeURIComponent(id);
  }

  window.NBDUrl = {
    __sentinel: 'nbd-url-v1',
    customer: customer,
    photoReview: photoReview,
  };
})();
