/**
 * image-pipeline.js — Storage trigger that generates responsive
 * variants for every photo uploaded to `photos/{uid}/{filename}`.
 *
 * Why this exists
 * ───────────────
 * Joe shoots photos with an iPhone in the field. A single 4032×3024
 * iPhone JPEG is 3-5 MB. The customer overview strip and the phase
 * grid render dozens of these at thumbnail size. Pre-pipeline, every
 * tile downloaded the full original — meaning a customer with 80
 * photos pulled ~250 MB on a single dashboard load. On LTE in a
 * driveway, that's 30+ seconds of stalled UI before the page is
 * interactive. The bandwidth bill is the smaller concern; the
 * worse problem is that Joe can't move photos between phases until
 * the originals finish loading.
 *
 * Pipeline
 * ────────
 *   1. Storage write at `photos/{uid}/{filename}` fires this
 *      trigger.
 *   2. Skip variants we generated ourselves (path contains
 *      `/_variants/`) so we don't recurse and bill ourselves
 *      forever.
 *   3. Download the original to /tmp.
 *   4. Sharp pipeline: auto-orient via EXIF (`.rotate()`), resize
 *      (no enlargement — small images stay small), encode as WebP
 *      with quality tuned per variant.
 *   5. Upload three variants to
 *        `photos/{uid}/_variants/{base}_{thumb,med,full}.webp`
 *      with a random `firebaseStorageDownloadTokens` so the URL is
 *      long-lived without needing signed URLs.
 *   6. Stamp the matching Firestore photo doc with
 *        `urls: { thumb, med, full }` + `variantsGeneratedAt`.
 *      The customer.html render uses `<img srcset>` to pull the
 *      right size for the rendered cell — typically the 200px
 *      thumb for grid tiles, jumping to 1600px for lightbox/print.
 *
 * Sizes were chosen against the actual render code:
 *   - 200 px  → covers the phase-grid + overview-strip thumbnails
 *               (rendered ~150-180 px on 2x DPR phones).
 *   - 600 px  → covers the customer-overview hero + the photo
 *               carousel inline view.
 *   - 1600 px → lightbox + photo report PDF generation
 *               (still well under iPhone-12 sensor width, so we
 *               don't visibly downsample anything Joe captured).
 *
 * Idempotency
 * ───────────
 * Safe to invoke multiple times for the same path. Every upload
 * overwrites the variant at the same destination key; the doc
 * update is also a write-through. If a stale variant exists it is
 * replaced.
 *
 * Doc lookup uses `storagePath` (set by the upload code in
 * customer.html, see Photo typedef in docs/pro/js/types.js). If a
 * legacy photo doc lacks `storagePath`, the trigger logs
 * `no_doc_matched` and exits cleanly — the variants still exist
 * in Storage and a backfill migration can stamp them later.
 */

const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// sharp is loaded lazily so the rest of the functions deploy even
// when sharp's prebuilt binaries aren't available in the local env.
// In prod (Cloud Functions runtime), sharp is fully supported.
function loadSharp() {
  return require('sharp');
}

const VARIANTS = [
  { name: 'thumb', width: 200,  quality: 70 },
  { name: 'med',   width: 600,  quality: 78 },
  { name: 'full',  width: 1600, quality: 82 },
];

// Hard cap above which we refuse to process the source. Storage
// rules already cap photo writes at 15 MB; this is a defense-in-
// depth bound for any future rule loosening.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

