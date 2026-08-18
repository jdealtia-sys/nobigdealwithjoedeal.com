/**
 * scripts/_migration-guard.js — run-once protection for the one-shot backfills.
 *
 * WHY
 * ───
 * The backfills under scripts/ are ONE-SHOT: each was written for a specific
 * historical data state and applied once. Their existing safety rails — dry-run
 * by default, `--apply` needing `--yes`, per-document idempotency — all guard a
 * *careless* run. None of them notice a *second deliberate* run. That gap is
 * widest exactly where it hurts most: purge-legacy-storage-portals deletes
 * customer-facing Storage objects, and "is this the one that already ran?" is a
 * bad question to be answering at 2am from a comment header.
 *
 * This records completion in Firestore and refuses a second `--apply`.
 *
 * WHERE THE MARKER LIVES
 * ──────────────────────
 * One doc: `system/script_migrations`, keyed by script name.
 *
 *   system/script_migrations = {
 *     'backfill-pins-to-knocks': {
 *        completedAt, completedBy, host, stats: {...}
 *     },
 *     ...
 *   }
 *
 * `system/` is already admin-SDK-only — firestore.rules has
 * `match /system/{docId} { allow read, write: if false; }` — so this needs NO
 * rules change and no client can see it.
 *
 * Deliberately NOT `system/migrations` or its `history` subcollection: those
 * belong to the VERSIONED runner in functions/migrations/runner.js, which
 * tracks `appliedVersion` and runs automatically. These scripts are manual,
 * unversioned, and human-invoked. Mixing them would let an ad-hoc backfill
 * perturb the automated runner's state.
 *
 * SEMANTICS
 * ─────────
 *   dry run       always allowed — read-only, and the way you check state
 *   --apply       refused if already recorded; exits 3 with when/who
 *   --force       overrides the refusal, for a deliberate re-run
 *
 * KNOWN LIMIT: these scripts already ran in prod WITHOUT writing a marker, so
 * a first `--apply` after this lands sees no marker and proceeds. Stamp the
 * already-done ones without re-running them:
 *
 *   node scripts/mark-migration-complete.js <script-name>
 */
'use strict';

const os = require('os');
const { getFirestore, FieldValue } = require('./_admin');

const DOC_PATH = 'system/script_migrations';
const EXIT_ALREADY_COMPLETED = 3;

/** Read the recorded completion for one script, or null. */
async function getCompletion(name) {
  const snap = await getFirestore().doc(DOC_PATH).get();
  const all = (snap.exists && snap.data()) || {};
  return all[name] || null;
}

function fmt(ts) {
  if (!ts) return '(unknown time)';
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return String(ts);
}

/**
 * The whole decision, as a pure function — exported so it can be unit-tested
 * without Firestore, a network, or a process that exits.
 *
 * Returns one of:
 *   'proceed' — no marker; nothing to say
 *   'note'    — marker exists but this is a dry run (read-only, still useful)
 *   'warn'    — marker exists and --force was passed; run but say so loudly
 *   'refuse'  — marker exists, applying, no --force → must not run
 *
 * @param {object|null} prior  the recorded completion, or null
 * @param {object} opts  { apply, force }
 */
function decide(prior, opts) {
  const { apply, force } = opts || {};
  if (!prior) return 'proceed';
  if (!apply) return 'note';
  if (force) return 'warn';
  return 'refuse';
}

/**
 * Refuse a second --apply. Call once inside main(), AFTER the admin app is
 * initialised (it reads Firestore) and after the --apply/--yes check.
 *
 * @param {string}  name    script name, e.g. 'backfill-pins-to-knocks'
 * @param {object}  opts
 * @param {boolean} opts.apply  is this an applying run?
 * @param {boolean} opts.force  --force passed?
 */
async function assertNotCompleted(name, opts) {
  const prior = await getCompletion(name);
  const verdict = decide(prior, opts);

  if (verdict === 'proceed') return;

  if (verdict === 'note') {                 // dry runs stay useful
    console.log(`\nNOTE: ${name} was already applied on ${fmt(prior.completedAt)}`
      + `${prior.completedBy ? ' by ' + prior.completedBy : ''}.`);
    console.log('      This dry run is read-only and will still report what it sees.\n');
    return;
  }

  if (verdict === 'warn') {
    console.warn(`\n⚠ ${name} already applied on ${fmt(prior.completedAt)} — `
      + 're-running anyway because --force was passed.\n');
    return;
  }

  console.error(`\n✗ REFUSING TO RUN: ${name} has already been applied.`);
  console.error(`    when : ${fmt(prior.completedAt)}`);
  if (prior.completedBy) console.error(`    by   : ${prior.completedBy}`);
  if (prior.stats) console.error(`    stats: ${JSON.stringify(prior.stats)}`);
  console.error('');
  console.error('  This is a ONE-SHOT migration; a second apply is not idempotent by');
  console.error('  assumption, only by accident. Re-run the dry run (drop --apply) to');
  console.error('  inspect current state, or pass --force if you genuinely mean it.');
  console.error('');
  process.exit(EXIT_ALREADY_COMPLETED);
}

/**
 * Record a successful applying run. Call at the END of main(), only when
 * apply was true and the run did not fail.
 */
async function recordCompletion(name, stats) {
  await getFirestore().doc(DOC_PATH).set({
    [name]: {
      completedAt: FieldValue.serverTimestamp(),
      completedBy: process.env.USER || process.env.USERNAME || '(unknown)',
      host: os.hostname(),
      stats: stats || {},
    },
  }, { merge: true });
  console.log(`\n[migration-guard] recorded ${name} as completed — a further `
    + '--apply will be refused (use --force to override).');
}

module.exports = {
  assertNotCompleted,
  recordCompletion,
  getCompletion,
  decide,
  DOC_PATH,
  EXIT_ALREADY_COMPLETED,
};
