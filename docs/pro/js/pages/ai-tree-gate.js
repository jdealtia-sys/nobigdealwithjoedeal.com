/**
 * NBD Pro — /pro/ai-tree.html auth gate.
 * Extracted from an inline <script type="module"> for strict CSP.
 */
import { NBDAuth } from '/pro/js/nbd-auth.js';

window._nbdAuth = NBDAuth.init({
  requiredPlan: 'professional',
  onReady: () => {
    document.documentElement.style.visibility = 'visible';
  }
});
