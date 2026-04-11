/**
 * claude-proxy.js — Secure Claude API helper for NBD Pro
 *
 * Routes every Claude API call through the hardened Firebase Cloud
 * Function `claudeProxy`. The function:
 *   - verifies a Firebase ID token
 *   - requires a valid App Check token (enforceAppCheck: true)
 *   - checks the Stripe subscription is active (admin role bypasses)
 *   - applies per-uid rate limits + a daily token budget
 *
 * There is no longer a direct-browser fallback. The previous localStorage
 * "bring-your-own-key" path let any logged-in user bypass every server-side
 * gate (rate limit, budget, subscription check) by pasting their own key —
 * it was also a common place for API keys to leak into the DOM. Call sites
 * now fail closed: if the proxy isn't reachable, the feature is unavailable.
 *
 * Usage (drop-in replacement for direct fetch):
 *   const result = await callClaude({
 *     model: 'claude-haiku-4-5-20251001',
 *     max_tokens: 1000,
 *     messages: [{ role: 'user', content: 'Hello' }]
 *   });
 */

const CLOUD_FUNCTION_URL = 'https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy';

/**
 * Call Claude via the hardened claudeProxy Cloud Function.
 *
 * @param {object} params — { model, max_tokens, messages, system, temperature }
 * @returns {Promise<object>} — Anthropic API response shape
 */
async function callClaude(params) {
  const user = window._auth?.currentUser || window.auth?.currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken(/*forceRefresh*/ false);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + idToken,
  };

  // Attach App Check token if the host page initialized App Check.
  // nbd-auth.js sets window._nbdGetAppCheckToken when ready.
  try {
    if (typeof window._nbdGetAppCheckToken === 'function') {
      const token = await window._nbdGetAppCheckToken();
      if (token) headers['X-Firebase-AppCheck'] = token;
    }
  } catch (_e) { /* server will reject if enforced and token missing */ }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s

  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + response.status);
    }
    return await response.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// Always-on — the previous `isClaudeProxyAvailable` / `resetClaudeProxyCheck`
// helpers existed only for the direct-fallback path that's now gone.
window.callClaude = callClaude;
window.isClaudeProxyAvailable = () => true;
window.resetClaudeProxyCheck = () => {};

console.log('✓ Claude proxy loaded (Cloud Function only — no client-side fallback)');
