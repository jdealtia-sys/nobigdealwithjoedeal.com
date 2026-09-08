# Our Work pricing/identification recon — 2026-09-08

> Jo asked for a review of `/our-work` (sorting, tags, pricing) and to fold
> newly-added drone photos into the site and the post queue. Before touching
> any dollar figure or publishing anything new, an 8-agent workflow tried to
> **identify** the jobs behind the 7 unpriced projects and a fresh raw
> drone-photo drop, using EXIF GPS + the CRM `leads` collection — the same
> technique from [SESSION-2026-08-28](../projects/SESSION-2026-08-28-ourwork-areas-galleries-gbp.md)
> (see [[gps-crm-matching-unattributed-jobs]] in memory). **Result: nothing
> was confidently identified, so nothing was priced and no new Our Work entry
> was created from this recon.** That's a real finding, not a stall — see
> §1 for why the data structurally can't answer this, and §4 for what would
> actually close it.

## §0 — Method

Two reusable, dependency-free Node scripts (no `exiftool`/PIL available in
this sandbox, so a minimal JPEG EXIF parser was written and verified against
a real DJI file first):

- `exif-gps.js` — parses JPEG APP1/EXIF segments for GPS lat/lng + capture
  `dateTime` from a raw file.
- A local dump of the `leads` Firestore collection (235 docs, `id`, `name`,
  `address`, `lat`/`lng`, `jobValue`, `stage`, `jobType`, `scopeOfWork`,
  `damageType`, `createdAt`, …) via `functions/`'s `firebase-admin` + ADC
  (read-only; `scripts/_admin.js`'s existing pattern).
- Haversine matching, with an explicit **<150m = trustworthy** bar. Below
  that, many leads share a suspiciously identical ~2–3km distance across
  wildly different ZIP codes — a **ZIP-centroid geocode artifact**, not a
  real address match, and every agent was told to discard it rather than
  report it as "near."

8 agents ran in parallel: one per unpriced slug, one for the new drone
folder (which turned out to hold two separate same-day flights, handled as
independent findings). Full transcript: `wf_00426f12-607` journal, this
session.

## §1 — The structural wall: the CRM export only goes back to 2026-02-14

Every one of the 235 leads in the dump has `createdAt` between
**2026-02-14 and 2026-09-08**. There is not one 2023, 2024, or 2025 record.
Four of the seven unpriced projects are dated 2023 or 2024
(`valley-flashing-detail` 2024-05, `aframe-standing-seam-metal` 2026-03 —
photo predates CRM but no TN footprint at all, `cincinnati-oh-plank-deck-bungalow-2024`,
`loveland-oh-single-day-replacement-2024`, `loveland-oh-wind-repair-2023`).
**No GPS fix, however precise, can find a job in a CRM export that doesn't
cover the year the job happened.** This is independent of and more
fundamental than the distance-matching question — worth knowing before the
next session reaches for this same technique on an older job.

## §2 — Per-project findings

| Project | Original photo found? | GPS | Best CRM candidate | Distance | Confidence | Priced? |
|---|---|---|---|---|---|---|
| `hail-impact-chalk-marked` | Yes (Photo Library, non-slug filename) | 39.3508,-84.3848 (2025-09-29) | Kevin Murphy, West Chester — hail/insurance/paid $22,100 | 2,002 m | **low** | No |
| `valley-flashing-detail` | Yes | 39.3763,-84.3327 (2024-05-08) | — none; nearest Maineville lead is 11.8 km and wrong job type | 11,774 m | **none** | No |
| `aframe-standing-seam-metal` | Yes, 2 frames | 35.7353,-83.5163 (2026-03-06, Gatlinburg TN) | — none; CRM has **zero TN entries**, nearest lead 362 km away | — | **none** | No |
| `cincinnati-oh-plank-deck-bungalow-2024` | **No** — exhaustive search of all 14 REAL_2024-*.JPG in the library found nothing matching | — | — | — | **none** | No |
| `loveland-oh-single-day-replacement-2024` | **No** — library is organized by content category, not by job; no per-job archive exists for this one | — | — | — | **none** | No |
| `loveland-oh-siding-peak-reseal-2026` | No drone original (ground-level hand repair) | — | **Terri Kalb, Loveland** — re-confirmed independently (3 HEIC timestamps match the documented 13:39–13:47 visit window) | — | **low** (WHO is solid, price isn't) | No — genuinely no invoice anywhere, confirms [SESSION-2026-08-31](../projects/SESSION-2026-08-31-sweep-rocks-and-four-cards.md) |
| `loveland-oh-wind-repair-2023` | No drone original for this specific job | — | **Alex Little, 1213 W Loveland Ave** — matches address/city/year/damage-type… | — | **low, and see §3** | No |

## §3 — Flag for Jo: `loveland-oh-wind-repair-2023` may not be an NBD job

The strongest textual match for this **already-published, already-live**
card is a full Xactimate/EagleView file for a 2023 wind claim at
1213 W Loveland Ave — but every page of it is on **"JK Roofing &
Construction" letterhead, with Jonathan Deal listed as Estimator**, not
NBD/No Big Deal. The claim's scope is also much larger (whole-house tear-off
plus siding/windows/electrical, $48k grand total) than the site's "reset the
courses by hand" copy describes, and the folder holds no photos to confirm
it's even the same repair. This reads like a job from **before NBD
existed** — the same JKRC/MLR/SPR-era pattern already documented for a few
of the original seed cards (see the "prior-brand jobs" note in
[SESSION-2026-08-28](../projects/SESSION-2026-08-28-ourwork-areas-galleries-gbp.md)
§1). **Not touched or unpublished by this session** — per
[PUBLISH-PROJECT.md](../runbooks/PUBLISH-PROJECT.md) rule 3, whose job it
was is Jo's call, not the session's, and this card has been live since
2026-08-31. Flagging so he can decide: leave as-is (a joint/prior-brand job
run as a regular project is exactly the precedent from the 2026-09-03 shed
case), add a note, or replace it.

## §4 — New drone-photo folder (Drive `DJI_001`, id `1uEtW53WvsNrHryl7Oq6Xsrt692pTOPiM`)

The ~50 "new" files Jo added are actually **49 files across two upload
batches** (the rest of that folder is older content already reviewed in a
prior session). Splitting by embedded capture date found **three distinct
flights**, not one:

| Flight | When | Reverse-geocoded near | Best CRM candidate | Distance | Confidence |
|---|---|---|---|---|---|
| 2026-08-29 | 17:28–17:44 (one ~16 min flight) | Crestwood Dr, Mason OH 45040 | Sarah Chen, 1035 Reading Rd, Mason — $11,500, stage `new`, 5 months cold | 2,685 m | **none** |
| 2026-09-08, flight 1 | 11:36–11:38 | Lora Ave, Cheviot/Bridgetown OH 45211 | A D2D door-knock lead, 4390 Race Rd, Bridgetown — storm-damage canvass cluster, same neighborhood | 1,773 m | **low** — best of the three, still not a real match |
| 2026-09-08, flight 2 | 12:21–12:22 | Muriel Ct, Clifton/CUF, Cincinnati 45219 | — none nearby at all | 5,140 m | **none** |

None clears the 150 m bar. Most likely explanation per the agent's own
read: these properties simply aren't in the lead pipeline yet (a canvass
target, a referral, or a job not yet entered) — **not** a matching failure
on the recon's part. **No Our Work entry and no social post was built from
these photos** — publishing a job before knowing whose it is and whether
consent is on file is exactly what
[PUBLISH-PROJECT.md](../runbooks/PUBLISH-PROJECT.md) rule 3 exists to
prevent.

