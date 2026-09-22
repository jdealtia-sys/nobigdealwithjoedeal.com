/**
 * email-unsubscribe.js — the homeowner-facing unsubscribe page and the
 * RFC 8058 one-click endpoint, plus the rep's "Mark unsubscribed" callable.
 * ═══════════════════════════════════════════════════════════════
 *
 *   emailUnsubscribe      (onRequest) — /unsubscribe/<token>
 *     GET/HEAD  renders a small confirmation page (tenant name + masked
 *               address) with a POST button. NO side effects: link scanners
 *               and mail-client previews fetch GET, and must never
 *               unsubscribe anyone by doing so.
 *     POST      records the suppression (idempotent) and says so. This is
 *               both the page's button (body carries via=page → source
 *               'link') and the mailbox provider's RFC 8058 one-click POST
 *               (body "List-Unsubscribe=One-Click" → source 'one_click').
 *               Any POST to a valid token unsubscribes: the token is the
 *               authority, and RFC 8058 says the POST must not need more.
 *     Unknown / malformed token → one neutral page (404) that names no
 *     tenant and no address.
 *
 *   markEmailUnsubscribed (onCall)    — { leadId } → source 'rep'
 *     For "they called and said stop emailing me". Lead owner, same-company
 *     company_admin/manager, or platform admin — the roles that may write
 *     the lead. Viewer / access-code member refused.
 *
 * INTENTIONALLY PUBLIC. `enforceAppCheck` is a no-op on onRequest
 * (tests/appcheck-onrequest-contract.test.js) — the 256-bit token in the path
 * is the only credential, which is what an unsubscribe link has to be. Per-IP
 * rate limited. Served first-party through the firebase.json rewrite
 * `/unsubscribe/**` so the site's CSP + security headers apply; the page has
 * no script at all.
 *
 * Register + token model: functions/email-suppression.js.
 */
'use strict';

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { enforceRateLimit, clientIp, rateLimitIpKey } = require('./rate-limit');
const Suppression = require('./email-suppression');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// /unsubscribe/<token> through Hosting; /<token> on the direct function URL.
function tokenFromPath(p) {
  const m = String(p || '').split('?')[0].match(/(?:^|\/)([A-Za-z0-9_-]{43})\/?$/);
  return m ? m[1] : '';
}

// The POST body, whatever shape it arrived in. Express has parsed
// application/x-www-form-urlencoded into an object; anything else (multipart,
// text/plain, a missing content type) is read from rawBody as best-effort.
// Only `via` is consulted, and only to label the source.
function bodyField(req, name) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b) && b[name] != null) return String(b[name]);
  let raw = '';
  if (typeof b === 'string') raw = b;
  else if (Buffer.isBuffer(b)) raw = b.toString('utf8');
  else if (req.rawBody && Buffer.isBuffer(req.rawBody)) raw = req.rawBody.toString('utf8');
  if (!raw) return '';
  try {
    const v = new URLSearchParams(raw).get(name);
    if (v != null) return v;
  } catch (_) { /* not urlencoded */ }
  const m = raw.match(new RegExp('name="' + name + '"\\r?\\n\\r?\\n([^\\r\\n]*)'));
  return m ? m[1] : '';
}

async function tenantName(db, companyId) {
  try {
    const cp = await db.doc('companyProfile/' + companyId).get();
    const n = cp && cp.exists ? (((cp.data() || {}).brand || {}).legalName || '') : '';
    if (n) return String(n).slice(0, 120);
  } catch (e) {
    logger.warn('emailUnsubscribe: companyProfile read failed', { err: e && e.message });
  }
  try {
    const co = await db.doc('companies/' + companyId).get();
    const n = co && co.exists ? ((co.data() || {}).name || '') : '';
    if (n) return String(n).slice(0, 120);
  } catch (_) { /* fall through */ }
  return '';
}

const esc = Suppression.escHtml;

