# Session 2026-08-17 — photos follow-ups: d2d variants, digest watch, legacy sweep

**Context:** the three deliberate leftovers from
[SESSION-2026-08-17-deploy-list-drift-and-verification](SESSION-2026-08-17-deploy-list-drift-and-verification.md),
all picked up on Jo's go. Recon + adversarial review ran as multi-agent
workflows; the review confirmed 5 real bugs in the first draft, all fixed
before shipping (see "Review findings" below — two are subtle race classes
worth knowing about).

## Lane 1 — d2d knock photos get variants (feature)

Variants for d2d paths were ALREADY generated since the nested-shapes fix —
only the stamping dead-ended (knock photos have no /photos doc). Design:

- **Client** (`d2d-tracker-core/ui`): `uploadPhotos` now also collects the
  storage object paths; the knock doc persists `photoPaths` (index-aligned
  with `photoUrls`). The path is the only join key — the `{knockId}` path
  segment is a client tempId, NOT the Firestore doc id.
- **Pipeline** (`functions/image-pipeline.js`): `/d2d/` sources query
  `knocks` by `array-contains` on `photoPaths` (owner-guarded, DI-02
  mirror) and transaction-stamp `photoVariants[idx]` — a per-photo
  `{thumb,med,full}` map, additive so all six `photoUrls` consumers keep
  working. Pre-feature knocks keep counting under `noDocMatchedD2d`.
- **Renderers**: d2d detail modal + prospect cards prefer
  `photoVariants[i].thumb` (80-90px tiles were pulling multi-MB
  originals); the lightbox keeps the original.
- **Conversion**: `convertToLead` copies `photoPaths`/`photoVariants`
  alongside `photoUrls`.

## Lane 2 — healthDigestCron watches the pipeline

- Pipeline stamps `lastGenuineNoMatchAt/Path` ONLY on non-d2d no-matches
  (the shared `lastNoMatch*` pair mixes in d2d noise).
- New digest section (between Activity and the footer) + subject suffix
  `⚠ pipeline orphan` when a genuine orphan occurred inside the 24h
  window — lifetime counters never reset, so recency comes from the
  timestamp, not a baseline diff. Interpolated storage paths are
  HTML-escaped (`escHtml`); gatherer failure degrades to safe zeros.

## Lane 3 — legacy 2-segment sweep (`--include-legacy`)

Prod survey first: all 39 docs carry `userId` (ONE owner — Jo), all have
`leadId`, every Storage object exists (29 png / 10 jpeg), dated
2026-04-09→10. The flag: opt-in param on `skipReasonForSource` (default
byte-identical), ownership = doc `userId` + `createdAt < 2026-04-11`
cutoff, `[legacy]`-prefixed dry-run lines + distinct-owner printout,
basename-collision refusal (all legacy variants share one
`photos/_variants/` dir). Deployed trigger's substring recursion guard
covers that dir; the trigger itself still excludes 2-segment paths — the
flag is backfill-only.

## Review findings (adversarial workflow; 8 confirmed → 5 distinct, all fixed)

1. **Upload-before-addDoc race (the big one).** The d2d client uploads all
   photos + the voice memo BEFORE `addDoc` creates the knock — on LTE the
   first photo's trigger can run tens of seconds before the doc exists,
   miss the query, get miscounted as docless-by-design, with NO recovery
   path. Fix: **`onKnockCreated`** (new Firestore trigger, wired in
   index.js + FUNCTIONS_INDEX): on knock create, any `photoPaths` entry
   whose variants already exist is stamped — download tokens are
   recoverable from the variant objects' own
   `firebaseStorageDownloadTokens` metadata, so rebuilt urls are identical
   to what the Storage trigger writes. Whichever event fires last
   completes the join; both go through `stampKnockVariant` (idempotent).
   Owner-guarded: `photoPaths` is client-written and rules-unconstrained,
   so a doc listing a victim's path must never receive their tokens.
2. **Auto-convert stale copy.** Hot-disposition knocks auto-convert ~1s
   after `addDoc`, copying `photoVariants` from the client's STALE
   snapshot — always `[]` on the primary path. Fix: the stamp transaction
   mirrors the full array onto `leads/{knock.leadId}` when present.
3. **One-directional version-skew.** `{urls, paths}` object return +
   stale cached UI (SW mixed bundles) would persist a MAP into
   `knock.photoUrls`, breaking six consumers. Fix: return an ARRAY
   carrying a `paths` property — Firestore silently drops non-index array
   props, so every mixed pairing degrades to "no variants" instead of
   corrupt data. Smoke-pinned as a contract.
4. **Cross-run legacy collision.** Pending-only dedup missed clobber
   against docs completed in an earlier (e.g. `--limit` canary) run —
   overwriting invalidates the tokens already stamped into their urls.
   Fix: collision check runs against ALL accepted legacy docs.
5. **Phantom stamps.** No-op transactions (doc vanished / path removed
   between query and tx) counted as stamped, suppressing the metric. Fix:
   the transaction returns whether it wrote.

## Tests / gates

Three new smoke sections (d2d end-to-end, digest watch, legacy flag) with
the race/skew/collision fixes pinned as contracts; full suite 3404 ✓;
syntax/inline/integrity clean; `functions/index.js` loads with all three
exports.

## Run/verify state

See the PR + follow-up entries in this note's future updates for: deploy
verification (per-function lines), the `--include-legacy` apply run, and
the prod d2d probe.
