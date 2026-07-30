/**
 * tests/public-surface-leak-tripwire.test.js — regression tripwire for the
 * 2026-07-30 public-surface exposure sweep (#1147 / #1149 / #1150).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * firebase.json sets hosting.public = "docs", so docs/ IS the live site root:
 * every file under it is world-readable at
 * https://nobigdealwithjoedeal.com/<path-relative-to-docs> unless a
 * hosting.ignore glob excludes it from the upload.
 *
 * Three separate leaks shipped that way, and each was fixed by EDITING the
 * file (the content lives in .js/.html the CRM loads at runtime, so no
 * ignore glob can reach it). Nothing prevented them coming back.
 *
 * The root cause is a house style: decision logs, audit notes, remediation
 * commentary and TODOs get written INTO the served file. Roughly two-thirds
 * of the 19 audit findings were exactly that. So this guard pins the
 * SPECIFIC strings that leaked, rather than trying to pattern-match
 * "internal-sounding prose" (which would be brittle and noisy).
 *
 * IMPORTANT — the lesson that made all of this necessary:
 * tests/security-headers-gdpr.test.js already contained CSP and GDPR
 * invariants but was NEVER referenced from .github/, so it gated nothing for
 * months. That is HOW the docs/deploy/ leak survived. This file is wired into
 * the Smoke tests job in the same commit that introduces it. If you add a
 * check here, confirm it actually runs: grep .github/ for this filename.
 *
 * Zero deps. Run: node tests/public-surface-leak-tripwire.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fb = require(path.join(ROOT, 'firebase.json'));
const PUBLIC_ROOT = path.join(ROOT, fb.hosting.public);

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

// ── which files actually ship ────────────────────────────────
// Mirrors firebase.json hosting.ignore. Supports `**/` (zero+ dirs),
// trailing `**`, and `*`. Kept in sync with the matcher in
// security-headers-gdpr.test.js.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; } else { re += '.*'; i += 1; }
      } else { re += '[^/]*'; }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += (c === '/' ? '/' : '\\' + c);
    } else { re += c; }
  }
  return new RegExp('^' + re + '$');
}
const ignoreRes = (fb.hosting.ignore || []).map(globToRe);
const isIgnored = rel => ignoreRes.some(r => r.test(rel));

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else out.push(r);
  }
  return out;
}

// Only text-ish files can leak a string; skip binaries so the scan stays fast.
const TEXTY = /\.(js|mjs|cjs|html|htm|css|txt|json|xml|svg|md)$/i;
const served = walk(PUBLIC_ROOT, '', [])
  .filter(f => !isIgnored(f))
  .filter(f => TEXTY.test(f));

const sources = new Map();          // rel -> contents
for (const f of served) {
  try { sources.set(f, fs.readFileSync(path.join(PUBLIC_ROOT, f), 'utf8')); } catch (_) { /* unreadable → skip */ }
}

// opts.skip     — drop whole files by path
// opts.lineSkip — drop individual lines before matching
// opts.allow    — predicate on the MATCHED TEXT; true = benign, not a hit
function scan(re, opts = {}) {
  const skip = opts.skip || (() => false);
  const hits = [];
  for (const [f, src] of sources) {
    if (skip(f)) continue;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (opts.lineSkip && opts.lineSkip(lines[i])) continue;
      const m = lines[i].match(re);
      if (!m) continue;
      if (opts.allow && opts.allow(m[0])) continue;
      hits.push(`${f}:${i + 1}`);
    }
  }
  return hits;
}

console.log('PUBLIC-SURFACE LEAK TRIPWIRE — served files under docs/');
ok(`scan set is non-empty (${sources.size} served text files) — guard is live`, sources.size > 200);

// ── 1. Third-party PII in CODE COMMENTS ──────────────────────
// crm-pipeline.js shipped a real homeowner's phone + email as comment
// examples. Repo convention is reserved 555- numbers and example.com.
//
// SCOPED TO COMMENTS ON PURPOSE. Blanket content matching produces pure
// noise here and a noisy guard gets switched off:
//   - the business NAP phone is deliberately published on 40+ marketing
//     pages and in the schema.org JSON-LD;
//   - docs/pro/js/demo.js is a seeded DEMO dataset of fabricated leads with
//     realistic (513) numbers and consumer mailboxes — that is the point of
//     it;
//   - docs/index.html names "ABC Supply" as a homepage trust signal.
// The leak class that actually shipped was developer commentary, so that is
// what this pins.
{
  // Line comments (// …, # … in txt) and block-comment bodies. Cheap and
  // good enough: we only need the prose a developer typed, not a parser.
  const COMMENT = /(^\s*(?:\/\/|\*|<!--)|\/\/[^"'`]*$)/;
  const isComment = line => COMMENT.test(line);
  const SEED = f => /(^|\/)(demo|seed|fixtures?)[-.]|\/vendor\//i.test(f);

  // Benign matches, decided on the MATCHED digits (not the file):
  //   - exchange 555 → the reserved-for-fiction range (555-01xx etc.);
  //   - NBD's own business number, which is deliberately published in the
  //     sitewide schema.org JSON-LD and on 40+ marketing pages. It appears
  //     in comments that explain a tenant-branding bug (a white-label tenant
  //     must NOT inherit it) — quoting it there is the point.
  const NBD_PUBLIC_PHONE = '8594207382';
  const phoneRe = /(?<!\d)(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/;
  const benignPhone = (t) => {
    const d = t.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return d.slice(3, 6) === '555' || d === NBD_PUBLIC_PHONE;
  };
  const phone = scan(phoneRe, { skip: SEED, lineSkip: l => !isComment(l), allow: benignPhone });
  ok(`no real-looking phone number in a served code comment (found: ${phone.slice(0, 5).join(', ') || 'none'})`,
    phone.length === 0);

  // Consumer mailbox providers = a real person, not a business contact.
  const mailRe = /[A-Za-z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|aol|icloud|proton(?:mail)?)\.[A-Za-z]{2,}/i;
  const mail = scan(mailRe, { skip: SEED, lineSkip: l => !isComment(l) });
  ok(`no personal-mailbox email in a served code comment (found: ${mail.slice(0, 5).join(', ') || 'none'})`,
    mail.length === 0);

  // Non-vacuity: the comment filter must not be excluding everything.
  const anyComment = scan(/\S/, { lineSkip: l => !isComment(l) });
  ok(`comment filter still matches real comments (${anyComment.length} lines) — checks above are not vacuous`,
    anyComment.length > 500);
}

