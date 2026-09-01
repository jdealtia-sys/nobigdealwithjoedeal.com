/**
 * scripts/backfill-pins-to-knocks.js
 *
 * ONE-TIME BACKFILL — migrates legacy hand-dropped DOOR-KNOCK pins from the
 * /pins collection into /knocks, so the D2D map (now the single unified map)
 * shows them alongside every other knock instead of stranding them on the
 * retired Maps & Pins surface.
 *
 * Background
 * ──────────
 * The app historically had TWO parallel door-knock representations:
 *   • /knocks — the D2D quick-knock flow (detailed dispositions), and
 *   • /pins   — hand-dropped map pins that could carry a door-knock status.
 * The map-unification work folds everything onto the D2D map. Pins that
 * represent a LEAD/customer are re-derived from /leads (the Customers layer),
 * so they need no migration. Pins that are hand-dropped DOOR KNOCKS are the
 * ones this script converts to /knocks.
 *
 * What migrates (a pin must satisfy ALL):
 *   • pin.status is one of the legacy door-knock statuses (PIN_STATUS_MAP), and
 *   • pin is NOT a lead/customer pin (no pin.leadId, pin.type !== 'customer').
 * Everything else is skipped (customer pins, statusless pins, unknown status).
 *
 * Disposition mapping (legacy hyphen status → /knocks underscore disposition).
 * Two are best-effort because /knocks has no exact equivalent, flagged below:
 *   not-home       → not_home
 *   interested     → interested
 *   not-interested → not_interested
 *   callback       → callback
 *   do-not-knock   → do_not_knock
 *   left-material  → left_material
 *   signed         → appointment   (no 'signed' disposition; hottest match)
 *   follow-up      → come_back      (no 'follow_up'; "asked to return" ≈)
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — a migrated pin is flagged (migratedToKnock:true) and the
 *     created knock carries migratedFromPinId; re-runs skip already-migrated
 *     pins. Safe to re-run.
 *   • Never deletes the source pin — the /pins doc is left intact (only
 *     flagged), so this is fully reversible by ignoring the new /knocks docs.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC).
 * firebase-admin arrives through scripts/_admin.js, which resolves it out of
 * functions/node_modules — scripts/ and the repo root have none of their own.
 * Do NOT set NODE_PATH: _admin tries a bare require.resolve FIRST, so a
 * NODE_PATH install satisfies it and silently decides which firebase-admin
 * this script gets, which is the single-resolver guarantee _admin exists to
 * provide. Runs on v12 and v14 alike.
 *
 * (This docstring used to warn "v14 breaks Timestamps". That was inherited
 * boilerplate — it appeared verbatim in seven sibling scripts, the exact
 * copy-paste propagation _admin.js's own docstring describes. The only
 * Timestamps here are FieldValue.serverTimestamp() sentinels this script
 * WRITES, plus `pin.createdAt` copied straight through to the new knock
 * unread — never compared, formatted or instanceof-checked, so no version's
 * Timestamp class is ever load-bearing. See
 * documentation/audit/ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01.md.)
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *
 * RUN
 *   node scripts/backfill-pins-to-knocks.js               # dry-run
 *   node scripts/backfill-pins-to-knocks.js --apply --yes # actually write
 *
 * Run this AFTER the unified-map code is deployed. The /pins docs are left in
 * place, so there is no hard ordering requirement and no data loss risk.
 */

const { initAdmin, getFirestore, FieldValue, FieldPath } = require('./_admin');
const { assertNotCompleted, recordCompletion } = require('./_migration-guard');


const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
// --force overrides the run-once guard (see scripts/_migration-guard.js).
const FORCE = args.includes('--force');
const MIGRATION = 'backfill-pins-to-knocks';

const PAGE = 500;   // read page size
const BATCH = 200;  // 2 writes per migrated pin (create knock + flag pin); stay < 500