exports.onPhotoUploaded = onObjectFinalized(
  {
    region: 'us-central1',
    memory: '1GiB',
    cpu: 1,
    timeoutSeconds: 120,
    // No bucket filter — we get the project default, which is what
    // Storage rules also target.
  },
  async (event) => {
    const object = event.data;
    const objectName = object && object.name;
    const contentType = (object && object.contentType) || '';

    if (!objectName) return;
    if (!objectName.startsWith('photos/')) return;
    // Recursion guard — we write variants back to Storage, which
    // would re-fire this trigger on each one without this check.
    if (objectName.includes('/_variants/')) return;
    if (!contentType.startsWith('image/')) return;

    // Path shape: photos/{uid}/{filename} — variants live one
    // level deeper at photos/{uid}/_variants/..., already filtered
    // above. Anything other than the canonical 3-segment shape is
    // either nested folders we don't recognize or the legacy
    // `photos/{file}` form (already blocked by Storage rules).
    const parts = objectName.split('/');
    if (parts.length !== 3) return;
    const uid = parts[1];
    const filename = parts[2];

    const sizeBytes = Number((object && object.size) || 0);
    if (sizeBytes > MAX_SOURCE_BYTES) {
      logger.warn('image_pipeline_source_too_large', { objectName, sizeBytes });
      return;
    }

    const bucketName = object.bucket;
    const bucket = admin.storage().bucket(bucketName);
    const sourceFile = bucket.file(objectName);

    // Strip extension for the variant base name. We use the
    // original filename so backfill / debugging can correlate
    // variants to source by lexical match.
    const baseName = filename.replace(/\.[^.]+$/, '');

    const localSource = path.join(
      os.tmpdir(),
      `src_${crypto.randomUUID()}_${filename}`
    );

    let sharpLib;
    try {
      sharpLib = loadSharp();
    } catch (err) {
      logger.error('image_pipeline_sharp_missing', { error: String(err) });
      return;
    }

    try {
      await sourceFile.download({ destination: localSource });
    } catch (err) {
      logger.error('image_pipeline_download_failed', {
        objectName,
        error: String(err),
      });
      try { fs.unlinkSync(localSource); } catch (_) {}
      return;
    }

    const generated = {};
    const tempFiles = [localSource];

    try {
      for (const v of VARIANTS) {
        const variantBase = `${baseName}_${v.name}.webp`;
        const localVariant = path.join(os.tmpdir(), `out_${crypto.randomUUID()}_${variantBase}`);
        tempFiles.push(localVariant);

        await sharpLib(localSource)
          .rotate() // auto-orient via EXIF before resize
          .resize({ width: v.width, withoutEnlargement: true })
          .webp({ quality: v.quality })
          .toFile(localVariant);

        const variantPath = `photos/${uid}/_variants/${variantBase}`;
        const downloadToken = crypto.randomUUID();

        await bucket.upload(localVariant, {
          destination: variantPath,
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              sourcePath: objectName,
              variantSize: v.name,
            },
          },
        });

        const encodedPath = encodeURIComponent(variantPath);
        generated[v.name] =
          `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}` +
          `?alt=media&token=${downloadToken}`;
      }
    } catch (err) {
      logger.error('image_pipeline_variant_failed', {
        objectName,
        error: String(err),
      });
      // Don't update the doc on partial failure — clients keep
      // rendering from `url` and a re-upload (or a backfill) will
      // fix it.
      cleanupTempFiles(tempFiles);
      return;
    }

    cleanupTempFiles(tempFiles);

    // Stamp the photo doc. The upload code in customer.html writes
    // `storagePath` alongside the doc; we use that to find the
    // record without needing to crack the URL.
    const db = admin.firestore();
    try {
      const snap = await db
        .collection('photos')
        .where('storagePath', '==', objectName)
        .limit(5)
        .get();

      if (snap.empty) {
        logger.info('image_pipeline_no_doc_matched', { objectName, uid });
        return;
      }

      const writes = [];
      snap.forEach((doc) => {
        writes.push(
          doc.ref.update({
            urls: generated,
            variantsGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        );
      });
      await Promise.all(writes);

      logger.info('image_pipeline_variants_stamped', {
        objectName,
        uid,
        docs: snap.size,
      });
    } catch (err) {
      logger.error('image_pipeline_doc_update_failed', {
        objectName,
        error: String(err),
      });
    }
  }
);

function cleanupTempFiles(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
}
