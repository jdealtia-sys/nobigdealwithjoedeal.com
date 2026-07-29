/**
 * NBD Pro — provisioning-retry.js (first-run audit 2026-07-28, root cause).
 *
 * ONE shared answer to "createCompany didn't land". Before this module, seven
 * call sites (register.js ×6, stripe-success.js ×1) each made a SINGLE
 * attempt and swallowed the failure with console.warn — a transient network
 * blip or App Check hiccup at the one moment that matters left the account
 * permanently tenant-less: no companies/{uid} doc, no companyId claim, public
 * leads misrouted to the platform owner, phantom-company team ops.
 *
 * ensureProvisioned(user, callThunk, opts):
 *   - retries the callable (bounded, exponential backoff) — createCompany is
 *     idempotent server-side (existing doc → {created:false} + claim re-merge)
 *     so re-running is always safe;
 *   - NEVER retries functions/failed-precondition (invited rep / conflict —
 *     permanent) or functions/resource-exhausted (rate-limited 5/hr —
 *     retrying only burns the quota the next surface needs);
 *   - on success: token refresh (claims live NOW), clears the per-uid pending
 *     marker, returns true;
 *   - on final failure: sets localStorage 'nbd_provision_pending_'+uid (same
 *     per-uid convention as nbd_invite_checked_) so the dashboard-bootstrap
 *     login-time self-heal retries on the next dashboard load, warns once,
 *     returns false. NEVER throws.
 *
 * Deliberately a static ES module import at every consumer (register.js,
 * onboarding.js, stripe-success.js) — NOT a window.X helper. A page-scoped
 * helper behind a `window.X && …` guard is the silent-failure class this
 * repo has been burned by (#1110/#1111): the guard "works" on pages that
 * never loaded the helper and the tenant never gets provisioned, no error.
 */

// Codes that must NOT be retried:
//   functions/failed-precondition — invited rep / conflicting membership;
//     the server will refuse every attempt, permanently.
//   functions/resource-exhausted — callableRateLimit('createCompany', 5, 1h);
//     hammering it burns the budget the wizard/dashboard heals draw from.
//   functions/invalid-argument — deterministic input rejection (e.g. a name
//     outside the server's 2-80 char rule); identical input fails identically.
const PERMANENT_CODES = ['functions/failed-precondition', 'functions/resource-exhausted', 'functions/invalid-argument'];

export async function ensureProvisioned(user, callThunk, opts) {
  const { attempts = 3, baseDelayMs = 800 } = opts || {};
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await callThunk();
      // Claims (companyId/role) were just minted or re-merged — refresh so
      // THIS session sees them. Best-effort: the company exists either way,
      // and the next natural token refresh picks the claims up.
      try { await user.getIdToken(true); } catch (_) {}
      try { localStorage.removeItem('nbd_provision_pending_' + user.uid); } catch (_) {}
      return true;
    } catch (e) {
      lastErr = e;
      const code = (e && e.code) || '';
      if (PERMANENT_CODES.includes(code)) break;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
      }
    }
  }
  // Mark the account so the dashboard-bootstrap login-time self-heal retries
  // on the next dashboard load (per-uid: a shared device must not leak the
  // marker across accounts, and invitees — who never call this — never get
  // one, keeping claimInvite semantics untouched).
  try { localStorage.setItem('nbd_provision_pending_' + user.uid, '1'); } catch (_) {}
  console.warn('createCompany provisioning failed (marked pending for login-time self-heal):',
    (lastErr && (lastErr.code || lastErr.message)) || lastErr);
  return false;
}
