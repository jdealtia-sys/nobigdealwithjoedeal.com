/**
 * email-suppression.js — the per-tenant email opt-out register, and the ONE
 * gate every commercial send path calls before it hands a message to Resend.
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS (2026-09-22)
 *
 * Nothing in the CRM recorded or honoured "stop emailing me". sendEmail
 * checked auth, role and rate limits; the automated homeowner senders checked
 * nothing at all. CAN-SPAM requires a working opt-out on every COMMERCIAL
 * email, honoured within 10 business days. Transactional / relationship mail
 * (an estimate the customer asked for, an invoice, a receipt, a contract to
 * sign, a portal link for an active job, an appointment confirmation) is
 * exempt, and the owner decided (2026-09-22) it keeps sending after an
 * unsubscribe.
 *
 * WHAT LIVES HERE
 *
 *   email_suppressions/{companyId}__{sha256(normalized email)}
 *     { companyId, emailHash, email, source, createdAt, leadId? }
 *     Per TENANT: company A's unsubscribe never blocks company B. The doc id
 *     carries a hash, not the address, so an id in a log or a URL is not PII.
 *     `email` is kept (lowercased) so the tenant can see who it is.
 *     Server-write only; tenant members may GET their own tenant's docs
 *     (firestore.rules) so the CRM can show an "Unsubscribed" badge.
 *
 *   email_unsub_tokens/{token}
 *     { companyId, email, emailHash, leadId?, source, createdAt }
 *     One opaque 256-bit token per commercial send, carried by the footer
 *     link and the RFC 8058 List-Unsubscribe header. No client access at all.
 *     No expiry: an unsubscribe link must keep working for the life of the
 *     email (CAN-SPAM: at least 30 days after the send; we never retire it).
 *
 * THE CONTRACT
 *
 *   resolveCategory({category, kind}) — 'transactional' ONLY when a caller
 *     says so explicitly (category === 'transactional', or a `kind` from the
 *     TRANSACTIONAL_KINDS allowlist). Anything else — no category, a typo, an
 *     unknown kind — is COMMERCIAL. Fail closed for marketing.
 *
 *   gateCommercialEmail(db, {companyId, email, leadId, source}) — the gate.
 *     Suppressed → { suppressed: true }  and the caller MUST NOT send.
 *     Clear      → { suppressed: false, url, headers, footerHtml, footerText }
 *                  and the caller MUST put `headers` on the Resend call and
 *                  the footer in the body (applyFooter does both shapes).
 *     THROWS on a Firestore error (read or token mint), exactly like
 *     sms-optout.js isOptedOut: an unknown opt-out state is "do not send",
 *     never "probably fine". sendEmail answers 503 suppression_unverified,
 *     which the browser client refuses instead of handing off to mailto:.
 *
 * Deliberately NOT a cache — an unsubscribe is a legal instruction and the
 * read is one doc get.
 */
'use strict';

const crypto = require('crypto');

const COLLECTION = 'email_suppressions';
const TOKENS = 'email_unsub_tokens';

const CATEGORY = Object.freeze({
  COMMERCIAL: 'commercial',
  TRANSACTIONAL: 'transactional',
});

// The only `kind` values that make a send transactional. A client-supplied
// kind outside this set is commercial. Keep it SHORT and about the MESSAGE's
// primary purpose, not the page it was sent from.
const TRANSACTIONAL_KINDS = Object.freeze([
  'estimate',      // an estimate / proposal delivered to the customer
  'proposal',      // Close Board deal link (estimate + accept page)
  'invoice',
  'receipt',       // payment confirmation
  'contract',      // contract / e-sign envelope / signed copy
  'portal_link',   // project portal for an active job
  'document',      // a report / photo report the customer is receiving
  'appointment',   // appointment / crew / adjuster-meeting confirmation
]);
const _TX_KIND_SET = new Set(TRANSACTIONAL_KINDS);

const SOURCES = Object.freeze(['link', 'one_click', 'rep', 'complaint', 'bounce']);

// Public base for unsubscribe links. firebase.json rewrites /unsubscribe/**
// to the emailUnsubscribe function. Overridable for emulator runs.
const DEFAULT_BASE_URL = 'https://nobigdealwithjoedeal.com/unsubscribe/';

// Same bound, same reason as sms-optout.js READ_TIMEOUT_MS: the browser client
// aborts sendEmail at 25s and treats an abort as offline (mailto: handoff).
// A hung read must answer 503 before that.
const READ_TIMEOUT_MS = 10000;

