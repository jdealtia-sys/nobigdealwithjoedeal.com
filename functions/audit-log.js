/**
 * Audit log — invoices only. SUPERSEDED by audit-triggers.js (H-4).
 *
 * audit-triggers.js is the canonical audit_log writer for users, leads,
 * companies, companies/members, access_codes, and subscriptions — it
 * redacts PII, records a compact diff, and stamps `ts` (so
 * auditLogRetentionCron, which prunes by `ts`, can age entries out).
 *
 * This module used to ALSO write audit_log for users/companies/
 * access_codes/subscriptions, which DOUBLE-WROTE every row — and its
 * entries used `createdAt` (not `ts`), so they evaded retention and
 * accumulated forever with unredacted before/after PII.
 *
 * 2026-06-08 dedup: those four triggers are now no-ops. audit-triggers.js
 * already covers their collections (more completely + redacted), so no
 * audit coverage is lost. The only live writer left here is auditInvoices,
 * because `invoices/*` is NOT covered by audit-triggers.js.
 *
 * The four no-op exports are RETAINED (not deleted) because the CI deploy
 * is name-scoped (`firebase deploy --only functions:<list>`) and cannot
 * prune orphaned functions — removing the exports would leave the old
 * revisions live in prod, still double-writing. To delete them for good
 * once convenient (one-time, needs prod access):
 *   firebase functions:delete auditUsers auditCompanies auditAccessCodes \
 *     auditSubscriptions --project <pro-project> --force
 */

'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { FieldValue } = require('firebase-admin/firestore');

// ─── DEPRECATED no-ops — superseded by audit-triggers.js (see header) ──
// Kept as registered no-ops ONLY so the name-scoped CI deploy doesn't
// leave orphaned, still-double-writing revisions live in prod.
const noop = async () => {};
exports.auditSubscriptions = onDocumentWritten('subscriptions/{uid}', noop);
exports.auditUsers         = onDocumentWritten('users/{uid}', noop);
exports.auditAccessCodes   = onDocumentWritten('access_codes/{codeId}', noop);
exports.auditCompanies     = onDocumentWritten('companies/{companyId}', noop);

// ─── Invoices — the one sensitive collection audit-triggers.js omits ──
async function writeAudit(entry) {
  try {
    await getFirestore().collection('audit_log').add(entry);
  } catch (e) {
    logger.error('audit_log_write_failed', { err: e.message, path: entry.path });
  }
}

exports.auditInvoices = onDocumentWritten('invoices/{invoiceId}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  // Only audit status and total changes — other edits (notes, line items
  // during drafting) would be too noisy.
  const b = before || {};
  const a = after || {};
  if (b.status === a.status && b.total === a.total) return;
  await writeAudit({
    kind: 'invoice.state_change',
    path: event.data.after.ref.path,
    docId: event.data.after.ref.id,
    // Store ONLY the non-PII state fields this trigger audits (status +
    // total) — never the full invoice doc, which carries homeowner
    // name/email/phone + line items and would accumulate plaintext PII in
    // the ~7-year audit_log. (DI-01, backend security audit 2026-06-24.)
    before: before ? { status: before.status ?? null, total: before.total ?? null } : null,
    after:  after  ? { status: after.status  ?? null, total: after.total  ?? null } : null,
    // `ts` (not just createdAt) so auditLogRetentionCron — which queries
    // on `ts` — can actually age these out instead of accumulating forever.
    ts: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
});
