/**
 * functions/lead-artifact-cleanup.js — reap a deleted lead's Storage artifacts.
 *
 * THE BUG THIS CLOSES (found 2026-08-18)
 * ──────────────────────────────────────
 * Hard-deleting a lead (`window._permanentDeleteLead` →
 * `deleteDoc(doc(db,'leads',id))`) removes the Firestore doc and nothing else.
 * Firestore does not cascade to subcollections, and it has never touched
 * Storage. So every baked HTML artifact the lead accumulated survived:
 *
 *     portals/{uid}/{leadId}/v-<ts>.html      legacy customer portal
 *     portals/{uid}/{leadId}-photos.html      legacy photo portal
 *     documents/{uid}/{leadId}/d-*.html       generated + signed documents
 *     galleries/{uid}/{leadId}.html           retired share-gallery
 *     audio/{uid}/{leadId}/*                  call recordings
 *
 * Each was uploaded through the client SDK, which stamps a
 * `firebaseStorageDownloadTokens` value on the object. That token URL bypasses
 * Storage Security Rules, never expires, and has no revocation path — so the
 * artifact stayed fetchable by anyone holding the link *forever*, while the
 * only record that it existed (the lead doc) was gone. Deleting the lead
 * destroyed the pointer, not the data.
 *
 * A prod sweep found 10 such orphans across portals/, documents/ and
 * galleries/ belonging to two deleted leads. scripts/purge-legacy-storage-
 * portals.js could not see them: its discovery is lead-driven and it skips
 * `if (!leadSnap.exists)`, which is precisely the orphan case.
 *
 * WHAT THIS DOES
 * ──────────────
 * onDocumentDeleted('leads/{leadId}') → delete every leadId-keyed Storage
 * prefix for the owning uid, drop the orphaned `documents` subcollection (and
 * any Storage object its htmlPath points at, which covers older path shapes
 * the deterministic prefixes miss), and revoke the lead's outstanding portal /
 * doc-sign tokens.
 *
 * NOT covered here, deliberately:
 *   - photos/{uid}/... is flat per-uid, not leadId-keyed, so it cannot be
 *     reaped by prefix. Photo objects are reachable only through signImageUrl
 *     (15-min v4 signed URL, no permanent token), so an orphan there is not
 *     publicly fetchable. Reaping them needs a photos-collection query by
 *     leadId — separate change, tracked in the sweep script's report.
 *   - Soft delete (`deleted: true`) does NOT fire this. That is the trash bin;
 *     the lead is restorable and its artifacts must survive.
 *
 * Idempotent and best-effort throughout: a missing object, a missing
 * subcollection, or an unresolvable uid must never leave the function retrying
 * against data that is already gone.
 */

'use strict';

const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

// Every Storage prefix whose path shape embeds the leadId. Kept in one place
// so a new leadId-keyed prefix is one line here rather than a fresh orphan
// class discovered years later. `flat` covers the pre-versioning shapes that
// wrote a single object at {prefix}/{uid}/{leadId}<suffix> instead of a
// directory — collectPaths() in scripts/purge-legacy-storage-portals.js
// documents where those came from.
const LEAD_KEYED_PREFIXES = [
  { prefix: 'documents', flat: [] },
  { prefix: 'portals', flat: ['.html', '-photos.html'] },
  { prefix: 'galleries', flat: ['.html', '-photos.html'] },
  { prefix: 'audio', flat: [] },
];

// Token collections that carry a leadId. A live token pointing at a deleted
// lead is the same leak class as an orphaned object: it grants a no-login
// stranger a page built from a customer record nobody can see anymore.
const LEAD_TOKEN_COLLECTIONS = ['portal_tokens', 'doc_sign_tokens'];

/**
 * Resolve the owning uid(s) for a deleted lead.
 *
 * Normally just `lead.userId`. But a lead doc that was written before the
 * ownership backfill — or corrupted — may lack it, and that is exactly the
 * lead whose artifacts nobody will ever look for again. Fall back to the uids
 * recorded on the documents subcollection, then to the uid embedded in any
 * htmlPath, so a missing userId degrades to a narrower sweep instead of none.
 *
 * @returns {Set<string>}
 */
function resolveOwnerUids(lead, docSnaps) {
  const uids = new Set();
  if (lead && typeof lead.userId === 'string' && lead.userId) uids.add(lead.userId);
  for (const d of docSnaps) {
    const m = d.data() || {};
    if (typeof m.userId === 'string' && m.userId) uids.add(m.userId);
    // documents/{uid}/{leadId}/{docId}.html — segment 1 is the owner.
    if (typeof m.htmlPath === 'string') {
      const parts = m.htmlPath.split('/');
      if (parts.length >= 3 && parts[1]) uids.add(parts[1]);
    }
  }
  return uids;
}

