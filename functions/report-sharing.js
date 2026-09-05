/**
 * functions/report-sharing.js — share a saved inspection report with the homeowner
 *
 * Lets a rep mint a no-login link to a saved inspection report so the homeowner
 * can view it. Previously there was NO share path: saveReport() persisted the
 * report HTML inline in /reports/{id}, the customer portal's "View" button read
 * a never-written `htmlUrl`, and the /reports rule is owner-only, so a homeowner
 * could never reach a report.
 *
 * Mirrors the audited deal-acceptance.js / portal.js / remote-signing.js token
 * model, simplified because a report is VIEW-ONLY (no acceptance / signature /
 * burn):
 *   - report_share_tokens/{token} is admin-SDK only (firestore.rules)
 *   - token = 24 chars over a 32-char no-confusable alphabet (~120 bits)
 *   - server-checked expiry (default 30 days); REUSABLE (homeowner may reopen)
 *   - getSharedReport reads the report HTML inline from /reports/{id} via the
 *     admin SDK (bypassing the owner-only rule) and serves it same-origin — the
 *     homeowner never reads Firestore/Storage directly.
 *
 * Exports:
 *   createReportShareToken (onCall)    — rep mints a share link for a report they own
 *   getSharedReport        (onRequest) — /report/<token> → serves that report HTML
 *
 * Security: getSharedReport is intentionally NOT App-Check / auth gated — that's
 * the point of a no-login view link. Compensating controls: unguessable token +
 * expiry + per-IP rate limit + the report HTML is the rep's own generated content
 * (no homeowner-writable surface here). No PII beyond the report the rep chose to
 * share is exposed.
 */
