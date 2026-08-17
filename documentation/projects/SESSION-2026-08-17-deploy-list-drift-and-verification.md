# Session 2026-08-17 — deploy-list drift: Storage triggers never auto-deployed; prod verification of the photos pipeline

**Context:** follow-through on
[SESSION-2026-08-16-image-pipeline-nested-shapes](SESSION-2026-08-16-image-pipeline-nested-shapes.md)
(PR #1206, merged `75c3740d`) and
[SESSION-2026-08-16-photos-variants-backfill](SESSION-2026-08-16-photos-variants-backfill.md).
This session tried to ship #1206 to prod and found the auto-deploy had a
false-green failure mode; fixed it (PR #1210), verified the deploy at the
revision level, confirmed backfill convergence, and live-probed the trigger
end-to-end in prod.

## The deploy-list drift (the load-bearing finding)

`#1206`'s merge triggered a **green** `firebase-deploy.yml` run
(31983728976) that never deployed `onPhotoUploaded` — the log contains no
`functions[onPhotoUploaded(...)]` line at all. Green run ≠ function
deployed.

**Root cause:** the strict deploy step builds its `--only functions:...`
list by grepping `exports.*=` for a **fixed alternation of trigger wrapper
names** (`onRequest|onCall|onSchedule|onDocument*|...`). The alternation
was written 2026-04-14 (`80937b1a`) — twelve days before the repo's first
Storage-trigger export existed (`onPhotoUploaded`, `bbf54aff` 2026-04-26).
`onObjectFinalized` was never added, so **every function exported through
it was silently excluded from every auto-deploy since**. Same drift
pattern as the pipeline bug itself: a fixed list written before the thing
it needed to include existed.

**Blast radius:**

- `onPhotoUploaded` (image pipeline) — existed in prod from a manual
  deploy, but **merged changes to it never shipped via CI** (e.g.
  `f812c50e` 2026-07-05, the firebase-admin v14 prep that touched
  image-pipeline.js, only reached prod with this session's deploy).
- `onAudioUploaded` (voice-intelligence Storage trigger) — the fix deploy
  logged **`Successful create operation`**, meaning the function had
  **never existed in prod at all**. Server-side processing of
  `audio/{uid}/...` uploads went live for the FIRST time
  2026-08-17T01:32Z. If D2D voice memos / Voice Intelligence recordings
  start producing output where they silently didn't, this is why. Recorded
  on PR #1210 as well.

**Fix (PR #1210, one word + a warning comment):** `onObjectFinalized`
added to the alternation; discovery now finds **167** functions (was 165,
missing exactly the two above). The comment warns that any future v2
wrapper type (`onMessagePublished`, `onValueWritten`, …) must be added or
its functions won't deploy — the alternation is a hand-maintained list and
this is its second drift casualty.

## Deploy verification (revision-level, not run-level)

Lesson applied: a green run is not evidence for a specific function.
Verified three independent ways:

1. Run 31984395299 log: `functions[onPhotoUploaded(us-central1)]
   Successful update operation` + `functions[onAudioUploaded(us-central1)]
   Successful create operation`.
2. `firebase functions:list --project nobigdeal-pro`: both present as v2
   `google.cloud.storage.object.v1.finalized` triggers.
3. `gcloud functions describe onPhotoUploaded --gen2`: `updateTime
   2026-08-17T01:32:19Z`, state `ACTIVE` — matches the deploy to the
   second; that deploy built from main containing the #1206 pipeline.

## Backfill convergence (read-only re-run, 2026-08-17)

The §2.2 apply had already been executed on Jo's machine after the
backfill note was written. An idempotent **dry-run re-run** (this session)
confirms convergence — effectively the post-apply verification:

- 111 `/photos` docs scanned; **71 fully stamped** (storagePath + complete
  `urls` + `variantsGeneratedAt`) — the earlier dry-run's 70-object
  backlog plus the 1 already-complete doc, all converged.
- Phase A: **0** docs need storagePath. Phase B: **0** objects need
  variants. 0 owner mismatches, 0 foreign buckets.
- Known deliberate exclusions unchanged: 39 legacy 2-segment
  `photos/{file}` docs (pre-2026-04-11 rules hardening; Jo's call, leave
  recommended) and 1 homeowner-portal upload (not a `photos/` object).
- `metrics/imagePipeline` still absent in prod — expected: it only
  materializes when a no-match fires, and nothing has hit that branch yet.
  Watch: `noDocMatched` staying flat on organic uploads = wiring holds;
  `noDocMatchedD2d` climbing is normal until d2d variants become a feature.

## Live prod probe (end-to-end, 2026-08-17T13:14Z)

Admin-SDK probe wrote the **exact dashboard `_uploadPhoto` shape** under a
synthetic uid (`probe-stamp-check-*` — no real user data): `/photos` doc
first (storagePath included, so the trigger's lookup can't race into a
no-match), then a real 640×480 JPEG to
`photos/{uid}/{leadId}/{ts}_probe.jpg`.

- Deployed trigger stamped the doc **~5 seconds** after upload:
  `variantsGeneratedAt` + tokenized `urls.{thumb,med,full}`.
- All three variant objects physically exist at the **nested**
  `{sourceDir}/_variants/` layout — the collision-safe source-dir
  derivation confirmed in prod, not just tests.
- Probe cleaned up everything it created (doc + original + 3 variants);
  prod state unchanged.
- (Probe-authoring gotcha for future scripts: download URLs percent-encode
  the object path, so substring checks for `/_variants/` must test the
  DECODED path or `%2F_variants%2F`.)

## State of the whole photos-variants lane (closed)

pipeline widened (#1206) → actually deployed (#1210 + run 31984395299) →
backlog backfilled (71/71) → live-verified with a dashboard-shape upload.
Open threads are the deliberate ones only: 39 legacy 2-segment docs
(decision: Jo), d2d variant wiring (separate feature), and a few-days
watch on `metrics/imagePipeline`.
