/**
 * image-pipeline.js — Storage trigger that generates responsive
 * variants for every photo uploaded under `photos/{uid}/**`.
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
 *   1. Storage write under `photos/{uid}/...` fires this trigger.
 *      Every upload surface is owner-rooted at segment [1] but the
 *      depth varies (see the path-shape comment in the handler):
 *      customer page writes photos/{uid}/{filename}, the dashboard
 *      and photo-engine write photos/{uid}/{leadId}/..., D2D writes
 *      photos/{uid}/d2d/{knockId}/....
 *   2. Skip variants we generated ourselves (path contains
 *      `/_variants/`) so we don't recurse and bill ourselves
 *      forever, and photo-engine's client-generated `/thumbs/`
 *      copies (variants of a thumbnail are pure waste).
 *   3. Download the original to /tmp.
 *   4. Sharp pipeline: auto-orient via EXIF (`.rotate()`), resize
 *      (no enlargement — small images stay small), encode as WebP
 *      with quality tuned per variant.
 *   5. Upload three variants next to the source:
 *        `{sourceDir}/_variants/{base}_{thumb,med,full}.webp`
 *      (for the canonical customer-page shape that is
 *      `photos/{uid}/_variants/...`, unchanged from the original
 *      rollout). Deriving the destination from the full source dir —
 *      not just the basename — keeps same-named files in different
 *      leads/knocks from clobbering each other's variants.
 *      Each variant gets a random `firebaseStorageDownloadTokens`
 *      so the URL is long-lived without needing signed URLs.
 *   6. Stamp the doc of record:
 *      - Normal photos: the matching /photos doc (found by
 *        `storagePath` equality) gets `urls: { thumb, med, full }` +
 *        `variantsGeneratedAt`. customer.html renders `<img srcset>`
 *        from it — typically the 200px thumb for grid tiles, jumping
 *        to 1600px for lightbox/print.
 *      - D2D knock photos (path contains `/d2d/`): no /photos doc
 *        exists — the knocks entry is the doc of record. Found by
 *        array-contains on its `photoPaths` field (client-persisted,
 *        index-aligned with photoUrls, since 2026-08-17);
 *        `photoVariants[idx]` is transaction-stamped with the same
 *        {thumb,med,full} map. The d2d detail modal and prospect
 *        cards prefer photoVariants[i].thumb over the original.
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
 * Doc lookup uses `storagePath` (set by every /photos doc writer —
 * customer.html, dashboard _uploadPhoto, photo-engine, photo-editor;
 * see Photo typedef in docs/pro/js/types.js). If a photo doc lacks
 * `storagePath` (legacy docs), the trigger logs `no_doc_matched`
 * and exits cleanly — the variants still exist in Storage (with
 * `sourcePath` in their metadata) and a backfill migration can
 * stamp them later. D2D knock photos have no /photos doc; their
 * stamping goes to the knocks entry via photoPaths (see step 6).
 * Pre-feature knocks (uploaded before the client persisted
 * photoPaths, or from a stale cached bundle) have no join key and
 * count under the separate `noDocMatchedD2d` metrics key, keeping
 * the §2.2 genuine-orphan signal (`noDocMatched` +
 * `lastGenuineNoMatchAt/Path`, consumed by healthDigestCron) clean.
 */

