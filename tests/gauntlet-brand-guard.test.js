/**
 * tests/gauntlet-brand-guard.test.js — source-contract tripwire (gauntlet Batch 3).
 *
 * The Batch 3 de-branding taught us that a whole family of customer/adjuster-
 * facing generators hardcoded NBD identity and slipped past manual review. This
 * guard scans those generators and FAILS if an NBD-identity literal
 * ('No Big Deal Home Solutions', 'Joe Deal', '(859) 420-7382', 'Cincinnati',
 * 'Northern Kentucky', 'Lexington, KY') appears on a line that is NOT gated —
 * i.e. not adjacent to an isNbd / _brand() / _legal() / {{company}} / getter
 * reference and not a comment. Every real NBD literal in these files should be
 * an explicit NBD-branch fallback next to its gate; a bare one is a regression.
 *
 * Purely lexical (no execution). Run: node tests/gauntlet-brand-guard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const ROOT = path.join(__dirname, '..');

// Customer/adjuster-facing generators de-branded in Batch 3.
const FILES = [
  'docs/pro/js/document-generator.js',
  'docs/pro/js/document-generator-templates.js',
  'docs/pro/js/estimate-supplement.js',
  'docs/pro/js/estimate-finalization.js',
  'docs/pro/js/warranty-cert.js',
  'docs/pro/js/photo-report.js',
  'docs/pro/js/inspection-report-engine.js',
  'docs/pro/js/email_system.js',
  'docs/pro/js/portal.js',
  'docs/pro/js/customer-portal.js',
  'functions/print/templates/warranty.hbs',
  'functions/print/partials/coverPage.hbs',
];

// Rendered NBD-identity literals that must never appear ungated on a tenant path.
const NBD_LITERALS = [
  /No Big Deal Home Solutions/,
  /Joe Deal/,
  /\(859\)\s?420-7382/,
  /859-420-7382/,
  /Northern Kentucky/,
  /Lexington, KY/,
];

// A line is "gated" if it — or any line within GATE_WINDOW above/below — carries
// a per-tenant resolver / NBD-gate reference, OR the literal's own line is part
// of a conditional/fallback expression (ternary, ||, ===). A truly BARE literal
// (`x = 'No Big Deal Home Solutions'` with no gate nearby and no branch operator)
// is what this tripwire is meant to catch.
const GATE_WINDOW = 6;
const GATE_TOKENS = [
  'isNbd', '_isNbdBrand', '_brand(', 'window._brand', '_brandRaw', '_brandOverride',
  '_legal(', '_custIdPrefix', 'NBD_COMPANY_PROFILE_DEFAULTS', 'legalName',
  'company.isNbd', 'company.footerName', 'company.seal', 'preparedBy',
  'DEFAULT_COMPANY_NAME', 'DEFAULT_REP_NAME', 'BRAND', 'tenantName', '_bc.', '_b.',
  // structural resolvers: these NBD-default data blocks are only ever read for
  // the NBD tenant by a nearby resolver function / ternary.
  'C.name', 'view.company', '_resolveCompany', '_pbNbd', '_pbCo', 'NBD_DOC_COMPANY',
  'resolveDocCompany', 'resolveBrand', '_repName', 'brandRaw',
  // NBD-default DATA blocks read only for the NBD tenant by their consumer:
  'COMPANY',   // DG.COMPANY default, gated by _resolveCompany()
  'curated',   // NBD-only curated testimonial fallback (rendered only when isNbd)
];
// Same-line branch/fallback operators: the literal is the NBD arm of a ternary
// or the fallback of a `||`, i.e. structurally gated on this very line. (Does
// NOT include a bare `: '` — that would pass every object property, defeating
// the tripwire.)
const BRANCH_ON_LINE = /\?|\|\||===|!==/;

function isCommentLine(t) {
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('{{!');
}

console.log('BRAND GUARD — no ungated NBD identity literal in customer-facing generators');

let totalUngated = 0;
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); }
  catch (_) { ok('file present: ' + rel, false); continue; }
  const lines = src.split(/\r?\n/);
  const ungated = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!NBD_LITERALS.some((re) => re.test(line))) continue;
    const trimmed = line.trim();
    if (isCommentLine(trimmed)) continue; // documentation, not output
    // Gated if the literal's own line is a branch/fallback expression, OR any
    // line within ±GATE_WINDOW carries a resolver/gate token (an NBD-default
    // data block is only ever read for NBD by a nearby resolver / isNbd ternary).
    if (BRANCH_ON_LINE.test(line)) continue;
    const lo = Math.max(0, i - GATE_WINDOW), hi = Math.min(lines.length - 1, i + GATE_WINDOW);
    const windowText = lines.slice(lo, hi + 1).join('\n');
    const gated = GATE_TOKENS.some((tok) => windowText.indexOf(tok) !== -1);
    if (!gated) ungated.push((i + 1) + ': ' + trimmed.slice(0, 100));
  }
  ok('no ungated NBD literal in ' + rel, ungated.length === 0);
  if (ungated.length) { totalUngated += ungated.length; ungated.forEach((u) => console.log('        → ' + u)); }
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed` + (totalUngated ? ` (${totalUngated} ungated literal lines)` : ''));
if (failed) { console.log('\nUngated NBD literals found — gate each behind isNbd/_brand()/{{company}} or make it a per-tenant value:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('✓ No ungated NBD identity literal in any customer-facing generator');
