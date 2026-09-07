/**
 * deploy-api-enable-step.test.js — the "Enable required Google APIs" step
 * must not print an alarming line on a healthy deploy.
 *
 * WHY THIS EXISTS
 *
 * The deploy service account deliberately does NOT hold
 * roles/serviceusage.serviceUsageAdmin, so `gcloud services enable` returns 1
 * on EVERY run — including when all seven APIs are already on, which they are.
 * The step has known that since 2026-08-17 and asserts the end state instead
 * of trusting the exit code, which is the right design.
 *
 * What it still did was let gcloud's failure text stream into the log:
 *
 *   ERROR: (gcloud.services.enable) [firebase-adminsdk-...] does not have
 *   permission to access projects instance [nobigdeal-pro] ...
 *   ✓ All 7 required APIs already enabled (services enable exited 1 — expected...)
 *
 * On 2026-09-07 that pair did exactly what the step's own comment warns about:
 * the ERROR was read as a live fault and reported as a production issue by
 * someone triaging a genuinely failed deploy in the same run. A log line that
 * reads as a failure on every healthy deploy is not free — it trains readers
 * to skim past the real ones.
 *
 * So: the gcloud text is evidence only when the end-state check finds
 * something wrong, and this suite pins that in both directions by running the
 * REAL step body — extracted from the workflow YAML — against a stubbed gcloud.
 *
 * Run: node tests/deploy-api-enable-step.test.js   (needs bash; no deps)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github/workflows/firebase-deploy.yml');
const yml = fs.readFileSync(WF, 'utf8').replace(/\r\n/g, '\n');

/** Pull one step's `run: |` block out of the workflow and dedent it. */
function extractRunBlock(stepName) {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => l.trim() === '- name: ' + stepName);
  if (at < 0) return null;
  let i = at;
  while (i < lines.length && lines[i].trim() !== 'run: |') i++;
  if (i >= lines.length) return null;
  const bodyIndent = lines[i].match(/^(\s*)/)[1] + '  ';
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') { out.push(''); continue; }
    if (!lines[j].startsWith(bodyIndent)) break;
    out.push(lines[j].slice(bodyIndent.length));
  }
  return out.join('\n');
}

const body = extractRunBlock('Enable required Google APIs');
ok('the step body is extractable from the workflow', !!body,
  'the test must run the REAL step, not a copy of it');

if (!body) {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const ALL_SEVEN = ['cloudscheduler', 'identitytoolkit', 'pubsub', 'eventarc',
  'run', 'cloudbuild', 'artifactregistry'];
const DENIED = 'ERROR: (gcloud.services.enable) [firebase-adminsdk-fbsvc@nobigdeal-pro.iam.gserviceaccount.com] does not have permission to access projects instance [nobigdeal-pro] (or it may not exist): Permission denied to enable service [artifactregistry.googleapis.com]';

/**
 * Run the real step body with a stubbed gcloud.
 * `enabled` is the list `services list --enabled` will report.
 */
function runStep(enabled) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-api-step-'));
  const listFile = path.join(dir, 'enabled.txt').replace(/\\/g, '/');
  fs.writeFileSync(listFile, enabled.map((a) => a + '.googleapis.com').join('\n') + (enabled.length ? '\n' : ''));

  const harness = `
# Merge stderr into stdout: in the GitHub log both streams land in the same
# place, so a test that reads only stdout cannot see a streamed gcloud ERROR —
# which is exactly the line under test. Capturing them separately made the
# "no alarming ERROR line" assertion unable to fail.
exec 2>&1
PRO_PROJECT=nobigdeal-pro
GOOGLE_APPLICATION_CREDENTIALS=/dev/null
# Stub gcloud: 'services enable' always fails the way the real SA does;
# 'services list' reports the fixture; everything else is a quiet no-op.
gcloud() {
  case "$1 $2" in
    "services enable") printf '%s\\n' ${JSON.stringify(DENIED)} >&2; return 1 ;;
    "services list")   cat "${listFile}"; return 0 ;;
    *) return 0 ;;
  esac
}
${body}
`;
  const script = path.join(dir, 'step.sh');
  fs.writeFileSync(script, harness);
  return execFileSync('bash', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

(function run() {
  console.log('\ndeploy-api-enable-step — a healthy deploy must read as healthy\n');

  // ── the everyday case: all seven on, SA cannot enable ─────────────────
  {
    const out = runStep(ALL_SEVEN);
    ok('a healthy run confirms all seven APIs',
      /All 7 required APIs already enabled/.test(out), out.slice(0, 300));
    ok('...and prints NO alarming gcloud ERROR line',
      !out.includes('does not have permission'),
      'output still carries gcloud\'s permission error:\n' + out.slice(0, 400)
      + '\n— on every healthy deploy, two lines above a ✓, which is how it gets '
      + 'mistaken for the cause of a real failure');
    ok('...and raises no warning annotation',
      !out.includes('::warning::'), out.slice(0, 300));
  }

  // ── a REAL problem: an API is genuinely off ───────────────────────────
  {
    const out = runStep(ALL_SEVEN.filter((a) => a !== 'eventarc'));
    ok('a genuinely missing API is warned about, and named',
      out.includes('::warning::') && /NOT enabled/.test(out) && /eventarc/.test(out),
      out.slice(0, 400));
    ok('...and THERE the gcloud error is shown, because it is evidence',
      out.includes('does not have permission'),
      'the operator needs to know the enable attempt was refused, not just that '
      + 'the API is off:\n' + out.slice(0, 400));
  }

  // ── the list itself is unreadable ─────────────────────────────────────
  {
    const out = runStep([]);
    ok('an unreadable API list is surfaced rather than guessed',
      out.includes('::warning::') && /Could not read enabled-API list/.test(out),
      out.slice(0, 400));
    ok('...and shows the gcloud error too',
      out.includes('does not have permission'), out.slice(0, 400));
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
})();