## §5 — What would actually close this

1. **Jo's memory is the fastest path** for all seven — he was on every one
   of these jobs. A one-line answer per slug (customer/town/price, or "skip
   it") is faster than any further automated recon and is exactly what
   [PUBLISH-PROJECT.md](../runbooks/PUBLISH-PROJECT.md)'s phone template
   asks for.
2. For the three "no original photo found" projects (`plank-deck-bungalow`,
   `single-day-replacement`, and effectively `wind-repair-2023`), the NBD
   Photo Library Drive folder searched here doesn't have them — they may be
   in `COMPANIES/NBD/CUSTOMERS` or a personal archive outside what this
   recon was scoped to search.
3. For the new drone set: the fastest close is Jo naming the three
   properties from the reverse-geocoded areas above (Mason/Crestwood,
   Cheviot/Bridgetown, Clifton/CUF) — a human glance at the photos will
   settle it in seconds where GPS-only matching couldn't.
4. This whole technique needs an **older lead export** (pre-2026) to ever
   work on 2023–2025 jobs — worth asking whether one exists anywhere before
   spending another recon session on this CRM export specifically.

## §6 — What this session did do to `/our-work` (unblocked by the above)

Four site changes Jo asked for, all independent of the pricing question and
shipped this session: tags consolidated into a real second filter facet,
featured/pinned ordering, and `/our-work/<slug>` detail pages for all 45
live projects (generated by `scripts/build-projects.mjs`, chrome via
`scripts/apply-partials.js`, `docs/our-work/` now discovered by
`scripts/build-sitemap.js`). All CI gates green. Session/PR details in the
handoff for this date.
