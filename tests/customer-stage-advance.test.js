/**
 * customer-stage-advance.test.js — the customer page's "Move to Next Stage".
 *
 * The kanban's moveCard does five things on every stage change: gates on
 * required fields, writes `stage`, stamps `stageRole`, logs an activity note,
 * and fires the email drip. progressStage on customer.html did exactly one of
 * them — it wrote `stage` — and the words stageRole, missingRequiredFields and
 * EmailDrip did not appear in customer-bootstrap.module.js at all.
 *
 * The consequences were invisible rather than loud:
 *   - stageRole went stale or absent while `stage` moved on. analytics-kpi,
 *     money-dashboard, the leaderboard and the forecast all bucket on
 *     stageRole, so the numbers quietly disagreed with the board.
 *   - the customer's own activity feed showed no record of a stage change
 *     made from that very page.
 *   - a lead moved to contract_signed here got none of the follow-up the same
 *     move triggers on the board — nbd-comms.js is loaded on the page, so the
 *     drip was simply never called.
 *
 * WHY THE GATE IS A WARNING HERE AND A BLOCK ON THE BOARD — and why that is
 * deliberate, not a half-fix: every gated field has an input in the dashboard
 * lead modal, so blocking there is satisfiable. The customer page's edit modal
 * carries only jobValue of them; insCarrier, claimNumber, estimateAmount,
 * deductibleOrOwedByHO, financeCompany, loanAmount and scheduledDate have no
 * input on that page at all. Blocking would strand the rep with no way to
 * proceed, which is worse than the silent advance it replaced. Turning it into
 * a real gate means giving that modal the fields first — see the assertion at
 * the bottom, which fails once it has them, so this decision gets revisited
 * instead of quietly outliving its reason.
 *
 * Run: node tests/customer-stage-advance.test.js   (no deps, no DOM)
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const boot = read('docs/pro/js/customer-bootstrap.module.js');
const customerHtml = read('docs/pro/customer.html');

// progressStage's body — assert inside it, so an unrelated match elsewhere in
// a 2000-line file cannot make these pass.
const start = boot.indexOf('window.progressStage = async function');
const fn = start >= 0 ? boot.slice(start, start + 9000) : '';

console.log('\ncustomer-stage-advance — parity with the kanban move\n');

ok('progressStage exists', start >= 0);

ok('the canonical stage config is imported (not a private hardcoded copy)',
  /import\s*\{[^}]*\bstageRole\b[^}]*\}\s*from\s*["']\.\/crm-stages\.js["']/.test(boot),
  'a fourth hardcoded ladder is how these paths drifted apart in the first place');

ok('crm-stages.js exists at the imported path',
  fs.existsSync(path.join(ROOT, 'docs/pro/js/crm-stages.js')),
  'a module script whose import 404s takes the WHOLE page down');

ok('customer.html loads the bootstrap as a module (so the import is legal)',
  /<script\s+type="module"\s+src="js\/customer-bootstrap\.module\.js/.test(customerHtml));

// ── the write ───────────────────────────────────────────────────────────
ok('the stage write stamps stageRole', /stageRole:\s*_stageRole\(nextStage\)/.test(fn),
  'without it stageRole drifts from stage, and every KPI buckets on stageRole');

ok('it still writes stage, stageStartedAt and stageHistory (unchanged)',
  /stage:\s*nextStage/.test(fn) && /stageStartedAt/.test(fn) && /stageHistory/.test(fn));

// ── the bookkeeping the kanban does ─────────────────────────────────────
ok('an activity note is written', /type:\s*'stage_change'/.test(fn));
ok('the note goes to the notes collection', /collection\(window\.db,\s*'notes'\)/.test(fn));
ok('the drip is fired', /EmailDrip\.onStageChange\(/.test(fn));
ok('the drip receives the OLD and NEW stage', /onStageChange\(window\._customerId,\s*oldStage,\s*nextStage\)/.test(fn));
ok('nbd-comms.js (EmailDrip) is actually loaded on the page',
  /nbd-comms\.js/.test(customerHtml),
  'the drip call would be a silent no-op without it');

// ── each addition degrades safely ───────────────────────────────────────
// The stage write is the thing that must not fail. Every addition around it
// is wrapped, so a broken note or drip cannot roll back a completed move.
const noteBlock = fn.slice(fn.indexOf("type: 'stage_change'") - 700, fn.indexOf("type: 'stage_change'") + 400);
ok('the activity note is wrapped in try/catch', /try\s*\{/.test(noteBlock) && /catch\s*\(/.test(noteBlock));
const dripBlock = fn.slice(fn.indexOf('EmailDrip.onStageChange') - 500, fn.indexOf('EmailDrip.onStageChange') + 300);
ok('the drip call is wrapped in try/catch', /try\s*\{/.test(dripBlock) && /catch\s*\(/.test(dripBlock));
ok('the drip is feature-detected before calling',
  /typeof window\.EmailDrip\.onStageChange === 'function'/.test(fn));

// ── the required-field warning ──────────────────────────────────────────
ok('missing required fields are surfaced to the rep', /_missingRequiredFields\(/.test(fn));
ok('…and they are NAMED, not just counted', /missing\.join\(', '\)/.test(fn));
ok('the check evaluates the DESTINATION stage, not the current one',
  /_missingRequiredFields\([\s\S]{0,120}?stage:\s*nextStage/.test(fn),
  'checking the current stage would warn about the wrong requirements');
ok('the warning does not abort the move',
  !/_missingRequiredFields[\s\S]{0,400}\breturn\b/.test(fn),
  'this page cannot satisfy most gated fields — blocking would strand the rep');

// ── the tripwire on that decision ───────────────────────────────────────
// If the customer edit modal ever gains the gated inputs, the warning should
// become a real block. Fail then, so the trade-off is re-decided rather than
// quietly outliving its reason.
const GATED_INPUT_IDS = ['editInsCarrier', 'editClaimNumber', 'editEstimateAmount', 'editScheduledDate'];
const present = GATED_INPUT_IDS.filter((id) => customerHtml.includes('id="' + id + '"'));
ok('the customer edit modal still lacks the gated inputs (why this is a warning)',
  present.length === 0,
  'the edit modal now has ' + present.join(', ') + ' — promote the warning in progressStage to a real block');

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);
