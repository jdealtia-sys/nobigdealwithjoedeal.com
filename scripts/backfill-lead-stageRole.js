/**
 * scripts/backfill-lead-stageRole.js
 *
 * ONE-TIME BACKFILL — stamps the denormalized `stageRole` on every /leads doc
 * that is missing it, so the freeform-pipeline classification (won/lost/active/
 * job/new) is correct for leads created BEFORE the Phase-0/3 role work.
 *
 * Background
 * ──────────
 * The freeform-pipeline design (functions/stage-roles.js) says a lead's
 * PERSISTED `stageRole` WINS — the client stamps it on every stage change
 * (crm-pipeline moveCard) so a lead sitting on a tenant's CUSTOM stage still
 * classifies correctly on the server, which has no idea what that stage means.
 * The built-in key map (roleFromKey) is only the FALLBACK.
 *
 * That fallback is CORRECT for built-in / legacy stages but WRONG for custom
 * stages: a lead on `custom_walkthru` with no persisted stageRole resolves to
 * ACTIVE via the key map even if the tenant declared that stage WON — so its
 * revenue / KPI / portal classification is silently off. Leads created before
 * the role work predate the denormalization and have no `stageRole` at all.
 *
 * This backfill closes that gap: for every lead missing a valid `stageRole`,
 * it computes the role from the tenant's OWN pipeline config
 * (companyProfile.pipelines.stages[key].role) when the stage is custom/
 * overridden, and from the shared key map (functions/stage-roles.js) otherwise
 * — the exact same precedence the runtime uses — then persists it.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing.
 *   • --apply requires --yes as well.
 *   • Idempotent — skips docs that already carry a VALID stageRole. The
 *     persisted value is authoritative (a rep may have moved the lead onto a
 *     custom stage whose role differs from the key-map guess), so this only
 *     ever FILLS a gap; it never overwrites an existing role. Safe to re-run.
 *   • A lead with no stage at all resolves to 'new' (roleFromKey's own default).
 *
 * SETUP (per the admin-script-runner pattern — prod nobigdeal-pro via ADC,
 * with NODE_PATH pointed at a firebase-admin v12 install; v14 breaks
 * Timestamp handling):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NODE_PATH=/path/to/fa12/node_modules    # firebase-admin@12
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *
 * RUN
 *   node scripts/backfill-lead-stageRole.js               # dry-run
 *   node scripts/backfill-lead-stageRole.js --apply --yes # actually write
 *
 * Run this AFTER Phase 3 (persisted stageRole) is live. There's no hard
 * ordering requirement — the runtime already falls back to the key map for
 * built-in stages — but until it runs, custom-stage leads created before the
 * cutover classify by the key map (i.e. usually ACTIVE) instead of the
 * tenant-declared role.
 */

const admin = require('firebase-admin');
const { roleFromKey, ROLE } = require('../functions/stage-roles');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const PAGE = 500;   // read page size
const BATCH = 400;  // Firestore batch write cap is 500; stay under it

const VALID_ROLES = new Set(Object.keys(ROLE).map((k) => ROLE[k]));

function init() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT,
    });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

// Per-tenant pipeline config, lazily loaded + cached. companyProfile is keyed
// by companyId (solo operators: their uid). Returns the raw config or null.
function makeTenantCfgLoader(db) {
  const cache = new Map(); // companyId → cfg | null
  return async function tenantCfg(companyId) {
    if (!companyId) return null;
    if (cache.has(companyId)) return cache.get(companyId);
    let cfg = null;
    try {
      const snap = await db.collection('companyProfile').doc(companyId).get();
      if (snap.exists) {
        const p = (snap.data() || {}).pipelines;
        if (p && typeof p === 'object') cfg = p;
      }
    } catch (e) {
      console.warn('! companyProfile read failed for ' + companyId + ' — ' + e.message);
    }
    cache.set(companyId, cfg);
    return cfg;
  };
}

// The role the runtime WOULD resolve for this lead's stage: the tenant's own
// stage-override role wins (covers custom + recoloured stages), else the shared
// key map. Mirrors resolvePipelineConfig.roleOf + functions/stage-roles.roleFor.
function resolveRole(stageKey, cfg) {
  if (cfg && cfg.stages && stageKey) {
    const ov = cfg.stages[stageKey];
    if (ov && typeof ov.role === 'string' && VALID_ROLES.has(ov.role)) return ov.role;
  }
  return roleFromKey(stageKey);
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  init();
  const db = admin.firestore();
  const tenantCfg = makeTenantCfgLoader(db);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill leads.stageRole');
  console.log('  project : ' + PROJECT);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  let scanned = 0;
  let alreadyOk = 0;
  let toFix = 0;
  let written = 0;
  let failures = 0;
  const byRole = {}; // role → count of fills (visibility)

  let batch = db.batch();
  let batchCount = 0;
  async function flush() {
    if (batchCount === 0) return;
    if (APPLY) {
      try {
        await batch.commit();
        written += batchCount;
      } catch (e) {
        failures += batchCount;
        console.warn('! batch commit failed — ' + e.message);
      }
    }
    batch = db.batch();
    batchCount = 0;
  }

  let last = null;
  while (true) {
    let q = db.collection('leads').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};

      // Idempotent: a valid persisted role is authoritative — never overwrite.
      if (typeof data.stageRole === 'string' && VALID_ROLES.has(data.stageRole)) {
        alreadyOk++;
        continue;
      }

      const cfg = await tenantCfg(data.companyId);
      const role = resolveRole(data.stage, cfg);

      toFix++;
      byRole[role] = (byRole[role] || 0) + 1;
      if (!APPLY) {
        if (toFix <= 20) {
          const had = data.stageRole ? `'${data.stageRole}'` : '(missing)';
          console.log('  would set ' + doc.id + '.stageRole ' + had + ' → \'' + role + '\''
            + '  (stage: ' + JSON.stringify(data.stage || '') + ', tenant: ' + (data.companyId || '—') + ')');
        }
        continue;
      }

      batch.set(doc.ref, { stageRole: role }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  await flush();

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned            : ' + scanned);
  console.log('  already correct    : ' + alreadyOk);
  console.log('  needed backfill    : ' + toFix);
  console.log('  fills by role      : ' + JSON.stringify(byRole));
  if (APPLY) {
    console.log('  written            : ' + written);
    console.log('  failures           : ' + failures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write)');
  }
  console.log('───────────────────────────────────────────────────────────');

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
