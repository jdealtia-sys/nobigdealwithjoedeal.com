/**
 * ONE-TIME MIGRATION — seed the docPrefixes/{PREFIX} reservation registry.
 * ═══════════════════════════════════════════════════════════════
 *
 * Companion to the "global customer-ID prefix uniqueness" fix (firestore.rules
 * docPrefixes block + functions/handlers/provisioning.js:reserveCompanyPrefix).
 *
 * Customer-ID prefixes (brand.docPrefix, e.g. 'OAK') used to be chosen per
 * tenant with no cross-tenant uniqueness check, so two self-serve tenants could
 * both mint 'OAK-0001' and the public referral endpoint could misroute a lead
 * across tenants. Going forward, reserveCompanyPrefix claims each prefix in a
 * global registry. This script back-fills that registry for the tenants that
 * ALREADY have a prefix — otherwise their existing prefix is unowned and a new
 * tenant could reserve it out from under them.
 *
 * What it reserves:
 *   1. 'NBD' → the platform (NBD) owner's tenant key. NBD carries no
 *      brand.docPrefix (it's the default), so it's reserved explicitly.
 *   2. Every companyProfile/{companyId} whose brand.docPrefix is set →
 *      docPrefixes/{DOCPREFIX} = { companyId }.
 *
 * NOT a Cloud Function (no trigger export); excluded from deploy via
 * firebase.json functions.ignore. Run locally ONCE, BEFORE (or with) deploying
 * the new rules:
 *
 *   cd functions
 *   #   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   #   …or rely on `firebase login` Application Default Credentials.
 *   node migrate-docprefixes.js --dry-run                 # preview
 *   node migrate-docprefixes.js                           # apply
 *   node migrate-docprefixes.js --nbd-company-id=<uid>    # force the NBD key
 *
 * Idempotent: a reservation that already points at the SAME companyId is left
 * as-is. A CONFLICT (prefix already reserved by a DIFFERENT companyId) is a real
 * pre-existing collision — the script reports it and exits non-zero WITHOUT
 * overwriting, so it must be resolved by hand.
 */
'use strict';

const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const { OWNER_EMAILS } = require('./handlers/_shared');

function parseArgs(argv) {
  const out = { dryRun: false, nbdCompanyId: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a.startsWith('--nbd-company-id=')) out.nbdCompanyId = a.split('=')[1];
  }
  return out;
}

// Resolve the NBD (platform) tenant key: the owner's companyId claim, or their
// uid when they run solo (companyId == uid convention). Same resolution the
// per-tenant companyProfile migration uses.
async function resolveNbdKey() {
  for (const email of OWNER_EMAILS) {
    try {
      const u = await getAuth().getUserByEmail(email);
      const claimCid = (u.customClaims && u.customClaims.companyId) || u.uid;
      console.log(`  resolved NBD owner ${email}: key=${claimCid}`);
      return claimCid;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  admin.initializeApp();
  const db = getFirestore();

  // ── Build the desired prefix → companyId map ──────────────────────
  // { PREFIX: { companyId, source } }
  const desired = {};

  const nbdKey = args.nbdCompanyId || (await resolveNbdKey());
  if (!nbdKey) {
    console.error('✗ Could not resolve the NBD owner key. Pass --nbd-company-id=<uid>.');
    process.exit(1);
  }
  desired.NBD = { companyId: nbdKey, source: 'nbd-owner' };

  const profiles = await db.collection('companyProfile').get();
  for (const doc of profiles.docs) {
    const brand = (doc.data() || {}).brand || {};
    const prefix = brand.docPrefix;
    if (!prefix) continue; // unconfigured tenant → mints under the NBD fallback
    const PREFIX = String(prefix).toUpperCase();
    if (PREFIX === 'NBD') continue; // handled above; a tenant shouldn't hold it
    if (desired[PREFIX] && desired[PREFIX].companyId !== doc.id) {
      console.error(`✗ PRE-EXISTING COLLISION: prefix '${PREFIX}' claimed by both `
        + `${desired[PREFIX].companyId} and ${doc.id}. Resolve manually before migrating.`);
      process.exit(1);
    }
    desired[PREFIX] = { companyId: doc.id, source: 'companyProfile.brand.docPrefix' };
  }

  console.log(`\nPrefixes to reserve (${Object.keys(desired).length}):`);
  for (const [PREFIX, v] of Object.entries(desired)) {
    console.log(`  ${PREFIX} → ${v.companyId}  (${v.source})`);
  }

  // ── Reconcile against the existing registry ───────────────────────
  let created = 0, unchanged = 0;
  const conflicts = [];
  for (const [PREFIX, v] of Object.entries(desired)) {
    const ref = db.doc(`docPrefixes/${PREFIX}`);
    const snap = await ref.get();
    if (snap.exists) {
      const owner = (snap.data() || {}).companyId;
      if (owner === v.companyId) { unchanged++; continue; }
      conflicts.push({ PREFIX, existing: owner, desired: v.companyId });
      continue;
    }
    if (args.dryRun) {
      console.log(`[DRY RUN] would reserve docPrefixes/${PREFIX} → ${v.companyId}`);
      created++;
      continue;
    }
    await ref.set({
      companyId: v.companyId,
      seal: PREFIX,
      reservedVia: 'migrate-docprefixes',
      reservedAt: FieldValue.serverTimestamp(),
    });
    console.log(`✓ reserved docPrefixes/${PREFIX} → ${v.companyId}`);
    created++;
  }

  if (conflicts.length) {
    console.error('\n✗ REGISTRY CONFLICTS (existing reservation points elsewhere) — NOT overwritten:');
    conflicts.forEach((c) => console.error(`  ${c.PREFIX}: registry=${c.existing} desired=${c.desired}`));
    process.exit(1);
  }

  console.log(`\n${args.dryRun ? '[DRY RUN] ' : ''}Done. created=${created} unchanged=${unchanged}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
