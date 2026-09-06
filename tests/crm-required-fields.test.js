/**
 * crm-required-fields.test.js — the stage advance gate's field table.
 *
 * REQUIRED_FIELDS_BY_TYPE had no test at all. It is the data behind the
 * "⚠ Needs X" card badge and the gate that stops a stage move
 * (crm-pipeline.js:1846 calls missingRequiredFields({...lead, stage: newStage})),
 * so a missing entry is silent: the move just succeeds with the field blank.
 *
 * THE BUG THIS LOCKS: crew_scheduled is a `track: 'shared'` stage reachable
 * from the Jobs view by a lead of any type, but the lookup is keyed by the
 * lead's jobType — and only `warranty` listed scheduledDate. So an
 * insurance / cash / finance / service job moved to Crew Scheduled was gated
 * by nothing, and since smart-calendar.js builds the day's job list from
 * `leads.filter(l => l.scheduledDate === todayStr)`, that job never appeared
 * on the schedule. The crew was "scheduled" and the schedule did not know.
 *
 * The second half of the file is the part that keeps the gate honest: every
 * required field must be REACHABLE — it needs a human label and an input the
 * quick-fix panel can focus. A gate demanding a field with no input is worse
 * than no gate, because the rep cannot satisfy it and cannot advance the lead.
 *
 * Run: node tests/crm-required-fields.test.js   (no deps, no DOM)
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');

// crm-stages.js is an ES module and there is no loader wired here — same
// strip-and-vm approach as crm-stages-roles.test.js.
let src = fs.readFileSync(path.join(ROOT, 'docs/pro/js/crm-stages.js'), 'utf8');
src = src.replace(/export\s+function\s+/g, 'function ').replace(/export\s+const\s+/g, 'const ');
src += '\nthis.__out = { S, STAGE_META, REQUIRED_FIELDS_BY_TYPE, requiredFieldsFor, missingRequiredFields, JOB_TYPES };';
const sandbox = { console, window: {} };
vm.runInNewContext(src, sandbox, { filename: 'crm-stages.js' });
const { S, STAGE_META, REQUIRED_FIELDS_BY_TYPE, requiredFieldsFor, missingRequiredFields, JOB_TYPES } = sandbox.__out;

console.log('\ncrm-required-fields — the stage advance gate\n');

ok('module surface present',
  !!(S && REQUIRED_FIELDS_BY_TYPE && typeof requiredFieldsFor === 'function' && typeof missingRequiredFields === 'function'));

// ── the crew_scheduled hole ─────────────────────────────────────────────
console.log('\n  crew_scheduled gates scheduledDate on every track');
const TRACKS = Object.keys(REQUIRED_FIELDS_BY_TYPE);
ok('all five job types are present', TRACKS.length === 5, JSON.stringify(TRACKS));

for (const track of TRACKS) {
  ok(`${track}: crew_scheduled requires scheduledDate`,
    (requiredFieldsFor(track, S.CREW_SCHEDULED) || []).includes('scheduledDate'),
    JSON.stringify(requiredFieldsFor(track, S.CREW_SCHEDULED)));
}

ok('a dated job passes the gate',
  (missingRequiredFields({ jobType: 'insurance', stage: S.CREW_SCHEDULED, scheduledDate: '2026-09-10', insCarrier: 'X', claimNumber: '1' }) || [])
    .indexOf('scheduledDate') === -1);

ok('an undated job is BLOCKED (the defect)',
  (missingRequiredFields({ jobType: 'cash', stage: S.CREW_SCHEDULED, jobValue: 1000 }) || [])
    .includes('scheduledDate'));

ok('an empty-string date is treated as missing, not satisfied',
  (missingRequiredFields({ jobType: 'cash', stage: S.CREW_SCHEDULED, jobValue: 1000, scheduledDate: '' }) || [])
    .includes('scheduledDate'));

// ── the existing entries must not have been disturbed ───────────────────
console.log('\n  pre-existing gates are unchanged');
const EXPECTED = {
  insurance: { claim_filed: ['insCarrier', 'claimNumber'], estimate_submitted: ['estimateAmount', 'deductibleOrOwedByHO'] },
  cash: { contract_signed: ['jobValue'] },
  finance: { loan_approved: ['loanAmount', 'financeCompany'] },
  warranty: { warranty_scheduled: ['scheduledDate'] },
  service: { service_quoted: ['jobValue'] },
};
for (const [track, stages] of Object.entries(EXPECTED)) {
  for (const [stage, fields] of Object.entries(stages)) {
    const got = requiredFieldsFor(track, stage) || [];
    ok(`${track}/${stage} still requires ${fields.join(', ')}`,
      fields.every((f) => got.includes(f)), JSON.stringify(got));
  }
}

// ── every gated field must be reachable ─────────────────────────────────
// A gate the rep cannot satisfy blocks the lead forever. Both maps live in
// crm-pipeline.js: FIELD_LABELS names the field on the card badge, and
// _GATE_FIELD_META points the quick-fix panel at a real input id.
console.log('\n  every gated field is reachable by the rep');
const pipeSrc = fs.readFileSync(path.join(ROOT, 'docs/pro/js/crm-pipeline.js'), 'utf8');
const dashHtml = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.html'), 'utf8');

const allFields = [...new Set(
  Object.values(REQUIRED_FIELDS_BY_TYPE).flatMap((byStage) => Object.values(byStage).flat())
)];
ok('collected the gated field list', allFields.length > 0, JSON.stringify(allFields));

// _GATE_FIELD_META entries look like:  fieldName: { label: '..', inputId: 'lX' },
const gateMeta = {};
const metaBlock = pipeSrc.slice(pipeSrc.indexOf('_GATE_FIELD_META'));
const re = /(\w+):\s*\{\s*label:\s*'([^']*)',\s*inputId:\s*'([^']*)'\s*\}/g;
let m;
while ((m = re.exec(metaBlock))) { gateMeta[m[1]] = { label: m[2], inputId: m[3] }; }

for (const f of allFields) {
  const meta = gateMeta[f];
  ok(`${f}: has a quick-fix entry`, !!meta, 'missing from _GATE_FIELD_META in crm-pipeline.js');
  if (!meta) continue;
  ok(`  ${f}: its input #${meta.inputId} exists in dashboard.html`,
    dashHtml.includes(`id="${meta.inputId}"`),
    'the gate would demand a field with no input — unsatisfiable');
  ok(`  ${f}: has a card-badge label`,
    new RegExp(f + '\\s*:\\s*[\'"]').test(pipeSrc.slice(pipeSrc.indexOf('const FIELD_LABELS'), pipeSrc.indexOf('const FIELD_LABELS') + 1200)),
    'missing from FIELD_LABELS — the badge would print the raw key');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);
