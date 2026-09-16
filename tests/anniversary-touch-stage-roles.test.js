/**
 * tests/anniversary-touch-stage-roles.test.js
 *
 * functions/anniversary-touch.js's findAnniversaryLeads() restricted the
 * eligible-lead query (and its redundant in-memory re-check) to a hardcoded
 * literal-stage set, COMPLETE_STAGES = {'complete','Complete',
 * 'install_complete','deductible_collected','final_payment'}. 'closed' — the
 * actual, current, canonical stage a job gets when it closes via the normal
 * path today (functions/stage-roles.js's WON set, docs/pro/js/crm-stages.js's
 * _ROLE_WON, dashboard-bootstrap.module.js's close_job target, seed-demo.js's
 * seeded completed jobs) — was never in that set, nor were 'final_photos',
 * 'collections', or 'warranty_claim' (added by #1576 and #1580, both landing
 * after this file was last touched). Because the Firestore
 * `.where('stage','in', COMPLETE_STAGE_LIST)` clause excludes those stages
 * at the QUERY level, a job that closed the normal way is invisible to this
 * cron, not merely mis-scored in memory — the anniversary/referral-touch
 * feature silently never fires for the overwhelmingly common case.
 *
 * dormant-leads.js hit the identical class of bug on 2026-09-15 and was
 * patched to classify terminal leads with functions/stage-roles.js's
 * roleFor()/ROLE.WON instead of a hand-maintained stage-string set (see its
 * _isTerminalLead). This suite proves anniversary-touch.js needs — and,
 * after the fix, has — the same treatment.
 *
 * findAnniversaryLeads() can't be exercised through the onSchedule wrapper
 * without a live/emulated Firestore + scheduler trigger (same constraint
 * tests/deal-acceptance-atomicity.test.js documents for submitDealAcceptance),
 * so this suite drives it directly via exports._test against a minimal fake
 * Firestore query builder that faithfully enforces `where('field','in',list)`
 * / `where('field','==',value)` semantics — a stage missing from the query's
 * `in` list must not come back, exactly like real Firestore.
 *
 * Run: node tests/anniversary-touch-stage-roles.test.js   (needs functions/ deps)
 */
'use strict';

const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const FUNCTIONS = path.join(__dirname, '..', 'functions');
const AT = require(path.join(FUNCTIONS, 'anniversary-touch.js'));

if (!AT._test || typeof AT._test.findAnniversaryLeads !== 'function') {
  console.log('✗ anniversary-touch.js does not export _test.findAnniversaryLeads — cannot run this suite');
  process.exit(1);
}
const { findAnniversaryLeads } = AT._test;

// ── Minimal fake Firestore query builder ──────────────────────────
// Mirrors real Firestore semantics closely enough to catch this exact bug
// class: a `where(field, 'in', list)` filter drops any doc whose field
// value isn't literally in `list` — it does NOT know about role mappings,
// aliases, or anything else the app layer understands.
function applyOp(fieldVal, op, value) {
  if (op === '==') return fieldVal === value;
  if (op === 'in') return Array.isArray(value) && value.indexOf(fieldVal) !== -1;
  throw new Error('fake Firestore: unsupported op ' + op);
}
function makeQuery(docs) {
  return {
    _docs: docs,
    where(field, op, value) {
      return makeQuery(this._docs.filter((d) => applyOp(d.data[field], op, value)));
    },
    limit(n) {
      return makeQuery(this._docs.slice(0, n));
    },
    async get() {
      return { docs: this._docs.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  };
}
function makeFakeDb(leadsById) {
  return {
    collection(name) {
      if (name !== 'leads') throw new Error('fake Firestore: unexpected collection ' + name);
      return makeQuery(Object.keys(leadsById).map((id) => ({ id, data: leadsById[id] })));
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ANNIVERSARY_MS = Date.now() - 370 * DAY_MS; // inside the 360-380 day window

function leadAt(stage, extra) {
  return Object.assign({
    userId: 'u1',
    stage,
    completedAt: ANNIVERSARY_MS, // timestampMillis() accepts a raw number
  }, extra || null);
}

section('Current WON stages must all surface an anniversary lead');
const CURRENT_WON_STAGES = ['closed', 'install_complete', 'final_photos', 'final_payment', 'deductible_collected', 'collections', 'warranty_claim'];

(async () => {
  for (const stage of CURRENT_WON_STAGES) {
    const db = makeFakeDb({ [`lead_${stage}`]: leadAt(stage) });
    const out = await findAnniversaryLeads(db, 'u1');
    ok(`stage '${stage}' is found (job closed via this stage today)`, out.length === 1 && out[0].id === `lead_${stage}`,
      `got ${out.length} leads: ${JSON.stringify(out.map((l) => l.id))}`);
  }

  section('Legacy raw stage spellings still work (no regression)');
  for (const stage of ['complete', 'Complete']) {
    const db = makeFakeDb({ [`lead_${stage}`]: leadAt(stage) });
    const out = await findAnniversaryLeads(db, 'u1');
    ok(`legacy stage '${stage}' is still found`, out.length === 1 && out[0].id === `lead_${stage}`);
  }

  section('Non-WON stages are correctly excluded');
  for (const stage of ['new', 'contract_signed', 'install_in_progress']) {
    const db = makeFakeDb({ [`lead_${stage}`]: leadAt(stage) });
    const out = await findAnniversaryLeads(db, 'u1');
    ok(`active stage '${stage}' is excluded`, out.length === 0, `got ${out.length} leads`);
  }

  section("'lost' stage is excluded (anniversary is WON-only, not decided-only)");
  {
    const db = makeFakeDb({ lead_lost: leadAt('lost') });
    const out = await findAnniversaryLeads(db, 'u1');
    ok("'lost' stage is excluded", out.length === 0, `got ${out.length} leads`);
  }

  section('Window filtering is unaffected by the fix');
  {
    const tooRecent = Date.now() - 30 * DAY_MS;
    const tooOld = Date.now() - 400 * DAY_MS;
    const db = makeFakeDb({
      lead_recent: leadAt('closed', { completedAt: tooRecent }),
      lead_old: leadAt('closed', { completedAt: tooOld }),
      lead_in_window: leadAt('closed'),
    });
    const out = await findAnniversaryLeads(db, 'u1');
    ok('only the in-window closed lead is returned', out.length === 1 && out[0].id === 'lead_in_window',
      `got ${out.length} leads: ${JSON.stringify(out.map((l) => l.id))}`);
  }

  section('Multiple current-WON-stage leads for the same rep all surface together');
  {
    const db = makeFakeDb({
      lead_closed: leadAt('closed'),
      lead_collections: leadAt('collections'),
      lead_warranty: leadAt('warranty_claim'),
    });
    const out = await findAnniversaryLeads(db, 'u1');
    ok('all three surface', out.length === 3,
      `got ${out.length} leads: ${JSON.stringify(out.map((l) => l.id))}`);
  }

  console.log('\n' + (failed === 0 ? '✓' : '✗') + ' anniversary-touch-stage-roles: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
