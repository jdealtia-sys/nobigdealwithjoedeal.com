/**
 * functions/lead-artifact-paths.js — pure path logic for the lead-artifact reaper.
 *
 * WHY THIS IS ITS OWN MODULE
 * ──────────────────────────
 * functions/index.js mounts the reaper with `Object.assign(exports, mod)`, so
 * EVERY export of lead-artifact-cleanup.js becomes part of the deployed Cloud
 * Functions surface — and a smoke assertion (rightly) fails on any export not
 * documented in FUNCTIONS_INDEX.md. Exporting these two helpers from there
 * just to unit-test them would put test scaffolding into the deploy index.
 *
 * They also have no business needing firebase-admin: they are string
 * manipulation with a security rule attached. Keeping them here means the
 * confinement check — the security boundary of the whole trigger — is
 * testable in plain Node with zero mocking, which is the difference between a
 * boundary that is checked and one that is merely asserted in a comment.
 *
 * No imports on purpose. Anything that needs a bucket or a Firestore handle
 * belongs in lead-artifact-cleanup.js, not here.
 */

'use strict';

// Variant suffixes written by image-pipeline.js next to every source image, at
// `{sourceDir}/_variants/{base}_{name}.webp`. Deliberately duplicated rather
// than imported: requiring image-pipeline.js evaluates its onObjectFinalized
// registration at module scope, which throws without FIREBASE_CONFIG and would
// make this module untestable in plain Node. tests/lead-photo-reaping.test.js
// pins these names against that file's source so the copy cannot drift — if
// someone adds an 'xl' variant, that test goes red rather than the reaper
// silently leaving one orphan per photo behind forever.
const VARIANT_SUFFIXES = ['thumb', 'med', 'full'];

/**
 * The variant objects image-pipeline.js writes beside a source image.
 *
 * Variants land at `{sourceDir}/_variants/{base}_{name}.webp`. For the flat
 * photo shape that directory is `photos/{uid}/_variants/` — SHARED by every
 * one of that uid's flat photos across all leads — so it can never be
 * prefix-deleted and each name has to be derived. Returns [] for anything
 * without a directory or a base name rather than guessing at one.
 *
 * @param {string} objectPath
 * @returns {string[]}
 */
function variantPathsFor(objectPath) {
  if (typeof objectPath !== 'string') return [];
  const slash = objectPath.lastIndexOf('/');
  if (slash === -1) return [];
  const dir = objectPath.slice(0, slash);
  const base = objectPath.slice(slash + 1).replace(/\.[^.]+$/, '');
  if (!dir || !base) return [];
  return VARIANT_SUFFIXES.map((v) => `${dir}/_variants/${base}_${v}.webp`);
}

/**
 * May the reaper delete `p` on behalf of the deleted lead?
 *
 * THE ATTACK THIS REFUSES: photo paths come off /photos docs, and those are
 * CLIENT-WRITTEN. If we trusted a photo doc's own userId, anyone could write a
 * photos doc naming a victim's object, hard-delete their own lead, and have
 * the trigger delete someone else's file using admin credentials. So the uid
 * set passed in must be resolved from the LEAD, never from the photo doc.
 *
 * D2D knock objects are refused outright: they belong to the knock's
 * lifecycle, not the lead's, and a converted knock must survive its lead.
 *
 * Fails closed — an un-reaped orphan costs a sweep, a wrongly-reaped object
 * costs a customer their photos.
 *
 * @param {string} p object path taken from a /photos doc
 * @param {Set<string>|string[]} ownerUids uids resolved from the LEAD
 * @returns {boolean}
 */
function isReapablePhotoPath(p, ownerUids) {
  if (typeof p !== 'string' || !p) return false;
  if (p.includes('/d2d/')) return false;
  for (const uid of ownerUids) {
    if (!uid) continue;
    if (p.startsWith(`photos/${uid}/`)) return true;
  }
  return false;
}

module.exports = { VARIANT_SUFFIXES, variantPathsFor, isReapablePhotoPath };
