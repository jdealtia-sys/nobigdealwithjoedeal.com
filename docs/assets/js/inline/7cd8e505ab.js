/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 7cd8e505ab.  Do not edit by hand (comment updated 2026-08-07).

   DEPLOYMENT ORDER (pinned by tests/turnstile-contract.test.js): this key
   MUST be populated (and deployed) BEFORE TURNSTILE_SECRET is set on the
   server or TURNSTILE_REQUIRED=true is exported. A configured server rejects
   every tokenless submission (403) — with this key empty the client can never
   produce a token, so setting the secret first silently kills all public
   leads. Populate key → deploy → then set the secret. */
window.__NBD_TURNSTILE_SITEKEY = "";
