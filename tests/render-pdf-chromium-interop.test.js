/**
 * tests/render-pdf-chromium-interop.test.js — getBrowser() must launch with a
 * REAL executablePath and a REAL args array, whichever way @sparticuz/chromium
 * happens to be packaged.
 *
 * THE BUG. @sparticuz/chromium 149.0.0 dropped its CommonJS build. Its
 * package.json is "type":"module" with one export condition
 * ({".":{"types":..,"default":"./build/index.js"}}), so require() on the
 * nodejs22 runtime takes the require(esm) path and returns the ES module
 * NAMESPACE — { __esModule, default, inflate, setupLambdaEnvironment } — not
 * the module object. The API is a class on `.default`. functions/render-pdf.js
 * read `chromium.executablePath` and `chromium.args` straight off the
 * namespace, where both are undefined, so `await undefined()` threw
 * "chromium.executablePath is not a function" at stage:launch.
 *
 * That was 100% of server-rendered documents — warranty, estimate, invoice,
 * contract, change order, receipt, inspection, photo report — silently failing
 * over to the client-side html2canvas path from the 148->149 bump (#712,
 * 2026-06-24) until 2026-09-08. Not one `[renderPdf] ok` line survived in the
 * 30-day log window. v148 shipped dual CJS/ESM with no `.default` at all, so
 * the version bump alone broke it with no code change.
 *
 * THE SIBLING PATH. `args` was undefined too, not just executablePath. A fix
 * that unwrapped only the throwing call would still hand puppeteer
 * `args: undefined` — dropping all 22 flags, --no-sandbox and --single-process
 * among them, which is its own failure inside the function sandbox. So the
 * launch options are asserted as a pair, not one at a time.
 *
 * WHY vm AND NOT grep. A source regex for `.default` matches the fixed and the
 * broken file about equally well, and this repo quotes the defect verbatim in
 * its fix comments, so a naive absence-assertion fails on a correct file. This
 * harness instead lifts the real resolveChromium() and getBrowser() out of the
 * source, runs them in a vm sandbox against both genuine packaging shapes with
 * an injected require(), and reads the options that actually reach
 * puppeteer.launch(). Reverting the fix reddens A2/A3 and B2/B3 with a
 * TypeError, not a string mismatch.
 *
 * render-pdf.js pulls in firebase-functions at module scope and a worktree has
 * no functions/node_modules, so the file cannot simply be require()d — same
 * constraint render-pdf-neutral-fallback.test.js works around, same technique
 * pushed one step further to behaviour.
 *
 * Zero deps.  Run: node tests/render-pdf-chromium-interop.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions/render-pdf.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Lift a top-level `function name(...) { ... }` out of the source by
// matching braces. String/comment-naive on purpose: these two functions
// contain no brace-bearing literals, and a heavier parser would be a
// dependency. Throws loudly if the shape it expects is gone.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`extractFn: function ${name}( not found in render-pdf.js`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`extractFn: unbalanced braces reading ${name}`);
  return src.slice(start, i);
}

// getBrowser is `async function getBrowser(`, so match that form too.
function extractAsyncFn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`extractFn: async function ${name}( not found`);
  return 'async ' + extractFn(src.slice(start + 'async '.length), name);
}

// ── The two genuine packaging shapes, reproduced from the real tarballs. ──

// v149: ESM namespace. executablePath/args are statics on a class at .default,
// and the namespace itself carries only inflate/setupLambdaEnvironment.
function makeV149Namespace() {
  class Chromium {
    static get args() { return V149_ARGS.slice(); }
    static executablePath() { return Promise.resolve('/tmp/chromium'); }
  }
  return {
    __esModule: true,
    default: Chromium,
    inflate: () => {},
    setupLambdaEnvironment: () => {},
  };
}
const V149_ARGS = [
  '--ash-no-nudges', '--disable-domain-reliability', '--disable-print-preview',
  '--disk-cache-size=33554432', '--no-default-browser-check', '--no-sandbox',
  '--single-process', '--hide-scrollbars',
];

// v148: the "require" condition resolved to a .cjs whose executablePath/args
// were direct properties. Critically there was NO `.default` — which is why
// an unconditional `mod.default` unwrap would regress this direction.
function makeV148Cjs() {
  const mod = {
    get args() { return V149_ARGS.slice(); },
    executablePath: () => Promise.resolve('/tmp/chromium'),
    inflate: () => {},
  };
  return mod;
}

// ── Build a sandbox holding the REAL resolveChromium + getBrowser, with
// require() and puppeteer injected so we can read the launch options. ──
function runGetBrowser(chromiumModule) {
  const captured = {};
  const sandbox = {
    _browser: null,
    console,
    Promise,
    Error,
    Object,
    Array,
    require(id) {
      if (id === '@sparticuz/chromium') return chromiumModule;
      if (id === 'puppeteer-core') {
        return {
          launch: async (opts) => {
            captured.opts = opts;
            return { isConnected: () => true, _fake: true };
          },
        };
      }
      throw new Error('unexpected require in sandbox: ' + id);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${extractFn(SRC, 'resolveChromium')}\n${extractAsyncFn(SRC, 'getBrowser')}\n` +
    `globalThis.__run = () => getBrowser();`,
    sandbox
  );
  return sandbox.__run().then(() => captured.opts);
}

(async () => {
  console.log('\nrender-pdf chromium CJS/ESM interop\n');

  // ── A. v149 ESM namespace — the shape that is actually in production. ──
  console.log('A. @sparticuz/chromium 149 (ESM namespace, API on .default)');
  let optsA = null, errA = null;
  try { optsA = await runGetBrowser(makeV149Namespace()); }
  catch (e) { errA = e; }

  ok('A1 getBrowser() completes instead of throwing at launch',
    !errA, errA && errA.message);
  ok('A2 executablePath is a resolved path string, not undefined',
    !!optsA && typeof optsA.executablePath === 'string' && optsA.executablePath.length > 0,
    optsA ? `got ${JSON.stringify(optsA.executablePath)}` : 'no launch options captured');
  // The sibling path: a fix that only unwrapped executablePath leaves this
  // undefined and the browser boots with no flags at all.
  ok('A3 args is the real flag array, not undefined',
    !!optsA && Array.isArray(optsA.args) && optsA.args.length === V149_ARGS.length,
    optsA ? `got ${JSON.stringify(optsA.args)}` : 'no launch options captured');
  ok('A4 sandbox flags survive (--no-sandbox present)',
    !!optsA && Array.isArray(optsA.args) && optsA.args.includes('--no-sandbox'));
  ok('A5 headless mode still requested',
    !!optsA && optsA.headless === 'shell',
    optsA ? `got ${JSON.stringify(optsA.headless)}` : '');

  // ── B. v148 CJS — must not regress if the package flips back. ──
  console.log('\nB. @sparticuz/chromium 148 (CJS, direct properties, no .default)');
  let optsB = null, errB = null;
  try { optsB = await runGetBrowser(makeV148Cjs()); }
  catch (e) { errB = e; }
  ok('B1 getBrowser() completes on the CJS shape too', !errB, errB && errB.message);
  ok('B2 executablePath resolved from the module itself',
    !!optsB && typeof optsB.executablePath === 'string' && optsB.executablePath.length > 0);
  ok('B3 args resolved from the module itself',
    !!optsB && Array.isArray(optsB.args) && optsB.args.length === V149_ARGS.length);

  // ── C. An unrecognised shape must name itself. ──
  console.log('\nC. Unknown packaging shape fails legibly');
  const resolveOnly = (() => {
    const s = { module: {}, exports: {}, Object, Error };
    vm.createContext(s);
    vm.runInContext(`${extractFn(SRC, 'resolveChromium')}; globalThis.__r = resolveChromium;`, s);
    return s.__r;
  })();
  let cErr = null;
  try { resolveOnly({ __esModule: true, somethingElse: 1 }); }
  catch (e) { cErr = e; }
  ok('C1 throws rather than returning a useless object', !!cErr);
  ok('C2 message names the package',
    !!cErr && /@sparticuz\/chromium/.test(cErr.message), cErr && cErr.message);
  ok('C3 message reports the keys it actually saw',
    !!cErr && /somethingElse/.test(cErr.message), cErr && cErr.message);
  ok('C4 message is not the old opaque "is not a function"',
    !!cErr && !/is not a function/.test(cErr.message), cErr && cErr.message);

  // ── D. The real installed package, when deps are present. ──
  console.log('\nD. Real @sparticuz/chromium (skipped without functions/node_modules)');
  let realMod = null;
  try { realMod = require(require.resolve('@sparticuz/chromium', { paths: [path.join(ROOT, 'functions')] })); }
  catch (_) { /* not installed in this worktree — expected */ }
  if (!realMod) {
    console.log('  - skipped: @sparticuz/chromium not installed');
  } else {
    const resolved = resolveOnly(realMod);
    ok('D1 real module resolves to an object exposing executablePath()',
      resolved && typeof resolved.executablePath === 'function');
    ok('D2 real module exposes a non-empty args array',
      resolved && Array.isArray(resolved.args) && resolved.args.length > 0,
      resolved ? `args=${resolved && resolved.args && resolved.args.length}` : '');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
