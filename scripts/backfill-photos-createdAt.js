/**
 * scripts/backfill-photos-createdAt.js
 *
 * ONE-TIME BACKFILL — stamps a canonical `createdAt` on every /photos doc
 * that is missing one.
 *
 * Background
 * ──────────
 * /photos was historically written by several client paths that set
 * INCONSISTENT timestamp fields:
 *   • photo-engine.js        → capturedAt (number) + uploadedAt (Timestamp)
 *   • dashboard-bootstrap     → createdAt (Timestamp)        [already canonical]
 *   • photo-editor.js (copy)  → annotatedAt only (no create/upload stamp)
 *   • repos.js stampCreate    → createdAt (Timestamp)        [already canonical]
 *
 * We standardized on `createdAt` as the single ordering field: the Recent
 * photo feed (dashboard-widgets.js) and the per-lead gallery
 * (photo-engine.js getPhotosForLead) now both orderBy('createdAt').
 *
 * Firestore's orderBy SILENTLY EXCLUDES documents that lack the ordered
 * field — so until legacy docs (which only have uploadedAt / capturedAt /
 * annotatedAt) get a `createdAt`, they would vanish from those views. This
 * script backfills `createdAt` so the cutover doesn't drop existing photos.
 *
 * Derivation (first present wins):
 *   1. uploadedAt   — server upload time (photo-engine)
 *   2. capturedAt   — client capture epoch (ms → Timestamp)
 *   3. annotatedAt  — annotation-copy edit time
 *   4. snap.createTime — Firestore's own doc-creation metadata (universal)
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — only touches docs WITHOUT a createdAt; safe to re-run.
 *   • Never overwrites an existing createdAt.
 *
 * SETUP
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro          # optional override
 *
 * RUN
 *   node scripts/backfill-photos-createdAt.js               # dry-run
 *   node scripts/backfill-photos-createdAt.js --apply --yes # actually write
 *
 * Run this AROUND the deploy of the createdAt cutover (ideally just before
 * or immediately after) to minimize the window where legacy photos are
 * missing from the feed/gallery.
 */

const { initAdmin, getFirestore, Timestamp } = require('./_admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const PAGE = 500;   // read page size
const BATCH = 400;  // Firestore batch write cap is 500; stay under it

function init() {
  // initAdmin is idempotent (ADC credential by default), so the old
  // "already exists" message-matching catch is no longer needed.
  initAdmin({ projectId: PROJECT });
}



// Derive a canonical createdAt Timestamp for a doc that lacks one.
// Returns a Firestore Timestamp, or null if nothing usable (the caller
// then falls back to snap.createTime, which always exists).
function deriveCreatedAt(data) {
  const up = data.uploadedAt;
  if (up && typeof up.toMillis === 'function') return up;        // already a Timestamp
  if (up && typeof up.seconds === 'number') return new Timestamp(up.seconds, up.nanoseconds || 0);

  const cap = data.capturedAt;
  if (typeof cap === 'number' && isFinite(cap)) return Timestamp.fromMillis(cap);

  const ann = data.annotatedAt;
  if (ann && typeof ann.toMillis === 'function') return ann;
  if (ann && typeof ann.seconds === 'number') return new Timestamp(ann.seconds, ann.nanoseconds || 0);

  return null;
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  init();
  const db = getFirestore();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill photos.createdAt');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  let scanned = 0;
  let alreadyOk = 0;
  let toFix = 0;
  let written = 0;
  let failures = 0;

  let batch = db.batch();
  let batchCount = 0;
  async function flush() {
    if (batchCount === 0) return;
    if (APPLY) {
      try {
        await batch.commit();
        written += batchCount;
      } catch (e) {
        failures += batchCount;
        console.warn('! batch commit failed — ' + e.message);
      }
    }
    batch = db.batch();
    batchCount = 0;
  }

  let last = null;
  while (true) {
    let q = db.collection('photos').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};

      // Idempotent: never touch a doc that already has createdAt.
      const existing = data.createdAt;
      if (existing && (typeof existing.toMillis === 'function' || typeof existing.seconds === 'number')) {
        alreadyOk++;
        continue;
      }

      toFix++;
      const derived = deriveCreatedAt(data) || doc.createTime;  // createTime always present
      const source = data.uploadedAt ? 'uploadedAt'
        : (typeof data.capturedAt === 'number') ? 'capturedAt'
        : data.annotatedAt ? 'annotatedAt'
        : 'createTime';

      if (!APPLY) {
        if (toFix <= 20) {
          console.log('  would set ' + doc.id + '.createdAt ← ' + source
            + ' (' + derived.toDate().toISOString() + ')');
        }
        continue;
      }

      batch.set(doc.ref, { createdAt: derived }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  await flush();

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned        : ' + scanned);
  console.log('  already had it : ' + alreadyOk);
  console.log('  needed backfill: ' + toFix);
  if (APPLY) {
    console.log('  written        : ' + written);
    console.log('  failures       : ' + failures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write)');
  }
  console.log('───────────────────────────────────────────────────────────');

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