const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');
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
    // Substring match, so it covers variants at any nesting depth.
    if (objectName.includes('/_variants/')) return;
    // photo-engine uploads its own client-generated 200px thumbnail
    // next to each original (photos/{uid}/{leadId}/thumbs/...).
    // Variants of a thumbnail are pure waste — skip them like our
    // own _variants output.
    if (objectName.includes('/thumbs/')) return;
    if (!contentType.startsWith('image/')) return;

    // Path shape: photos/{uid}/... — owner uid is ALWAYS segment
    // [1] (storage.rules matches photos/{uid}/{allPaths=**}), but
    // depth varies by upload surface:
    //   customer page  photos/{uid}/{custId}_{ts}_{name}      (3 seg)
    //   dashboard      photos/{uid}/{leadId}/{ts}_{name}      (4 seg)
    //   photo-engine   photos/{uid}/{leadId}/{ts}_{preset}.jpg (4 seg)
    //   photo-editor   photos/{uid}/{leadId}/photo_{id}.jpg   (3-4 seg)
    //   d2d tracker    photos/{uid}/d2d/{knockId}/{ts}_{name} (5 seg)
    // Accept any depth >= 3. (Until 2026-08 this required exactly 3
    // segments — written for the customer-page shape before the
    // nested surfaces existed — which silently skipped every nested
    // upload.) The legacy 2-segment `photos/{file}` form stays
    // excluded; Storage rules block it anyway.
    const parts = objectName.split('/');
    if (parts.length < 3) return;
    const uid = parts[1];
    if (!uid) return;
    const filename = parts[parts.length - 1];

    const sizeBytes = Number((object && object.size) || 0);
    if (sizeBytes > MAX_SOURCE_BYTES) {
      logger.warn('image_pipeline_source_too_large', { objectName, sizeBytes });
      return;
    }

    const bucketName = object.bucket;
    const bucket = getStorage().bucket(bucketName);
    const sourceFile = bucket.file(objectName);

    // Strip extension for the variant base name. We use the
    // original filename so backfill / debugging can correlate
    // variants to source by lexical match.
    const baseName = filename.replace(/\.[^.]+$/, '');

    // Variants land NEXT TO their source: {sourceDir}/_variants/....
    // For the canonical 3-segment shape that is photos/{uid}/_variants/
    // (unchanged from the original rollout); for nested shapes the
    // lead/knock segment stays in the key, so two same-named files in
    // different leads can't clobber each other's variants.
    const sourceDir = parts.slice(0, -1).join('/');

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

        const variantPath = `${sourceDir}/_variants/${variantBase}`;
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

    const db = getFirestore();

    // ── D2D knock photos: stamp the KNOCK doc, not /photos ──────────
    // Knock photos have no /photos doc — their doc of record is the
    // knocks entry, which (since 2026-08-17) persists each upload's
    // object path in `photoPaths` (index-aligned with photoUrls). The
    // path's {knockId} segment is a client tempId, not the doc id, so
    // the only join key is an array-contains lookup on the persisted
    // path. Stamping is a transaction because one knock's photos fire
    // N concurrent triggers that all rewrite the same photoVariants
    // array. Pre-feature knocks (no photoPaths) fall through to the
    // noDocMatchedD2d counter, same as before.
    if (objectName.includes('/d2d/')) {
      try {
        const snap = await db
          .collection('knocks')
          .where('photoPaths', 'array-contains', objectName)
          .limit(5)
          .get();

        let stampedDocs = 0;
        for (const doc of snap.docs) {
          // Owner-scope guard, mirroring the /photos DI-02 check: the
          // knocks create rule pins userId, but never stamp a queried
          // doc whose owner doesn't match the Storage path owner.
          if (doc.data().userId !== uid) {
            logger.warn('image_pipeline_knock_owner_mismatch_skipped', { objectName, uid, docOwner: doc.data().userId || null });
            continue;
          }
          const didStamp = await stampKnockVariant(db, doc.ref, objectName, generated);
          if (didStamp) stampedDocs++;
        }

        if (stampedDocs === 0) {
          logger.info('image_pipeline_no_doc_matched', { objectName, uid });
          // Docless-by-design counter (pre-feature knocks / stale client
          // bundles without photoPaths). Best-effort: a failed metrics
          // write must not break the trigger.
          try {
            await db.doc('metrics/imagePipeline').set({
              noDocMatchedD2d: FieldValue.increment(1),
              lastNoMatchAt:   FieldValue.serverTimestamp(),
              lastNoMatchPath: objectName,
              lastNoMatchUid:  uid,
            }, { merge: true });
          } catch (_) { /* metrics write is best-effort */ }
        } else {
          logger.info('image_pipeline_knock_variants_stamped', {
            objectName,
            uid,
            docs: stampedDocs,
          });
        }
      } catch (err) {
        logger.error('image_pipeline_knock_update_failed', {
          objectName,
          error: String(err),
        });
      }
      return;
    }

    // Stamp the photo doc. The upload code in customer.html writes
    // `storagePath` alongside the doc; we use that to find the
    // record without needing to crack the URL.
    try {
      const snap = await db
        .collection('photos')
        .where('storagePath', '==', objectName)
        .limit(5)
        .get();

      if (snap.empty) {
        logger.info('image_pipeline_no_doc_matched', { objectName, uid });
        // Bump a metrics counter so we know if this branch is hot
        // enough to warrant a backfill sweep (audit §2.2). Variants are
        // already in Storage at {sourceDir}/_variants/... with the
        // originating sourcePath in their metadata, so a backfill can
        // stamp them later. D2D paths never reach here (stamped or
        // counted in the knock branch above), so this counter measures
        // GENUINE orphans only — the healthDigestCron warning keys off
        // the lastGenuineNoMatch* fields below, which unlike the shared
        // lastNoMatch* pair are never touched by d2d noise.
        // Best-effort: a failed metrics write must not break the
        // trigger, so this is fire-and-forget with a swallowed catch.
        try {
          await db.doc('metrics/imagePipeline').set({
            noDocMatched:    FieldValue.increment(1),
            lastNoMatchAt:   FieldValue.serverTimestamp(),
            lastNoMatchPath: objectName,
            lastNoMatchUid:  uid,
            lastGenuineNoMatchAt:   FieldValue.serverTimestamp(),
            lastGenuineNoMatchPath: objectName,
          }, { merge: true });
        } catch (_) { /* metrics write is best-effort */ }
        return;
      }

      const writes = [];
      snap.forEach((doc) => {
        // Owner-scope: `uid` comes from the Storage object path
        // photos/{uid}/... (Storage-rule-owned, trustworthy), but
        // `storagePath` is a client-written Firestore field whose create
        // rule only pins userId — not storagePath. Without this guard a
        // user could pre-create a photo doc with someone else's storagePath
        // and have these variant URLs stamped onto another tenant's doc.
        // Skip any non-owned match. (DI-02, backend security audit 2026-06-24.)
        if (doc.data().userId !== uid) {
          logger.warn('image_pipeline_owner_mismatch_skipped', { objectName, uid, docOwner: doc.data().userId || null });
          return;
        }
        writes.push(
          doc.ref.update({
            urls: generated,
            variantsGeneratedAt: FieldValue.serverTimestamp(),
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

/**
 * Transaction-stamp photoVariants[idx] on a knock doc for one source
 * object, and mirror the whole array onto the converted lead when the
 * knock carries a leadId. Returns true only when a stamp was actually
 * written (the caller's noDocMatchedD2d metric must not be suppressed
 * by a no-op transaction — e.g. the doc vanished or the path was pulled
 * from photoPaths between query and transaction).
 *
 * The lead mirror closes the auto-convert race: convertToLead copies
 * photoVariants from the CLIENT's stale knock snapshot, which on the
 * hot-disposition auto path is always pre-stamp (empty). Mirroring at
 * stamp time reaches the lead regardless of conversion order. The
 * residual window — stamping between the convertedToLead flip and the
 * leadId write-back — self-heals on the next photo's stamp or the
 * onKnockCreated sweep, since the mirror rewrites the full array.
 */
async function stampKnockVariant(db, knockRef, objectName, urls) {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(knockRef);
    if (!fresh.exists) return false;
    const data = fresh.data() || {};
    const paths = Array.isArray(data.photoPaths) ? data.photoPaths : [];
    const idx = paths.indexOf(objectName);
    if (idx === -1) return false;

    const leadId = (typeof data.leadId === 'string' && data.leadId) ? data.leadId : null;
    const leadRef = leadId ? db.collection('leads').doc(leadId) : null;
    // All transaction reads must precede writes.
    const leadSnap = leadRef ? await tx.get(leadRef) : null;

    const count = Math.max(paths.length, Array.isArray(data.photoUrls) ? data.photoUrls.length : 0);
    const variants = Array.isArray(data.photoVariants) ? data.photoVariants.slice() : [];
    while (variants.length < count) variants.push(null);
    variants[idx] = urls;

    tx.update(knockRef, { photoVariants: variants, updatedAt: FieldValue.serverTimestamp() });
    if (leadSnap && leadSnap.exists) {
      // Lead photoUrls is a verbatim copy of the knock's (convertToLead
      // .slice()), so the index alignment carries over unchanged.
      tx.update(leadRef, { photoVariants: variants });
    }
    return true;
  });
}

// Reused by scripts/backfill-photos-variants.js (the §2.2 backfill) so the
// script's sharp encode spec and size cap can never drift from the
// trigger's. Invisible to deploy — functions/index.js re-exports only
// onPhotoUploaded, and the Firebase CLI reads the entry module's exports.
// ── Race-heal trigger: knock created AFTER its photos finished ─────
// The d2d client uploads every photo (and the voice memo) BEFORE
// addDoc creates the knock doc — on slow connections the earliest
// photos' onPhotoUploaded runs finish minutes before the doc exists,
// their knocks query misses, and (pre-2026-08-17) the variants were
// permanently orphaned under the docless-by-design metric. This
// trigger closes the race from the doc side: on knock create, any
// photoPaths entry whose variants ALREADY exist in Storage is stamped
// here — the download tokens are recoverable from the variant objects'
// own firebaseStorageDownloadTokens metadata, so the URLs rebuilt here
// are byte-identical to what the Storage trigger would have written.
// Whichever event fires last completes the join; both stamp through
// stampKnockVariant, so double-stamping is idempotent.
exports.onKnockCreated = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'knocks/{knockId}',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const paths = Array.isArray(data.photoPaths) ? data.photoPaths : [];
    if (!paths.length) return;

    const db = getFirestore();
    const bucket = getStorage().bucket();
    let healed = 0;

    for (const p of paths) {
      if (typeof p !== 'string' || !p.includes('/d2d/')) continue;
      // Owner guard (DI-02 mirror): photoPaths is a client-written,
      // rules-unconstrained field. Without this check, a knock doc
      // listing a VICTIM's object path would get the victim's variant
      // download tokens minted onto the attacker's doc.
      if (p.split('/')[1] !== data.userId) {
        logger.warn('image_pipeline_knock_create_owner_mismatch', { path: p, docOwner: data.userId || null });
        continue;
      }
      try {
        const parts = p.split('/');
        const baseName = parts[parts.length - 1].replace(/\.[^.]+$/, '');
        const sourceDir = parts.slice(0, -1).join('/');

        const urls = {};
        let complete = true;
        for (const v of VARIANTS) {
          const variantPath = `${sourceDir}/_variants/${baseName}_${v.name}.webp`;
          const file = bucket.file(variantPath);
          const [exists] = await file.exists();
          if (!exists) { complete = false; break; }
          const [meta] = await file.getMetadata();
          const tokens = meta && meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
          if (!tokens) { complete = false; break; }
          urls[v.name] =
            `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(variantPath)}` +
            `?alt=media&token=${String(tokens).split(',')[0]}`;
        }
        // Variants not (fully) there yet → the Storage trigger is still
        // running (or failed); it stamps on completion, nothing to heal.
        if (!complete) continue;

        if (await stampKnockVariant(db, snap.ref, p, urls)) healed++;
      } catch (err) {
        logger.warn('image_pipeline_knock_create_heal_failed', { path: p, error: String(err) });
      }
    }

    if (healed) {
      logger.info('image_pipeline_knock_create_healed', { knockId: event.params.knockId, healed });
    }
  }
);

exports.VARIANTS = VARIANTS;
exports.MAX_SOURCE_BYTES = MAX_SOURCE_BYTES;
