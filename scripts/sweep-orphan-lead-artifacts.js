/**
 * scripts/sweep-orphan-lead-artifacts.js
 *
 * Finds Storage objects under a leadId-keyed prefix whose lead no longer
 * exists, and (optionally) deletes them. Also reports — and can strip — the
 * permanent download tokens on objects whose lead is still alive.
 *
 * WHY THIS EXISTS (and why purge-legacy-storage-portals.js could not do it)
 * ────────────────────────────────────────────────────────────────────────
 * That script's discovery is LEAD-DRIVEN: it enumerates leads carrying legacy
 * portal fields, then derives object paths from them. Two blind spots follow
 * directly from that design, and both were confirmed in prod on 2026-08-18:
 *
 *   1. It does `if (!leadSnap.exists) continue;` — so a deleted lead, whose
 *      artifacts are the ones nobody can ever find again, is skipped by
 *      construction. Deleting a lead removed the only pointer and left the
 *      customer-facing HTML live.
 *   2. It only matches the path shapes it knows. Objects written at an older
 *      shape are invisible to it no matter which lead they belong to.
 *
 * This script inverts the discovery: it enumerates the BUCKET, parses the
 * leadId back out of each object's path, and asks Firestore whether that lead
 * still exists. Storage is the source of truth, so nothing can hide from it —
 * which is the only property that makes an orphan sweep trustworthy.
 *
 * WHAT COUNTS AS AN ORPHAN
 *   {prefix}/{uid}/{leadId}/...        → orphan when leads/{leadId} is gone
 *   {prefix}/{uid}/{leadId}.html       → same, flat legacy shape
 *   {prefix}/{uid}/{leadId}-photos.html
 *
 * Prefixes swept: portals, documents, galleries, audio. photos/ and docs/ are
 * NOT leadId-keyed ({uid}/{file} and {uid}/{leadId}/{file} respectively) —
 * docs/ IS swept, photos/ cannot be and is reported as unswept.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD happen, touches nothing.
 *   • --apply requires --yes.
 *   • --backup-dir is REQUIRED with --apply: every object is downloaded to
 *     disk before deletion. Point it OUTSIDE the repo — this repo is public
 *     and docs/ is the Hosting root.
 *   • Idempotent / safe to re-run.
 *   • A lead read failure is never treated as "lead absent" — an object is
 *     only ever deleted after a successful read that came back empty.
 *
 * SETUP
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro
 *   export NBD_STORAGE_BUCKET=nobigdeal-pro.firebasestorage.app
 *
 * RUN
 *   node scripts/sweep-orphan-lead-artifacts.js
 *   node scripts/sweep-orphan-lead-artifacts.js --prefix documents
 *   node scripts/sweep-orphan-lead-artifacts.js --apply --yes --backup-dir ~/nbd-sweep-backup
 *   node scripts/sweep-orphan-lead-artifacts.js --revoke-tokens --apply --yes
 *
 * --revoke-tokens additionally strips firebaseStorageDownloadTokens from
 * LIVE-lead objects. Those cannot be deleted (the lead still needs them), but
 * the token is what makes them world-readable, and nothing reads it anymore
 * once document-generator.js stopped persisting htmlUrl. Stripping it kills
 * every already-shared link. Run the sweep WITHOUT this flag first and read
 * the report.
 */

'use strict';

const fs = require('fs');
const path = require('path');
// ./_admin is required lazily inside main(): it resolves firebase-admin out of
// functions/node_modules, which a pure-Node test run does not have installed.
// Keeping it out of module scope is what lets tests/orphan-sweep-parser.test.js
// import parseObjectPath without the SDK — and matches the rule that requiring
// this file must have no side effects.

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const REVOKE = args.includes('--revoke-tokens');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const BUCKET = process.env.NBD_STORAGE_BUCKET || 'nobigdeal-pro.firebasestorage.app';

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}
const BACKUP_DIR = argValue('--backup-dir');
const ONLY_PREFIX = argValue('--prefix');

