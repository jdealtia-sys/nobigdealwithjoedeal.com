/**
 * claude-proxy.js — Secure Claude API proxy for NBD Pro
 *
 * Routes Claude API calls through Firebase Cloud Function when deployed.
 * Falls back to direct browser call (with localStorage key) when function isn't available.
 *
 * Usage (drop-in replacement for direct fetch):
 *   const result = await callClaude({
 *     model: 'claude-haiku-4-5-20251001',
 *     max_tokens: 1000,
 *     messages: [{ role: 'user', content: 'Hello' }]
 *   });
 *   // result = { content: [...], usage: {...} }
 */

const CLOUD_FUNCTION_URL = 'https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy';
const LOCAL_KEY_STORE = 'nbd_joe_key';

// Track whether Cloud Function is available (avoids repeated timeout on every call)
let _proxyAvailable = null; // null = unknown, true/false = tested
let _proxyLastCheck = 0;
const PROXY_CHECK_INTERVAL = 300000; // Re-check every 5 minutes

/**
 * Call Claude API — secure proxy with fallback
 *
 * @param {object} params — { model, max_tokens, messages, system, temperature }
 * @returns {Promise<object>} — Anthropic API response
 */
async function callClaude(params) {
  // Try Cloud Function first (if available or unknown)
  if (_proxyAvailable !== false || Date.now() - _proxyLastCheck > PROXY_CHECK_INTERVAL) {
    try {
      const result = await _callViaProxy(params);
      _proxyAvailable = true;
      _proxyLastCheck = Date.now();
      return result;
    } catch (e) {
      console.warn('Cloud Function unavailable, falling back to direct call:', e.message);
      _proxyAvailable = false;
      _proxyLastCheck = Date.now();
    }
  }

  // Fallback: direct browser call with localStorage key
  return _callDirect(params);
}

/**
 * Call via Firebase Cloud Function (secure — key is server-side)
 */
async function _callViaProxy(params) {
  // Get Firebase auth token
  const user = window._auth?.currentUser || window.auth?.currentUser;
  if (!user) throw new Error('Not authenticated');

  const idToken = await user.getIdToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Call Anthropic API directly from browser (fallback — key in localStorage)
 */
async function _callDirect(params) {
  const apiKey = localStorage.getItem(LOCAL_KEY_STORE) || '';
  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    throw new Error('No API key configured. Add your Anthropic key in Settings → Ask Joe AI.');
  }

  const body = {
    model: params.model || 'claude-haiku-4-5-20251001',
    max_tokens: params.max_tokens || 1000,
    messages: params.messages,
  };
  if (params.system) body.system = params.system;
  if (params.temperature !== undefined) body.temperature = params.temperature;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  return await response.json();
}

/**
 * Check if secure proxy is available
 */
function isProxyAvailable() {
  return _proxyAvailable === true;
}

/**
 * Force re-check proxy availability on next call
 */
function resetProxyCheck() {
  _proxyAvailable = null;
  _proxyLastCheck = 0;
}

// Expose globally
window.callClaude = callClaude;
window.isClaudeProxyAvailable = isProxyAvailable;
window.resetClaudeProxyCheck = resetProxyCheck;

console.log('✓ Claude proxy loaded (Cloud Function + localStorage fallback)');
