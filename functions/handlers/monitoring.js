/**
 * functions/handlers/monitoring.js — CSP / browser-monitoring endpoints.
 *
 * Step 4c extraction. Moved verbatim from functions/index.js:
 *   - cspReport (onRequest, accepts CSP violation reports → logs only)
 *
 * No behavioral changes; pure structural move.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');

const { httpRateLimit } = require('../integrations/upstash-ratelimit');

// ═════════════════════════════════════════════════════════════
// F-09: CSP violation report receiver.
//
// The Report-Only CSP in firebase.json is currently a no-op because
// violations have nowhere to go. This endpoint accepts both the
// classic `application/csp-report` body shape (report-uri) and the
// newer `application/reports+json` array shape (Reporting API /
// report-to) and logs a bounded subset of fields.
//
// We accept unauthenticated POSTs — the browser fires these without
// credentials. Per-IP rate limit and hard size cap protect against
// log-flooding. Firestore is intentionally NOT written; logs are
// enough and cheaper.
// ═════════════════════════════════════════════════════════════
exports.cspReport = onRequest(
  {
    region: 'us-central1',
    cors: false,
    maxInstances: 5,
    concurrency: 80,
    timeoutSeconds: 5,
    memory: '128MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    try {
      // Hard size cap — bounded-budget log ingestion.
      const raw = req.rawBody;
      if (raw && Buffer.isBuffer(raw) && raw.length > 8192) {
        res.status(413).end(); return;
      }
      // Per-IP rate limit — 60/min/IP. Normal reporting is well below
      // this; a page stuck in a CSP loop could exceed. Soft fail OK.
      try {
        await httpRateLimit(req, res, 'cspReport:ip', 60, 60_000);
      } catch (_) { /* ignore rate-limit errors; log pipeline */ }

      const body = req.body || {};
      // `report-uri` shape: { "csp-report": { ... } }
      // `report-to` shape: [ { type: 'csp-violation', body: { ... } } ]
      const reports = Array.isArray(body)
        ? body.map(r => r && r.body).filter(Boolean)
        : body['csp-report']
          ? [body['csp-report']]
          : [body];
      for (const r of reports) {
        logger.warn('csp_violation', {
          documentURI:        String(r['document-uri']       || r.documentURL || '').slice(0, 400),
          blockedURI:         String(r['blocked-uri']        || r.blockedURL  || '').slice(0, 400),
          violatedDirective:  String(r['violated-directive'] || r.effectiveDirective || '').slice(0, 200),
          originalPolicy:     String(r['original-policy']    || r.originalPolicy     || '').slice(0, 500),
          disposition:        String(r.disposition || '').slice(0, 20),
          sourceFile:         String(r['source-file']        || r.sourceFile || '').slice(0, 400),
          lineNumber:         Number(r['line-number']        || r.lineNumber || 0) || null,
          statusCode:         Number(r['status-code']        || r.statusCode || 0) || null,
          userAgent:          String(req.headers['user-agent'] || '').slice(0, 200)
        });
      }
      res.status(204).end();
    } catch (e) {
      logger.warn('cspReport error', { err: e.message });
      res.status(204).end();  // Never signal failure to the browser — it'll retry.
    }
  }
);