// 32 random bytes → 43 base64url chars. The endpoint accepts exactly this.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

function emailHash(email) {
  const n = normalizeEmail(email);
  if (!n) return '';
  return crypto.createHash('sha256').update(n, 'utf8').digest('hex');
}

/** Doc id in email_suppressions. '' when either half is missing. */
function suppressionId(companyId, email) {
  const c = String(companyId == null ? '' : companyId).trim();
  const h = emailHash(email);
  if (!c || !h || c.indexOf('/') !== -1 || c.indexOf('__') !== -1) return '';
  return c + '__' + h;
}

/**
 * @param {{category?: string, kind?: string}} [opts]
 * @returns {'commercial'|'transactional'}
 */
function resolveCategory(opts) {
  const o = opts || {};
  if (o.category === CATEGORY.TRANSACTIONAL) return CATEGORY.TRANSACTIONAL;
  if (typeof o.kind === 'string' && _TX_KIND_SET.has(o.kind)) return CATEGORY.TRANSACTIONAL;
  return CATEGORY.COMMERCIAL;
}

function mintToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function isToken(t) {
  return typeof t === 'string' && TOKEN_RE.test(t);
}

function baseUrl() {
  const b = process.env.EMAIL_UNSUBSCRIBE_BASE_URL || DEFAULT_BASE_URL;
  return b.endsWith('/') ? b : b + '/';
}

