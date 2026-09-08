/**
 * scripts/backfill-photos-damageType.js
 *
 * ONE-TIME BACKFILL — folds every /photos doc's `damageType` to the
 * canonical lowercase snake_case id.
 *
 * Background
 * ──────────
 * Four client surfaces wrote this one field in four vocabularies
 * (verified 2026-09-08 — see documentation/audit/PHOTO-DAMAGETYPE-
 * VOCABULARY-2026-09-08.md):
 *
 *   photo-editor.js          Title Case  'Hail' 'Flashing Damage' 'Soffit/Fascia'
 *   customer-tasks-ui.js     Title Case  'Hail' 'Flashing' 'Gutter'  (shorter wording)
 *   customer.html bulk bar   kebab-case  'hail' 'granule-loss' 'missing-shingles'
 *   photo-review.js + AI     snake_case  'hail' 'granular_loss' 'wear'
 *
 * photo-report.js `_buildPairs` tier 2 groups before/after candidates by
 * damageType. Its normKey already lowercased, so case alone was never the
 * problem — SEPARATOR and WORDING drift was: a 'granule-loss' before-shot
 * and a 'granular_loss' after-shot missed each other, tiers 1+2 came back
 * empty, and tier 3 shipped the two as a chronological pair mislabeled
 * "Project overview".
 *
 * THIS SCRIPT IS OPTIONAL. The fix normalizes on READ as well as on write
 * (docs/pro/js/photo-damage-types.js, wired into photo-report.js,
 * photo-review.js, photo-editor.js and customer-tasks-ui.js), so legacy
 * docs already pair and label correctly without it. Run it to make the
 * stored data match what the app now computes — which makes a raw
 * Firestore export, a future aggregate query, or a `where('damageType',
 * '==', …)` filter agree with the UI.
 *
 * Fold source
 * ───────────
 * The canon is loaded FROM docs/pro/js/photo-damage-types.js via `vm`
 * rather than re-declared here. That file is a classic browser script
 * (no `export` syntax) precisely so Node can run it — the same trick
 * tests/smoke/photo-damage-canon.test.js uses. A second copy of the
 * alias table in this script is exactly the drift that caused the bug.
 *
 * Unknown values are slugified and KEPT, never collapsed to 'other':
 * a rep's free-text peril still has to group with itself.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — only touches docs whose stored value differs from its
 *     canonical form; safe to re-run.
 *   • Never clears a value: a doc with damageType '' or absent is skipped.
 *
 * SETUP
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro          # optional override
 *
 * RUN
 *   node scripts/backfill-photos-damageType.js               # dry-run
 *   node scripts/backfill-photos-damageType.js --apply --yes # actually write
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { initAdmin, getFirestore } = require('./_admin');
const { assertNotCompleted, recordCompletion } = require('./_migration-guard');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
// --force overrides the run-once guard (see scripts/_migration-guard.js).
const FORCE = args.includes('--force');
const MIGRATION = 'backfill-photos-damageType';
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const PAGE = 500;   // read page size
const BATCH = 400;  // Firestore batch write cap is 500; stay under it

// ── Load the shared canon (single source of truth) ────────────────────
function loadCanon() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'docs/pro/js/photo-damage-types.js'),
    'utf8'
  );
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'photo-damage-types.js' });
  const canon = sandbox.window.NBD_PHOTO_DAMAGE;
  if (!canon || typeof canon.normalize !== 'function') {
    throw new Error('photo-damage-types.js did not expose window.NBD_PHOTO_DAMAGE');
  }
  return canon;
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  const canon = loadCanon();
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();
  await assertNotCompleted(MIGRATION, { apply: APPLY, force: FORCE });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill photos.damageType → canonical snake_case');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  let scanned = 0;
  let empty = 0;
  let alreadyOk = 0;
  let toFix = 0;
  let written = 0;
  let failures = 0;
  let aiOffCanon = 0;
  // stored spelling → { to, n } so the dry-run reports the real shape of
  // the data instead of only the first 20 doc ids.
  const folds = new Map();

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

      // The AI classifier's allowlist is already canonical; count any
      // drift rather than fixing it here — a non-canonical aiSuggestion
      // means functions/photo-vision.js changed and needs its own look.
      const ai = data.aiSuggestion && data.aiSuggestion.damageType;
      if (ai && canon.normalize(ai) !== ai) aiOffCanon++;

      const raw = data.damageType;
      // Never invent a value and never clear one.
      if (raw == null || raw === '') { empty++; continue; }

      const next = canon.normalize(raw);
      if (!next) { empty++; continue; }          // whitespace-only — leave alone
      if (next === raw) { alreadyOk++; continue; } // idempotent

      toFix++;
      const key = String(raw);
      const seen = folds.get(key);
      if (seen) seen.n++;
      else folds.set(key, { to: next, n: 1 });

      if (!APPLY) continue;

      batch.update(doc.ref, { damageType: next });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  await flush();

  if (folds.size) {
    console.log('  fold map (stored spelling → canonical id):');
    const rows = Array.from(folds.entries()).sort((a, b) => b[1].n - a[1].n);
    for (const [from, info] of rows) {
      console.log('    ' + String(info.n).padStart(5) + '  ' +
        JSON.stringify(from) + ' → ' + info.to);
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log('  scanned          : ' + scanned);
  console.log('  no damageType    : ' + empty);
  console.log('  already canonical: ' + alreadyOk);
  console.log('  needed folding   : ' + toFix);
  if (aiOffCanon) {
    console.log('  ! aiSuggestion.damageType off-canon: ' + aiOffCanon +
      ' (check functions/photo-vision.js ALLOWED_DAMAGE)');
  }
  if (APPLY) {
    console.log('  written          : ' + written);
    console.log('  failures         : ' + failures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write)');
  }
  console.log('───────────────────────────────────────────────────────────');

  if (APPLY && failures === 0) await recordCompletion(MIGRATION, { scanned, toFix, written });

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
