/**
 * scripts/backfill-sms-optout-keys.js
 *
 * ONE-TIME BACKFILL — re-keys the TCPA opt-out register onto the canonical
 * last-10 key, so every STOP that was ever recorded starts being honoured.
 *
 * Background
 * ──────────
 * `sms_opt_outs` was WRITTEN under one key and READ under another:
 *
 *   write (incomingSMS)  String(twilioFrom).replace(/\D/g,'')  → '18595550134'
 *   read  (every sender) String(lead.phone).replace(/\D/g,'')  → '8595550134'
 *
 * Twilio delivers E.164 with the country code; leads store the phone however
 * the rep typed it. So the register was effectively write-only and a
 * homeowner's STOP was never honoured on any rep- or AI-initiated text, while
 * we replied "You've been unsubscribed from NBD Pro SMS".
 *
 * functions/sms-optout.js now owns one derivation for both sides. This script
 * moves the records already in production onto it. Without it those people
 * would silently become textable again the moment the write side normalises —
 * the same harm, inverted, on the exact people who already objected.
 *
 * Derivation: phoneDigits10() from functions/phone-utils.js, imported here so
 * the migrated key and the looked-up key cannot drift.
 *
 * MEASURED STATE, 2026-09-04 (dry-run against nobigdeal-pro)
 * ──────────────────────────────────────────────────────────
 * `sms_opt_outs` holds ZERO documents — it does not even appear in
 * `db.listCollections()`, which only returns collections with at least one
 * doc. So do the `sms_log`, `sms_inbound_seen` and `storm_alert_subscribers`
 * collections, while `leads` returns rows on the same connection.
 *
 * Read that carefully, because it cuts both ways. The key mismatch is a real
 * defect and the fix is right — but NO homeowner has been harmed by it, and
 * claiming otherwise would be inventing damage. No inbound SMS has ever been
 * received in production, so no STOP has ever been recorded to be ignored.
 * The A2P 10DLC registration that gates delivery is still pending.
 *
 * That makes this a PREVENTIVE fix landing before the feature goes live,
 * which is the best possible timing — and it makes this script a no-op today.
 * It still ships: the buggy write path is live until the deploy, so a record
 * could appear in the window, and re-running costs nothing. Re-run the
 * dry-run at deploy time rather than trusting this note.
 *
 * ORDERING — there is none, deliberately
 * ──────────────────────────────────────
 * `isOptedOut()` checks the canonical key and falls back to the legacy key,
 * so no window exists in which an existing opt-out is invisible. Deploy first
 * or backfill first; both are safe. Run it soon anyway: the fallback is the
 * thing this retires.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — a record whose canonical doc already exists is skipped;
 *     safe to re-run.
 *   • NEVER destructive by default. The legacy doc is left in place so the
 *     runtime fallback keeps working. Pass --prune ONLY after the
 *     `optout.legacy_key_hit` log line has gone quiet in production, which is
 *     the evidence that nothing depends on it any more.
 *   • Records with no usable phone digits are reported and left untouched.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC).
 * firebase-admin arrives through scripts/_admin.js. Do NOT set NODE_PATH.
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *
 * RUN
 *   node scripts/backfill-sms-optout-keys.js                     # dry-run
 *   node scripts/backfill-sms-optout-keys.js --apply --yes       # migrate
 *   node scripts/backfill-sms-optout-keys.js --apply --yes --prune  # + delete legacy
 */

const { initAdmin, getFirestore } = require('./_admin');
const { assertNotCompleted, recordCompletion } = require('./_migration-guard');

const { phoneDigits10 } = require('../functions/phone-utils');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const FORCE = args.includes('--force');
const PRUNE = args.includes('--prune');
const MIGRATION = 'backfill-sms-optout-keys';
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const COLLECTION = 'sms_opt_outs';

const PAGE = 500;
const BATCH = 200;   // each migrated record is 1-2 writes; stay well under 500