'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');
const { callableRateLimit } = require('./shared');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');
const { secretOr } = require('./integrations/_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app',
];
const REPORT_URL_BASE = 'https://nobigdealwithjoedeal.com/report/';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// 32-char no-confusable alphabet (no 0/O, 1/I/L) — same as deal-acceptance.js / portal.js.
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintToken() {
  const bytes = require('crypto').randomBytes(24);
  let s = '';
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════
// createReportShareToken — rep mints a reusable view link for a report.
// ═══════════════════════════════════════════════════════════════
exports.createReportShareToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 20,
    memory: '256MiB',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    // A compromised rep session could otherwise mint tokens in a loop.
    await callableRateLimit(request, 'createReportShareToken', 30, 60_000);

    const d = request.data || {};
    const reportId = typeof d.reportId === 'string' ? d.reportId : null;
    if (!reportId || !/^[A-Za-z0-9_-]{6,128}$/.test(reportId)) {
      throw new HttpsError('invalid-argument', 'A valid reportId is required');
    }

    const db = getFirestore();
    // Owner-scope: the rep must own the report (or be platform admin).
    const repSnap = await db.doc(`reports/${reportId}`).get();
    if (!repSnap.exists) throw new HttpsError('not-found', 'Report not found');
    const report = repSnap.data();
    const isAdmin = request.auth.token.role === 'admin';
    if (report.userId !== uid && !isAdmin) throw new HttpsError('permission-denied', 'Not your report');
    if (!report.html || typeof report.html !== 'string') {
      throw new HttpsError('failed-precondition', 'This report has no saved content to share');
    }

    const now = Date.now();
    const ttlDays = 30;
    const expiresAt = Timestamp.fromMillis(now + ttlDays * 86_400_000);
    const token = mintToken();
    const meta = report.metadata || {};

    await db.doc(`report_share_tokens/${token}`).set({
      reportId,
      ownerUid: report.userId,
      companyId: report.companyId || report.userId,
      leadId: report.leadId || null,
      customerName: String(meta.propertyAddress || report.type || '').slice(0, 160),
      status: 'active',
      mintedBy: uid,
      mintedAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    const shareUrl = REPORT_URL_BASE + token;

    // Optionally email the homeowner the link. The rep may pass an explicit
    // `email`; otherwise resolve the lead's email from the report's leadId.
    // Best-effort — the token is already minted, so a mail failure surfaces to
    // the rep (emailed:false) without losing the link.
    let toEmail = (typeof d.email === 'string' && EMAIL_RE.test(d.email.trim())) ? d.email.trim() : '';
    let firstName = '';
    if (!toEmail && report.leadId) {
      try {
        const leadSnap = await db.doc(`leads/${report.leadId}`).get();
        if (leadSnap.exists) {
          const lead = leadSnap.data();
          firstName = String(lead.firstName || '').slice(0, 80);
          if (typeof lead.email === 'string' && EMAIL_RE.test(lead.email.trim())) toEmail = lead.email.trim();
        }
      } catch (e) { logger.warn('[createReportShareToken] lead email lookup failed', { err: e.message }); }
    }

    let emailed = false;
    if (toEmail) {
      // Multi-tenant branding: resolve the tenant's legal name so the subject
      // line names THEIR company, not NBD. Keyed by the report's companyId
      // (falls back to the report owner's uid for solo tenants). One
      // best-effort read (only on the email path); NBD (profile brand.legalName
      // is NBD's, or absent) leaves tenantName '' → the exact NBD subject
      // stands → byte-identical.
      let tenantName = '';
      const tenantKey = report.companyId || report.userId;
      if (tenantKey) {
        try {
          const cpSnap = await db.doc(`companyProfile/${tenantKey}`).get();
          if (cpSnap.exists) { const _ln = ((cpSnap.data() || {}).brand || {}).legalName || ''; tenantName = (_ln && _ln !== 'No Big Deal Home Solutions') ? _ln : ''; }  // NBD-name guard (byte-identical; mirrors render-pdf.js/sms-functions.js)
        } catch (e) {
          logger.warn('[createReportShareToken] tenant resolve failed', { reportId, err: e.message });
        }
      }
      try {
        const { Resend } = require('resend');
        const resend = new Resend(RESEND_API_KEY.value());
        const fromEmail = secretOr(EMAIL_FROM, 'noreply@nobigdealwithjoedeal.com');
        const reportName = escHtml(report.type || 'inspection report');
        await resend.emails.send({
          from: fromEmail,
          to: toEmail,
          subject: `Your inspection report from ${tenantName || 'No Big Deal Home Solutions'}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
            <p>Hi ${escHtml(firstName || 'there')},</p>
            <p>Your <strong>${reportName}</strong> is ready. Tap the button below to view it — no login needed.</p>
            <p style="text-align:center;margin:28px 0;">
              <a href="${escHtml(shareUrl)}" style="background:#e8720c;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;display:inline-block;">View Your Report</a>
            </p>
            <p style="font-size:12px;color:#666;">This secure link expires in 30 days. If you didn't expect this, you can ignore the email.</p>
          </div>`,
        });
        emailed = true;
      } catch (e) {
        logger.warn('[createReportShareToken] email send failed', { reportId, err: e.message });
      }
    }

    logger.info('[createReportShareToken] minted', { reportId, emailed });
    return { token, shareUrl, expiresAt: expiresAt.toMillis(), emailed, sentTo: emailed ? toEmail : null };
  }
);

// ═══════════════════════════════════════════════════════════════
// getSharedReport — /report/<token> → serve the report HTML (view-only).
// ═══════════════════════════════════════════════════════════════
exports.getSharedReport = onRequest(
  {
    region: 'us-central1',
    maxInstances: 40,
    concurrency: 40,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    const errPage = (code, msg) => {
      res.status(code).set('Content-Type', 'text/html; charset=utf-8').set('X-Robots-Tag', 'noindex, nofollow')
        // Neutral, unbranded title — an unresolvable/expired report link must
        // not assert NBD's (or any tenant's) identity to a stranger's homeowner.
        .send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Inspection Report</title><body style="font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px"><div><div style="font-size:44px">📋</div><p style="max-width:420px;line-height:1.6;font-size:16px">${escHtml(msg)}</p></div></body>`);
    };
    // token is the last path segment: /report/<token>
    const m = (req.path || '').match(/\/report\/([A-Za-z0-9]{10,64})\/?$/);
    const token = m ? m[1] : '';
    if (!token) { errPage(400, 'This report link is invalid.'); return; }
    // Per-IP rate limit — stops token brute-forcing.
    if (!(await httpRateLimit(req, res, 'sharedreport-get:ip', 30, 60_000))) return;

    const db = getFirestore();
    const tokSnap = await db.doc(`report_share_tokens/${token}`).get();
    if (!tokSnap.exists) { errPage(404, 'This report link is invalid.'); return; }
    const tok = tokSnap.data();
    if (tok.status && tok.status !== 'active') {
      errPage(410, 'This report link has been revoked. Ask your rep for a fresh one.'); return;
    }
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      errPage(410, 'This report link has expired. Ask your rep for a fresh one.'); return;
    }

    // Fire-and-forget viewed stamp (do not gate the response).
    db.doc(`report_share_tokens/${token}`).update({
      viewedAt: FieldValue.serverTimestamp(),
      viewCount: FieldValue.increment(1),
    }).catch(() => {});

    // The report HTML is stored inline on the report doc (saveReport). Read it
    // via the admin SDK — the /reports rule is owner-only, so the homeowner can
    // never read it directly; only this token-gated function can.
    let html = '';
    try {
      const repSnap = await db.doc(`reports/${tok.reportId}`).get();
      if (!repSnap.exists) { errPage(404, 'This report is no longer available.'); return; }
      html = repSnap.data().html || '';
    } catch (e) {
      logger.error('[getSharedReport] report fetch failed', { token: token.slice(0, 6), err: e.message });
      errPage(500, 'We could not load this report right now. Please try again shortly.'); return;
    }
    if (!html) { errPage(404, 'This report has no content to display.'); return; }

    res.status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('X-Robots-Tag', 'noindex, nofollow')
      .set('Cache-Control', 'no-store')
      .send(html);
  }
);

module.exports = exports;