// ── 2. Private infrastructure ────────────────────────────────
// The AI-proxy Worker hostname (which embedded the founder's personal
// account handle) was hardcoded in vault-app.js + vault-page.js. The bare
// CSP wildcard `https://*.workers.dev` is fine and must stay allowed.
{
  const worker = scan(/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  ok(`no specific *.workers.dev hostname in served files (found: ${worker.slice(0, 5).join(', ') || 'none'})`,
    worker.length === 0);
  // Prove the above isn't passing just because the wildcard vanished too.
  const wildcard = scan(/\*\.workers\.dev/);
  ok(`CSP wildcard *.workers.dev still present (${wildcard.length} refs) — check above is not vacuous`,
    wildcard.length > 0);
}

// ── 3. Commercial relationships ──────────────────────────────
// product-data.js named a specific supplier branch and portal-confirmed
// wholesale costs; estimate-catalog-xactimate.js named its suppliers.
// NOTE: the supplier BRAND names are deliberately public — docs/index.html
// advertises "sourcing from ABC Supply" as a trust signal, and
// expense-config.js matches vendor-name variants as a product feature. What
// leaked was the specific BRANCH and the portal-confirmed wholesale costs,
// i.e. the negotiated relationship. Pin that, not the brand.
{
  // Not pinned: a bare "portal shows $X" note. It survives in
  // product-data.js and no longer identifies WHICH supplier, so it discloses
  // no relationship — and that file is mid-migration under a separate change
  // (the cost/margin fields are still public and being moved server-side).
  // Pin the identifying strings only.
  const branch = scan(/\bABC\s*#\s*\d+|CONFIRMED via portal|TAMKO Team pricing/i);
  ok(`no supplier branch / portal-cost provenance in served files (found: ${branch.slice(0, 5).join(', ') || 'none'})`,
    branch.length === 0);
}

// ── 4. Self-disclosed weaknesses ─────────────────────────────
// The worst single line was "/pro/ai-tool-finder" telling every visitor that
// "all plan gating is fake". Also caught: the robots.txt post-mortem, the
// register.html paywall-bypass note, and the mfa-enroll line advertising
// that admin MFA was not yet enforced.
{
  const brag = scan(/gating is fake|NOT WIRED|paywall bypass|silently ignored by Googlebot|admin_mfa_required/i);
  ok(`no self-disclosed weakness in served files (found: ${brag.slice(0, 5).join(', ') || 'none'})`,
    brag.length === 0);
}

// ── 5. Internal workflow markers ─────────────────────────────
// TODO_JO comments disclosed that no specific OH/KY registration backs the
// "Licensed & Insured" card. Operator-directed TODOs belong in the tracker,
// not in bytes shipped to homeowners.
{
  const todo = scan(/TODO_JO\b|prospective customer/i);
  ok(`no operator-directed TODO / sales-status marker in served files (found: ${todo.slice(0, 5).join(', ') || 'none'})`,
    todo.length === 0);
}

// ── 6. Internal docs stay unpublished ────────────────────────
// Belt-and-braces with security-headers-gdpr.test.js: assert from THIS
// file's own served-set that no runbook or asset sidecar is in it.
{
  const leaked = [...sources.keys()].filter(f => /\.md$/i.test(f) || /(^|\/)CREDIT\.txt$/i.test(f) || f.startsWith('deploy/'));
  ok(`no .md / CREDIT.txt / deploy-* file is in the served set (found: ${leaked.slice(0, 5).join(', ') || 'none'})`,
    leaked.length === 0);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach(f => console.log('  - ' + f));
  console.log('\nThese files are served publicly at https://nobigdealwithjoedeal.com/<path>.');
  console.log('Fix by EDITING the file — a hosting.ignore glob cannot help for');
  console.log('anything the app loads at runtime.');
  process.exit(1);
}
