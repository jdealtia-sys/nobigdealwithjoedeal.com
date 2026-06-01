#!/usr/bin/env node
/**
 * scripts/_drill-count.js — helper for scripts/restore-drill.sh (EMULATOR ONLY).
 *
 * Counts documents in the collections the seed writes and stashes the
 * tallies to /tmp so the drill can compare before-backup vs after-restore.
 *
 * Modes:
 *   node _drill-count.js before   → write counts to /tmp/nbd-drill-before.json
 *   node _drill-count.js after    → write counts to /tmp/nbd-drill-after.json
 *   node _drill-count.js empty    → assert all collections are EMPTY (fresh boot)
 *   node _drill-count.js --compare→ diff before vs after, exit 1 on mismatch
 *
 * RULE 0: refuses to run unless FIRESTORE_EMULATOR_HOST is set (except in
 * --compare mode, which only reads the /tmp json files and touches no db).
 */
'use strict';

const fs = require('fs');
const COLLECTIONS = ['leads', 'estimates', 'customers', 'knocks', 'subscriptions', 'companyProfile', 'userSettings'];
const BEFORE = '/tmp/nbd-drill-before.json';
const AFTER = '/tmp/nbd-drill-after.json';
const mode = process.argv[2] || 'before';

if (mode === '--compare') {
  const a = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const b = JSON.parse(fs.readFileSync(AFTER, 'utf8'));
  let mismatch = 0;
  for (const c of COLLECTIONS) {
    const ok = (a[c] || 0) === (b[c] || 0);
    console.log(`  ${ok ? '✓' : '✗'} ${c.padEnd(16)} before=${a[c] || 0}  after=${b[c] || 0}`);
    if (!ok) mismatch++;
  }
  process.exit(mismatch ? 1 : 0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('✗ REFUSING: FIRESTORE_EMULATOR_HOST not set (emulator-only).');
  process.exit(1);
}

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'nobigdeal-pro' });
const db = admin.firestore();

(async () => {
  const counts = {};
  for (const c of COLLECTIONS) {
    const snap = await db.collection(c).get();
    counts[c] = snap.size;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (mode === 'empty') {
    if (total !== 0) {
      console.error(`  ✗ expected EMPTY emulator, found ${total} docs: ${JSON.stringify(counts)}`);
      process.exit(1);
    }
    console.log('  ✓ fresh emulator is empty (0 docs) — confirms data was lost without --import');
    process.exit(0);
  }

  const out = mode === 'after' ? AFTER : BEFORE;
  fs.writeFileSync(out, JSON.stringify(counts, null, 2));
  console.log(`  ✓ ${mode}: ${total} docs across ${COLLECTIONS.length} collections → ${out}`);
  console.log(`    ${JSON.stringify(counts)}`);
  process.exit(0);
})().catch(e => { console.error('count failed:', e.message); process.exit(1); });
