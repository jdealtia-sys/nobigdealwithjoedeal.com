/**
 * NBD Pro — /pro/understand.html auth gate.
 * Extracted from an inline <script type="module"> for strict CSP.
 */
import { NBDAuth } from '/pro/js/nbd-auth.js';

window._nbdAuth = NBDAuth.init({
  requiredPlan: 'professional',
  onReady: (user) => {
    window._authUser = user;
    window._db = NBDAuth.db;
    window._firebaseReady = true;
    if (typeof window.initUnderstand === 'function') window.initUnderstand();
  }
});
