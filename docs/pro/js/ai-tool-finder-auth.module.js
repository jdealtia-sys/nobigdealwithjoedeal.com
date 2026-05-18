// ai-tool-finder-auth.module.js — auth bootstrap for /pro/ai-tool-finder
// Extracted from inline <script type="module"> so the strict CSP
// (script-src 'self') can execute it.
import { NBDAuth } from '/pro/js/nbd-auth.js';
window._nbdAuth = NBDAuth.init({
  requiredPlan: 'professional',
  onReady: (user) => {
    console.log('NBD Auth ready — plan:', NBDAuth.userPlan);
  }
});
