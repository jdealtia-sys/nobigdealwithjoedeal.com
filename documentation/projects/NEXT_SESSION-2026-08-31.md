# Next session — brief as of 2026-08-31 (power session close)

> Read this first. Full session record:
> [SESSION-2026-08-31-sweep-rocks-and-four-cards](SESSION-2026-08-31-sweep-rocks-and-four-cards.md).

## State of the world

- **/our-work: 43 live projects, 36 priced** (was 39/34). New: Kalb
  (Loveland, siding-repair — the first siding card since the strip gap
  analysis), Wilson (Loveland, storm/repair), Garrity (Loveland,
  **first flat-roof/EPDM card**), By Golly's (Milford, commercial,
  $73–74k, business named with Jo's approval).
- **Every PR from this session is merged**: #1301/#1302 (deps), #1303
  (Rock 2 telemetry), #1304 (Rock 4 Tranche 3 plan), #1305 (four cards).
  Verify the #1305 deploy went green and the four slugs render live if
  that wasn't confirmed before close.
- The weekly agent sweep is DONE for the week of 08-31 (all gates green,
  no rot, dependabot cleared).

## The lanes, in priority order

1. **Rock 2 — the 30-day clock is finally real.** Deprecation warns now
   reach Sentry as events (#1303, deployed 2026-08-31). The wizard-deletion
   gate = zero `startNewEstimateOriginal` warns in Sentry → Issues through
   ~2026-09-30. Two Jo decisions still needed before deletion: pre-V2
   stored docs (migrate vs read-only) and the `dashboard.legacy.html`
   rollback-snapshot refresh. Weekly check is one Sentry search.
2. **Rock 4 — execute the Tranche 3 plan**:
   [globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md).
   Start with T3-0 (zone-draw shim unwind at `maps.js:464-468` +
   `damagNearMe` dedup), then T3-A slice 1 (dashboard-actions.js's 33
   mechanically-safe names). Census re-runs via `scripts/globals-xref.js`.
3. **The posting session Jo planned** — GBP + Facebook, per-platform, with
   all 43 cards to draw from. Kit: [gbp-post-kit-2026-08-28](../marketing/gbp-post-kit-2026-08-28.md)
   + 4 posters. STILL deliberately unposted. Add the six Central-KY towns
   to the GBP service area BEFORE the Lexington post.
4. **Housekeeping**: draft PR #1299 (INDEX handoff consolidation) is
   OPEN and now needs a rebase over this session's INDEX edits — finish
   it or close it, don't let it rot.

## Held content (Jo's calls, no agent action)

- **Philpot TAMKO sample pull** — publishable evidence is complete
  ($400 receipt, Loveland, EXIF-confirmed) but brand-sensitive against
  the Pro Gold partnership. Jo decides.
- **Sharon Batavia gutter frames** — five clean frames staged (08-28
  session scratchpad); good generic illustration for the thin gutter
  service page; NEVER with a completion date (it was an estimate walk).
- **Siding-replacement strip is still empty and unfillable from Drive**
  (settled 08-28 — do not re-run the search). Live path: the Southman
  proposal (NBD-2026-0811-STH Option B, $4,600) — if Jo closes it,
  document as it happens.

## Watch-outs

- The 08-28 session scratchpad
  (`…\Temp\claude\C--Users-jonat-nobigdealwithjoedeal-com\966f9031-…\scratchpad`)
  still holds all staged photo sets + the round6/round7 JSON fact records.
  Windows temp is not forever — anything still-wanted should be pulled to
  Drive or published before it evaporates.
- Wilson town doctrine: when a job folder has no town, check the ERA'S
  CUSTOMER BOOK in Drive (street → ZIP → mailing town). Details in the
  session note's techniques section.
