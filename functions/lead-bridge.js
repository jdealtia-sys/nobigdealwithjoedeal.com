/**
 * functions/lead-bridge.js — public lead → CRM pipeline bridge (Phase C, H-1).
 * ═══════════════════════════════════════════════════════════════
 *
 * Fixes the live-QA H-1 finding: public-form submissions land in the
 * per-kind public collections (contact_leads / estimate_leads /
 * inspect_leads / free_roof_entries) but never reached the CRM `leads`
 * pipeline, so the owner had to re-enter them by hand from the alert email.
 *
 * These onCreate triggers mirror each high-intent public lead into the
 * tenant's `leads` collection so it shows up in the pipeline (stage "New",
 * source "Website — …"). Purely ADDITIVE — runs alongside lead-alert.js
 * (which still emails/texts) and does NOT touch submitPublicLead or the
 * public collections. A bridge failure never blocks intake or the alert.
 *
 * Routing is tenant-aware: the lead's validated companyId resolves to that
 * tenant's owner (companies/{companyId}.ownerId). NBD's main forms pass no
 * companyId → the lead is mirrored to the tenant-zero owner (Joe), so NBD
 * is byte-identical. Writes go through the admin SDK (bypasses rules) since
 * a public submit has no authenticated user.
 *
 * Idempotent: the mirrored doc uses a deterministic id derived from the
 * source (collection + source doc id), so a re-delivered trigger create()s
 * a no-op instead of a duplicate lead.
 */

'use strict';

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
// Modular FieldValue import — admin.firestore.FieldValue is undefined under
// the emulator runtime (see emulator-qa notes); the modular path works in
// both prod and emulator.
const { FieldValue } = require('firebase-admin/firestore');

const L = require('./lead-bridge-logic');

// Tenant-zero (NBD) owner uid — Joe / jonathandeal459@gmail.com. Matches the
// uid in set-jd-claims.js (companyId == uid solo convention). Overridable via
// env for emulator/test runs. Public NBD forms pass no companyId, so an
// untagged lead mirrors to this owner — byte-identical to today's NBD.
const NBD_OWNER_UID = process.env.NBD_OWNER_UID || '1phDvAVXHSg82wDLegAbQFq14Ci1';

const BRIDGE_COLLECTIONS = Object.keys(L.BRIDGE_KINDS);

async function bridgeToCrm(collection, data, sourceId) {
  data = data || {};
  const db = admin.firestore();

  // Resolve the lead's tenant owner. companyId was validated against the
  // companies registry by submitPublicLead before it was stamped.
  const companyId = data.companyId ? String(data.companyId) : '';
  let companyDoc = null;
  if (companyId) {
    try {
      const snap = await db.collection('companies').doc(companyId).get();
      companyDoc = snap.exists ? (snap.data() || {}) : null;
    } catch (e) {
      logger.error('leadBridge: company lookup failed', { companyId, err: e && e.message });
    }
  }

  const target = L.resolveBridgeTarget(companyId, companyDoc, { nbdOwnerUid: NBD_OWNER_UID });
  if (!target) {
    // Known tenant but no resolvable owner (e.g. companies/{id}.ownerId
    // unset). Never guess an owner — leave the public lead + alert as-is.
    logger.warn('leadBridge: no owner resolvable — skipping CRM mirror', { collection, sourceId, companyId });
    return;
  }

  const id = L.bridgeDocId(collection, sourceId);
  const leadDoc = L.mapPublicLeadToLead({
    collection, sourceId, data,
    ownerUid: target.ownerUid,
    companyId: target.companyId,
  });
  leadDoc.createdAt = FieldValue.serverTimestamp();
  leadDoc.stageStartedAt = FieldValue.serverTimestamp();

  try {
    // create() (not set()) so a re-delivery hits ALREADY_EXISTS instead of
    // overwriting a lead the rep may have already edited.
    await db.collection('leads').doc(id).create(leadDoc);
    logger.info('leadBridge: mirrored public lead into CRM', {
      collection, sourceId, leadId: id, companyId: target.companyId, ownerUid: target.ownerUid,
    });
  } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) {
      logger.info('leadBridge: CRM lead already exists — idempotent skip', { collection, sourceId, leadId: id });
    } else {
      logger.error('leadBridge: CRM mirror failed', { collection, sourceId, err: e && e.message });
    }
  }
}

function makeTrigger(collection) {
  return onDocumentCreated(
    {
      region: 'us-central1',
      document: `${collection}/{leadId}`,
      maxInstances: 10,
      memory: '256MiB',
      timeoutSeconds: 30,
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return;
      await bridgeToCrm(collection, snap.data() || {}, event.params && event.params.leadId);
    }
  );
}

exports.leadBridgeContact  = makeTrigger('contact_leads');
exports.leadBridgeEstimate = makeTrigger('estimate_leads');
exports.leadBridgeInspect  = makeTrigger('inspect_leads');
exports.leadBridgeFreeRoof = makeTrigger('free_roof_entries');

// Exposed for tests / wiring sanity.
exports._bridgeCollections = BRIDGE_COLLECTIONS;
