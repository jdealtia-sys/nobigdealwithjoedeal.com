// project-codex-auth.module.js — auth bootstrap for /pro/project-codex
// Extracted from the inline <script type="module"> in project-codex.html
// so the strict CSP (script-src 'self' with no unsafe-inline) lets it run.
import { NBDAuth } from '/pro/js/nbd-auth.js';
window._nbdAuth = NBDAuth.init({
  requiredPlan: 'foundation',
  onReady: (user) => {
    window._authUser = user;
    window._db = NBDAuth.db;
    window._firebaseReady = true;
    if (typeof initCodex === 'function') initCodex();
  }
});
