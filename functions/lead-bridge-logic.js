/**
 * functions/lead-bridge-logic.js — pure (firebase-free) logic for the
 * public-lead → CRM-pipeline bridge (Phase C, H-1 fix).
 *
 * Split out from lead-bridge.js so it can be unit-tested with zero deps
 * (no firebase-admin / functions runtime). The trigger file owns the
 * Firestore I/O; everything here is a pure function of its inputs.
 *
 * The problem (H-1): submitPublicLead writes public-form submissions into
 * per-kind collections (contact_leads, estimate_leads, inspect_leads,
 * free_roof_entries). The CRM pipeline reads the `leads` collection
 * (rules scope reads to `userId == auth.uid`). Nothing copied public
 * leads into `leads`, so they never reached the pipeline — the owner only
 * learned of them by email. This module maps a public lead onto a CRM
 * `leads` doc and resolves which tenant/owner it belongs to.
 *
 * Tenant model:
 *   - NBD (tenant zero): public forms pass NO companyId → owner is the
 *     tenant-zero uid; solo convention => companyId == owner uid.
 *   - A tenant microsite passes a validated companyId (submitPublicLead
 *     checks it against the companies registry) → owner is
 *     companies/{companyId}.ownerId, or the companyId itself when the id
 *     is a uid (solo tenant). If no owner is resolvable, the caller skips
 *     the mirror (never guesses an owner — that would leak a lead into the
 *     wrong pipeline or none at all).
 */

'use strict';

// The four high-intent public kinds that become CRM pipeline leads — the
// same set lead-alert.js already treats as alert-worthy leads. `guide`
// (download) and `storm` (subscriber) are list-builders, not pipeline
// leads, so they are intentionally NOT bridged. label matches lead-alert's
// KIND_LABEL so the CRM `source` reads the same as the alert subject.
const BRIDGE_KINDS = {
  contact_leads:     { kind: 'contact',   label: 'Contact form' },
  estimate_leads:    { kind: 'estimate',  label: 'Instant Estimate' },
  inspect_leads:     { kind: 'inspect',   label: 'Inspection / Storm tool' },
  free_roof_entries: { kind: 'free_roof', label: 'Free Roof entry' },
};

// Firebase Auth uids are 28-char alphanumeric strings. A tenant whose
// companyId looks like a uid is a solo operator (companyId == uid), so the
// owner is the companyId itself. A short slug like 'oaks' is NOT a uid and
// requires an explicit companies/{id}.ownerId.
function looksLikeUid(s) {
  return typeof s === 'string' && /^[A-Za-z0-9]{20,}$/.test(s);
}

// Resolve { ownerUid, companyId } for a public lead, or null when no owner
// can be safely determined (caller then skips the CRM mirror).
//   companyId   — the lead's (already-validated) tenant tag, or '' for NBD.
//   companyDoc  — companies/{companyId} data, or null if absent/unread.
//   opts.nbdOwnerUid — tenant-zero owner uid (NBD default when untagged).
function resolveBridgeTarget(companyId, companyDoc, opts) {
  opts = opts || {};
  const nbdOwnerUid = opts.nbdOwnerUid || null;
  companyId = companyId ? String(companyId) : '';

  // Untagged → NBD (tenant zero). Solo convention: companyId == owner uid,
  // matching every in-app NBD lead (userId == companyId == Joe's uid).
  if (!companyId) {
    if (!nbdOwnerUid) return null;
    return { ownerUid: nbdOwnerUid, companyId: nbdOwnerUid };
  }

  // Tenant-tagged. Prefer the company doc's explicit owner.
  const ownerId = companyDoc && (companyDoc.ownerId || companyDoc.ownerUid);
  if (ownerId) return { ownerUid: String(ownerId), companyId };

  // Solo tenant whose companyId IS their uid (no separate company doc).
  if (looksLikeUid(companyId)) return { ownerUid: companyId, companyId };

  // Tenant is known (submitPublicLead validated it) but has no resolvable
  // owner uid (e.g. companies/oaks.ownerId not set yet). Skip — do not guess.
  return null;
}

