// pro-index-auth-redirect.module.js — non-blocking auth check
// Extracted from inline <script type="module"> in /pro/index.html so the
// strict CSP (script-src 'self') can execute it. Anonymous users see the
// landing immediately; logged-in users are redirected to the dashboard.
try {
  const { NBDAuth } = await import('/pro/js/nbd-auth.js');
  NBDAuth.init({
    requiredPlan: 'free',
    onReady: (user) => { if (user) window.location.replace('/pro/dashboard.html'); }
  });
} catch (e) { /* landing content is already visible; silent fail is correct */ }
