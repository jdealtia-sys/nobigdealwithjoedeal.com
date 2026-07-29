/**
 * tests/render-pdf-neutral-fallback.test.js — an unresolved tenant brand must
 * render NEUTRAL, never the platform owner's identity.
 *
 * THE BUG. functions/render-pdf.js resolveDocCompany() returned
 * NBD_DOC_COMPANY — the owner's logo, legal name, tagline, phone, email,
 * contact name "Joe" and "NBD" seal — for EVERY unresolved case:
 *   1. no companyId
 *   2. companyProfile doc missing
 *   3. profile present but no brand.legalName
 *   4. the Firestore read threw
 * So a tenant hitting any of those got Joe's identity stamped on server-rendered
 * contracts, warranties and invoices — paper a homeowner signs, naming the wrong
 * contracting party.
 *
 * Case 2 is not hypothetical: provisioning is BEST-EFFORT. docs/pro/js/pages/
 * register.js catches createCompany failure at three sites and only warns
 * "createCompany failed (account still usable)" — observed firing live during a
 * real emulator signup. That contractor has a working account, no
 * companyProfile doc, and was getting the owner's name on his paperwork.
 *
 * Blank beats wrong: the printed forms carry ruled lines for writing the
 * details in. The tenant branch already blanked logo/seal/contactName for
 * exactly this reason; the fallback just didn't.
 *
 * Static assertions on purpose — render-pdf.js imports firebase-functions, and
 * per the repo rule a worktree has no functions/node_modules, so a require()
 * test cannot load it. Same approach gauntlet-brand-guard.test.js uses for the
 * same class of defect.
 *
 * Zero deps.  Run: node tests/render-pdf-neutral-fallback.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions/render-pdf.js'), 'utf8');
const decomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const CODE = decomment(SRC);

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('RENDER-PDF — unresolved tenant brand renders neutral, not the owner');

// ── 1. A neutral block exists and is genuinely blank ──────────────────
{
  ok('NEUTRAL_DOC_COMPANY exists', /const NEUTRAL_DOC_COMPANY = \{/.test(CODE));

  const block = CODE.slice(CODE.indexOf('const NEUTRAL_DOC_COMPANY = {'),
                           CODE.indexOf('function hbsEsc'));
  ok('it is marked isNbd:false (so every {{#if company.isNbd}} takes the neutral arm)',
    /isNbd:\s*false/.test(block));

  // Every identity field must be empty — one stray literal here would put the
  // owner's details on a stranger's contract just as surely as before.
  for (const field of ['logoUrl', 'nameHtml', 'footerName', 'brandTag',
                       'brandContact', 'footerContact', 'email', 'phone',
                       'contactName', 'seal']) {
    ok(`neutral.${field} is blank`,
      new RegExp(field + ":\\s*''").test(block),
      'an unresolved tenant must borrow no part of the owner\'s identity');
  }
  ok('neutral carries no NBD literal at all',
    !/No Big Deal|Joe|859|nobigdealwithjoedeal|'NBD'/.test(block));
}

// ── 2. NBD chrome is reserved for the platform tenant ─────────────────
{
  ok('the platform owner uid is defined and env-overridable',
    /const NBD_OWNER_UID = process\.env\.NBD_OWNER_UID/.test(CODE));
  ok('resolveDocCompany decides platform vs tenant up front',
    /const isPlatform = String\(companyId \|\| ''\) === NBD_OWNER_UID;/.test(CODE));
  ok('the fallback is selected by that gate',
    /const UNRESOLVED = isPlatform \? NBD_DOC_COMPANY : NEUTRAL_DOC_COMPANY;/.test(CODE));
}

// ── 3. No unresolved path can still return the owner's block ──────────
{
  const fn = CODE.slice(CODE.indexOf('async function resolveDocCompany('),
                        CODE.indexOf('exports.renderPdf'));

  // The ONLY permitted mention of NBD_DOC_COMPANY inside the resolver are the
  // UNRESOLVED ternary and the legalName comparison that detects "this tenant
  // IS NBD by name". A bare `return NBD_DOC_COMPANY` is the bug.
  ok('no bare `return NBD_DOC_COMPANY` remains in the resolver',
    !/return NBD_DOC_COMPANY\s*;/.test(fn),
    'that was the fallback for all four unresolved cases');

  const returns = (fn.match(/return UNRESOLVED\s*;/g) || []).length;
  ok('the unresolved paths return the gated value', returns >= 2,
    `saw ${returns} — expected the early !companyId return and the tail return`);

  // The tenant branch must stay intact — this fix must not weaken it.
  ok('the resolved-tenant branch still blanks logo/seal/contactName',
    /logoUrl: b\.logoUrl \|\| ''/.test(fn)
    && /seal: b\.seal \|\| ''/.test(fn)
    && /contactName: ''/.test(fn));
  ok('a tenant whose brand IS resolvable still renders isNbd:false',
    /isNbd: false,/.test(fn));
}

// ── 4. The precondition that makes case 2 live ────────────────────────
// If provisioning ever becomes fail-hard AT REGISTER, this fallback stops
// being reachable that way — worth knowing, so assert the current behaviour
// rather than silently depending on it. Since the 2026-07-28 first-run audit
// the single-shot console.warn swallow was replaced by ensureProvisioned
// (docs/pro/js/provisioning-retry.js): bounded retries, then `return false`
// — still never throws, so registration still proceeds and a retried-out
// tenant still reaches the no-profile path until the wizard/dashboard heals
// finish the job.
{
  const reg = fs.readFileSync(path.join(ROOT, 'docs/pro/js/pages/register.js'), 'utf8');
  const pr = fs.readFileSync(path.join(ROOT, 'docs/pro/js/provisioning-retry.js'), 'utf8');
  ok('registration still treats createCompany failure as non-fatal',
    /ensureProvisioned\(/.test(reg) && /return false;/.test(pr) && !/^\s*throw\b/m.test(pr),
    'if this became fail-hard, a tenant could no longer reach the no-profile path this way');
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