function renderPage({ title, heading, bodyHtml }) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">'
    + '<title>' + esc(title) + '</title>'
    + '<style>'
    + 'body{margin:0;background:#f5f5f5;color:#1f2937;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55}'
    + '.card{max-width:460px;margin:48px auto;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08);padding:28px 24px}'
    + 'h1{font-size:21px;margin:0 0 12px;color:#12223d}'
    + 'p{margin:0 0 14px;font-size:15px}'
    + '.muted{color:#6b7280;font-size:13px}'
    + 'button{display:block;width:100%;padding:13px 16px;border:0;border-radius:8px;background:#12223d;color:#fff;font-size:16px;font-weight:600;cursor:pointer}'
    + 'button:focus-visible{outline:3px solid #bd5728;outline-offset:2px}'
    + '@media (max-width:520px){.card{margin:16px}}'
    + '</style></head><body><main class="card">'
    + '<h1>' + esc(heading) + '</h1>' + bodyHtml
    + '</main></body></html>';
}

function send(res, status, page, method) {
  res.status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'private, no-store')
    .set('X-Robots-Tag', 'noindex, nofollow')
    // The token is in the URL: never leak it to anything this page links to.
    .set('Referrer-Policy', 'no-referrer')
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.send(method === 'HEAD' ? '' : page);
}

const NEUTRAL = {
  title: 'Unsubscribe',
  heading: 'This link isn\'t valid',
  bodyHtml: '<p>We couldn\'t find this unsubscribe link. It may have been copied incompletely.</p>'
    + '<p class="muted">To stop emails, use the unsubscribe link at the bottom of the email you received, or reply to it and ask to be removed.</p>',
};

async function handleUnsubscribe(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.set('Allow', 'GET, HEAD, POST');
    send(res, 405, renderPage(NEUTRAL), method);
    return;
  }

  try {
    await enforceRateLimit('emailUnsub:ip', rateLimitIpKey(clientIp(req)), 30, 60_000);
  } catch (e) {
    if (e && e.rateLimited) {
      res.set('Retry-After', String(Math.ceil((e.retryAfterMs || 60_000) / 1000)));
      send(res, 429, renderPage({
        title: 'Unsubscribe', heading: 'Please try again in a minute',
        bodyHtml: '<p>Too many requests from this network. Wait a moment and reload this page.</p>',
      }), method);
      return;
    }
    // A limiter outage must not stop someone unsubscribing: the token is
    // 256 bits, so there is nothing to brute-force here.
    logger.warn('emailUnsubscribe: rate limiter unavailable', { err: e && e.message });
  }

  const token = tokenFromPath(req.path || req.url);
  if (!Suppression.isToken(token)) { send(res, 404, renderPage(NEUTRAL), method); return; }

  const db = getFirestore();
  let tok = null;
  try {
    const snap = await db.doc(Suppression.TOKENS + '/' + token).get();
    tok = snap && snap.exists ? (snap.data() || {}) : null;
  } catch (e) {
    logger.error('emailUnsubscribe: token read failed', { err: e && e.message });
    send(res, 503, renderPage({
      title: 'Unsubscribe', heading: 'Something went wrong',
      bodyHtml: '<p>We couldn\'t load this page just now. Please try the link again in a few minutes.</p>',
    }), method);
    return;
  }
  if (!tok || !tok.companyId || !tok.email) { send(res, 404, renderPage(NEUTRAL), method); return; }

  const name = await tenantName(db, tok.companyId);
  const from = name ? esc(name) : 'this company';
  const masked = esc(Suppression.maskEmail(tok.email));

  if (method === 'POST') {
    const via = bodyField(req, 'via');
    const source = via === 'page' ? 'link' : 'one_click';
    try {
      const r = await Suppression.recordSuppression(db, {
        companyId: tok.companyId, email: tok.email, leadId: tok.leadId || null, source,
      }, FieldValue.serverTimestamp);
      logger.info('emailUnsubscribe: recorded', { companyId: tok.companyId, source, created: r.created });
    } catch (e) {
      logger.error('emailUnsubscribe: record failed', { err: e && e.message });
      send(res, 503, renderPage({
        title: 'Unsubscribe', heading: 'We couldn\'t save that',
        bodyHtml: '<p>Your unsubscribe didn\'t go through. Please press the button again in a minute.</p>',
      }), method);
      return;
    }
    send(res, 200, renderPage({
      title: 'Unsubscribed',
      heading: 'You\'re unsubscribed',
      bodyHtml: '<p><strong>' + masked + '</strong> won\'t get marketing or follow-up emails from ' + from + ' anymore.</p>'
        + '<p class="muted">You may still get emails about work you\'ve asked for — an estimate, an invoice or receipt, a contract to sign, or an appointment confirmation.</p>',
    }), method);
    return;
  }

  // GET / HEAD — read only. Never write from here.
  let already = false;
  try {
    already = (await Suppression.isSuppressed(db, tok.companyId, tok.email)).suppressed;
  } catch (_) { /* show the button; POST is idempotent */ }
  if (already) {
    send(res, 200, renderPage({
      title: 'Unsubscribed', heading: 'You\'re already unsubscribed',
      bodyHtml: '<p><strong>' + masked + '</strong> is already off ' + from + '\'s marketing and follow-up emails.</p>',
    }), method);
    return;
  }
  send(res, 200, renderPage({
    title: 'Unsubscribe',
    heading: 'Unsubscribe from ' + (name ? name : 'these emails'),
    bodyHtml: '<p>Stop marketing and follow-up emails from ' + from + ' to <strong>' + masked + '</strong>?</p>'
      + '<form method="post">'
      + '<input type="hidden" name="List-Unsubscribe" value="One-Click">'
      + '<input type="hidden" name="via" value="page">'
      + '<button type="submit">Unsubscribe</button>'
      + '</form>'
      + '<p class="muted" style="margin-top:14px">You\'ll still get emails about work you\'ve asked for, like an estimate, invoice, receipt, contract or appointment confirmation.</p>',
  }), method);
}