// Deterministic CRM doc id so a re-delivered trigger can't create a second
// lead for the same public submit (idempotency via create()-or-skip).
function bridgeDocId(collection, sourceId) {
  return String(collection) + '__' + String(sourceId);
}

// The /estimate funnel saves follow-up EVENT docs (results shown, CTA
// click, email request) into estimate_leads alongside the initial lead
// save. Each event carries a `type` tag; the initial save has none.
// Bridging the events too gave the owner up to 4 duplicate "New" pipeline
// cards per completed funnel. Known event types are skipped; an UNKNOWN
// future type still bridges (fail-open — never silently drop a possible
// lead). estimate-email.js still fires on email_estimate_request docs.
const ESTIMATE_EVENT_TYPES = ['estimate_result', 'cta_click', 'email_estimate_request'];
function isFollowUpEvent(collection, data) {
  return collection === 'estimate_leads' &&
    ESTIMATE_EVENT_TYPES.indexOf(String((data || {}).type || '')) !== -1;
}

// Best-effort name split: the public kinds carry a single `name` (or
// `nomineeName`), except `contact` which already has firstName.
function splitName(data) {
  data = data || {};
  if (data.firstName) {
    return { firstName: String(data.firstName), lastName: String(data.lastName || '') };
  }
  const raw = String(data.name || data.nomineeName || '').trim();
  if (!raw) return { firstName: '(Web lead)', lastName: '' };
  const parts = raw.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Map a public-form submission onto a CRM `leads` doc (minus the
// serverTimestamp fields, which the trigger adds so this stays pure).
function mapPublicLeadToLead(args) {
  args = args || {};
  const collection = args.collection;
  const data = args.data || {};
  const meta = BRIDGE_KINDS[collection] || { kind: collection, label: collection };
  const { firstName, lastName } = splitName(data);

  const notesParts = [];
  const story = data.story || data.message || data.details || '';
  if (story) notesParts.push(String(story));
  if (data.nominatorName) {
    notesParts.push('Nominated by ' + data.nominatorName +
      (data.nominatorRelation ? ' (' + data.nominatorRelation + ')' : ''));
  }
  if (collection === 'free_roof_entries') notesParts.push('"One Free Roof" giveaway entry');
  if (data.photoCount) notesParts.push('Homeowner has ' + data.photoCount + ' photo(s) to share');
  // Estimator context — so the pipeline card shows what the homeowner
  // actually asked for, not just a name and address. Fields are present
  // only post-M-04 allowlist expansion; older docs simply add no line.
  if (collection === 'estimate_leads') {
    const ctx = [];
    if (data.service) ctx.push(String(data.service) + (data.roofType ? ' (' + String(data.roofType) + ')' : ''));
    if (data.timeline) ctx.push('timeline: ' + String(data.timeline));
    if (ctx.length) notesParts.push('Instant Estimate — ' + ctx.join(' · '));
  }

  const doc = {
    userId: args.ownerUid,
    companyId: args.companyId,
    firstName: firstName,
    lastName: lastName,
    address: String(data.address || data.zip || ''),
    phone: String(data.phone || ''),
    email: String(data.email || ''),
    stage: 'New',
    status: 'new',
    source: 'Website — ' + meta.label,
    notes: notesParts.join('\n'),
    // provenance + idempotency anchor
    webLead: true,
    publicLeadKind: meta.kind || collection,
    publicLeadCollection: collection,
    publicLeadId: String(args.sourceId || ''),
  };

  // Marketing attribution — only when the gateway passed it through.
  if (data.utm_source)   doc.utmSource = String(data.utm_source);
  if (data.utm_medium)   doc.utmMedium = String(data.utm_medium);
  if (data.utm_campaign) doc.utmCampaign = String(data.utm_campaign);
  if (data.referrer)     doc.referrer = String(data.referrer);

  return doc;
}

module.exports = {
  BRIDGE_KINDS,
  ESTIMATE_EVENT_TYPES,
  isFollowUpEvent,
  looksLikeUid,
  resolveBridgeTarget,
  bridgeDocId,
  splitName,
  mapPublicLeadToLead,
};
