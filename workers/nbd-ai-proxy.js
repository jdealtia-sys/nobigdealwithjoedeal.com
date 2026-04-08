/**
 * NBD AI Proxy — Cloudflare Worker
 * Routes AI requests to Anthropic Claude API with server-side API key.
 * Replaces the old Gemini-based worker.
 *
 * DEPLOY:
 *   1. Go to Cloudflare Dashboard → Workers & Pages
 *   2. Select "nbd-ai-proxy" worker
 *   3. Click "Quick Edit" and paste this entire file
 *   4. Go to Settings → Variables → add ANTHROPIC_API_KEY as a Secret
 *   5. Click "Save and Deploy"
 *
 * Or via Wrangler CLI:
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler deploy
 */

const ALLOWED_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

const ALLOWED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514'
];

const MAX_TOKENS_LIMIT = 4096;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Origin check
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.some(o => origin.startsWith(o)) && origin !== '') {
      return jsonResponse({ error: 'Origin not allowed' }, 403);
    }

    // Check API key is configured
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured in Worker secrets' }, 500);
    }

    try {
      const body = await request.json();

      // Validate required fields
      if (!body.messages || !Array.isArray(body.messages)) {
        return jsonResponse({ error: 'messages array required' }, 400);
      }

      // Build Anthropic request
      const anthropicBody = {
        model: ALLOWED_MODELS.includes(body.model) ? body.model : 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(body.max_tokens || 1000, MAX_TOKENS_LIMIT),
        messages: body.messages
      };

      if (body.system) anthropicBody.system = body.system;
      if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;

      // Forward to Anthropic
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': env.ANTHROPIC_API_KEY
        },
        body: JSON.stringify(anthropicBody)
      });

      const data = await response.json();

      // Return with CORS headers
      return jsonResponse(data, response.status, origin);

    } catch (err) {
      return jsonResponse({ error: 'Internal server error', message: err.message }, 500, origin);
    }
  }
};

function handleCORS(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.find(o => origin.startsWith(o)) || ALLOWED_ORIGINS[0];

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function jsonResponse(data, status = 200, origin = '') {
  const allowedOrigin = ALLOWED_ORIGINS.find(o => origin.startsWith(o)) || ALLOWED_ORIGINS[0];

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