function init() {
  initAdmin({ projectId: PROJECT });
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  init();
  const db = getFirestore();
  await assertNotCompleted(MIGRATION, { apply: APPLY, force: FORCE });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill sms_opt_outs → canonical last-10 key');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('  prune   : ' + (PRUNE ? 'YES — legacy docs will be DELETED' : 'no (legacy docs kept)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  let scanned = 0;
  let alreadyCanonical = 0;
  let toMigrate = 0;
  let collision = 0;
  let unusable = 0;
  let written = 0;
  let pruned = 0;
  let failures = 0;

  let batch = db.batch();
  let batchCount = 0;
  async function flush() {
    if (batchCount === 0) return;
    if (APPLY) {
      try {
        await batch.commit();
      } catch (e) {
        failures += batchCount;
        console.warn('! batch commit failed — ' + e.message);
      }
    }
    batch = db.batch();
    batchCount = 0;
  }

  let last = null;
  for (;;) {
    let q = db.collection(COLLECTION).orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};

      // Derive from the doc id itself, NOT from data.phone. The id is what the
      // lookup uses, and a record whose stored `phone` disagrees with its own
      // id (hand-edited, or written by some path we have not found) must still
      // migrate to the key derived from the id people are actually keyed on.
      const canonical = phoneDigits10(doc.id);

      if (!canonical) {
        unusable++;
        console.warn('  ! ' + doc.id + ' — no usable digits, left untouched');
        continue;
      }

      if (doc.id === canonical) { alreadyCanonical++; continue; }

      // Idempotency + safety: never clobber an existing canonical record. If
      // both exist the canonical one is authoritative (it is the one the
      // runtime already honours) and the legacy one is redundant.
      const target = db.doc(COLLECTION + '/' + canonical);
      const existing = await target.get();
      if (existing.exists) {
        collision++;
        if (collision <= 20) {
          console.log('  = ' + doc.id + ' → ' + canonical + ' already present, legacy is redundant'
            + (PRUNE ? ' (will prune)' : ''));
        }
        if (PRUNE) {
          batch.delete(doc.ref);
          batchCount++;
          pruned++;
          if (batchCount >= BATCH) await flush();
        }
        continue;
      }

      toMigrate++;
      if (!APPLY) {
        if (toMigrate <= 20) {
          console.log('  would copy ' + doc.id + ' → ' + canonical
            + '  (phone: ' + JSON.stringify(data.phone || '') + ')'
            + (PRUNE ? ' and delete the legacy doc' : ''));
        }
        continue;
      }

      batch.set(target, Object.assign({}, data, {
        migratedFrom: doc.id,
        migratedBy: MIGRATION,
      }));
      batchCount++;
      written++;
      if (PRUNE) { batch.delete(doc.ref); batchCount++; pruned++; }
      if (batchCount >= BATCH) await flush();
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  await flush();

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned            : ' + scanned);
  console.log('  already canonical  : ' + alreadyCanonical);
  console.log('  to migrate         : ' + toMigrate + (APPLY ? ' (written: ' + written + ')' : ''));
  console.log('  redundant legacy   : ' + collision);
  console.log('  unusable ids       : ' + unusable);
  if (PRUNE) console.log('  legacy pruned      : ' + pruned);
  if (failures) console.log('  FAILED writes      : ' + failures);
  console.log('───────────────────────────────────────────────────────────');

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing was written. Re-run with --apply --yes to migrate.');
  } else if (failures) {
    console.error('\nCompleted WITH FAILURES — not recording completion. Investigate and re-run.');
    process.exit(1);
  } else {
    await recordCompletion(MIGRATION, { scanned, written, pruned, collision, unusable });
    console.log('\nDone. Watch for `optout.legacy_key_hit` in the logs — once it stops');
    console.log('appearing, the legacy fallback in functions/sms-optout.js can be removed.');
  }
}

main().catch((e) => {
  console.error('FATAL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
