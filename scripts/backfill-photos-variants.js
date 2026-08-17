/**
 * scripts/backfill-photos-variants.js
 *
 * ONE-TIME BACKFILL — §2.2 of the image-pipeline audit: give every legacy
 * /photos doc the WebP variant set (`urls.{thumb,med,full}` +
 * `variantsGeneratedAt`) that the Storage trigger stamps on fresh uploads,
 * and first repair the `storagePath` field the trigger's doc lookup keys on.
 *
 * Background
 * ──────────
 * functions/image-pipeline.js (onPhotoUploaded) generates 200/600/1600 px
 * WebP variants for every photo upload and stamps the matching /photos doc.
 * Until 2026-08-16 it hard-required the 3-segment customer-page path shape
 * (photos/{uid}/{file}) — every nested upload surface (dashboard
 * photos/{uid}/{leadId}/..., photo-engine, photo-editor, d2d) was silently
 * skipped, so photos uploaded there since ~2026-04 have no variants and
 * their grids pull multi-MB originals. On top of that, dashboard
 * _uploadPhoto and photo-editor docs written before that same fix never
 * stamped `storagePath`, so even a re-fired trigger could not find their
 * docs (the lookup is where('storagePath','==',objectName)).
 * See documentation/projects/SESSION-2026-08-16-image-pipeline-nested-shapes.md.
 *
 * What it does (in order)
 * ───────────────────────
 *   Phase A — storagePath repair (Firestore-only)
 *     For every /photos doc missing `storagePath`, derive it from the
 *     `url` field (the /o/{encoded-object-path} segment of the Firebase
 *     download URL), owner-check it (the path's uid segment must equal
 *     doc.userId — mirror of the trigger's DI-02 guard), and stamp it
 *     with merge:true.
 *
 *   Phase B — variant generation (Storage + sharp + doc stamp)
 *     For every /photos doc that has a storagePath but not the complete
 *     urls + variantsGeneratedAt stamp, download the original, generate
 *     the three WebP variants with sharp using THE SAME `VARIANTS` spec
 *     the runtime trigger uses (imported from functions/image-pipeline.js
 *     so the two can never drift), upload them to
 *     {sourceDir}/_variants/{base}_{thumb,med,full}.webp with the same
 *     token + immutable-cache metadata, and stamp the doc(s) exactly like
 *     the trigger does. Docs sharing one storagePath are stamped together
 *     from a single generation (mirrors the trigger's multi-match stamp).
 *
 * Why direct generation instead of "touch the object to re-fire the trigger"
 * ──────────────────────────────────────────────────────────────────────────
 * A metadata-only touch does NOT re-fire onObjectFinalized — GCS emits
 * `metadataUpdated` for metadata writes; `finalized` only fires when a new
 * object GENERATION is created (upload / copy / rewrite). A self-rewrite of
 * every object would re-fire it, but that churns object generations, doubles
 * the Storage I/O (rewrite + trigger re-download), and silently depends on
 * the widened trigger being deployed first. Generating directly has none of
 * those failure modes, and the variant uploads this script performs land
 * under /_variants/ — which the deployed trigger's recursion guard skips —
 * so the script cannot re-fire the pipeline on its own output.
 *
 * SKIPPED on purpose
 *   • `/_variants/` and `/thumbs/` paths — pipeline outputs and
 *     photo-engine's client-generated thumbs are never variant sources.
 *   • d2d knock photos (photos/{uid}/d2d/...) — they have NO /photos doc
 *     by design (URLs live on the knock entry); wiring their variants up is
 *     a separate feature (see the 2026-08-16 session note). They keep
 *     counting under metrics/imagePipeline.noDocMatchedD2d.
 *
 * SAFETY
 *   • Dry-run by default — prints what WOULD change, writes nothing
 *     (dry-run is Firestore-read-only; it does not touch Storage).
 *   • --apply requires --yes as well. --limit N caps Phase B generation
 *     jobs for a canary run (e.g. --limit 5 --apply --yes).
 *   • Idempotent — docs with storagePath + complete urls +
 *     variantsGeneratedAt are skipped; safe to re-run. A re-run after a
 *     partial failure regenerates only what is still missing.
 *   • Owner-checked — a doc is only stamped when its userId matches the
 *     uid segment of the derived/stored path (DI-02 mirror).
 *   • Source objects that no longer exist (photo-editor save-over deletes
 *     the old object) are counted and skipped, never fabricated.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC, with
 * NODE_PATH pointed at a firebase-admin v12 install; sharp is reused from
 * functions/node_modules — run `cd functions && npm ci` once):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NODE_PATH=/path/to/fa12/node_modules    # firebase-admin@12
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *   export NBD_BUCKET=nobigdeal-pro.firebasestorage.app  # optional override
 *
 * RUN
 *   node scripts/backfill-photos-variants.js                          # dry-run
 *   node scripts/backfill-photos-variants.js --apply --yes --limit 5  # canary
 *   node scripts/backfill-photos-variants.js --apply --yes            # full run
 *
 * Run AFTER the widened pipeline (c39e4288) is deployed, so the trigger
 * covers fresh uploads while this sweeps the backlog. VERIFY: the script
 * prints metrics/imagePipeline before and after; over the following days
 * `noDocMatched` should stop climbing on organic uploads (only
 * `noDocMatchedD2d` keeps moving until d2d variants become a feature).
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i === -1) return Infinity;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
})();
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const BUCKET = process.env.NBD_BUCKET || 'nobigdeal-pro.firebasestorage.app';

const PAGE = 500;   // Firestore read page size
const BATCH = 400;  // Firestore batch write cap is 500; stay under it

// ── Pure helpers (exported for tests/smoke/photo.test.js) ──────────
// Zero deps above this line beyond Node built-ins: the smoke suite
// requires this module to unit-test these, so firebase-admin, sharp,
// and the pipeline spec are all loaded lazily inside main().

/**
 * Parse a Firebase Storage download URL into { bucket, path }.
 * getDownloadURL emits
 *   https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
 * Returns null for anything else (missing/odd values, other hosts, no /o/
 * segment, undecodable percent-encoding) — callers count those and skip.
 */
function storagePathFromUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  if (u.hostname !== 'firebasestorage.googleapis.com') return null;
  const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!m) return null;
  let objectPath;
  try { objectPath = decodeURIComponent(m[2]); } catch (_) { return null; }
  if (!objectPath) return null;
  return { bucket: m[1], path: objectPath };
}

/**
 * Mirror of the trigger's own source gates: returns a skip-reason string,
 * or null when the path is a legitimate variant source. Order and
 * semantics match functions/image-pipeline.js (substring guards included).
 */
function skipReasonForSource(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) return 'empty';
  if (!objectPath.startsWith('photos/')) return 'not-photos';
  if (objectPath.includes('/_variants/')) return 'variants-output';
  if (objectPath.includes('/thumbs/')) return 'client-thumb';
  if (objectPath.includes('/d2d/')) return 'd2d';
  const parts = objectPath.split('/');
  if (parts.length < 3) return 'too-shallow';
  if (!parts[1]) return 'empty-uid';
  return null;
}

/** Owner uid is ALWAYS path segment [1] (storage.rules contract). */
function uidFromPath(objectPath) {
  return String(objectPath || '').split('/')[1] || '';
}

/**
 * Variant destinations for a source object — EXACTLY the trigger's layout:
 * {sourceDir}/_variants/{base}_{name}.webp, extension stripped at the last
 * dot. `variants` is passed in (the pipeline's VARIANTS) to keep this pure.
 */
function variantDestinations(objectPath, variants) {
  const parts = objectPath.split('/');
  const filename = parts[parts.length - 1];
  const baseName = filename.replace(/\.[^.]+$/, '');
  const sourceDir = parts.slice(0, -1).join('/');
  return variants.map((v) => ({
    name: v.name,
    width: v.width,
    quality: v.quality,
    destination: `${sourceDir}/_variants/${baseName}_${v.name}.webp`,
  }));
}

