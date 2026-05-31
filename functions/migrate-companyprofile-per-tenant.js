/**
 * ONE-TIME MIGRATION — companyProfile/main → companyProfile/{companyId}
 *
 * Phase-1 audit fix companion. The old single global `companyProfile/main`
 * doc became per-tenant `companyProfile/{companyId}` (see firestore.rules +
 * docs/pro/js/company-profile.js). This script copies the existing global
 * doc to the owning tenant's per-tenant key so NBD's customized legal /
 * financing / marketing overrides are preserved after the rule tightens.
 *
 * It is NOT a Cloud Function (no trigger export) and is excluded from deploy
 * via firebase.json `functions.ignore`. Run it locally once, BEFORE deploying
 * the new rules + hosting:
 *
 *   cd functions
 *   # Authenticate the Admin SDK (either works):
 *   #   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   #   …or rely on `firebase login` Application Default Credentials.
 *   node migrate-companyprofile-per-tenant.js --dry-run    # preview
 *   node migrate-companyprofile-per-tenant.js              # apply
 *   node migrate-companyprofile-per-tenant.js --companyId=<id>   # explicit key
 *
 * Idempotent: re-runs merge into the same target doc. The legacy
 * companyProfile/main is left in place as a tombstone (no longer client-
 * reachable under the new rule); delete it manually once verified.
 */
'use strict';

const admin = require('firebase-admin');

// Known platform-owner emails (mirrors PROVISION_OWNER_EMAILS in
// functions/handlers/_shared.js). The owner's companyId claim — or uid when
// they run solo (companyId == uid convention) — is the per-tenant key.
const OWNER_EMAILS = [
  'jd@nobigdealwithjoedeal.com',
  'jonathandeal459@gmail.com',
];

function parseArgs(argv) {
  const out = { dryRun: false, companyId: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a.startsWith('--companyId=')) out.companyId = a.split('=')[1];
  }
  return out;
}

async function resolveOwnerKey() {
  for (const email of OWNER_EMAILS) {
    try {
      const u = await admin.auth().getUserByEmail(email);
      const claimCid = u.customClaims && u.customClaims.companyId;
      const key = claimCid || u.uid;
      console.log(`  resolved owner ${email}: key=${key} (companyId claim=${claimCid || '(none → using uid)'})`);
      return key;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  admin.initializeApp();
  const db = admin.firestore();

  const mainSnap = await db.doc('companyProfile/main').get();
  if (!mainSnap.exists) {
    console.log('No companyProfile/main found — nothing to migrate.');
    return;
  }
  const data = mainSnap.data() || {};
  console.log(`Found companyProfile/main with ${Object.keys(data).length} fields.`);

  const key = args.companyId || (await resolveOwnerKey());
  if (!key) {
    console.error('✗ Could not resolve a tenant key. Pass --companyId=<id> explicitly.');
    process.exit(1);
  }

  const targetPath = `companyProfile/${key}`;
  const targetSnap = await db.doc(targetPath).get();
  if (targetSnap.exists) {
    console.log(`Target ${targetPath} already exists — will merge (idempotent).`);
  }

  if (args.dryRun) {
    console.log(`[DRY RUN] would copy companyProfile/main → ${targetPath} (merge).`);
    return;
  }

  await db.doc(targetPath).set(data, { merge: true });
  console.log(`✓ Copied companyProfile/main → ${targetPath}`);
  console.log('  Legacy companyProfile/main left as tombstone — delete after verifying the app.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
