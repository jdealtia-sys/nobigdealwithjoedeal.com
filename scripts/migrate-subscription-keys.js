/**
 * scripts/migrate-subscription-keys.js — D-2 re-key migration (Firestore ONLY).
 *
 * Moves a slug tenant's billing doc from subscriptions/{ownerUid} to
 * subscriptions/{companyId} so Phase D can read by companyId. It COPIES the
 * existing doc (incl. the SAME stripeCustomerId / subscription id) — it NEVER
 * touches Stripe and NEVER creates a customer/subscription, so it cannot cause
 * a charge. The source doc is LEFT in place (soak period) so the {uid} fallback
 * keeps working until we tombstone + delete in a later pass.
 *
 *   ⚠ MONEY-ADJACENT DATA. Defaults to DRY-RUN (read-only). --apply WRITES prod
 *     Firestore and requires --i-have-a-fresh-backup (run backup-collections.js
 *     first). Per project rule, prod writes are Jo's to authorize/run.
 *
 *   NBD (solo, companyId == owner uid) is a NO-OP: source id == target id.
 *   Only slug tenants (e.g. 'oaks', companyId != uid) actually migrate.
 *
 * USAGE:
 *   node scripts/migrate-subscription-keys.js                 # dry-run, all companies
 *   node scripts/migrate-subscription-keys.js --company oaks  # dry-run, one tenant
 *   node scripts/migrate-subscription-keys.js --apply --i-have-a-fresh-backup
 */
'use strict';

const path = require('path');

// INVARIANT: this script must never touch Stripe — it ONLY re-keys Firestore
// docs (reusing the existing Stripe customer/subscription verbatim). There is
// deliberately no `require('stripe')` and no stripe.* call anywhere below; the
// re-key cannot create/modify a subscription, so it cannot cause a charge.
// (Enforced by code review, not a runtime guard — a runtime check can't prove
// a negative about its own imports.)

let admin, FieldValue;
const { createRequire } = require('module');
const ADMIN_CANDIDATES = [
  path.join(__dirname, '..', 'functions', 'package.json'),
  'C:/Users/jonat/nobigdealwithjoedeal.com/functions/package.json',
];
try {
  admin = require('firebase-admin');
  ({ FieldValue } = require('firebase-admin/firestore'));
} catch (_) {
  for (const pkg of ADMIN_CANDIDATES) {
    try { const r = createRequire(pkg); admin = r('firebase-admin'); ({ FieldValue } = r('firebase-admin/firestore')); break; } catch (_e) { /* next */ }
  }
}
if (!admin) { console.error('✗ could not resolve firebase-admin'); process.exit(1); }
if (!admin.apps.length) admin.initializeApp();

const argv = process.argv.slice(2);
const arg = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
const has = (flag) => argv.includes(flag);

const onlyCompany = arg('--company', null);
const apply = has('--apply');
const backedUp = has('--i-have-a-fresh-backup');

const db = admin.firestore();

function looksLikeUid(s) { return typeof s === 'string' && /^[A-Za-z0-9]{20,}$/.test(s); }

async function targetsFromCompanies() {
  // Each companies/{slug} doc carries ownerId. companyId == doc id (the slug).
  const snap = await db.collection('companies').get();
  const out = [];
  snap.forEach((d) => {
    const companyId = d.id;
    const ownerId = (d.data() || {}).ownerId;
    out.push({ companyId, ownerId });
  });
  return out;
}

async function planOne({ companyId, ownerId }) {
  if (!ownerId) return { companyId, action: 'skip', why: 'companies doc has no ownerId' };
  if (companyId === ownerId) return { companyId, action: 'noop', why: 'solo tenant (companyId == ownerUid)' };
  if (looksLikeUid(companyId)) return { companyId, action: 'skip', why: 'companyId looks like a uid (solo) — not a slug tenant' };

  const srcRef = db.doc(`subscriptions/${ownerId}`);
  const dstRef = db.doc(`subscriptions/${companyId}`);
  const [src, dst] = await Promise.all([srcRef.get(), dstRef.get()]);

  if (!src.exists) return { companyId, action: 'skip', why: `source subscriptions/${ownerId} ABSENT` };
  const srcData = src.data() || {};
  if (dst.exists) {
    const d = dst.data() || {};
    const samePlan = d.plan === srcData.plan && d.status === srcData.status;
    return { companyId, action: samePlan ? 'noop' : 'review', why: samePlan ? `target already present + matching (plan=${d.plan})` : `target EXISTS with drift (src plan=${srcData.plan}/${srcData.status} vs dst ${d.plan}/${d.status}) — resolve manually` };
  }
  return { companyId, action: 'copy', why: `copy subscriptions/${ownerId} -> subscriptions/${companyId} (plan=${srcData.plan}, customer=${srcData.stripeCustomerId ? 'reused' : 'none'})`, ownerId, srcData };
}

async function main() {
  console.log(`\n=== subscription re-key migration (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
  if (apply && !backedUp) {
    console.error('✗ refusing --apply without --i-have-a-fresh-backup. Run scripts/backup-collections.js first.');
    process.exit(1);
  }

  let targets = await targetsFromCompanies();
  if (onlyCompany) targets = targets.filter((t) => t.companyId === onlyCompany);
  if (!targets.length) { console.log('no matching companies.'); return; }

  const plans = [];
  for (const t of targets) plans.push(await planOne(t));

  for (const p of plans) console.log(`  [${p.action.toUpperCase()}] ${p.companyId}: ${p.why}`);

  const toCopy = plans.filter((p) => p.action === 'copy');
  if (!apply) {
    console.log(`\nDRY-RUN: ${toCopy.length} doc(s) would be copied. Re-run with --apply --i-have-a-fresh-backup to write.`);
    return;
  }

  for (const p of toCopy) {
    const out = { ...p.srcData, reKeyedFrom: p.ownerId, reKeyedAt: FieldValue.serverTimestamp() };
    await db.doc(`subscriptions/${p.companyId}`).create(out); // .create = fail if it raced into existence
    // Neutralize the SOURCE doc so two live subscriptions never share one
    // stripeCustomerId. The by-customer webhook branches use an UNORDERED
    // where('stripeCustomerId','==',customerId).limit(1) and would otherwise
    // match an arbitrary one of the two during the soak window. We clear only
    // the customer id (+ tombstone marker); plan/status stay so the D-1 {uid}
    // fallback keeps resolving until the source is deleted post-soak.
    await db.doc(`subscriptions/${p.ownerId}`).set({
      stripeCustomerId: FieldValue.delete(),
      reKeyedTo: p.companyId,
      reKeyedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓ wrote subscriptions/${p.companyId}; neutralized source subscriptions/${p.ownerId} (customerId cleared, plan retained)`);
  }
  console.log(`\nAPPLIED: ${toCopy.length} copied; source customerId cleared. Delete source docs in a later pass after soak.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
