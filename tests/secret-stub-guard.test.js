/**
 * tests/secret-stub-guard.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * The deploy stubs every declared secret with the literal `__unset__` so the
 * Firebase CLI can bind it. `'__unset__'` is a truthy nine-character string.
 * The registry's hasSecret() knows that; a BARE defineSecret() param guarded
 * with plain truthiness does not. On 2026-09-04 the stability audit found
 * four deployed functions believing they were configured when they were not:
 * the Places widget asked Google for `places/__unset__` on every refresh, the
 * lead alert would text the phone number "__unset__" instead of Jo's fallback,
 * and every `EMAIL_FROM.value() || 'noreply@…'` would have sent from
 * "__unset__" had that secret ever been stubbed.
 *
 * functions/integrations/_shared.js now exports secretValue()/secretOr() for
 * bare params. This pins their semantics and — the part that matters for the
 * future — fails CI when a `.value() ||` / `.value() ??` fallback reappears
 * anywhere under functions/ outside a small allowlist of sites that validate
 * the value's PREFIX (`price_`, `whsec_`) and are therefore stub-safe.
 *
 * Pure-Node. Run: node tests/secret-stub-guard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'functions');
const shared = require(path.join(FUNCTIONS, 'integrations', '_shared.js'));
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '').replace(/\s\/\/[^\n]*$/mg, '');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const param = (v) => ({ value: () => v });

console.log('\nsecretValue() — the stub is unset, whitespace is trimmed, nothing throws');
{
  ok('a real value is returned trimmed', shared.secretValue(param('  AIza-real-key \n')) === 'AIza-real-key');
  ok("the deploy stub '__unset__' → null", shared.secretValue(param('__unset__')) === null);
  ok("'  __unset__  ' (stub with whitespace) → null", shared.secretValue(param('  __unset__  ')) === null);
  ok('empty string → null', shared.secretValue(param('')) === null);
  ok('whitespace only → null', shared.secretValue(param('   ')) === null);
  ok('non-string (undefined, the unbound-param case) → null', shared.secretValue(param(undefined)) === null);
  ok('a param whose .value() throws (not bound to this function) → null, no throw', shared.secretValue({ value: () => { throw new Error('not bound'); } }) === null);
  ok('null / garbage param → null', shared.secretValue(null) === null && shared.secretValue({}) === null);
  ok('SECRET_STUB_VALUE is exported and is the literal the deploy writes', shared.SECRET_STUB_VALUE === '__unset__');
}

console.log('\nsecretOr() — the fallback beats the stub, a real value beats the fallback');
{
  ok('stub → fallback', shared.secretOr(param('__unset__'), '+18594207382') === '+18594207382');
  ok('empty → fallback', shared.secretOr(param(''), 'noreply@x') === 'noreply@x');
  ok('real → real (trimmed)', shared.secretOr(param(' jd@x '), 'noreply@x') === 'jd@x');
  ok('throwing param → fallback', shared.secretOr({ value: () => { throw new Error('x'); } }, 'fb') === 'fb');
  ok("the bug this replaces: '__unset__' || fallback would have kept the stub", ('__unset__' || 'fb') === '__unset__');
}

console.log('\nSOURCE CONTRACT — no bare truthiness fallback on a secret outside the prefix-validated allowlist');
{
  // Sites allowed to keep `.value() ||`: each validates the value's prefix on
  // the same or an adjacent line, so the stub can never pass.
  const ALLOW = {
    'handlers/seats.js': { count: 4, mustMatch: /startsWith\('price_'\)/ },
    'handlers/stripe-connect.js': { count: 1, mustMatch: /startsWith\('whsec_'\)/ },
  };
  const offenders = [];
  const seen = {};
  for (const f of walk(FUNCTIONS)) {
    const rel = path.relative(FUNCTIONS, f).replace(/\\/g, '/');
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    const hits = (src.match(/\.value\(\)\s*(\|\||\?\?)/g) || []).length;
    if (!hits) continue;
    seen[rel] = hits;
    const rule = ALLOW[rel];
    if (!rule) { offenders.push(rel + ' ×' + hits); continue; }
    if (hits > rule.count) offenders.push(rel + ' ×' + hits + ' (allowed ' + rule.count + ')');
    if (!rule.mustMatch.test(src)) offenders.push(rel + ' lost its prefix check');
  }
  ok('zero `.value() ||` / `.value() ??` fallbacks outside the allowlist', offenders.length === 0, offenders.join('; '));
  ok('the allowlisted files still exist and still use the pattern (else prune the allowlist)',
     Object.keys(ALLOW).every((k) => seen[k] > 0), JSON.stringify(seen));

  // The other spelling of the same bug: `try { x = X.value(); } catch {}` then
  // `if (!x)`. Four sites had it (three Anthropic keys, one Geocoding key that
  // IS the stub in prod). None may come back.
  const tryCatchReads = [];
  for (const f of walk(FUNCTIONS)) {
    const rel = path.relative(FUNCTIONS, f).replace(/\\/g, '/');
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    const n = (src.match(/=\s*[A-Z][A-Z0-9_]*\.value\(\);\s*\}\s*catch/g) || []).length;
    if (n) tryCatchReads.push(rel + ' ×' + n);
  }
  ok('zero `try { x = SECRET.value(); } catch` bare reads', tryCatchReads.length === 0, tryCatchReads.join('; '));

  // Whoever calls secretValue/secretOr must import it from the REGISTRY
  // (integrations/_shared). functions/handlers/_shared.js is a different
  // module with the same basename and does not export them — a handler that
  // adds `secretValue` to its `require('./_shared')` destructuring loads fine
  // and throws TypeError at call time. (Caught in review on 2026-09-04.)
  const badImports = [];
  for (const f of walk(FUNCTIONS)) {
    const rel = path.relative(FUNCTIONS, f).replace(/\\/g, '/');
    if (rel === 'integrations/_shared.js') continue;
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    if (!/\bsecret(Value|Or)\(/.test(src)) continue;
    const inIntegrations = rel.startsWith('integrations/');
    const fromRegistry = inIntegrations
      ? /\bsecret(Value|Or)\b[^\n]*require\(\s*['"]\.\/_shared['"]\s*\)/.test(src)
      : /\bsecret(Value|Or)\b[^\n]*require\(\s*['"](\.\/|\.\.\/)integrations\/_shared['"]\s*\)/.test(src);
    if (!fromRegistry) badImports.push(rel);
  }
  ok('every secretValue/secretOr caller imports it from integrations/_shared (not handlers/_shared)', badImports.length === 0, badImports.join(', '));

  // Bare `if (!X.value())` / `try { x = X.value() } catch {}; if (!x)` guards
  // on the four audited functions are gone.
  const gr = codeOnly(fs.readFileSync(path.join(FUNCTIONS, 'google-reviews.js'), 'utf8'));
  ok('google-reviews reads both Places secrets via secretValue', /secretValue\(NBD_PLACE_ID\)/.test(gr) && /secretValue\(GOOGLE_PLACES_API_KEY\)/.test(gr));
  ok('google-reviews has no bare .value() read left', !/\.value\(\)/.test(gr));
  const vm = codeOnly(fs.readFileSync(path.join(FUNCTIONS, 'integrations', 'voice-memo.js'), 'utf8'));
  ok('voice-memo reads DEEPGRAM_API_KEY via secretValue', /secretValue\(DEEPGRAM_API_KEY\)/.test(vm) && !/DEEPGRAM_API_KEY\.value\(\)/.test(vm));
  const vf = codeOnly(fs.readFileSync(path.join(FUNCTIONS, 'verify-functions.js'), 'utf8'));
  ok("notifyNewLead: Jo's phone falls back through secretOr", /secretOr\(JOE_PHONE_SECRET,\s*JOE_PHONE_FALLBACK\)/.test(vf));
  ok("notifyNewLead: Jo's email falls back through secretOr", /secretOr\(JOE_EMAIL_SECRET,\s*JOE_EMAIL_FALLBACK\)/.test(vf));
  ok('notifyNewLead: EMAIL_FROM falls back through secretOr', /secretOr\(EMAIL_FROM,/.test(vf));
  const di = codeOnly(fs.readFileSync(path.join(FUNCTIONS, 'dictate.js'), 'utf8'));
  ok('dictate (fixed in #1385) still gates on the registry hasSecret()', /hasSecret\(\s*'GROQ_API_KEY'\s*\)/.test(di) && !/DEEPGRAM_API_KEY\.value\(\)/.test(di));

  // Every EMAIL_FROM sender goes through secretOr.
  let emailFromBare = 0, emailFromSafe = 0;
  for (const f of walk(FUNCTIONS)) {
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    emailFromBare += (src.match(/EMAIL_FROM\.value\(\)/g) || []).length;
    emailFromSafe += (src.match(/secretOr\(EMAIL_FROM,/g) || []).length;
  }
  ok('no bare EMAIL_FROM.value() remains', emailFromBare === 0, String(emailFromBare));
  ok('at least the seven known EMAIL_FROM senders use secretOr', emailFromSafe >= 7, String(emailFromSafe));

  const sharedSrc = codeOnly(fs.readFileSync(path.join(FUNCTIONS, 'integrations', '_shared.js'), 'utf8'));
  ok('_shared exports secretValue and secretOr', /secretValue,\s*\n\s*secretOr,/.test(sharedSrc) || (/\bsecretValue\b/.test(sharedSrc.slice(sharedSrc.indexOf('module.exports'))) && /\bsecretOr\b/.test(sharedSrc.slice(sharedSrc.indexOf('module.exports')))));
  ok('hasSecret and secretValue agree on the stub', shared.hasSecret('THIS_SECRET_DOES_NOT_EXIST') === false && shared.secretValue(param(shared.SECRET_STUB_VALUE)) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