// Prefixes whose path shape embeds the leadId at segment 2. Mirrors
// LEAD_KEYED_PREFIXES in functions/lead-artifact-cleanup.js — if you add one
// there, add it here, or the trigger will reap going forward while this sweep
// stays blind to the backlog.
//
// `flat` lists the legacy suffixes that wrote a single object at
// {prefix}/{uid}/{leadId}<suffix> instead of a directory. It is per-prefix on
// purpose: docs/ legitimately holds {uid}/{file} objects (the signed-doc
// upload's older shape), and treating those as flat would parse the FILENAME
// as a leadId, find no such lead, and report a real file as an orphan.
const LEAD_KEYED_PREFIXES = {
  portals: { flat: ['-photos.html', '.html'] },
  galleries: { flat: ['-photos.html', '.html'] },
  documents: { flat: [] },
  audio: { flat: [] },
  docs: { flat: [] },
};

// Firestore auto-IDs are 20 chars of [A-Za-z0-9]. Anything outside this shape
// is not treated as a leadId — it lands in the unparsed bucket for human
// review rather than being resolved against Firestore. A false negative costs
// a manual look; a false positive deletes a customer's document.
const LEAD_ID_RE = /^[A-Za-z0-9_-]{16,40}$/;

// Prefixes that hold per-lead customer data but are NOT leadId-keyed, so this
// sweep structurally cannot check them. Reported, never guessed at.
const UNSWEEPABLE = {
  photos: 'photos/{uid}/{file} — flat per-uid. Orphans need a photos-collection '
    + 'query by leadId. Reachable only via signImageUrl (15-min signed URL, no '
    + 'permanent token), so an orphan there is not publicly fetchable.',
  reports: 'reports/{uid}/{file} — flat per-uid, same as photos/.',
  deal_rooms: 'deal_rooms/{uid}/{dealId}.html — keyed by dealId, not leadId.',
  receipts: 'receipts/{uid}/{file} — flat per-uid; expense-keyed, not lead-keyed.',
};

// {prefix}/{uid}/{leadId}/rest  OR  {prefix}/{uid}/{leadId}<legacy-suffix>
// Returns null when no leadId is recoverable — the caller reports those
// rather than acting on them.
function parseObjectPath(name) {
  const parts = name.split('/');
  if (parts.length < 3) return null;
  const [prefix, uid, third] = parts;
  const cfg = LEAD_KEYED_PREFIXES[prefix];
  if (!cfg || !uid || !third) return null;

  // Directory shape — the leadId is a whole path segment, so it is
  // unambiguous.
  if (parts.length >= 4) {
    return LEAD_ID_RE.test(third) ? { prefix, uid, leadId: third, shape: 'dir' } : null;
  }

  // Flat shape — only for prefixes that actually had one. Longest suffix
  // first so '-photos.html' wins over '.html'.
  for (const suffix of cfg.flat) {
    if (third.toLowerCase().endsWith(suffix.toLowerCase())) {
      const leadId = third.slice(0, third.length - suffix.length);
      return LEAD_ID_RE.test(leadId) ? { prefix, uid, leadId, shape: 'flat' } : null;
    }
  }
  return null;
}

async function listAllObjects(bucket, prefixes) {
  const out = [];
  for (const p of prefixes) {
    let pageToken;
    do {
      const [files, nextQuery] = await bucket.getFiles({
        prefix: p + '/',
        maxResults: 1000,
        autoPaginate: false,
        pageToken,
      });
      out.push(...files);
      pageToken = nextQuery && nextQuery.pageToken;
    } while (pageToken);
    console.log(`  scanned ${p}/ …`);
  }
  return out;
}

// Cache lead-existence lookups: one bucket can hold hundreds of objects per
// lead, and each would otherwise be its own Firestore read.
// Returns { exists, softDeleted }.
//
// The two states are NOT the same and must not be collapsed. Deleting a lead
// in the CRM is a SOFT delete (`deleted: true` — the restorable trash bin);
// only `_permanentDeleteLead` removes the doc. So:
//
//   exists:false               → orphan. Nothing points at the object. Delete.
//   exists:true, soft-deleted  → NOT an orphan; the lead is restorable and its
//                                artifacts must survive. But the rep believes
//                                this lead is deleted while its generated HTML
//                                stays publicly fetchable — the least
//                                defensible place for a permanent token, so it
//                                is reported separately.
//   exists:true, live          → normal.
function makeLeadChecker(db) {
  const cache = new Map();
  return async function leadState(leadId) {
    if (cache.has(leadId)) return cache.get(leadId);
    // Deliberately NOT wrapped in a try/catch that returns "absent": a
    // transient read failure must never be read as "the lead is gone" and
    // authorize a delete. Let it throw and abort the run.
    const snap = await db.doc('leads/' + leadId).get();
    const state = {
      exists: snap.exists,
      softDeleted: snap.exists && (snap.data() || {}).deleted === true,
    };
    cache.set(leadId, state);
    return state;
  };
}