// No enforceAppCheck: it is meaningless on onRequest and
// tests/appcheck-onrequest-contract.test.js fails the build if it appears here.
exports.emailUnsubscribe = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    concurrency: 40,
    timeoutSeconds: 15,
    memory: '256MiB', // never below 256MiB: a 128MiB gen2 fails its startup healthcheck
  },
  handleUnsubscribe
);

async function handleMarkUnsubscribed(request) {
  const auth = request.auth;
  if (!auth || !auth.uid) throw new HttpsError('unauthenticated', 'Sign in required');
  const token = auth.token || {};
  const role = token.role || '';
  if (role === 'viewer' || role === 'member') {
    throw new HttpsError('permission-denied', 'Your account role cannot change email preferences');
  }
  const leadId = request.data && typeof request.data.leadId === 'string' ? request.data.leadId.trim() : '';
  if (!leadId || leadId.indexOf('/') !== -1 || leadId.length > 200) {
    throw new HttpsError('invalid-argument', 'leadId required');
  }
  const db = getFirestore();
  const snap = await db.doc('leads/' + leadId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Lead not found');
  const lead = snap.data() || {};
  const isAdmin = role === 'admin';
  const myCompany = token.companyId || '';
  const isStaff = role === 'company_admin' || role === 'manager';
  const sameCompany = !!myCompany && lead.companyId === myCompany;
  if (!isAdmin && lead.userId !== auth.uid && !(isStaff && sameCompany)) {
    throw new HttpsError('permission-denied', 'Not your lead');
  }
  const email = Suppression.normalizeEmail(lead.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('failed-precondition', 'This customer has no email address');
  }
  // The tenant key every CRM send uses (email-functions.js sendEmail):
  // claims.companyId || uid. A platform admin acts in the LEAD's tenant.
  const companyId = isAdmin
    ? String(lead.companyId || lead.userId || '')
    : String(myCompany || auth.uid);
  if (!companyId) throw new HttpsError('failed-precondition', 'Lead has no tenant');
  const r = await Suppression.recordSuppression(db, {
    companyId, email, leadId, source: 'rep', byUid: auth.uid,
  }, FieldValue.serverTimestamp);
  logger.info('markEmailUnsubscribed', { companyId, leadId, created: r.created });
  return { ok: true, created: r.created, id: r.id };
}

exports.markEmailUnsubscribed = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  handleMarkUnsubscribed
);

exports._test = { tokenFromPath, bodyField, handleUnsubscribe, handleMarkUnsubscribed };
