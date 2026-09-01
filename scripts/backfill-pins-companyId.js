/**
 * scripts/backfill-pins-companyId.js
 *
 * ONE-TIME BACKFILL — stamps `companyId` on every /pins doc created before the
 * team-territory scoping (2026-07-08), so a teammate's EXISTING door-knock /
 * customer pins fill into the shared team map instead of only new drops.
 *
 * Background
 * ──────────
 * _savePin now stamps companyId (claim, or uid for solo) and the /pins rule
 * makes same-company members read each other's pins (sameCompanyAsResource).
 * Legacy pins have no companyId, so they fall back to owner-only — invisible to
 * the rest of the tenant. This backfills companyId onto them.
 *
 * Deriving a pin's companyId:
 *   1. If the pin links a lead (pin.leadId) and that lead has a companyId → use it
 *      (authoritative — the pin belongs to that lead's tenant).
 *   2. Else map the pin's userId → companyId via the leads book (every lead
 *      carries BOTH userId and companyId, enforced by the create rule), taking
 *      the most common companyId seen for that user. Users whose leads span >1
 *      company are ambiguous and skipped (see buildLeadMaps), not guessed.
 *   3. Else read the owner's companyId custom claim via admin auth — catches a
 *      genuine COMPANY rep who door-knocked but never created a lead. Without
 *      this they'd fall to their uid (step 4) and their leadless pins would fail
 *      the /pins sameCompanyAsResource() read rule, staying owner-only.
 *   4. Else fall back to the pin's own userId (solo-operator convention —
 *      matches _savePin's `claims.companyId || uid`).
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — skips pins that already carry a companyId. Safe to re-run.
 *   • A pin with no userId (shouldn't happen) is left untouched.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC).
 * firebase-admin arrives through scripts/_admin.js. Do NOT set NODE_PATH:
 * _admin tries a bare require.resolve FIRST, so a NODE_PATH install satisfies
 * it and overrides the functions/ resolution _admin exists to centralise.
 * Runs on v12 and v14 alike — this script handles no Timestamp at all. (The
 * v12 pin here was inherited boilerplate; see
 * documentation/audit/ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01.md.)
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro
 *
 * RUN
 *   node scripts/backfill-pins-companyId.js               # dry-run
 *   node scripts/backfill-pins-companyId.js --apply --yes # actually write
 */

const { initAdmin, getFirestore, getAuth } = require('./_admin');
const { assertNotCompleted, recordCompletion } = require('./_migration-guard');


const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
// --force overrides the run-once guard (see scripts/_migration-guard.js).
const FORCE = args.includes('--force');
const MIGRATION = 'backfill-pins-companyId';
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const PAGE = 500;
const BATCH = 400;

function init() {
  // initAdmin is idempotent (ADC credential by default), so the old
  // "already exists" message-matching catch is no longer needed.
  initAdmin({ projectId: PROJECT });
}

