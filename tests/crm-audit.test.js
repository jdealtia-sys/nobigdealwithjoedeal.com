/**
 * tests/crm-audit.test.js
 *
 * Pins the EXIT CONTRACT of scripts/crm-audit.js.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * docs/pro/** HTML is guarded by nothing today: check-site-integrity.js
 * excludes the `pro` and `admin` top dirs, and check-inline-html-scripts.js
 * skips `pro` unless run with --all. So a <script src> or <link href> pointing
 * at a deleted file under the CRM merges and deploys silently. crm-audit.js
 * already covers those pages, has zero deps, and runs in well under a second —
 * it is the obvious thing to wire into CI.
 *
 * Wiring it AS IT WAS would have manufactured the next silently-green gate,
 * which this repo has already shipped three times (visual baselines never
 * committed; npm test skipping 22 suites; storage rules absent from the deploy
 * gate). Two defects, both verified against the pre-2026-09-03 script:
 *
 *   1. The --json path ALWAYS EXITED 0. `if (AS_JSON) { …write…; return; }`
 *      sat ABOVE the totErr computation, so --json returned before the verdict
 *      was ever computed. Any CI step using --json (to archive the payload, to
 *      count findings) would have been green forever.
 *   2. A TYPO'D --page — or a moved docs/pro/, or a bad root — reported
 *      SUCCESS OVER ZERO PAGES. No pages means no findings means totErr === 0
 *      means exit 0: a green that means "I audited nothing".
 *
 * Both defects were reproduced before the fix, by dropping the pre-fix script
 * into a fixture tree so its own `__dirname/..` resolved there — unmodified,
 * against the same fixtures. Measured 2026-09-03:
 *
 *   broken <script src>, human path   → exit 1   (already worked)
 *   broken <script src>, --json       → exit 0   ← defect 1
 *   docs/pro/ with no .html           → exit 0   ← defect 2
 *   typo'd --page=dashbaord.html      → exit 0   ← defect 2
 *   root with no docs/pro/ at all     → raw ENOENT stack, exit 1
 *
 * The remaining cases here pin the behaviour AROUND those two, so a later fix
 * cannot trade one silent green for another: that --severity/--quiet stay
 * display filters and never move the verdict, that warn/info findings do not
 * fail the process, that the JSON payload shape survives, and — the other half
 * of "prove it can fail" — that a clean tree still exits 0. A gate that cannot
 * PASS is as useless as one that cannot fail.
 *
 * Method: build throwaway fixture trees under os.tmpdir() and run the REAL
 * script against them as a child process via NBD_AUDIT_ROOT (added for exactly
 * this reason; unset, the script still audits the real repo docs/pro/). No
 * real page is touched, and the assertions are on the exit code, because the
 * exit code is the entire product of a gate.
 *
 * Pure-Node, no emulator, no deps. Run: node tests/crm-audit.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'crm-audit.js');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

// ── fixture plumbing ────────────────────────────────────────────────
const madeRoots = [];

/** Write a { 'relative/path': 'contents' } map into a fresh temp tree. */
function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-crm-audit-'));
  madeRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return root;
}

