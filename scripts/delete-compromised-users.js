/**
 * scripts/delete-compromised-users.js
 *
 * Deletes 4 Firebase Auth users that were created by the OLD
 * validateAccessCode Cloud Function with deterministic, email-derived
 * passwords. Anyone who reverse-engineered the old function can still
 * sign in as these users using the leaked password formula until the
 * accounts themselves are deleted.
 *
 * The hardened validateAccessCode recreates these accounts on demand
 * with secure random passwords (you never see them — sessions use
 * custom tokens). So deleting them is the right fix.
 *
 * RUN ORDER:
 *   1. node scripts/seed-access-codes.js        (so the hardened flow has
 *                                                 codes to redeem)
 *   2. node scripts/delete-compromised-users.js (this script)
 *
 * SETUP:
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN:
 *   node scripts/delete-compromised-users.js
 *
 * Safe to re-run — already-deleted users are reported as "not found".
 */

const admin = require('firebase-admin');

const compromised = [
  'demo@nobigdeal.pro',
  'vip@nobigdeal.pro',
  'admin@nobigdeal.pro',
  'invite.2026@nobigdeal.pro',
];

function init() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

async function main() {
  init();

  let deleted = 0;
  let missing = 0;
  let failed = 0;

  for (const email of compromised) {
    try {
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);
      console.log('✓ deleted  ' + email + ' (uid=' + user.uid + ')');
      deleted++;
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.log('- not found (already deleted) ' + email);
        missing++;
      } else {
        console.error('! failed to delete ' + email + ' — ' + (e.message || e.code));
        failed++;
      }
    }
  }

  console.log('\nDeleted ' + deleted + ', already-missing ' + missing + ', failed ' + failed);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
