/**
 * scripts/audit-lead-source.js — READ ONLY. Writes nothing, ever.
 *
 * Prints how `source` is distributed across /leads and flags every doc whose
 * source disagrees with its own document id.
 *
 * WHY
 * ───
 * The Thumbtack ingest writes docs with the id prefix `thumbtack_leads__`, and
 * sets source:'Thumbtack'. But the Add/Edit Lead <select> only offered
 * Door Knock / Storm Canvass / Referral / Online / Other. A <select> whose
 * value is not among its <option>s renders BLANK — so opening any Thumbtack
 * lead showed an empty Source, and saving the form wrote whatever the user
 * then picked over the real value. During the 2026-09-06 cleanup that silently
 * downgraded a batch of Thumbtack leads to 'Online'.
 *
 * The doc id is the reliable signal, not the notes: it is stamped by the
 * ingest at creation and no UI can edit it.
 *
 * RUN
 *   node scripts/audit-lead-source.js
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');

const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const PREFIX = 'thumbtack_leads__';

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  const snap = await db.collection('leads').get();
  const bySource = new Map();
  const mismatched = [];
  let tt = 0;

  snap.forEach((d) => {
    const data = d.data() || {};
    const src = (data.source === undefined || data.source === null || data.source === '')
      ? '(empty)'
      : String(data.source);
    bySource.set(src, (bySource.get(src) || 0) + 1);

    if (!d.id.startsWith(PREFIX)) return;
    tt++;
    if (src === 'Thumbtack') return;
    mismatched.push({
      id: d.id,
      name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || '(no name)',
      source: src,
      stage: data.stage || '(no stage)',
      hasLeadCostLine: /Lead cost:\s*\$/.test(String(data.notes || '')),
    });
  });

  console.log('');
  console.log(`project: ${PROJECT}   /leads docs: ${snap.size}`);
  console.log('');
  console.log('=== source distribution ===');
  [...bySource.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s}`));

  console.log('');
  console.log(`=== docs with id prefix "${PREFIX}" : ${tt} ===`);
  console.log(`    of those, source is NOT 'Thumbtack' on ${mismatched.length}`);
  console.log('');
  if (mismatched.length) {
    console.log('  current      lead-cost-line  name                            id');
    console.log('  ' + '-'.repeat(100));
    mismatched
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((m) => {
        console.log(
          '  ' + m.source.padEnd(12) +
          ' ' + (m.hasLeadCostLine ? 'yes' : 'NO ').padEnd(15) +
          ' ' + m.name.padEnd(31) +
          ' ' + m.id
        );
      });
  }
  // Second signal. Only 43 docs carry the ingest prefix but 58 claim
  // source:'Thumbtack', so the prefix is sound evidence FOR Thumbtack and no
  // evidence against it — a lead typed in by hand never gets the prefix. The
  // independent marker is the fee line the ingest writes into the notes blob
  // ("Lead cost: $51.96"), which no other source produces.
  const feeNoPrefix = [];
  snap.forEach((d) => {
    if (d.id.startsWith(PREFIX)) return;
    const data = d.data() || {};
    if (!/Lead cost:\s*\$/.test(String(data.notes || ''))) return;
    const src = (data.source === undefined || data.source === null || data.source === '')
      ? '(empty)' : String(data.source);
    if (src === 'Thumbtack') return;
    feeNoPrefix.push({
      id: d.id,
      name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || '(no name)',
      source: src,
    });
  });

  console.log('');
  console.log(`=== NO ingest prefix, but notes carry a "Lead cost: $" line, and source is not Thumbtack : ${feeNoPrefix.length} ===`);
  feeNoPrefix.sort((a, b) => a.name.localeCompare(b.name))
    .forEach((m) => console.log('  ' + m.source.padEnd(12) + ' ' + m.name.padEnd(31) + ' ' + m.id));

  console.log('');
  console.log('READ ONLY — nothing was written.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
