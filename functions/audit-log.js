/**
 * Audit log — Firestore triggers on sensitive collections.
 *
 * Every write to `subscriptions/*`, `users/*`, `invoices/*`, `companies/*`,
 * `access_codes/*` writes an immutable row to `audit_log/{autoId}` that only
 * admins can read (see firestore.rules). This gives Joe a trail to detect
 * privilege escalation attempts and unexpected plan changes.
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

function auditEntry(kind, ref, before, after) {
  return {
    kind,
    path: ref.path,
    docId: ref.id,
    before: before || null,
    after: after || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function writeAudit(entry) {
  try {
    await admin.firestore().collection('audit_log').add(entry);
  } catch (e) {
    logger.error('audit_log_write_failed', { err: e.message, path: entry.path });
  }
}

exports.auditSubscriptions = onDocumentWritten('subscriptions/{uid}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  await writeAudit(auditEntry('subscription.write', event.data.after.ref, before, after));
});

exports.auditUsers = onDocumentWritten('users/{uid}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  // Only record if a privileged field changed — avoids flooding the log with
  // profile edits.
  const privilegedKeys = ['role', 'plan', 'accessCode', 'isAdmin', 'companyId'];
  const changed = privilegedKeys.some(k => {
    const b = before ? before[k] : undefined;
    const a = after  ? after[k]  : undefined;
    return JSON.stringify(b) !== JSON.stringify(a);
  });
  if (!changed) return;
  await writeAudit(auditEntry('user.privileged_change', event.data.after.ref, before, after));
});

exports.auditInvoices = onDocumentWritten('invoices/{invoiceId}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  // Only audit status and total changes — other edits (notes, line items
  // during drafting) would be too noisy.
  const b = before || {};
  const a = after || {};
  if (b.status === a.status && b.total === a.total) return;
  await writeAudit(auditEntry('invoice.state_change', event.data.after.ref, before, after));
});

exports.auditAccessCodes = onDocumentWritten('access_codes/{codeId}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  await writeAudit(auditEntry('access_code.write', event.data.after.ref, before, after));
});

exports.auditCompanies = onDocumentWritten('companies/{companyId}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
  if (JSON.stringify(before?.ownerId) === JSON.stringify(after?.ownerId)) return;
  await writeAudit(auditEntry('company.owner_change', event.data.after.ref, before, after));
});