// ── Runtime wiring ─────────────────────────────────────────────────

function init(admin) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT,
      storageBucket: BUCKET,
    });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

function loadSharp() {
  // sharp ships with functions/ (the pipeline's own dependency) — reuse
  // that install so the script encodes with the same build the trigger uses.
  try { return require(path.join(__dirname, '..', 'functions', 'node_modules', 'sharp')); } catch (_) {}
  try { return require('sharp'); } catch (_) {}
  console.error('sharp not found. Run `cd functions && npm ci` (sharp is a '
    + 'functions dependency), or point NODE_PATH at an install that has it.');
  process.exit(2);
}

async function printMetrics(db, label) {
  try {
    const snap = await db.doc('metrics/imagePipeline').get();
    if (!snap.exists) {
      console.log('metrics/imagePipeline (' + label + '): (doc missing)');
      return;
    }
    const m = snap.data() || {};
    const at = m.lastNoMatchAt && typeof m.lastNoMatchAt.toDate === 'function'
      ? m.lastNoMatchAt.toDate().toISOString() : String(m.lastNoMatchAt || '');
    console.log('metrics/imagePipeline (' + label + ')');
    console.log('  noDocMatched    : ' + (m.noDocMatched || 0) + '   (genuine orphans — should stop climbing post-deploy+backfill)');
    console.log('  noDocMatchedD2d : ' + (m.noDocMatchedD2d || 0) + '   (docless by design — keeps counting)');
    console.log('  lastNoMatchAt   : ' + at);
    console.log('  lastNoMatchPath : ' + (m.lastNoMatchPath || ''));
  } catch (e) {
    console.warn('! could not read metrics/imagePipeline — ' + e.message);
  }
}

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  // Lazy deps — keep the module top requirable with zero deps (smoke tests).
  const admin = require('firebase-admin');
  // Requiring functions/image-pipeline.js constructs its onObjectFinalized
  // trigger, and firebase-functions resolves the default bucket from
  // FIREBASE_CONFIG at that moment — absent in a plain admin-script env, so
  // the require would throw. Provide it (matching this run's target) before
  // the import; a no-op when the environment already sets it.
  if (!process.env.FIREBASE_CONFIG) {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, storageBucket: BUCKET });
  }
  const { VARIANTS, MAX_SOURCE_BYTES } = require('../functions/image-pipeline');
  const sharpLib = APPLY ? loadSharp() : null; // dry-run never encodes

  init(admin);
  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET);
  const FieldValue = admin.firestore.FieldValue;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill photos storagePath + WebP variants (§2.2)');
  console.log('  project : ' + PROJECT);
  console.log('  bucket  : ' + BUCKET);
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  if (LIMIT !== Infinity) console.log('  limit   : ' + LIMIT + ' generation jobs (canary)');
  console.log('═══════════════════════════════════════════════════════════\n');

  await printMetrics(db, 'BEFORE');
  console.log('');

  // ── Scan /photos once, classify every doc ────────────────────────
  let scanned = 0;
  let storagePathOk = 0;    // already carried storagePath
  let variantsOk = 0;       // already fully stamped (urls + variantsGeneratedAt)
  let urlUnparseable = 0;   // no storagePath and url not a Firebase download URL
  let foreignBucket = 0;    // url points at a bucket other than BUCKET
  let ownerMismatch = 0;    // path uid ≠ doc.userId (DI-02) — never stamped
  const skippedByReason = {}; // d2d / thumbs / _variants / not-photos / ...

  const stampJobs = [];               // { ref, id, sp } — Phase A
  const variantJobsByPath = new Map(); // sp → [ref] — Phase B (grouped like the trigger's multi-match stamp)

  let last = null;
  while (true) {
    let q = db.collection('photos').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};

      let sp = (typeof data.storagePath === 'string' && data.storagePath) ? data.storagePath : null;
      let needsStamp = false;
      if (!sp) {
        const parsed = storagePathFromUrl(data.url);
        if (!parsed) {
          urlUnparseable++;
          if (urlUnparseable <= 10) {
            console.log('  ? unparseable url on ' + doc.id + ': ' + JSON.stringify(data.url || null).slice(0, 120));
          }
          continue;
        }
        if (parsed.bucket !== BUCKET) {
          foreignBucket++;
          if (foreignBucket <= 10) console.log('  ? foreign bucket on ' + doc.id + ': ' + parsed.bucket);
          continue;
        }
        sp = parsed.path;
        needsStamp = true;
      }

      const reason = skipReasonForSource(sp);
      if (reason) {
        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
        continue;
      }

      if (uidFromPath(sp) !== data.userId) {
        ownerMismatch++;
        console.warn('  ! owner mismatch — NOT stamping ' + doc.id
          + ' (path uid ' + uidFromPath(sp) + ' ≠ doc userId ' + (data.userId || null) + ')');
        continue;
      }

      if (needsStamp) stampJobs.push({ ref: doc.ref, id: doc.id, sp });
      else storagePathOk++;

      const complete = data.urls && data.urls.thumb && data.urls.med && data.urls.full
        && data.variantsGeneratedAt;
      if (complete) {
        variantsOk++;
      } else {
        if (!variantJobsByPath.has(sp)) variantJobsByPath.set(sp, []);
        variantJobsByPath.get(sp).push(doc.ref);
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  // ── Phase A — stamp storagePath ──────────────────────────────────
  console.log('\nPhase A — storagePath repair: ' + stampJobs.length + ' doc(s) need it');
  let stamped = 0;
  let stampFailures = 0;
  if (!APPLY) {
    for (const j of stampJobs.slice(0, 20)) {
      console.log('  would set ' + j.id + '.storagePath = \'' + j.sp + '\'');
    }
    if (stampJobs.length > 20) console.log('  … and ' + (stampJobs.length - 20) + ' more');
  } else {
    let batch = db.batch();
    let batchCount = 0;
    const flush = async () => {
      if (batchCount === 0) return;
      try {
        await batch.commit();
        stamped += batchCount;
      } catch (e) {
        stampFailures += batchCount;
        console.warn('! batch commit failed — ' + e.message);
      }
      batch = db.batch();
      batchCount = 0;
    };
    for (const j of stampJobs) {
      batch.set(j.ref, { storagePath: j.sp }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH) await flush();
    }
    await flush();
    console.log('  stamped ' + stamped + ', failures ' + stampFailures);
  }

  // ── Phase B — generate variants + stamp docs ─────────────────────
  const allJobs = Array.from(variantJobsByPath.entries()); // [sp, [refs]]
  const jobs = allJobs.slice(0, LIMIT === Infinity ? allJobs.length : LIMIT);
  console.log('\nPhase B — variant generation: ' + allJobs.length + ' object(s) need variants'
    + (jobs.length < allJobs.length ? ' (processing ' + jobs.length + ' — --limit canary; the rest stays pending)' : ''));

  let generated = 0;
  let docsStamped = 0;
  let sourceMissing = 0;
  let sourceTooLarge = 0;
  let nonImage = 0;
  let genFailures = 0;

  if (!APPLY) {
    for (const [sp, refs] of jobs.slice(0, 20)) {
      console.log('  would generate ' + VARIANTS.map((v) => v.name).join('+')
        + ' for ' + sp + ' → ' + refs.length + ' doc(s)');
    }
    if (jobs.length > 20) console.log('  … and ' + (jobs.length - 20) + ' more');
  } else {
    let k = 0;
    for (const [sp, refs] of jobs) {
      k++;
      const tempFiles = [];
      try {
        const sourceFile = bucket.file(sp);
        const [exists] = await sourceFile.exists();
        if (!exists) {
          sourceMissing++;
          console.log('  - [' + k + '/' + jobs.length + '] source gone, skipping: ' + sp);
          continue;
        }
        const [meta] = await sourceFile.getMetadata();
        const sizeBytes = Number(meta.size || 0);
        if (sizeBytes > MAX_SOURCE_BYTES) {
          sourceTooLarge++;
          console.log('  - [' + k + '/' + jobs.length + '] over size cap (' + sizeBytes + ' B), skipping: ' + sp);
          continue;
        }
        const contentType = meta.contentType || '';
        if (contentType && !contentType.startsWith('image/')) {
          nonImage++;
          console.log('  - [' + k + '/' + jobs.length + '] not an image (' + contentType + '), skipping: ' + sp);
          continue;
        }

        const filename = sp.split('/').pop();
        const localSource = path.join(os.tmpdir(), 'bf_src_' + crypto.randomUUID() + '_' + filename);
        tempFiles.push(localSource);
        await sourceFile.download({ destination: localSource });

        // Same sharp chain, destination layout, and object metadata as the
        // trigger (functions/image-pipeline.js) — rotate → resize(no
        // enlargement) → webp, token + immutable cache + sourcePath.
        const urls = {};
        for (const v of variantDestinations(sp, VARIANTS)) {
          const localVariant = path.join(os.tmpdir(), 'bf_out_' + crypto.randomUUID() + '.webp');
          tempFiles.push(localVariant);

          await sharpLib(localSource)
            .rotate()
            .resize({ width: v.width, withoutEnlargement: true })
            .webp({ quality: v.quality })
            .toFile(localVariant);

          const downloadToken = crypto.randomUUID();
          await bucket.upload(localVariant, {
            destination: v.destination,
            resumable: false,
            metadata: {
              contentType: 'image/webp',
              cacheControl: 'public,max-age=31536000,immutable',
              metadata: {
                firebaseStorageDownloadTokens: downloadToken,
                sourcePath: sp,
                variantSize: v.name,
              },
            },
          });

          urls[v.name] = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET
            + '/o/' + encodeURIComponent(v.destination)
            + '?alt=media&token=' + downloadToken;
        }
        generated++;

        for (const ref of refs) {
          await ref.update({
            urls,
            variantsGeneratedAt: FieldValue.serverTimestamp(),
          });
          docsStamped++;
        }
        console.log('  ✓ [' + k + '/' + jobs.length + '] ' + sp + ' → ' + refs.length + ' doc(s)');
      } catch (e) {
        genFailures++;
        console.warn('  ! [' + k + '/' + jobs.length + '] failed for ' + sp + ' — ' + e.message);
      } finally {
        for (const p of tempFiles) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  scanned docs           : ' + scanned);
  console.log('  storagePath already set: ' + storagePathOk);
  console.log('  needed storagePath     : ' + stampJobs.length);
  console.log('  variants already ok    : ' + variantsOk);
  console.log('  needed variants        : ' + allJobs.length + ' object(s)');
  console.log('  url unparseable        : ' + urlUnparseable);
  console.log('  foreign bucket         : ' + foreignBucket);
  console.log('  owner mismatch (DI-02) : ' + ownerMismatch);
  for (const [reason, n] of Object.entries(skippedByReason)) {
    console.log(('  skipped (' + reason + ')').padEnd(25) + ': ' + n);
  }
  if (APPLY) {
    console.log('  storagePath stamped    : ' + stamped + ' (failures ' + stampFailures + ')');
    console.log('  variants generated     : ' + generated + ' object(s), ' + docsStamped + ' doc(s) stamped');
    console.log('  source missing         : ' + sourceMissing);
    console.log('  source too large       : ' + sourceTooLarge);
    console.log('  non-image source       : ' + nonImage);
    console.log('  generation failures    : ' + genFailures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write; add --limit 5 for a canary)');
  }
  console.log('───────────────────────────────────────────────────────────\n');

  if (APPLY) await printMetrics(db, 'AFTER');

  process.exit(stampFailures + genFailures > 0 ? 1 : 0);
}

module.exports = { storagePathFromUrl, skipReasonForSource, uidFromPath, variantDestinations };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
