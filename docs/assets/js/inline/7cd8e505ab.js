/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 7cd8e505ab.  Do not edit by hand (comment updated 2026-08-07).

   DEPLOYMENT ORDER (pinned by tests/turnstile-contract.test.js): this key
   MUST be populated (and deployed) BEFORE TURNSTILE_SECRET is set on the
   server or TURNSTILE_REQUIRED=true is exported. A configured server rejects
   every tokenless submission (403) — with this key empty the client can never
   produce a token, so setting the secret first silently kills all public
   leads. Populate key → deploy → then set the secret. */
/* Populated 2026-09-06. Cloudflare Turnstile widget "NBD public lead forms",
   INVISIBLE mode, hostnames nobigdealwithjoedeal.com + www. Invisible was
   chosen over Managed deliberately: public-lead-submit.js renders the widget
   with size:'invisible' into a container it appends to document.body, so a
   Managed widget that decided to show an interactive challenge would be
   unusable and would cost the lead. The site key is public by design — it is
   the SECRET key that must never appear here.

   Invisible mode also carries a legal condition, which docs/privacy.html now
   satisfies: Cloudflare's Turnstile Privacy Addendum must be referenced in
   our own privacy policy. */
window.__NBD_TURNSTILE_SITEKEY = "0x4AAAAAAEqcVVOXW3xyusXQ";
