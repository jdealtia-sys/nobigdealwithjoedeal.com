/**
 * scripts/fix-missing-street-addresses.js
 *
 * Three leads hold only a city and ZIP. The street is not missing from the
 * business — it is sitting in the filename of a measurement report already in
 * that customer's own Drive folder, and now on their CRM card:
 *
 *   David Wolfe    "Maineville, OH 45039"   -> 1004 River Forest Dr
 *   Heather Woods  "Bethel, OH 45106"       -> 3208 Pitzer Rd
 *   Duke Ganote    "Cincinnati, OH 45218"   -> 967 Ligorio Ave
 *
 * Found by scripts/audit-imported-docs-placement.js, which flags any imported
 * document matching neither its lead's name nor its address — these three
 * surfaced because the report named a street the lead record did not have.
 *
 * WHY EACH IS SAFE, one at a time rather than as a rule
 *   • A measurement report is ordered FOR a specific property and filed in
 *     that customer's folder. Two independent things agree: the folder it
 *     sits in, and the city/ZIP already on the lead.
 *   • Wolfe is corroborated a third way — the Aug 17 site inspection on file
 *     records 1004 River Forest Dr.
 *
 * SAFETY
 *   • Dry-run by default; --apply requires --yes.
 *   • --company REQUIRED. /leads is multi-tenant.
 *   • Each lead is matched by id AND by expected current address. If either
 *     has changed since this was written, that lead is SKIPPED, not guessed.
 *     A stale hard-coded fix that writes anyway is worse than no fix.
 *   • Never overwrites an address that already has a street number.
 *
 * RUN
 *   node scripts/fix-missing-street-addresses.js --company=<id>
 *   node scripts/fix-missing-street-addresses.js --company=<id> --apply --yes
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const COMPANY = (args.find(a => a.startsWith('--company=')) || '').split('=')[1] || '';

if (APPLY && !YES) { console.error('--apply also requires --yes.'); process.exit(2); }
if (!COMPANY) { console.error('\n  --company=<companyId> is REQUIRED. /leads is multi-tenant.\n'); process.exit(2); }

const FIXES = [
  {
    id: 'UIpzZG8LflLHfluWqJiK',
    name: 'David Wolfe',
    expectNow: 'Maineville, OH 45039',
    to: '1004 River Forest Dr, Maineville, OH 45039',
    evidence: 'Full Report + Property Owner Report both titled 1004 River Forest Dr; Aug 17 site inspection on file',
  },
  {
    id: 'bLAQzMHUBalhpjvkj0rj',
    name: 'Heather Woods',
    expectNow: 'Bethel, OH 45106',
    to: '3208 Pitzer Rd, Bethel, OH 45106',
    evidence: 'Full Report + Property Owner Report both titled 3208 Pitzer Rd',
  },
  {
    id: 'thumbtack_leads__lead_588019445196439552',
    name: 'Duke Ganote',
    expectNow: 'Cincinnati, OH 45218',
    to: '967 Ligorio Ave, Cincinnati, OH 45218',
    evidence: 'Full Report + Codes and Weather Report both titled 967 Ligorio Ave',
  },
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const hasStreetNumber = (s) => /^\s*\d+\s+\S/.test(String(s || ''));

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  console.log('');
  console.log('═'.repeat(64));
  console.log('Fill in the missing street address on three leads');
  console.log(`  project : ${PROJECT}`);
  console.log(`  company : ${COMPANY}`);
  console.log(`  mode    : ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'}`);
  console.log('═'.repeat(64));

  const todo = [];
  for (const f of FIXES) {
    const snap = await db.collection('leads').doc(f.id).get();
    console.log('');
    console.log(`── ${f.name}`);
    if (!snap.exists) { console.log('   SKIP: no lead with that id any more'); continue; }
    const x = snap.data() || {};
    if (x.companyId !== COMPANY) { console.log('   SKIP: belongs to a different company'); continue; }
    const cur = x.address;
    console.log(`   current : ${JSON.stringify(cur)}`);
    console.log(`   proposed: ${JSON.stringify(f.to)}`);
    console.log(`   evidence: ${f.evidence}`);
    if (hasStreetNumber(cur)) { console.log('   SKIP: already has a street number — not overwriting'); continue; }
    if (norm(cur) !== norm(f.expectNow)) {
      console.log(`   SKIP: address is not what this fix was written against (expected ${JSON.stringify(f.expectNow)})`);
      continue;
    }
    todo.push({ ref: snap.ref, ...f });
  }

  console.log('');
  if (!todo.length) { console.log('  Nothing to do.'); console.log(''); process.exit(0); }

  if (APPLY) {
    const batch = db.batch();
    // addressPreviousValue keeps what was there. The old value is not wrong,
    // just incomplete, and a later correction should be able to see it.
    todo.forEach((t) => batch.update(t.ref, {
      address: t.to,
      addressPreviousValue: t.expectNow,
      addressSource: 'report-filename-2026-09-07',
    }));
    await batch.commit();
    console.log(`  WROTE ${todo.length} leads.`);
  } else {
    console.log(`  ${todo.length} leads would change. Re-run with --apply --yes.`);
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