function withTimeout(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error('email suppression lookup did not answer within ' + ms + 'ms');
      e.code = 'suppression_read_timeout';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Is this address suppressed for this tenant? THROWS on a read error.
 * @returns {Promise<{suppressed: boolean, id: string}>}
 */
async function isSuppressed(db, companyId, email, opts) {
  const id = suppressionId(companyId, email);
  if (!id) {
    // No tenant or no address: there is nothing we could honour an opt-out
    // against, so a commercial send is refused rather than guessed.
    const e = new Error('email suppression check needs a companyId and an email');
    e.code = 'suppression_no_key';
    throw e;
  }
  const read = db.doc(COLLECTION + '/' + id).get();
  const asked = opts && Number(opts.timeoutMs);
  const snap = asked && Number.isFinite(asked) && asked > 0 ? await withTimeout(read, asked) : await read;
  return { suppressed: !!(snap && snap.exists), id };
}

/**
 * Record an unsubscribe. Idempotent: an existing record is left exactly as it
 * was (its first source and createdAt stand).
 * @returns {Promise<{id: string, created: boolean}>}
 */
async function recordSuppression(db, fields, serverTimestamp) {
  const f = fields || {};
  const id = suppressionId(f.companyId, f.email);
  if (!id) throw new Error('recordSuppression needs a companyId and an email');
  const source = SOURCES.indexOf(f.source) !== -1 ? f.source : 'link';
  const ref = db.doc(COLLECTION + '/' + id);
  const cur = await ref.get();
  if (cur && cur.exists) return { id, created: false };
  const row = {
    companyId: String(f.companyId),
    emailHash: emailHash(f.email),
    email: normalizeEmail(f.email),
    source,
    createdAt: typeof serverTimestamp === 'function' ? serverTimestamp() : new Date(),
  };
  if (f.leadId) row.leadId = String(f.leadId);
  if (f.byUid) row.byUid = String(f.byUid);
  await ref.set(row);
  return { id, created: true };
}

/**
 * Mint the per-send unsubscribe token. THROWS on a write error.
 * @returns {Promise<{token: string, url: string}>}
 */
async function mintUnsubscribeToken(db, fields, serverTimestamp) {
  const f = fields || {};
  const token = mintToken();
  const row = {
    companyId: String(f.companyId),
    email: normalizeEmail(f.email),
    emailHash: emailHash(f.email),
    source: String(f.source || 'unknown').slice(0, 60),
    createdAt: typeof serverTimestamp === 'function' ? serverTimestamp() : new Date(),
  };
  if (f.leadId) row.leadId = String(f.leadId);
  await db.doc(TOKENS + '/' + token).set(row);
  return { token, url: baseUrl() + token };
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function footerHtml(url) {
  return '<p style="font-size:12px;color:#6b7280;text-align:center;margin:18px 0 6px;line-height:1.5;">'
    + 'Don\'t want these emails? <a href="' + escHtml(url) + '" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p>';
}

function footerText(url) {
  return '\n\n—\nDon\'t want these emails? Unsubscribe: ' + url + '\n';
}

/** RFC 2369 + RFC 8058 headers for one-click unsubscribe. */
function listUnsubscribeHeaders(url) {
  return {
    'List-Unsubscribe': '<' + url + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * THE gate for commercial email. See the header for the contract.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{companyId: string, email: string, leadId?: string, source: string}} fields
 * @param {{timeoutMs?: number, serverTimestamp?: Function}} [opts]
 */
async function gateCommercialEmail(db, fields, opts) {
  const f = fields || {};
  const o = opts || {};
  const hit = await isSuppressed(db, f.companyId, f.email, { timeoutMs: o.timeoutMs });
  if (hit.suppressed) return { suppressed: true, id: hit.id };
  const minted = await mintUnsubscribeToken(db, f, o.serverTimestamp);
  return {
    suppressed: false,
    id: hit.id,
    token: minted.token,
    url: minted.url,
    headers: listUnsubscribeHeaders(minted.url),
    footerHtml: footerHtml(minted.url),
    footerText: footerText(minted.url),
  };
}

/**
 * Put the footer into an HTML body: before </body> when there is one, else
 * appended. Plain text gets the text footer appended.
 */
function applyFooter(gate, html, text) {
  const out = { html, text };
  if (!gate || gate.suppressed) return out;
  if (typeof html === 'string' && html) {
    const i = html.toLowerCase().lastIndexOf('</body>');
    out.html = i === -1 ? html + gate.footerHtml : html.slice(0, i) + gate.footerHtml + html.slice(i);
  }
  if (typeof text === 'string' && text) out.text = text + gate.footerText;
  return out;
}

/** "jo***@ex***.com" — enough for a homeowner to recognise, no more. */
function maskEmail(email) {
  const n = normalizeEmail(email);
  const at = n.lastIndexOf('@');
  if (at < 1) return '';
  const local = n.slice(0, at);
  const domain = n.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return local.slice(0, Math.min(2, local.length)) + '***@' + host.slice(0, 1) + '***' + tld;
}

/**
 * Every functions/ file that calls resend.emails.send(), with the category of
 * what it sends and who receives it. tests/email-unsubscribe.test.js fails
 * when a send site exists in a file not listed here, or when a file listed
 * 'commercial' does not call gateCommercialEmail — a new sender has to be
 * classified before it can ship. `internal` = recipient is the contractor /
 * team / platform owner, not a homeowner: out of scope for this register.
 */
const SEND_PATHS = Object.freeze({
  'email-functions.js': 'mixed',              // sendEmail: per-request kind → category (default commercial)
  'funnel-recovery.js': 'commercial',         // runAbandonRecovery → website visitor
  'lead-followup.js': 'commercial',           // leadFollowUpSweep → homeowner
  'estimate-email.js': 'transactional',       // homeowner explicitly asked "Email My Estimate"
  'storm-report-email.js': 'transactional',   // homeowner asked for their storm report copy
  'lead-alert.js': 'transactional',           // tenant alert (internal) + homeowner ack of their own request
  'esign-envelope.js': 'transactional',       // signing envelope
  'remote-signing.js': 'transactional',       // document signing link
  'report-sharing.js': 'transactional',       // report / document share link
  'anniversary-touch.js': 'internal',         // rep digest
  'dormant-leads.js': 'internal',             // rep digest
  'review-request-nudge.js': 'internal',      // rep digest
  'storm-watch.js': 'internal',               // Joe's storm alert
  'lead-digest.js': 'internal',               // Joe's morning digest
  'weekly-digest.js': 'internal',             // rep digest
  'marketing-report.js': 'internal',          // Joe's monthly report
  'verify-functions.js': 'internal',          // Joe's new-lead alert
  'handlers/invites.js': 'internal',          // team invite (account mail)
  'integrations/email-queue-worker.js': 'internal', // queue: dunning/erasure/health → account holders
});

module.exports = {
  COLLECTION,
  TOKENS,
  CATEGORY,
  TRANSACTIONAL_KINDS,
  SOURCES,
  READ_TIMEOUT_MS,
  TOKEN_RE,
  SEND_PATHS,
  normalizeEmail,
  emailHash,
  suppressionId,
  resolveCategory,
  isToken,
  isSuppressed,
  recordSuppression,
  mintUnsubscribeToken,
  listUnsubscribeHeaders,
  gateCommercialEmail,
  applyFooter,
  maskEmail,
  escHtml,
};
