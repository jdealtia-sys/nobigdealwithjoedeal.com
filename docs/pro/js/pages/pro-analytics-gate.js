/**
 * NBD Pro — /pro/analytics.html auth gate.
 * Extracted from an inline <script type="module"> so strict CSP can drop
 * 'unsafe-inline'. Initializes the shared NBDAuth gate and boots the
 * analytics controller once the user is verified.
 */
import { NBDAuth } from '/pro/js/nbd-auth.js';

window._nbdAuth = NBDAuth.init({
  requiredPlan: 'starter',
  onReady: () => {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    if (typeof window.bootAnalytics === 'function') window.bootAnalytics();
  }
});
