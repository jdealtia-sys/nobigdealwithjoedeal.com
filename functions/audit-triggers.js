/**
 * audit-triggers.js — H-4 immutable audit log writes.
 *
 * Records every sensitive mutation into `audit_log/{autoId}`. The
 * collection is admin-SDK-only (Firestore rules deny both client
 * reads and writes), so a compromised user session cannot scrub
 * history.
 *
 * Covered collections:
 *   users/{uid}                       — profile + claim-shadow fields
 *   leads/{leadId}                    — top-level lead records
 *   companies/{companyId}             — org metadata (name, ownerId)
 *   companies/{companyId}/members/*   — invite + role changes
 *   access_codes/{codeId}             — activation / rotation
 *   subscriptions/{uid}               — plan + status changes
 *
 * Retention: managed via a scheduled cleanup function (not in this
 * file) — default 7 years per GDPR/insurance-audit norms.
 *
 * Load into index.js:
 *   const auditTriggers = require('./audit-triggers');
 *   Object.assign(exports, auditTriggers);
 */

'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

// Best-effort PII redactor — never log the email or phone verbatim,
// only a stable hash so analysts can correlate without PII leakage.
const crypto = require('crypto');
function hash(v) {
  if (v == null) return null;
  return crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
}

// Walk both sides of a doc change and produce a terse diff object:
//   { added: {k: v}, removed: {k: v}, changed: {k: {from, to}} }
// Values that look like PII (strings > 60 chars, or keys matching
// /email|phone|address|name/) are replaced with a length marker +
// hash so the log captures the change without the plaintext.
const PII_KEYS = /email|phone|address|firstName|lastName|displayName|zip|parcel/i;
function redact(key, val) {
  if (val == null) return val;
  if (typeof val !== 'string') return val;
  if (PII_KEYS.test(key) || val.length > 120) {
    return `[redacted:${val.length}:${hash(val)}]`;
  }
  return val;
}
function diff(before, after) {
  const out = { added: {}, removed: {}, changed: {} };
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after  || {})
  ]);
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after  ? after[k]  : undefined;
    if (b === undefined && a !== undefined) out.added[k] = redact(k, a);
    else if (b !== undefined && a === undefined) out.removed[k] = redact(k, b);
    else if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.changed[k] = { from: redact(k, b), to: redact(k, a) };
    }
  }
  return out;
}

async function writeAuditEntry(entry) {
  try {
    await admin.firestore().collection('audit_log').add({
      ...entry,
      ts: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    // Never throw — failing an audit write must NOT break the
    // underlying Firestore operation. The loud console.error
    // gets surfaced by the ops log-based alert policy.
    logger.error('audit_log write failed', { type: entry.type, err: e.message });
  }
}

function buildHandler(collectionName, typeLabel, paramKeys) {
  return async (event) => {
    const before = event.data && event.data.before && event.data.before.exists
      ? event.data.before.data() : null;
    const after  = event.data && event.data.after  && event.data.after.exists
      ? event.data.after.data()  : null;
    const op = before && after ? 'update'
             : !before && after ? 'create'
             : before && !after ? 'delete' : 'noop';
    if (op === 'noop') return;

    const d = diff(before, after);
    const hasDelta =
      Object.keys(d.added).length   ||
      Object.keys(d.removed).length ||
      Object.keys(d.changed).length;
    if (op === 'update' && !hasDelta) return;

    const ids = {};
    for (const key of paramKeys || []) {
      if (event.params && event.params[key] != null) ids[key] = event.params[key];
    }

    await writeAuditEntry({
      type: typeLabel,
      op,
      collection: collectionName,
      ids,
      diff: d
    });
  };
}

// ─── User profile + claim-shadow ───────────────────────────
exports.audit_users = onDocumentWritten(
  { region: 'us-central1', document: 'users/{uid}' },
  buildHandler('users', 'user_profile', ['uid'])
);

// ─── Leads ─────────────────────────────────────────────────
exports.audit_leads = onDocumentWritten(
  { region: 'us-central1', document: 'leads/{leadId}' },
  buildHandler('leads', 'lead', ['leadId'])
);

// ─── Companies + members ───────────────────────────────────
exports.audit_companies = onDocumentWritten(
  { region: 'us-central1', document: 'companies/{companyId}' },
  buildHandler('companies', 'company', ['companyId'])
);

// Member role changes are the highest-signal event — the C-1 attack
// path writes here first. Log in a dedicated type so the ops alert
// policy can filter just on this.
exports.audit_company_members = onDocumentWritten(
  { region: 'us-central1', document: 'companies/{companyId}/members/{memberId}' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists
      ? event.data.before.data() : null;
    const after  = event.data && event.data.after  && event.data.after.exists
      ? event.data.after.data()  : null;

    const op = before && after ? 'update'
             : !before && after ? 'create'
             : before && !after ? 'delete' : 'noop';
    if (op === 'noop') return;

    const d = diff(before, after);

    // Flag any attempt to set role: 'admin' in an invite doc. Even
    // though onRepSignup allowlists and clamps the value, the attempt
    // itself is a red flag — someone probed the privilege-escalation
    // path that existed pre-C-1. Log as its own type so it pages.
    const badRole =
      (after && after.role === 'admin') ||
      (d.changed && d.changed.role && d.changed.role.to === 'admin');
    if (badRole) {
      logger.warn('SECURITY: invite doc set role=admin', {
        companyId: event.params.companyId,
        memberId: hash(event.params.memberId)
      });
      await writeAuditEntry({
        type: 'security_admin_grant_attempt',
        op, collection: 'companies/members',
        ids: { companyId: event.params.companyId, memberIdHash: hash(event.params.memberId) }
      });
    }

    await writeAuditEntry({
      type: 'company_member',
      op, collection: 'companies/members',
      ids: { companyId: event.params.companyId, memberIdHash: hash(event.params.memberId) },
      diff: d
    });
  }
);

// ─── Access codes (C-2 territory) ──────────────────────────
exports.audit_access_codes = onDocumentWritten(
  { region: 'us-central1', document: 'access_codes/{codeId}' },
  buildHandler('access_codes', 'access_code', ['codeId'])
);

// ─── Subscriptions (Stripe writes through here) ───────────
exports.audit_subscriptions = onDocumentWritten(
  { region: 'us-central1', document: 'subscriptions/{uid}' },
  buildHandler('subscriptions', 'subscription', ['uid'])
);

module.exports = exports;
