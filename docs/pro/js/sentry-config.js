/**
 * sentry-config.js — single source of truth for the Sentry DSN.
 *
 * To wire up Sentry error reporting for the whole pro app:
 *
 *   1. Create a free account at https://sentry.io and a new project
 *      (Platform: "Browser JavaScript", framework "None").
 *   2. Copy the DSN — it looks like
 *      https://abc123@o4xxxxxx.ingest.us.sentry.io/12345678
 *   3. Paste it into NBD_SENTRY_DSN below.
 *   4. Commit + deploy. sentry-init.js no-ops until this is non-empty.
 *
 * The DSN is public — it's an origin identifier, not a secret. Sentry
 * gates ingestion on the `Allowed Domains` field in the project's
 * Security Headers settings, so set that to your origins:
 *   - nobigdeal-pro.web.app
 *   - nobigdealwithjoedeal.com
 *   - www.nobigdealwithjoedeal.com
 *   - localhost (dev convenience)
 *
 * If a third party lifts the DSN they can't spam Sentry from another
 * origin — the browser SDK adds the Origin header which Sentry checks.
 *
 * Loaded on every pro page before sentry-init.js so any page can
 * report errors (login.html, customer.html, vault.html, dashboard.html,
 * etc.). Previously the DSN was hardcoded only in dashboard.html, so
 * login-flow errors fell on the floor.
 */
(function () {
  'use strict';

  // PASTE YOUR SENTRY DSN BETWEEN THE QUOTES ───────────────────────
  var NBD_SENTRY_DSN = '';
  // ─────────────────────────────────────────────────────────────────

  window.__NBD_SENTRY_DSN = NBD_SENTRY_DSN;

  // Release identifier — Sentry groups errors by release so you can
  // correlate "this bug spiked after deploy X." We don't have a build
  // pipeline yet so the date stamp is a coarse but useful proxy. Bump
  // on every meaningful deploy or wire to the git SHA when esbuild
  // lands.
  window.__NBD_RELEASE = 'web@2026-04-26';
})();
