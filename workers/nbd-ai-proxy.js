/**
 * NBD AI Proxy — Cloudflare Worker — DEPRECATED AND DISABLED (2026-04-11)
 *
 * This worker previously forwarded Anthropic requests using a secret API key
 * with only an Origin header check for auth. It had three fatal flaws:
 *
 *   1. The origin check was bypassed when the Origin header was absent
 *      (server-side callers pass no Origin), so anyone with curl could spend
 *      Joe's Anthropic budget at will.
 *   2. `ALLOWED_ORIGINS.some(o => origin.startsWith(o))` is a subdomain-prefix
 *      match — it is not an exact-host allowlist.
 *   3. There was no per-uid cap, no subscription gate, no daily budget.
 *
 * All legitimate traffic now goes through the Firebase `claudeProxy` Cloud
 * Function (requires Firebase ID token, App Check, subscription, rate limit,
 * and a daily token budget). This worker is left in place as a 410 stub so
 * that any client that still points at the old URL fails loudly.
 *
 * DEPLOY:
 *   wrangler deploy
 * THEN, in the Cloudflare dashboard, delete the `nbd-ai-proxy` worker entirely.
 */

export default {
  async fetch(request) {
    const body = JSON.stringify({
      error: 'gone',
      message: 'This endpoint has been retired. Use the Firebase claudeProxy function instead.',
    });
    return new Response(body, {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  },
};