// Legacy /pins door-knock status → /knocks disposition. Keys NOT present here
// (or customer/lead pins) are skipped. '*' marks a best-effort mapping.
const PIN_STATUS_MAP = {
  'not-home': 'not_home',
  'interested': 'interested',
  'not-interested': 'not_interested',
  'callback': 'callback',
  'do-not-knock': 'do_not_knock',
  'left-material': 'left_material',
  'signed': 'appointment',   // * no 'signed' disposition — hottest available
  'follow-up': 'come_back'   // * no 'follow_up' — "asked to return" is closest
};

function isDoorKnockPin(p) {
  if (!p) return false;
  if (p.leadId) return false;                 // pipeline pin — re-derived from /leads
  if (p.type === 'customer') return false;    // customer pin — not a knock
  return Object.prototype.hasOwnProperty.call(PIN_STATUS_MAP, p.status);
}

function knockFromPin(pin, pinId) {
  const disposition = PIN_STATUS_MAP[pin.status];
  const doc = {
    userId: pin.userId || null,
    companyId: pin.companyId || pin.userId || null,
    address: pin.address || pin.name || '',
    lat: (typeof pin.lat === 'number') ? pin.lat : (parseFloat(pin.lat) || null),
    lng: (typeof pin.lng === 'number') ? pin.lng : (parseFloat(pin.lng) || null),
    disposition,
    notes: pin.notes || '',
    stage: 'knock',
    convertedToLead: false,
    // Preserve when the pin was originally dropped so the knock lands in the
    // right place in history; fall back to now if the legacy pin lacked it.
    createdAt: pin.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    // Provenance + idempotency key.
    migratedFromPinId: pinId,
    migratedAt: FieldValue.serverTimestamp()
  };
  return doc;
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();
  // One-shot: refuse a second --apply unless --force.
  await assertNotCompleted(MIGRATION, { apply: APPLY, force: FORCE });
  console.log(`[backfill-pins-to-knocks] project=${PROJECT} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  let scanned = 0, eligible = 0, migrated = 0, skippedAlready = 0, skippedNotKnock = 0, skippedNoOwner = 0;
  const sample = [];
  let last = null;

  /* eslint-disable no-await-in-loop */
  while (true) {
    let q = db.collection('pins').orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;

    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      scanned++;
      const pin = d.data() || {};
      if (pin.migratedToKnock === true) { skippedAlready++; continue; }
      if (!isDoorKnockPin(pin)) { skippedNotKnock++; continue; }
      if (!pin.userId) { skippedNoOwner++; continue; } // a knock without an owner can't be tenancy-scoped
      eligible++;

      if (sample.length < 10) {
        sample.push({ pinId: d.id, status: pin.status, disposition: PIN_STATUS_MAP[pin.status], address: pin.address || pin.name || '' });
      }

      if (APPLY) {
        const knockRef = db.collection('knocks').doc();
        batch.set(knockRef, knockFromPin(pin, d.id));
        batch.update(d.ref, { migratedToKnock: true, migratedKnockId: knockRef.id });
        inBatch += 2;
        migrated++;
        if (inBatch >= BATCH) { await batch.commit(); batch = db.batch(); inBatch = 0; }
      }
    }
    if (APPLY && inBatch > 0) await batch.commit();
  }
  /* eslint-enable no-await-in-loop */

  console.log('\n── Summary ──');
  console.log(`scanned pins:            ${scanned}`);
  console.log(`eligible door-knock pins:${eligible}`);
  console.log(`${APPLY ? 'migrated' : 'WOULD migrate'}:            ${APPLY ? migrated : eligible}`);
  console.log(`skipped (already):       ${skippedAlready}`);
  console.log(`skipped (not a knock):   ${skippedNotKnock}`);
  console.log(`skipped (no owner uid):  ${skippedNoOwner}`);
  if (sample.length) {
    console.log('\nsample:');
    for (const s of sample) console.log(`  pin ${s.pinId}  ${s.status} → ${s.disposition}  ${s.address}`);
  }
  if (!APPLY) console.log('\nDRY-RUN — nothing written. Re-run with --apply --yes to migrate.');

  if (APPLY) await recordCompletion(MIGRATION, { scanned, eligible, migrated });

  process.exit(0);
}

main().catch(e => { console.error('backfill failed:', e); process.exit(1); });
