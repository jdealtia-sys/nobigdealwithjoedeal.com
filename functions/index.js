/**
 * Firebase Cloud Functions — NBD Pro API Proxy
 *
 * Keeps the Anthropic API key server-side (in Firebase secrets).
 * Client calls this function instead of hitting Anthropic directly.
 *
 * SETUP:
 *   1. cd functions && npm install
 *   2. firebase functions:secrets:set ANTHROPIC_API_KEY
 *      (paste your sk-ant-... key when prompted)
 *   3. firebase deploy --only functions
 *
 * CLIENT USAGE:
 *   const result = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <firebase-id-token>' },
 *     body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [...] })
 *   });
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

// Secret stored in Firebase Secret Manager
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

exports.claudeProxy = onRequest(
  {
    cors: ['https://nobigdealwithjoedeal.com', 'https://nobigdeal-pro.web.app', 'http://localhost:5000'],
    secrets: [ANTHROPIC_API_KEY],
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // Only POST allowed
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      // Rate limiting check (simple — per-user, per-minute)
      const userRef = admin.firestore().doc(`rate_limits/${decoded.uid}`);
      const userSnap = await userRef.get();
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      const maxRequests = 30;  // 30 requests per minute

      if (userSnap.exists()) {
        const data = userSnap.data();
        const windowStart = data.windowStart || 0;
        const count = data.count || 0;

        if (now - windowStart < windowMs && count >= maxRequests) {
          res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
          return;
        }

        if (now - windowStart >= windowMs) {
          await userRef.set({ windowStart: now, count: 1 });
        } else {
          await userRef.update({ count: count + 1 });
        }
      } else {
        await userRef.set({ windowStart: now, count: 1 });
      }

      // Forward to Anthropic
      const { model, max_tokens, messages, system, temperature } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'messages array required' });
        return;
      }

      const anthropicBody = {
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(max_tokens || 1000, 4096), // Cap at 4096
        messages,
      };
      if (system) anthropicBody.system = system;
      if (temperature !== undefined) anthropicBody.temperature = temperature;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY.value(),
        },
        body: JSON.stringify(anthropicBody),
      });

      const data = await response.json();

      if (!response.ok) {
        res.status(response.status).json(data);
        return;
      }

      // Log usage for analytics
      try {
        await admin.firestore().collection('api_usage').add({
          uid: decoded.uid,
          model: anthropicBody.model,
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        // Non-critical — don't fail the request
        console.warn('Usage logging failed:', e);
      }

      res.json(data);

    } catch (e) {
      console.error('Claude proxy error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);
