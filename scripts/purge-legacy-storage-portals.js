/**
 * scripts/purge-legacy-storage-portals.js
 *
 * ONE-TIME BACKFILL — deletes the pre-existing legacy "customer portal"
 * HTML files from Firebase Storage that revokePortalToken historically
 * could NOT touch.
 *
 * Background
 * ──────────
 * Pre-#698, docs/pro/js/customer-portal.js baked a lead's data into a static
 * HTML file and uploaded it to Storage at:
 *     portals/{uid}/{leadId}/v-<ts>.html    (full project portal, versioned)
 *     portals/{uid}/{leadId}-photos.html    (photo gallery portal)
 * and persisted the getDownloadURL on the lead doc as portalUrl / portalPath /
 * portalHistory[].path (+ photoPortalUrl). A Storage download-token URL bypasses
 * Security Rules and never expires, so any link a rep already shared stays live
 * forever — even after they "revoked" (which only flipped portal_tokens).
 *
 * The deployed fix (revokePortalToken + GDPR erasure) now deletes these objects
 * going forward. This script cleans up the artifacts created BEFORE that fix
 * shipped.
 *
 * Scope (default): every lead that has at least one REVOKED portal_token —
 * i.e. a rep already tried to kill access but the baked HTML survived. Pass
 * --all to instead purge EVERY lead that still carries legacy portal fields
 * (the whole legacy system is retired, so this is also defensible — but it
 * destroys customer-facing artifacts wholesale, so it needs Jo's explicit OK).
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD be deleted, touches nothing.
 *   • --apply requires --yes as well (deletes real customer-facing artifacts).
 *   • Idempotent / safe to re-run (ignoreNotFound on every delete).
 *
 * SETUP
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   # (optional overrides)
 *   export NBD_PROJECT=nobigdeal-pro
 *   export NBD_STORAGE_BUCKET=nobigdeal-pro.firebasestorage.app
 *
 * RUN
 *   node scripts/purge-legacy-storage-portals.js                # dry-run, revoked-only
 *   node scripts/purge-legacy-storage-portals.js --apply --yes  # actually delete
 *   node scripts/purge-legacy-storage-portals.js --all          # dry-run, ALL legacy leads
 *   node scripts/purge-legacy-storage-portals.js --all --apply --yes
 *
 * Coordinate with Jo before --apply: this deletes customer-facing artifacts.
 */

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const ALL = args.includes('--all');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const BUCKET = process.env.NBD_STORAGE_BUCKET || 'nobigdeal-pro.firebasestorage.app';

function init() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT,
      storageBucket: BUCKET,
    });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

// Collect every legacy baked-HTML object path recorded on a lead doc.
// Mirrors the logic in functions/portal.js → revokePortalToken so the
// backfill and the live path stay in lockstep.
function collectPaths(leadId, lead) {
  const paths = new Set();
  if (typeof lead.portalPath === 'string' && lead.portalPath) {
    paths.add(lead.portalPath);
  }
  if (Array.isArray(lead.portalHistory)) {
    for (const h of lead.portalHistory) {
      if (h && typeof h.path === 'string' && h.path) paths.add(h.path);
    }
  }
  // The photo portal persisted only its URL, never a path — but the object
  // location is deterministic from the owner uid + leadId.
  if (lead.photoPortalUrl && lead.userId) {
    paths.add(`portals/${lead.userId}/${leadId}-photos.html`);
  }
  // Only ever touch the portals/ tree.
  return [...paths].filter(p => p.startsWith('portals/'));
}

function hasLegacyFields(lead) {
  return !!(lead.portalUrl || lead.portalPath || lead.photoPortalUrl
    || (Array.isArray(lead.portalHistory) && lead.portalHistory.length));
}

// ── Target discovery ────────────────────────────────────────────────

