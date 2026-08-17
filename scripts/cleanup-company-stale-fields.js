#!/usr/bin/env node
/**
 * scripts/cleanup-company-stale-fields.js — drop dead fields from companies/{id}.
 *
 * Removes two fields that NO code reads, both left behind by the seed script
 * deleted in #1236:
 *
 *   • siteUrl      Pointed at /sites/nbd.html and /sites/oaks.html — static pages
 *                  that do not exist (#1166 retired the Oaks one; the NBD one
 *                  never existed). The canonical field is `siteSlug`, and the
 *                  public URL is DERIVED from it, never stored: setSiteSlug
 *                  returns '/sites/t/' + (slug || companyId), and the dashboard's
 *                  "Your Website" panel rebuilds the same string.
 *
 *   • subscription Denormalized {plan,status} metadata. Billing truth is the
 *                  separate subscriptions/{companyId} doc; the company-doc
 *                  fallback reads TOP-LEVEL `.plan` (handlers/invites.js), never
 *                  `.subscription.plan`. A seeded 'growth' here resolved to
 *                  free-tier seat caps anyway — it never did anything.
 *
 * ⚠ THIS WRITES TO PROD FIRESTORE. Jo runs this (Claude does not write prod).
 *   Auth: GOOGLE_APPLICATION_CREDENTIALS env var (same as seed-demo.js).
 *
 *   1. node scripts/cleanup-company-stale-fields.js           (dry run — read only)
 *   2. review the plan it prints
 *   3. node scripts/cleanup-company-stale-fields.js --write   (applies)
 *
 * Flags:
 *   --write        apply (default is a read-only dry run)
 *   --only=a,b,c   restrict to these company ids
 *
 * ── Ordering vs. the publication gate ──────────────────────────────────────
 * Unrelated field sets, so the two cannot clobber each other — but run
 * scripts/backfill-company-status.js FIRST. That one has a deploy deadline
 * attached (a status-less company goes dark at the gate cutover); this one is
 * pure hygiene with no deadline.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * Uses update() with FieldValue.delete(), so ONLY these two field paths are
 * touched. ownerId, status, plan, siteSlug, siteSlugUpdatedAt, colors, services
 * and everything else are left exactly as they are.
 *
 * Deliberately NOT set(): a whole-doc set() with no {merge:true} is precisely
 * what made the old seed script unsafe — it stripped ownerId (silently
 * disabling the owner-demotion guards in handlers/admin.js) and siteSlug
 * (orphaning the siteSlugs/{slug} claim doc, whose only release path is inside
 * setSiteSlug's transaction, making that slug permanently unclaimable). This
 * script must never reintroduce that failure mode — tests/
 * company-stale-fields-cleanup.test.js pins it.
 *
 * Idempotent: a doc carrying neither field is skipped, so re-running is a no-op.
 */

'use strict';

const STALE_FIELDS = ['siteUrl', 'subscription'];

// Pin the project explicitly. A bare initializeApp() follows whatever ambient
// credential/gcloud context happens to be set — the old seed script's mistake,
// and an easy way to write the wrong project.
const PROJECT_ID = 'nobigdeal-pro';

// ── Pure core (exported for tests; no Firestore, no argv) ──────────────────

// Which docs need cleaning, and which stale fields each one actually carries.
// `docs` is [{ id, data }]; `only` is a Set of ids or null for "all".
function planCleanup(docs, only) {
  const planned = [];
  let skipped = 0;
  for (const d of docs) {
    if (only && !only.has(d.id)) continue;
    const co = d.data || {};
    const present = STALE_FIELDS.filter((f) => co[f] !== undefined);
    if (!present.length) { skipped++; continue; }
    planned.push({ id: d.id, name: co.name || '(unnamed)', present, co });
  }
  return { planned, skipped };
}

// Build the update patch. Only ever contains STALE_FIELDS keys, and every value
// is the caller's delete sentinel — never a literal, never another field.
function buildPatch(present, deleteSentinel) {
  const patch = {};
  for (const f of present) {
    if (!STALE_FIELDS.includes(f)) continue; // belt-and-braces: never widen
    patch[f] = deleteSentinel;
  }
  return patch;
}

function parseOnly(argv) {
  const arg = argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  const ids = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function preview(v) {
  if (v === undefined) return '(absent)';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

// ── I/O ────────────────────────────────────────────────────────────────────

async function main() {
  const { getApps, initializeApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');

  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();

  const APPLY = process.argv.includes('--write');
  const ONLY = parseOnly(process.argv);

  console.log(`\ncompanies stale-field cleanup — project ${PROJECT_ID}`);
  console.log(`mode: ${APPLY ? 'WRITE' : 'DRY RUN'}${ONLY ? `  (--only=${[...ONLY].join(',')})` : ''}\n`);

  const snap = await db.collection('companies').get();
  const docs = [];
  snap.forEach((doc) => docs.push({ id: doc.id, data: doc.data() || {} }));

  const { planned, skipped } = planCleanup(docs, ONLY);

  console.log(`companies scanned: ${docs.length}   already clean: ${skipped}`);

  if (!planned.length) {
    console.log('\nNothing to do — no company doc carries siteUrl or subscription.\n');
    await db.terminate();
    return;
  }

  console.log(`\n${APPLY ? 'DELETING' : 'WOULD DELETE'} these fields (${planned.length} doc(s)):`);
  for (const p of planned) {
    console.log(`\n  companies/${p.id}  — ${p.name}`);
    for (const f of p.present) console.log(`    - ${f}: ${preview(p.co[f])}`);
    // Print the survivors too, so the operator can see this is a field-level
    // patch and not a document replacement.
    const keep = Object.keys(p.co).filter((k) => !p.present.includes(k)).sort();
    console.log(`    untouched (${keep.length}): ${keep.join(', ') || '(none)'}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --write to apply.\n');
    await db.terminate();
    return;
  }

  let n = 0;
  for (const p of planned) {
    await db.collection('companies').doc(p.id).update(buildPatch(p.present, FieldValue.delete()));
    n++;
    console.log(`  ✓ companies/${p.id}`);
  }
  console.log(`\n✅ cleaned ${n} compan${n === 1 ? 'y' : 'ies'}.\n`);
  await db.terminate();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n❌ failed:', e.message);
    process.exitCode = 1;
  });
}

module.exports = { STALE_FIELDS, planCleanup, buildPatch, parseOnly };
