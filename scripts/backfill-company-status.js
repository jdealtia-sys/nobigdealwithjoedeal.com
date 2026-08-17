/**
 * scripts/backfill-company-status.js — microsite publication-gate cutover.
 *
 * Stamps `status: 'active'` on every `companies/{id}` doc that has NO status
 * field, so tenants that are serving their microsite TODAY keep serving after
 * the publication gate ships.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * getPublicSiteConfig used to treat an absent `status` as "serve" (fail-open),
 * so /sites/t/<id> answered 200 for any company doc that existed at all. As of
 * 2026-08-17 it fails CLOSED: only `status:'active'` is published
 * (functions/handlers/public-site.js → isPublishedCompany). Docs written by
 * scripts/provision-tenant.js and the deleted seed-companies.js never set a
 * status, so without this backfill those tenants go dark the moment the gate
 * deploys.
 *
 * RUN THIS BEFORE DEPLOYING THE GATE. Order matters:
 *   1. node scripts/backfill-company-status.js          (dry run — read only)
 *   2. review the plan it prints
 *   3. node scripts/backfill-company-status.js --write  (applies)
 *   4. deploy functions
 *
 * ⚠ THIS WRITES TO PROD FIRESTORE. Jo runs this (Claude does not write prod).
 *   Auth: GOOGLE_APPLICATION_CREDENTIALS env var (same as seed-demo.js).
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * ONLY touches docs with no `status` field at all. A doc that already carries
 * a status is left exactly as-is — including 'superseded-by-invite', which
 * must stay unpublished. This is intentionally not a "publish everything"
 * button.
 *
 * Publishing a microsite is a deliberate release to that company, so after the
 * cutover use --only to release one tenant at a time:
 *   node scripts/backfill-company-status.js --only=oaks --write
 *
 * Flags:
 *   --write        apply (default is a read-only dry run)
 *   --only=a,b,c   restrict to these company ids
 */
'use strict';

const path = require('path');
// firebase-admin lives in functions/node_modules (scripts/ has none), so a bare
// require fails when run from the repo root. Resolve every firebase-admin
// entrypoint through the same resolver so they all come from one install.
let req = require;
try { require.resolve('firebase-admin'); }
catch (_) { req = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json')); }

const admin = req('firebase-admin');
// firebase-admin v14 REMOVED the legacy `admin.apps` array — reading
// `admin.apps.length` throws "Cannot read properties of undefined". getApps()
// is the modular equivalent. Several other scripts/ still use the old pattern
// and are latently broken on v14 (backfill-oaks-brand, provision-tenant,
// import-catalog-costs, seed-demo-access); fix them the same way when touched.
const { getApps } = req('firebase-admin/app');
// getFirestore(), not admin.firestore() — v14 dropped that namespace accessor
// too. Same modular import the functions use (see handlers/public-site.js).
const { getFirestore, FieldValue } = req('firebase-admin/firestore');
if (!getApps().length) admin.initializeApp();

const APPLY = process.argv.includes('--write');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg
  ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
  : null;

async function main() {
  const db = getFirestore();
  const snap = await db.collection('companies').get();

  const willStamp = [];
  const skipped = [];

  for (const doc of snap.docs) {
    const co = doc.data() || {};
    if (ONLY && !ONLY.has(doc.id)) continue;
    // Only a genuinely absent status is ambiguous. Anything already set is a
    // decision someone made — never overwrite it.
    if (Object.prototype.hasOwnProperty.call(co, 'status') && co.status) {
      skipped.push({ id: doc.id, name: co.name || '(unnamed)', status: co.status });
    } else {
      willStamp.push({ id: doc.id, name: co.name || '(unnamed)' });
    }
  }

  console.log(`\ncompanies scanned: ${snap.size}${ONLY ? `  (filtered to --only=${[...ONLY].join(',')})` : ''}`);

  if (skipped.length) {
    console.log(`\nleft alone — status already set (${skipped.length}):`);
    for (const c of skipped) console.log(`  · ${c.id.padEnd(30)} status=${c.status}   ${c.name}`);
  }

  if (!willStamp.length) {
    console.log('\nnothing to stamp — every matching company already has a status.');
    console.log('(if a tenant is dark and you expected it live, its status is set to something other than \'active\')\n');
    return;
  }

  console.log(`\n${APPLY ? 'STAMPING' : 'WOULD STAMP'} status:'active' — these become PUBLICLY REACHABLE at /sites/t/<id> (${willStamp.length}):`);
  for (const c of willStamp) console.log(`  → ${c.id.padEnd(30)} ${c.name}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --write to apply.\n');
    return;
  }

  let n = 0;
  for (const c of willStamp) {
    await db.doc(`companies/${c.id}`).set({
      status: 'active',
      statusSetBy: 'backfill-company-status.js',
      statusSetAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    n++;
  }
  console.log(`\n✅ stamped ${n} compan${n === 1 ? 'y' : 'ies'} status:'active'.`);
  console.log('   Deploy functions now — these keep serving; everything else is dark until released.\n');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('❌ backfill failed:', e && e.message ? e.message : e);
  process.exit(1);
});