exports.onLeadDeleted = onDocumentDeleted(
  {
    document: 'leads/{leadId}',
    region: 'us-central1',
    // Prefix deletes fan out one HTTP call per object. A lead with a long
    // portal history plus a few hours of call audio is still well inside this.
    timeoutSeconds: 300,
    memory: '256MiB',
    retry: false,
  },
  async (event) => {
    const leadId = event.params.leadId;
    // Client-side test leads are prefixed 'd-' and never hit Firestore, but a
    // guard here costs nothing and keeps the log clean.
    if (!leadId || leadId.startsWith('d-')) return;

    const lead = (event.data && typeof event.data.data === 'function')
      ? (event.data.data() || {})
      : {};

    const db = getFirestore();
    const bucket = getStorage().bucket();

    let objectsDeleted = 0;
    let docsDeleted = 0;
    let tokensRevoked = 0;
    const failures = [];

    // ── 1. The orphaned documents subcollection ────────────────────
    // Read it BEFORE deleting anything: its htmlPath values are the only
    // record of objects that sit at path shapes the deterministic prefixes
    // below do not match (the prod sweep found two such objects).
    let docSnaps = [];
    try {
      const snap = await db.collection(`leads/${leadId}/documents`).limit(500).get();
      docSnaps = snap.docs;
    } catch (e) {
      failures.push(`documents read: ${e.message}`);
    }

    const ownerUids = resolveOwnerUids(lead, docSnaps);
    if (!ownerUids.size) {
      // Nothing to scope a prefix delete to. Loud, because it means artifacts
      // may have survived and only the bucket-wide sweep script can find them.
      logger.error('[onLeadDeleted] no owner uid resolvable — Storage NOT swept', {
        leadId, documentsFound: docSnaps.length,
      });
    }

    // Delete the objects those metadata docs point at, then the docs.
    for (const d of docSnaps) {
      const meta = d.data() || {};
      for (const p of [meta.htmlPath, meta.archivePath]) {
        if (!p || typeof p !== 'string') continue;
        try {
          await bucket.file(p).delete({ ignoreNotFound: true });
          objectsDeleted++;
        } catch (e) {
          failures.push(`object ${p}: ${e.message}`);
        }
      }
      try {
        await d.ref.delete();
        docsDeleted++;
      } catch (e) {
        failures.push(`doc ${d.id}: ${e.message}`);
      }
    }

    // ── 2. Deterministic leadId-keyed Storage prefixes ─────────────
    for (const uid of ownerUids) {
      for (const { prefix, flat } of LEAD_KEYED_PREFIXES) {
        // Directory shape: {prefix}/{uid}/{leadId}/...
        // The trailing slash matters — without it, leadId 'abc' would also
        // match a sibling lead 'abcdef'.
        //
        // getFiles + per-object delete rather than bucket.deleteFiles(): the
        // latter resolves to `undefined` (Promise<void>), so destructuring a
        // count out of it throws — and the throw would land in the catch
        // below, silently reporting a failure while deleting nothing. Listing
        // first also gives an honest count and names each object in the log,
        // which is what makes a partial sweep visible.
        try {
          const [files] = await bucket.getFiles({ prefix: `${prefix}/${uid}/${leadId}/` });
          for (const f of files) {
            try {
              await f.delete({ ignoreNotFound: true });
              objectsDeleted++;
            } catch (e) {
              failures.push(`object ${f.name}: ${e.message}`);
            }
          }
        } catch (e) {
          failures.push(`prefix ${prefix}/${uid}/${leadId}/: ${e.message}`);
        }
        // Flat legacy shapes: {prefix}/{uid}/{leadId}.html etc.
        for (const suffix of flat) {
          const p = `${prefix}/${uid}/${leadId}${suffix}`;
          try {
            await bucket.file(p).delete({ ignoreNotFound: true });
            objectsDeleted++;
          } catch (e) {
            failures.push(`object ${p}: ${e.message}`);
          }
        }
      }
    }

    // ── 3. Outstanding tokens ──────────────────────────────────────
    for (const coll of LEAD_TOKEN_COLLECTIONS) {
      try {
        const snap = await db.collection(coll).where('leadId', '==', leadId).limit(200).get();
        for (const t of snap.docs) {
          await t.ref.delete();
          tokensRevoked++;
        }
      } catch (e) {
        failures.push(`${coll}: ${e.message}`);
      }
    }

    const summary = {
      leadId,
      ownerUids: [...ownerUids],
      objectsDeleted,
      docsDeleted,
      tokensRevoked,
      failures: failures.length,
    };
    if (failures.length) {
      // Best-effort by design, but a silent partial sweep is how the original
      // orphans went unnoticed for months — surface every failure.
      logger.error('[onLeadDeleted] partial sweep', { ...summary, detail: failures.slice(0, 20) });
    } else {
      logger.info('[onLeadDeleted] swept', summary);
    }
  }
);
