/**
 * paperwork-write.js — the ONE safe way to stamp a paperwork "filed" fact.
 *
 * 2026-09-15 (Paperwork Filing). Five flat, ISO-string-or-'' lead fields
 * (contractFiledAt, permitFiledAt, aobFiledAt, warrantyCertFiledAt,
 * cocFiledAt) gate REQUIRED_FIELDS_BY_TYPE's stage-advance hard block
 * (crm-stages.js) exactly the way scheduledDate/claimNumber/etc already do.
 * Three of the five are auto-derived from a real signing event
 * (document-generator.js's onPersistFinalized, warranty-cert.js's own
 * persist hook) — this module exists for the ONE field with no signer to
 * hook: Permit, which only ever gets a manual attestation. Kept as a shared
 * chokepoint (not a bare updateDoc duplicated at each call site) so the
 * Next-Action chip (dashboard-bootstrap.module.js) and the customer-page
 * paperwork checklist (customer-checklist.js) can never drift on the write
 * shape or the activity-note side effect.
 *
 * Same "plain deferred script, window global" convention as
 * stage-checklist.js — dashboard-bootstrap.module.js never statically
 * imports sibling modules (it dispatches through window.* globals), and
 * customer-checklist.js is a plain script too, so an ES `export` here would
 * need a second load-bearing path for no benefit.
 *
 * Never throws back to the caller for the activity-note step — a note
 * failure must not make the field write itself look like it failed.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Allowlist, not a free-form field name — every call site in this repo
  // passes one of these five literals; a typo here should fail loudly
  // rather than silently write and gate an unrelated field.
  var FILED_FIELDS = ['contractFiledAt', 'permitFiledAt', 'aobFiledAt', 'warrantyCertFiledAt', 'cocFiledAt'];

  async function commitPaperworkFiled(leadId, field, filed, opts) {
    opts = opts || {};
    if (!leadId || FILED_FIELDS.indexOf(field) === -1) {
      throw new Error('commitPaperworkFiled: unknown field "' + field + '"');
    }
    if (!(window.db && window.doc && window.updateDoc)) {
      throw new Error('commitPaperworkFiled: Firebase helpers not available on this page');
    }
    // '' — never false/0/null — missingRequiredFields() (crm-stages.js) only
    // treats undefined/null/'' as missing; a falsy-but-truthy sentinel would
    // silently satisfy the gate the moment the checkbox is unticked.
    var stamp = filed ? new Date().toISOString() : '';
    var payload = {};
    payload[field] = stamp;
    await window.updateDoc(window.doc(window.db, 'leads', leadId), payload);

    try {
      if (window.addDoc && window.collection && window.serverTimestamp) {
        await window.addDoc(window.collection(window.db, 'notes'), {
          leadId: leadId,
          type: 'note',
          text: field + (filed ? ' marked filed' : ' unmarked'),
          createdAt: window.serverTimestamp(),
          createdBy: opts.actorLabel || (window._currentUser && window._currentUser.email) || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'system',
        });
      }
    } catch (e) { console.warn('[paperwork-write] activity note failed:', e && e.message); }

    return stamp;
  }

  window.PaperworkWrite = { commitPaperworkFiled: commitPaperworkFiled, FILED_FIELDS: FILED_FIELDS };
})();