// Distinct leadIds that have at least one revoked portal_token. Scans the
// (small) portal_tokens collection client-side to avoid an index requirement
// on revokedAt.
async function revokedLeadIds(db) {
  const ids = new Set();
  let last = null;
  while (true) {
    let q = db.collection('portal_tokens').orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach(d => {
      const t = d.data();
      if (t && t.revokedAt && typeof t.leadId === 'string') ids.add(t.leadId);
    });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  return ids;
}

// Every leadId that still carries legacy portal fields. Firestore can only
// orderBy a field when the field exists, so we make one pass per field and
// union the results.
async function allLegacyLeadIds(db) {
  const ids = new Set();
  for (const field of ['portalPath', 'photoPortalUrl', 'portalHistory']) {
    let last = null;
    while (true) {
      let q = db.collection('leads').orderBy(field).limit(500);
      if (last) q = q.startAfter(last);
      let snap;
      try {
        snap = await q.get();
      } catch (e) {
        console.warn(`  (skipped pass on "${field}": ${e.message})`);
        break;
      }
      if (snap.empty) break;
      snap.forEach(d => ids.add(d.id));
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }
  }
  return ids;
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. This deletes real, '
      + 'customer-facing Storage objects. Re-run with: --apply --yes');
    process.exit(2);
  }

  init();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Legacy Storage-portal purge');
  console.log('  project : ' + PROJECT);
  console.log('  bucket  : ' + bucket.name);
  console.log('  scope   : ' + (ALL ? 'ALL leads with legacy portal fields'
    : 'leads with a REVOKED portal_token'));
  console.log('  mode    : ' + (APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════');

  console.log('Discovering target leads…');
  const leadIds = ALL ? await allLegacyLeadIds(db) : await revokedLeadIds(db);
  console.log('  ' + leadIds.size + ' candidate lead(s)\n');

  let leadsTouched = 0;
  let objectsDeleted = 0;
  let fieldsCleared = 0;
  let failures = 0;

  for (const leadId of leadIds) {
    let leadSnap;
    try {
      leadSnap = await db.doc('leads/' + leadId).get();
    } catch (e) {
      console.warn('! lead read failed ' + leadId + ' — ' + e.message);
      failures++;
      continue;
    }
    if (!leadSnap.exists) continue;
    const lead = leadSnap.data();
    if (!hasLegacyFields(lead)) continue; // nothing to do (already cleaned)

    const paths = collectPaths(leadId, lead);
    leadsTouched++;
    console.log('• lead ' + leadId + ' (owner ' + (lead.userId || '?') + ') — '
      + paths.length + ' object(s)');

    for (const p of paths) {
      if (!APPLY) {
        console.log('    would delete  ' + p);
        continue;
      }
      try {
        // ignoreNotFound resolves whether or not the object existed, so this
        // is safe to re-run.
        await bucket.file(p).delete({ ignoreNotFound: true });
        console.log('    deleted       ' + p);
        objectsDeleted++;
      } catch (e) {
        console.warn('    ! delete failed ' + p + ' — ' + e.message);
        failures++;
      }
    }

    // Clear the dead URL/path fields off the lead doc.
    if (!APPLY) {
      console.log('    would clear lead fields (portalUrl/portalPath/'
        + 'portalHistory/photoPortalUrl + *GeneratedAt)');
    } else {
      try {
        await leadSnap.ref.update({
          portalUrl: admin.firestore.FieldValue.delete(),
          portalPath: admin.firestore.FieldValue.delete(),
          portalHistory: admin.firestore.FieldValue.delete(),
          portalGeneratedAt: admin.firestore.FieldValue.delete(),
          photoPortalUrl: admin.firestore.FieldValue.delete(),
          photoPortalGeneratedAt: admin.firestore.FieldValue.delete(),
        });
        fieldsCleared++;
      } catch (e) {
        console.warn('    ! field clear failed ' + leadId + ' — ' + e.message);
        failures++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log((APPLY ? 'APPLIED' : 'DRY-RUN') + ' summary');
  console.log('  leads with legacy artifacts : ' + leadsTouched);
  if (APPLY) {
    console.log('  storage objects deleted     : ' + objectsDeleted);
    console.log('  lead docs field-cleared     : ' + fieldsCleared);
  }
  console.log('  failures                    : ' + failures);
  console.log('═══════════════════════════════════════════════════════════');
  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply --yes to delete (coordinate with Jo first).');
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
