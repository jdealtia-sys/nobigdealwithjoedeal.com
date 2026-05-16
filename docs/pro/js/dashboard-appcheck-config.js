// App Check (C-4): the reCAPTCHA v3 site key is origin-bound and
// safe to embed. Set window.__NBD_APP_CHECK_KEY here BEFORE the
// Firebase init module reads it. Keep it in sync across
// dashboard.html, customer.html, and any other page that talks to
// the Firebase SDK.
//
// CSP hotfix: this used to live as an inline <script> directly in
// dashboard.html. Production CSP `script-src-elem 'self'` blocks
// inline tags, so the entire dashboard hung at the load screen
// because Firebase auth never initialized. Loaded as a classic
// (non-deferred) external script so it runs synchronously and
// sets the global BEFORE the deferred `type="module"` Firebase
// init runs.
window.__NBD_APP_CHECK_KEY = "6LcuaMosAAAAAIaR0UKNVKdg2N_h2zFUj63gQKQE";