// Build userId → companyId (most common) and leadId → companyId maps from the
// leads book, so a pin can resolve its tenant even without auth claims.
async function buildLeadMaps(db) {
  const byUser = new Map();   // uid → Map(companyId → count)
  const byLead = new Map();   // leadId → companyId
  let last = null;
  while (true) {
    let q = db.collection('leads').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const data = d.data() || {};
      if (data.companyId) byLead.set(d.id, data.companyId);
      if (data.userId && data.companyId) {
        if (!byUser.has(data.userId)) byUser.set(data.userId, new Map());
        const m = byUser.get(data.userId);
        m.set(data.companyId, (m.get(data.companyId) || 0) + 1);
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  // Collapse each user's companyId histogram to the most common — BUT flag any
  // user whose leads span more than one companyId (e.g. a rep who worked solo
  // [companyId == uid] then joined a company). For those the "most common" is
  // NOT a safe tenant for a leadless door-knock pin, so mark them ambiguous and
  // leave their leadless pins for manual review rather than guess wrong.
  const userToCompany = new Map();
  const ambiguousUsers = new Set();
  for (const [uid, hist] of byUser) {
    if (hist.size > 1) ambiguousUsers.add(uid);
    let best = null, bestN = -1;
    for (const [cid, n] of hist) { if (n > bestN) { best = cid; bestN = n; } }
    if (best) userToCompany.set(uid, best);
  }
  return { userToCompany, byLead, ambiguousUsers };
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }
  init();
  const db = getFirestore();
  // One-shot: refuse a second --apply unless --force.
  await assertNotCompleted(MIGRATION, { apply: APPLY, force: FORCE });

  // Resolve a user's authoritative tenant from their companyId custom claim
  // (admin auth), cached. Mirrors _savePin's `claims.companyId || uid`: a company
  // rep carries a companyId claim even with ZERO leads, so their leadless pins
  // resolve to the real tenant instead of their uid. Returns null when there's no
  // company claim (genuine solo operator) or the user is gone — caller falls back
  // to uid in that case. Only hit for pins the lead book can't resolve, so this is
  // a handful of getUser() calls, not one per pin.
  const auth = getAuth();
  const claimCache = new Map();
  async function claimCompanyFor(uid) {
    if (!uid) return null;
    if (claimCache.has(uid)) return claimCache.get(uid);
    let cid = null;
    try {
      const u = await auth.getUser(uid);
      if (u.customClaims && u.customClaims.companyId) cid = u.customClaims.companyId;
    } catch (_) { /* user deleted / not found → treat as solo, fall back to uid */ }
    claimCache.set(uid, cid);
    return cid;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill pins.companyId');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  const { userToCompany, byLead, ambiguousUsers } = await buildLeadMaps(db);
  console.log('  lead-derived maps: ' + userToCompany.size + ' users, ' + byLead.size + ' leads, '
    + ambiguousUsers.size + ' multi-company (ambiguous) users\n');

  let scanned = 0, alreadyOk = 0, noUser = 0, toFix = 0, written = 0, failures = 0, ambiguous = 0;
  const source = { lead: 0, user: 0, claim: 0, ownUid: 0 };

  let batch = db.batch();
  let batchCount = 0;
  async function flush() {
    if (batchCount === 0) return;
    if (APPLY) {
      try { await batch.commit(); written += batchCount; }
      catch (e) { failures += batchCount; console.warn('! batch commit failed — ' + e.message); }
    }
    batch = db.batch();
    batchCount = 0;
  }

  let last = null;
  while (true) {
    let q = db.collection('pins').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      if (data.companyId) { alreadyOk++; continue; }          // idempotent
      if (!data.userId) { noUser++; continue; }               // can't derive a tenant

      let companyId, via;
      if (data.leadId && byLead.has(data.leadId)) {
        companyId = byLead.get(data.leadId); via = 'lead'; // authoritative: the linked lead's tenant
      } else if (ambiguousUsers.has(data.userId)) {
        // The owner's leads span >1 companyId and this pin has no lead to anchor
        // it — guessing a tenant risks leaking the pin into the wrong team's map.
        // Skip; the operator can assign these manually. (leadId-linked pins for
        // the same user still resolve correctly above.)
        ambiguous++;
        if (!APPLY && ambiguous <= 20) console.log('  SKIP ' + doc.id + ' — ambiguous user ' + data.userId + ' (leads span multiple companyIds, no leadId)');
        continue;
      } else if (userToCompany.has(data.userId)) {
        companyId = userToCompany.get(data.userId); via = 'user';
      } else {
        // No lead and no leads-book entry → a rep who door-knocked but never
        // created a lead. Their companyId claim is the authoritative tenant (a
        // company rep carries one even with zero leads); only a genuine solo
        // operator has no claim, and for them uid IS the tenant key.
        const claimCid = await claimCompanyFor(data.userId);
        if (claimCid) {
          companyId = claimCid; via = 'claim'; // company rep, no leads → real tenant
        } else {
          companyId = data.userId; via = 'ownUid'; // solo-operator convention
        }
      }
      source[via]++;

      toFix++;
      if (!APPLY) {
        if (toFix <= 20) console.log('  would set ' + doc.id + '.companyId → \'' + companyId + '\'  (via ' + via + ', userId ' + data.userId + ')');
        continue;
      }
      batch.set(doc.ref, { companyId: companyId }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  await flush();

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned         : ' + scanned);
  console.log('  already correct : ' + alreadyOk);
  console.log('  no userId       : ' + noUser);
  console.log('  ambiguous (skip): ' + ambiguous + '  (multi-company user, no leadId — assign manually)');
  console.log('  needed backfill : ' + toFix + '  ' + JSON.stringify(source));
  if (APPLY) { console.log('  written         : ' + written); console.log('  failures        : ' + failures); }
  else { console.log('  (dry-run — re-run with --apply --yes to write)'); }
  console.log('───────────────────────────────────────────────────────────');

  if (APPLY && failures === 0) await recordCompletion(MIGRATION, { scanned, toFix, written, ambiguous });

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
