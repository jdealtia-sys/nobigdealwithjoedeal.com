/**
 * scripts/seed-access-codes.js
 *
 * Populates the `access_codes` Firestore collection that the hardened
 * validateAccessCode Cloud Function reads.
 *
 * Before the security audit, access codes were a hardcoded object literal
 * inside validateAccessCode. That was removed; codes are now data, and
 * this script is how you create them. Safe to re-run — it overwrites by
 * code id.
 *
 * NO CODE IN THIS FILE GRANTS THE ADMIN ROLE. Admin access is claims-only
 * and is set via scripts/grant-admin-claim.js. Do not add an admin code.
 *
 * SETUP (once):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN:
 *   node scripts/seed-access-codes.js
 *
 * To add or rotate a code: edit the `codes` object below + re-run.
 */

const admin = require('firebase-admin');

const codes = {
  // Demo codes — 14-day trial
  'NBD-DEMO':  { active: true, email: 'demo@nobigdeal.pro',         role: 'member', plan: 'foundation',   trialDays: 14,  displayName: 'Demo User' },
  'DEMO':      { active: true, email: 'demo@nobigdeal.pro',         role: 'member', plan: 'foundation',   trialDays: 14,  displayName: 'Demo User' },
  'TRYIT':     { active: true, email: 'demo@nobigdeal.pro',         role: 'member', plan: 'foundation',   trialDays: 14,  displayName: 'Demo User' },

  // Beta invite codes — 90-day trial
  'NBD-2026':  { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation',   trialDays: 90,  displayName: 'Beta Member' },
  'DEAL-2026': { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation',   trialDays: 90,  displayName: 'Beta Member' },
  'ROOFCON26': { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation',   trialDays: 90,  displayName: 'Beta Member' },
  'NBD-STORM': { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation',   trialDays: 90,  displayName: 'Beta Member' },

  // Intentionally NOT present:
  // - 'NBD-ADMIN' — admin is claims-only, not a code
  // - 'NBD-JOE'   — use scripts/grant-admin-claim.js to become admin
};

function init() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

async function main() {
  init();
  const db = admin.firestore();

  let written = 0;
  for (const [id, data] of Object.entries(codes)) {
    await db.doc('access_codes/' + id).set(data);
    console.log('✓ seeded', id.padEnd(12), '→', data.email, '(' + data.plan + ', ' + data.trialDays + 'd trial)');
    written++;
  }
  console.log('\nWrote ' + written + ' access codes.');
  console.log('Test by signing in with one of the codes on /pro/login.html.');
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  console.error(e.stack);
  process.exit(1);
});
