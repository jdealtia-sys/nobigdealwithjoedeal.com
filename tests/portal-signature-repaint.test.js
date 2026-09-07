/* portal-signature-repaint.test.js
 *
 * The homeowner portal's 30-second poll replaced #mainWrap.innerHTML
 * wholesale, which tears down and recreates the BoldSign signing iframe —
 * destroying whatever the homeowner had typed or drawn inside it. The src is
 * not even stable: functions/portal.js re-mints getEmbeddedSignLink on every
 * view fetch, so each repaint injects a different embed URL into a brand-new
 * element.
 *
 * It is self-triggering. Opening the embed makes BoldSign report a view, and
 * functions/integrations/esign.js sets signatureStatus 'viewed' for any event
 * that is not complete/declined/expired. _diffView fires on that change. So
 * starting to sign is itself what causes the wipe — within 30s, or instantly
 * on tab-return from an OTP email via _onVisibility.
 *
 * The fix REJECTED for this was "defer while the homeowner has unsent work":
 * unbounded, with signals that never self-clear (a selected callback chip, a
 * failed upload preview), which would freeze the live view permanently and
 * reintroduce the stale "Review & sign" card the poll exists to prevent.
 *
 * So the deferral here must be bounded three ways, and this suite pins all
 * three: it ends when the estimate stops awaiting signature, it ends if the
 * iframe leaves the DOM, and it gives up after a fixed number of ticks.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const PORTAL = read('docs/pro/js/portal.js');
const ESIGN = read('functions/integrations/esign.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* ── lift and run the real predicate ── */
const fnSrc = /function _signatureInFlight\(nextView\) \{[\s\S]*?\n  \}/.exec(PORTAL);

group('The predicate is present and liftable', () => {
  assert('_signatureInFlight found', !!fnSrc,
    'if it moved, update the extractor — do not delete the suite');
});

function runPredicate(view, hasIframe) {
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === 'iframe[title="Sign Contract"]' && hasIframe ? {} : null),
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fnSrc[0] + '\nthis.__p = _signatureInFlight;', sandbox);
  return sandbox.__p(view);
}

if (fnSrc) {
  group('It defers only when a signature is genuinely in flight', () => {
    const awaiting = { estimate: { signatureStatus: 'sent' } };
    const viewed = { estimate: { signatureStatus: 'viewed' } };

    assert('awaiting signature + iframe mounted -> defer',
      runPredicate(awaiting, true) === true);
    assert('"viewed" also defers (BoldSign flips sent->viewed when they open it)',
      runPredicate(viewed, true) === true);

    // Both halves are load-bearing.
    assert('awaiting signature but NO iframe -> do not defer',
      runPredicate(awaiting, false) === false,
      'a page with no signEmbedUrl renders prose, not an iframe — nothing to protect');
    assert('iframe present but already signed -> do not defer',
      runPredicate({ estimate: { signatureStatus: 'signed' } }, true) === false,
      'otherwise a contract signed in another tab freezes this one');

    for (const s of ['declined', 'expired', 'none', undefined]) {
      assert('status "' + s + '" -> do not defer',
        runPredicate({ estimate: { signatureStatus: s } }, true) === false);
    }
    assert('no estimate at all -> do not defer', runPredicate({}, true) === false);
    assert('no view at all -> do not defer', runPredicate(null, true) === false);
  });
}

group('The poll defers without losing the update', () => {
  const i = PORTAL.indexOf('async function _pollOnce()');
  const region = i === -1 ? '' : PORTAL.slice(i, i + 3000);
  assert('_pollOnce found', i !== -1);

  assert('the deferral is guarded by the predicate AND a cap',
    /if \(events && _signatureInFlight\(view\) && _signDeferrals < MAX_SIGN_DEFERRALS\)/.test(region),
    'without the cap an abandoned signing session freezes the view forever');
  assert('_lastView is NOT advanced while deferring',
    /_signDeferrals\+\+;[\s\S]{0,400}return;[\s\S]{0,200}_signDeferrals = 0;[\s\S]{0,120}_lastView = view;/.test(region),
    'advancing it would drop the update entirely — the documented stale-card bug');
  assert('the counter resets once a repaint happens',
    /_signDeferrals = 0;/.test(region));
  assert('the banner announces once per streak, not once per tick',
    /if \(!_signDeferAnnounced\)/.test(region),
    'the diff is recomputed against the same stale _lastView every 30s');
});

group('The cap is real and finite', () => {
  const m = /const MAX_SIGN_DEFERRALS = (\d+);/.exec(PORTAL);
  assert('MAX_SIGN_DEFERRALS is defined', !!m);
  if (m) {
    const n = Number(m[1]);
    assert('it is a finite, sane number of ticks', n > 0 && n <= 60, 'got ' + n);
  }
});

group('The premise: opening the embed really does flip the status', () => {
  // If this stops being true the self-triggering loop is gone and the
  // deferral could be narrowed — so fail loudly rather than quietly guarding.
  assert('esign webhook sets "viewed" for non-terminal events',
    /signatureStatus\s*[:=]\s*'viewed'/.test(ESIGN),
    'if this changed, re-derive whether the repaint is still self-triggering');
  assert('the portal renders the signing iframe it is protecting',
    /title="Sign Contract"/.test(PORTAL));
  assert('and still repaints via a wholesale innerHTML replace',
    /getElementById\('mainWrap'\)\.innerHTML = parts\.join\(''\);/.test(PORTAL),
    'if this became surgical, this whole deferral could be removed');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