function runAudit(root, args) {
  return spawnSync(process.execPath, [SCRIPT, ...(args || [])], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { NBD_AUDIT_ROOT: root }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// A page whose every reference resolves. Deliberately free of inline <script>
// (nothing for the INLINE_SYNTAX check to trip on) and of duplicate ids.
const CLEAN_PAGE = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<link rel="stylesheet" href="css/app.css">',
  '</head><body>',
  '<main id="root"><button type="button">Save</button></main>',
  '<script src="js/app.js" defer></script>',
  '</body></html>',
].join('\n');

const CLEAN_TREE = {
  'docs/pro/dashboard.html': CLEAN_PAGE,
  'docs/pro/css/app.css': 'body{color:#111}\n',
  'docs/pro/js/app.js': 'window.saveThing = function saveThing(){};\n',
};

try {
  // ── DEFECT 1 — the verdict must exist on BOTH output paths ────────
  console.log('\nBROKEN REFERENCES — an error finding must fail the process');
  {
    const root = makeTree(Object.assign({}, CLEAN_TREE, {
      'docs/pro/dashboard.html':
        CLEAN_PAGE.replace('js/app.js', 'js/deleted-by-a-refactor.js'),
    }));

    const human = runAudit(root, []);
    ok('missing <script src> → exit 1 (human output)', human.status === 1);
    ok('missing <script src> is reported as BROKEN_SCRIPT',
       /BROKEN_SCRIPT/.test(human.stdout));

    // THE defect: this returned before totErr was computed and exited 0.
    const json = runAudit(root, ['--json']);
    ok('missing <script src> → exit 1 with --json (was always 0)', json.status === 1);

    let payload = null;
    try { payload = JSON.parse(json.stdout); } catch { /* stays null */ }
    ok('--json stdout is still parseable JSON', payload !== null);
    ok('--json payload keeps its { pages, findings } shape',
       !!payload && Array.isArray(payload.pages) && Array.isArray(payload.findings));
    ok('--json payload carries the BROKEN_SCRIPT finding',
       !!payload && payload.findings.some((f) => f.code === 'BROKEN_SCRIPT'));

    // A failing run must never serialize as clean. `findings` is the DISPLAY-
    // filtered list while the verdict counts over ALL findings, so
    // `--json --severity=info` exits 1 with `findings: []` — before the
    // 2026-09-03 exit fix that could not misfire, because --json always
    // exited 0. `counts` is unfiltered, so a parser can always recover what
    // the exit code meant.
    ok('--json payload carries unfiltered counts',
       !!payload && payload.counts && payload.counts.error === 1);
    const narrowed = runAudit(root, ['--json', '--severity=info']);
    let np = null;
    try { np = JSON.parse(narrowed.stdout); } catch { /* stays null */ }
    ok('a display filter cannot make a failing --json run look clean',
       narrowed.status === 1 && !!np && np.findings.length === 0 && np.counts.error === 1);

    // A missing stylesheet is the same class of rot and must gate too.
    const linkRoot = makeTree(Object.assign({}, CLEAN_TREE, {
      'docs/pro/dashboard.html': CLEAN_PAGE.replace('css/app.css', 'css/gone.css'),
    }));
    ok('missing <link rel=stylesheet href> → exit 1',
       runAudit(linkRoot, []).status === 1);

    // An inline block that cannot parse is dead JS on a shipped page.
    const synRoot = makeTree(Object.assign({}, CLEAN_TREE, {
      'docs/pro/dashboard.html':
        CLEAN_PAGE.replace('</body>', '<script>function broken( {</script></body>'),
    }));
    const syn = runAudit(synRoot, []);
    ok('unparseable inline <script> → exit 1', syn.status === 1);
    ok('unparseable inline <script> is reported as INLINE_SYNTAX',
       /INLINE_SYNTAX/.test(syn.stdout));
  }

  // ── DEFECT 2 — success over zero pages ───────────────────────────
  console.log('\nZERO PAGES — "I audited nothing" must never read as green');
  {
    // A root with no docs/pro/ at all: the shape a moved directory or a bad
    // NBD_AUDIT_ROOT produces. Pre-fix this was red only by accident — a raw
    // readdirSync ENOENT stack. Post-fix it is a named refusal that says which
    // root it used, so the reader can tell "misconfigured" from "dirty".
    const emptyRoot = makeTree({ 'readme.txt': 'no CRM here\n' });
    const empty = runAudit(emptyRoot, []);
    ok('root with no docs/pro/ → exit 1', empty.status === 1);
    ok('…and says what it looked for', /refusing to report success over zero pages/i.test(empty.stderr));
    ok('…and names the root it used', empty.stderr.includes(emptyRoot));

    // docs/pro/ exists but holds no .html — this is the one that was genuinely
    // green pre-fix: exit 0, and --json printed a cheerful `"pages": []`.
    const noHtmlRoot = makeTree({ 'docs/pro/js/app.js': '// nothing to audit\n' });
    ok('docs/pro/ with no .html → exit 1', runAudit(noHtmlRoot, []).status === 1);

    // THE defect as a human would hit it: a typo'd --page audits nothing and
    // used to print a triumphant 0-error report.
    const root = makeTree(CLEAN_TREE);
    const typo = runAudit(root, ['--page=dashbaord.html']);
    ok('typo\'d --page → exit 1', typo.status === 1);
    ok('…and echoes the filter that matched nothing',
       typo.stderr.includes('dashbaord.html'));

    // A bare --page with no value silently filtered everything out too.
    ok('bare --page with no value → exit 1', runAudit(root, ['--page']).status === 1);

    // The control: the correctly-spelled page still audits and passes.
    ok('correctly-spelled --page → exit 0',
       runAudit(root, ['--page=dashboard.html']).status === 0);

    // Zero pages must fail on the JSON path too, not print `"pages": []`.
    ok('typo\'d --page with --json → exit 1',
       runAudit(root, ['--page=dashbaord.html', '--json']).status === 1);
  }

  // ── The gate must also be able to PASS ───────────────────────────
  console.log('\nCLEAN TREE — a gate that cannot pass is as useless as one that cannot fail');
  {
    const root = makeTree(CLEAN_TREE);
    const clean = runAudit(root, []);
    ok('clean fixture tree → exit 0', clean.status === 0);
    ok('clean fixture tree reports 0 errors', /TOTAL: 0 error/.test(clean.stdout));

    const json = runAudit(root, ['--json']);
    ok('clean fixture tree → exit 0 with --json', json.status === 0);
    let payload = null;
    try { payload = JSON.parse(json.stdout); } catch { /* stays null */ }
    ok('clean --json lists the page it audited',
       !!payload && payload.pages.length === 1 && payload.pages[0] === 'dashboard.html');
    ok('clean --json has no error findings',
       !!payload && !payload.findings.some((f) => f.severity === 'error'));
  }

  // ── Severity is presentation, never a gate ───────────────────────
  console.log('\nSEVERITY/QUIET ARE DISPLAY FILTERS — they must not move the verdict');
  {
    const root = makeTree(Object.assign({}, CLEAN_TREE, {
      'docs/pro/dashboard.html': CLEAN_PAGE.replace('js/app.js', 'js/gone.js'),
    }));
    // If --severity ever became a gate filter, these three would diverge —
    // and `--severity=info` in a CI step would quietly de-gate every error.
    ok('--severity=info still exits 1 on an error finding',
       runAudit(root, ['--severity=info']).status === 1);
    ok('--severity=warn still exits 1 on an error finding',
       runAudit(root, ['--severity=warn']).status === 1);
    ok('--quiet still exits 1 on an error finding',
       runAudit(root, ['--quiet']).status === 1);

    // …and warn/info findings alone must NOT fail: the gate's blast radius is
    // error-severity only. A duplicate id is a `warn`.
    const warnRoot = makeTree(Object.assign({}, CLEAN_TREE, {
      'docs/pro/dashboard.html':
        CLEAN_PAGE.replace('<main id="root">', '<main id="root"><div id="root"></div>'),
    }));
    const warned = runAudit(warnRoot, []);
    ok('a warn-only page still exits 0', warned.status === 0);
    ok('…and the warn is actually reported (so this is not a vacuous pass)',
       /DUPLICATE_ID/.test(warned.stdout));
  }

  // ── The env override must not change the default ─────────────────
  console.log('\nDEFAULT ROOT — the override is additive, not a redirect');
  {
    // With NBD_AUDIT_ROOT unset the script must audit the REAL docs/pro/.
    // Asserting on the page count keeps this honest without asserting the
    // repo is clean (that verdict is reported separately, not pinned here).
    const env = Object.assign({}, process.env);
    delete env.NBD_AUDIT_ROOT;
    const real = spawnSync(process.execPath, [SCRIPT, '--json'], {
      cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    let payload = null;
    try { payload = JSON.parse(real.stdout); } catch { /* stays null */ }
    const onDisk = fs.readdirSync(path.join(REPO_ROOT, 'docs', 'pro'))
      .filter((f) => f.endsWith('.html')).length;
    ok('unset NBD_AUDIT_ROOT audits the real docs/pro/ (' + onDisk + ' pages)',
       !!payload && payload.pages.length === onDisk && onDisk > 0);
    ok('real-tree run exits 0 or 1, never a crash',
       real.status === 0 || real.status === 1);
  }
} finally {
  for (const r of madeRoots) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
