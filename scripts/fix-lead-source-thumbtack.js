/**
 * scripts/fix-lead-source-thumbtack.js
 *
 * Repairs `source` on leads the Add/Edit form silently downgraded.
 *
 * BACKGROUND
 * ──────────
 * The Thumbtack ingest creates docs with the id prefix `thumbtack_leads__` and
 * sets source:'Thumbtack'. The Add/Edit Lead <select>, however, only listed
 * Door Knock / Storm Canvass / Referral / Online / Other. A <select> whose
 * stored value is not among its <option>s renders BLANK — so every Thumbtack
 * lead opened with an empty Source box, and saving the form wrote whatever was
 * picked over the real value. During the 2026-09-06 cleanup that quietly
 * rewrote a batch of Thumbtack leads to 'Online'. The option list is fixed in
 * code (2026-09-06, PR #1438); this repairs the records it already damaged.
 *
 * WHY THE DOC ID IS THE EVIDENCE
 * ──────────────────────────────
 * The prefix is stamped by the ingest at creation and no UI can edit it, so it
 * cannot have been corrupted by the same bug that corrupted the field. The
 * independent second signal — the "Lead cost: $" line the ingest writes into
 * notes — agrees on every record and adds none of its own (checked 2026-09-06
 * with scripts/audit-lead-source.js: 9 by prefix, 0 extra by fee line).
 *
 * The prefix proves Thumbtack; its ABSENCE proves nothing. Only 43 docs carry
 * it while 58 legitimately claim source:'Thumbtack' — the rest were typed in
 * by hand. So this script only ever acts on prefixed docs and never "corrects"
 * a hand-entered source it cannot verify.
 *
 * SAFETY
 *   • Dry-run by default. --apply requires --yes as well.
 *   • Idempotent — a doc already reading 'Thumbtack' is skipped, so re-running
 *     is a no-op. Nothing else on the doc is touched.
 *   • Never writes a doc without the ingest prefix, whatever its notes say.
 *   • Prints the previous value of every field it changes. The change is fully
 *     reversible from the log, and derivable from the doc id regardless.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC)
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN
 *   node scripts/fix-lead-source-thumbtack.js               # dry-run
 *   node scripts/fix-lead-source-thumbtack.js --apply --yes # actually write
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const PREFIX = 'thumbtack_leads__';
const WANT = 'Thumbtack';

if (APPLY && !YES) {
  console.error('--apply also requires --yes. Refusing to write.');
  process.exit(2);
}

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  console.log('');
  console.log('═'.repeat(59));
  console.log('Fix leads.source on Thumbtack-ingested docs');
  console.log(`  project : ${PROJECT}`);
  console.log(`  mode    : ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'}`);
  console.log('═'.repeat(59));
  console.log('');

  const snap = await db.collection('leads').get();
  const todo = [];

  snap.forEach((d) => {
    if (!d.id.startsWith(PREFIX)) return;
    const data = d.data() || {};
    const src = (data.source === undefined || data.source === null || data.source === '')
      ? '(empty)' : String(data.source);
    if (src === WANT) return;
    todo.push({
      ref: d.ref,
      id: d.id,
      was: src,
      name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || '(no name)',
    });
  });

  todo.sort((a, b) => a.name.localeCompare(b.name));

  if (!todo.length) {
    console.log('  Nothing to do — every ingested doc already reads Thumbtack.');
    console.log('');
    process.exit(0);
  }

  todo.forEach((t) => {
    console.log(`  ${APPLY ? 'set ' : 'would set'} ${t.name.padEnd(24)} source: ${t.was.padEnd(10)} → ${WANT}`);
    console.log(`       ${t.id}`);
  });

  if (APPLY) {
    // One batch — 9 docs is far inside the 500-write limit, and all-or-nothing
    // is the right failure mode here: a half-applied repair is harder to
    // reason about than one that did not run.
    const batch = db.batch();
    todo.forEach((t) => batch.update(t.ref, { source: WANT }));
    await batch.commit();
    console.log('');
    console.log(`  WROTE ${todo.length} docs.`);
  } else {
    console.log('');
    console.log(`  ${todo.length} docs would change. Nothing was written.`);
    console.log('  Re-run with --apply --yes to write.');
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
