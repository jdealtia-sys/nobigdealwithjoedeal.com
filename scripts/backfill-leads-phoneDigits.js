/**
 * scripts/backfill-leads-phoneDigits.js
 *
 * ONE-TIME BACKFILL — stamps the canonical `phoneDigits` match key (last-10
 * US digits) on every /leads doc that is missing it or has a stale value.
 *
 * Background
 * ──────────
 * Inbound SMS (functions/sms-functions.js incomingSMS) used to match the
 * Twilio sender to a lead with an EXACT `where('phone','==',fromPhone)`.
 * Twilio delivers E.164 (+15551234567); leads store the phone however the
 * rep typed it ("(555) 123-4567") — so the equality almost never hit and
 * most inbound texts never tied to a lead (no inbound note, no AI draft,
 * the rep never saw the reply). The fix: every lead-write path now stamps
 * a normalized `phoneDigits` key, and incomingSMS matches on THAT.
 *
 * This script backfills `phoneDigits` onto the EXISTING leads written
 * before that change, so the revived inbound-SMS → AI-draft pipeline works
 * for the whole book, not just leads created from here on.
 *
 * Derivation: phoneDigits10(lead.phone) — the SAME transform the runtime
 * read/write paths use (functions/phone-utils.js), imported here so the
 * stamped key and the looked-up key can never drift.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — skips docs whose phoneDigits already equals the
 *     recomputed value; safe to re-run. Self-healing: a stale value (phone
 *     edited but key not refreshed) is corrected.
 *   • Leads with no usable phone are left untouched (no empty key written).
 *
 * SETUP (per the admin-script-runner pattern — prod nobigdeal-pro via ADC,
 * with NODE_PATH pointed at a firebase-admin v12 install; v14 breaks
 * Timestamp handling):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NODE_PATH=/path/to/fa12/node_modules    # firebase-admin@12
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *
 * RUN
 *   node scripts/backfill-leads-phoneDigits.js               # dry-run
 *   node scripts/backfill-leads-phoneDigits.js --apply --yes # actually write
 *
 * Run this AROUND the deploy of the incomingSMS phoneDigits cutover. The
 * exact-`phone` fallback in incomingSMS covers the window before this has
 * fully run, so there's no hard ordering requirement — but the sooner it
 * runs, the sooner legacy leads get the fast-path match.
 */

const admin = require('firebase-admin');
const { phoneDigits10 } = require('../functions/phone-utils');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const PAGE = 500;   // read page size
const BATCH = 400;  // Firestore batch write cap is 500; stay under it

function init() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT,
    });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  init();
  const db = admin.firestore();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill leads.phoneDigits');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  let scanned = 0;
  let alreadyOk = 0;
  let noPhone = 0;
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
    let q = db.collection('leads').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      const computed = phoneDigits10(data.phone);

      // No usable phone — nothing to match an inbound SMS on. Leave it.
      if (!computed) { noPhone++; continue; }

      // Idempotent: already carries the correct key.
      if (data.phoneDigits === computed) { alreadyOk++; continue; }

      toFix++;
      if (!APPLY) {
        if (toFix <= 20) {
          const had = data.phoneDigits ? `'${data.phoneDigits}'` : '(missing)';
          console.log('  would set ' + doc.id + '.phoneDigits ' + had + ' → \'' + computed + '\''
            + '  (phone: ' + JSON.stringify(data.phone || '') + ')');
        }
        continue;
      }

      batch.set(doc.ref, { phoneDigits: computed }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  await flush();

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned            : ' + scanned);
  console.log('  already correct    : ' + alreadyOk);
  console.log('  no usable phone    : ' + noPhone);
  console.log('  needed backfill    : ' + toFix);
  if (APPLY) {
    console.log('  written            : ' + written);
    console.log('  failures           : ' + failures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write)');
  }
  console.log('───────────────────────────────────────────────────────────');

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
