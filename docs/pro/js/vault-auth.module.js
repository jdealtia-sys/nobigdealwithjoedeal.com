// vault-auth.module.js — auth bootstrap for /pro/vault
// Extracted from inline <script type="module"> in vault.html so the
// strict CSP (script-src 'self' with no unsafe-inline) lets it run.
import { NBDAuth } from '/pro/js/nbd-auth.js';
window._nbdAuth = NBDAuth.init({
  requiredPlan: 'professional',
  requireAdmin: true,
  onReady: (user) => {
    window._authUser = user;
    window._db = NBDAuth.db;
    console.log('NBD Auth ready — admin:', NBDAuth.isAdmin);
  }
});
