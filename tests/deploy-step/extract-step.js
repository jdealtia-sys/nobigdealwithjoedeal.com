/**
 * extract-step.js — pull the strict functions-deploy `run:` body out of
 * .github/workflows/firebase-deploy.yml and dedent it into a runnable script.
 *
 * The point of extracting rather than copying: the harness must exercise the
 * shell that ACTUALLY ships. A copied fixture drifts from the workflow silently,
 * which is the same class of bug the step itself exists to catch.
 *
 * Usage: node extract-step.js <workflow.yml> <out.sh>
 */
'use strict';

const fs = require('fs');

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error('usage: node extract-step.js <workflow.yml> <out.sh>');
  process.exit(2);
}

const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);

const stepAt = lines.findIndex((l) => l.includes('name: Deploy Cloud Functions (strict'));
if (stepAt < 0) {
  console.error('extract-step: strict deploy step not found — was it renamed?');
  process.exit(1);
}

let runAt = -1;
for (let i = stepAt; i < lines.length; i++) {
  if (/^\s+run: \|\s*$/.test(lines[i])) { runAt = i; break; }
}
if (runAt < 0) {
  console.error('extract-step: no "run: |" block under the strict step');
  process.exit(1);
}

// The run: block body is indented 10 spaces (6 for the step, 4 more for the
// block scalar). Anything less indented ends the block.
const INDENT = 10;
const body = [];
for (let i = runAt + 1; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim() === '') { body.push(''); continue; }
  if (line.match(/^ */)[0].length < INDENT) break;
  body.push(line.slice(INDENT));
}

if (body.length < 50) {
  console.error(`extract-step: only ${body.length} lines extracted — indentation changed?`);
  process.exit(1);
}

fs.writeFileSync(out, body.join('\n') + '\n');
console.log(`extracted ${body.length} lines`);