function hasDownloadToken(file) {
  const m = (file.metadata && file.metadata.metadata) || {};
  return !!m.firebaseStorageDownloadTokens;
}

async function backupObject(file, backupDir) {
  const dest = path.join(backupDir, file.name.replace(/[\\/]/g, path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await file.download({ destination: dest });
  // Preserve the metadata too — the token value is part of the evidence of
  // what was publicly reachable, and it is not recoverable from the bytes.
  fs.writeFileSync(dest + '.metadata.json', JSON.stringify(file.metadata, null, 2));
  return dest;
}

async function main() {
  // Argument validation first — a typo should fail before we initialise the
  // admin SDK and authenticate against prod.
  const sweepable = Object.keys(LEAD_KEYED_PREFIXES);
  if (ONLY_PREFIX && !sweepable.includes(ONLY_PREFIX)) {
    console.error(`--prefix ${ONLY_PREFIX} is not lead-keyed. Sweepable: `
      + sweepable.join(', '));
    process.exit(2);
  }
  const prefixes = ONLY_PREFIX ? [ONLY_PREFIX] : sweepable;

  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes.');
    process.exit(2);
  }
  if (APPLY && !BACKUP_DIR) {
    console.error('Refusing to --apply without --backup-dir. These are real '
      + 'customer-facing artifacts; back them up first.\n'
      + 'Point it OUTSIDE the repo — this repo is public.');
    process.exit(2);
  }
  if (BACKUP_DIR) {
    const resolved = path.resolve(BACKUP_DIR);
    if (resolved.startsWith(path.resolve(__dirname, '..'))) {
      console.error('--backup-dir resolves inside the repo (' + resolved + ').\n'
        + 'This repo is public and docs/ is the Firebase Hosting root — a backup '
        + 'of leaked customer HTML must not land in the tree.');
      process.exit(2);
    }
    fs.mkdirSync(resolved, { recursive: true });
  }

  const { initAdmin, getFirestore, getStorage } = require('./_admin');
  initAdmin({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const leadState = makeLeadChecker(db);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Orphan lead-artifact sweep (storage-driven discovery)');
  console.log('  project  : ' + PROJECT);
  console.log('  bucket   : ' + bucket.name);
  console.log('  prefixes : ' + prefixes.join(', '));
  console.log('  mode     : ' + (APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no changes)'));
  console.log('  tokens   : ' + (REVOKE ? 'STRIP from live-lead objects' : 'report only'));
  if (BACKUP_DIR) console.log('  backup   : ' + path.resolve(BACKUP_DIR));
  console.log('═══════════════════════════════════════════════════════════');

  console.log('Enumerating bucket…');
  const files = await listAllObjects(bucket, prefixes);
  console.log('  ' + files.length + ' object(s) under lead-keyed prefixes\n');

  const orphans = [];
  const liveTokened = [];
  const softDeletedTokened = [];
  const unparsed = [];

  for (const f of files) {
    const parsed = parseObjectPath(f.name);
    if (!parsed) { unparsed.push({ name: f.name, tokened: hasDownloadToken(f) }); continue; }
    const state = await leadState(parsed.leadId);
    if (!state.exists) orphans.push({ file: f, ...parsed });
    else if (hasDownloadToken(f)) {
      (state.softDeleted ? softDeletedTokened : liveTokened).push({ file: f, ...parsed });
    }
  }

  // ── Report ────────────────────────────────────────────────────
  const byLead = new Map();
  for (const o of orphans) {
    if (!byLead.has(o.leadId)) byLead.set(o.leadId, []);
    byLead.get(o.leadId).push(o);
  }

  console.log('─── ORPHANS (lead no longer exists) ───────────────────────');
  if (!orphans.length) console.log('  none\n');
  for (const [leadId, items] of byLead) {
    console.log(`• lead ${leadId} — GONE, ${items.length} object(s) still live`);
    for (const o of items) {
      const tok = hasDownloadToken(o.file) ? ' [PUBLIC TOKEN]' : '';
      console.log(`    ${o.file.name}${tok}`);
    }
  }
  console.log('');

  console.log('─── SOFT-DELETED LEADS WITH PUBLIC DOWNLOAD TOKENS ────────');
  console.log(`  ${softDeletedTokened.length} object(s) fetchable by anyone holding the URL,`);
  console.log('  belonging to leads already DELETED in the CRM (deleted: true, trash bin).');
  console.log('  NOT orphans — the lead is restorable, so the object stays. But this is the');
  console.log('  least defensible token population: gone from the rep\'s view, live on the web.');
  for (const l of softDeletedTokened.slice(0, 40)) console.log('    ' + l.file.name);
  if (softDeletedTokened.length > 40) console.log(`    … and ${softDeletedTokened.length - 40} more`);
  console.log('');

  console.log('─── ACTIVE LEADS WITH PUBLIC DOWNLOAD TOKENS ──────────────');
  console.log(`  ${liveTokened.length} object(s) fetchable by anyone holding the URL.`);
  console.log('  These belong to active leads, so they are NOT deleted.');
  for (const l of liveTokened.slice(0, 40)) console.log('    ' + l.file.name);
  if (liveTokened.length > 40) console.log(`    … and ${liveTokened.length - 40} more`);
  console.log('');
  console.log(`  --revoke-tokens strips the token from all `
    + `${liveTokened.length + softDeletedTokened.length} object(s) above.${REVOKE ? ' (ACTIVE)' : ''}`);
  console.log('');

  if (unparsed.length) {
    const tokenedUnparsed = unparsed.filter(u => u.tokened);
    console.log('─── UNPARSED (no leadId recoverable from the path) ────────');
    console.log('  Never auto-deleted — review by hand. An unrecognised path shape is');
    console.log('  exactly what hid the original orphans, so this list is the one to read.');
    console.log(`  ${tokenedUnparsed.length} of ${unparsed.length} carry a public download token.`);
    for (const u of unparsed.slice(0, 40)) {
      console.log('    ' + u.name + (u.tokened ? ' [PUBLIC TOKEN]' : ''));
    }
    if (unparsed.length > 40) console.log(`    … and ${unparsed.length - 40} more`);
    console.log('');
  }

  console.log('─── NOT SWEPT (not leadId-keyed) ──────────────────────────');
  for (const [p, why] of Object.entries(UNSWEEPABLE)) console.log(`  ${p}: ${why}`);
  console.log('');

  // ── Act ───────────────────────────────────────────────────────
  let deleted = 0, revoked = 0, failures = 0;

  for (const o of orphans) {
    if (!APPLY) { console.log('would delete  ' + o.file.name); continue; }
    try {
      const at = await backupObject(o.file, BACKUP_DIR);
      await o.file.delete({ ignoreNotFound: true });
      console.log(`deleted       ${o.file.name}  (backup: ${at})`);
      deleted++;
    } catch (e) {
      console.warn(`! failed      ${o.file.name} — ${e.message}`);
      failures++;
    }
  }

  if (REVOKE) {
    for (const l of [...softDeletedTokened, ...liveTokened]) {
      if (!APPLY) { console.log('would revoke token  ' + l.file.name); continue; }
      try {
        // Clearing the token key is the documented revocation path: the
        // ?token= URL 403s immediately afterward. The object itself is
        // untouched, so the owner (and every admin-SDK reader) keeps access.
        await l.file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
        console.log('revoked token ' + l.file.name);
        revoked++;
      } catch (e) {
        console.warn(`! revoke failed ${l.file.name} — ${e.message}`);
        failures++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`orphan objects   : ${orphans.length}`);
  console.log(`orphan leads     : ${byLead.size}`);
  console.log(`soft-del w/ token: ${softDeletedTokened.length}`);
  console.log(`active w/ token  : ${liveTokened.length}`);
  console.log(`unparsed         : ${unparsed.length}`);
  console.log(`deleted          : ${deleted}`);
  console.log(`tokens revoked   : ${revoked}`);
  console.log(`failures         : ${failures}`);
  if (!APPLY) console.log('\nDRY-RUN — nothing was changed.');
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(failures ? 1 : 0);
}

// parseObjectPath decides which objects are eligible for deletion, so it is
// exported and covered by tests/orphan-sweep-parser.test.js. A false positive
// here deletes a live customer document; the guard against that is a test, not
// care. Requiring this file must therefore never start a sweep.
module.exports = { parseObjectPath, LEAD_KEYED_PREFIXES, LEAD_ID_RE };

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL: ' + (e && e.stack || e));
    process.exit(1);
  });
}
