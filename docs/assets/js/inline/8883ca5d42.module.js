/* @generated — extracted from inline <script type="module"> by audit-homeowner-2026-05-22.
   Hash: 8883ca5d42.  Do not edit by hand. */
import { NBDAuth } from '/pro/js/nbd-auth.js';
  window._nbdAuth = NBDAuth.init({
    requiredPlan: 'foundation',
    onReady: (user) => {
      if (user) {
        document.getElementById('user-name').textContent = user.displayName || user.email;
        document.getElementById('user-plan').textContent = NBDAuth.userPlan || 'team';
      }
    }
  });
