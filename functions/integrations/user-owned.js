/**
 * integrations/user-owned.js — canonical registry of every Firestore
 * collection, collectionGroup, Storage prefix, and owner-keyed doc
 * path that is tied to a single end-user uid.
 *
 * Single source of truth for:
 *   - `confirmAccountErasure` (M-01): GDPR Article 17 cascade. A user
 *     who requests right-to-be-forgotten expects every trace of their
 *     data removed. Before this registry, the cascade named 7 flat
 *     collections and 1 collection-group; the full list below is 21
 *     flat collections, 2 groups, 8 Storage prefixes, 5 owner-keyed
 *     uid-path docs, and the vestigial nested-leads subtree.
 *
 *   - `exportMyData` (M-02): GDPR Article 20 data export. Same shape,
 *     read side. A dump that omits 2/3 of the user's data is not a
 *     portable export.
 *
 * Rule for additions: if a new collection, subcollection, or Storage
 * prefix stores user data keyed by uid (via a field or a path
 * segment), it goes in THIS file before it lands in a rule file. The
 * registry is the blast-radius map. If it's not here, erasure and
 * export both silently miss it.
 *
 * Rule for exclusions: append-only audit trails (audit_log,
 * account_erasures) are intentionally excluded — the whole point of
 * those is to survive account deletion.
 */

'use strict';

// ─── FLAT COLLECTIONS ───────────────────────────────────────
// Every top-level collection that stamps the owner uid on each doc.
// Default ownerField is 'userId'; specify when a collection uses a
// different field name (e.g. invoices uses `createdBy`).
//
// Source: firestore.rules + grep for `collection(...).add({ userId }`
// across functions/ and docs/pro/js/ (see agent audit 2026-04-15).
const FLAT_USER_COLLECTIONS = [
  { name: 'leads' },
  { name: 'estimates' },
  { name: 'photos' },
  { name: 'pins' },
  { name: 'tasks' },
  { name: 'documents' },
  { name: 'communications' },
  { name: 'notifications' },
  { name: 'notes' },
  { name: 'dailyTracker' },
  { name: 'knocks' },
  { name: 'territories' },
  { name: 'products' },
  { name: 'templates' },
  { name: 'training_sessions' },
  { name: 'drip_queue' },
  { name: 'drip_log' },
  { name: 'lead_documents' },
  { name: 'referrals' },
  { name: 'review_requests' },
  { name: 'reports' },
  // Invoices use `createdBy` (not `userId`) for historical reasons —
  // the original invoice schema predated the userId convention.
  { name: 'invoices', ownerField: 'createdBy' },
  // Appointments are written by the Cal.com webhook (admin-SDK only,
  // see firestore.rules:481-484) but stamp `userId` on each booking
  // so the rep who owns the lead can read them. Caught by the
  // registry-drift sweep — was previously missing from the GDPR
  // cascade, leaving homeowner appointment metadata behind on
  // right-to-be-forgotten.
  { name: 'appointments' },
];

// ─── COLLECTION-GROUPS WITH userId STAMPS ───────────────────
// Subcollections under other parents whose rows carry a `userId`
// field. `collectionGroup(name).where('userId','==',uid)` reaches
// them without knowing the parent path.
//
// NOT listed: `leads/{leadId}/tasks|notes` — those use the PARENT
// lead's userId for authorization (firestore.rules:101-112), rows
// do not carry their own userId field, so a collectionGroup sweep
// wouldn't find them. They get nuked by the nested-leads
// recursiveDelete path instead.
const COLLECTION_GROUPS_WITH_USERID = [
  'recordings',   // leads/{leadId}/recordings/{id} — Voice Intelligence
  'activity',     // leads/{leadId}/activity/{id}   — F-05 rep + webhook stamps
];

// ─── STORAGE PREFIXES ───────────────────────────────────────
// Every Storage bucket path of the shape `<prefix>/{uid}/...` per
// storage.rules. Right-to-be-forgotten means deleting the binary
// payloads too, not just the Firestore row.
const STORAGE_PREFIXES = [
  'audio',
  'photos',
  'docs',
  'portals',
  'galleries',
  'reports',
  'shared_docs',
  'deal_rooms',
];

// ─── OWNER-KEYED UID-PATH DOCS ───────────────────────────────
// Firestore docs addressed as `<coll>/{uid}` directly — no scan
// needed, just a targeted delete/get. Excludes `account_erasures`
// and any audit-trail collections intentionally.
const OWNER_KEYED_DOCS = [
  'users',
  'subscriptions',
  'userSettings',
  'leaderboard',
  'reps',
  'estimate_drafts',
  'feature_flags',
];

// ─── NESTED-LEADS SUBTREE ───────────────────────────────────
// Vestigial `leads/{uid}/leads/{leadId}` path from an old schema
// (firestore.rules:140-145). No current writer, but the rule still
// permits the owner to write here, and previous GDPR sweeps missed
// the subtree. Erasure uses `db.recursiveDelete(NESTED_LEADS_PATH(uid))`
// to wipe the whole doc + every child collection in one call.
function NESTED_LEADS_PATH(uid) {
  return 'leads/' + uid;
}

module.exports = {
  FLAT_USER_COLLECTIONS,
  COLLECTION_GROUPS_WITH_USERID,
  STORAGE_PREFIXES,
  OWNER_KEYED_DOCS,
  NESTED_LEADS_PATH,
};
