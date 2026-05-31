/**
 * ONE-TIME MIGRATION — backfill companyId to the real tenant key.
 *
 * Phase-1.5 (Tenancy Coherence). Before this pass the client stamped
 * companyId inconsistently: the literal 'default' (d2d knocks/territories/
 * reps), null (close-board, storm-center territories), or omitted it
 * entirely (some lead-create paths). The client now always stamps
 * `claims.companyId || uid`. This script re-tags the EXISTING docs that
 * carry 'default' / null / missing companyId to each doc's owner key, so
 * the company-scoped read rules (leaderboard, knocks, reps, territories,
 * recordings, training_sessions) resolve correctly and no two tenants
 * share the 'default' bucket.
 *
 * Per-doc keying: companyId := (owner's companyId claim) || (doc.userId).
 * For a solo operator that's their uid — which is exactly the companyId
 * their invited members carry, so the whole tenant lands on one key.
 *
 * NOT a Cloud Function (no trigger export); excluded from deploy via
 * firebase.json `functions.ignore`. Run locally once, AFTER the client
 * is deployed and BEFORE (or with) the tightened create rules:
 *
 *   cd functions
 *   #   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   #   …or rely on `firebase login` Application Default Credentials.
 *   node migrate-companyid-backfill.js --dry-run    # preview counts
 *   node migrate-companyid-backfill.js              # apply
 *
 * Idempotent: docs that already carry a real key (not 'default'/null) are
 * skipped. Safe to re-run.
 */
'use strict';

const admin = require('firebase-admin');

// Collections that carry companyId and back a company-scoped read rule.
const COLLECTIONS = ['leads', 'knocks', 'territories', 'reps', 'training_sessions'];

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
  }
  return out;
}

function needsBackfill(companyId) {
  return companyId === undefined || companyId === null || companyId === '' || companyId === 'default';
}

async function main() {
  const args = parseArgs(process.argv);
  admin.initializeApp();
  const db = admin.firestore();
  const auth = admin.auth();

  // Resolve a uid → tenant key, cached. key = claims.companyId || uid.
  const keyCache = new Map();
  async function keyForUid(uid) {
    if (!uid) return null;
    if (keyCache.has(uid)) return keyCache.get(uid);
    let key = uid; // solo-operator default
    try {
      const u = await auth.getUser(uid);
      if (u.customClaims && u.customClaims.companyId) key = u.customClaims.companyId;
    } catch (_) { /* user deleted → fall back to uid */ }
    keyCache.set(uid, key);
    return key;
  }

  const summary = {};
  for (const coll of COLLECTIONS) {
    let scanned = 0, fixed = 0, skippedNoOwner = 0;
    const snap = await db.collection(coll).get();
    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      scanned++;
      const d = docSnap.data() || {};
      if (!needsBackfill(d.companyId)) continue;

      // Owner uid: most docs use `userId`; reps may key by doc id.
      const ownerUid = d.userId || (coll === 'reps' ? docSnap.id : null);
      const key = await keyForUid(ownerUid);
      if (!key) { skippedNoOwner++; continue; }

      if (!args.dryRun) {
        batch.update(docSnap.ref, {
          companyId: key,
          companyIdBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 400) { await batch.commit(); batch = db.batch(); batchCount = 0; }
      }
      fixed++;
    }
    if (!args.dryRun && batchCount > 0) await batch.commit();
    summary[coll] = { scanned, fixed, skippedNoOwner };
    console.log(`  ${coll}: scanned=${scanned} ${args.dryRun ? 'wouldFix' : 'fixed'}=${fixed} skippedNoOwner=${skippedNoOwner}`);
  }

  console.log(args.dryRun ? '\n[DRY RUN] no writes performed.' : '\n✓ Backfill complete.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('✗ backfill failed:', e);
  process.exit(1);
});
