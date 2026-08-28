# NEXT SESSION — 2026-08-28

## §FINAL STATE (session end — read this first)

Four content PRs **merged and verified live** the same day: #1285 (real towns
+ 3 new priced projects), #1286 (photo expansion + Dindar), #1287 (Goddard
three-layer fix, real Roofivent close-ups, Dindar panels-off), #1289 (gallery
expansion: 46 photos across 14 cards → Jo's "10 per reel" target met on the
four flagship cards). `/our-work` now carries 18 projects, zero "Greater
Cincinnati" placeholders.

**Two things are waiting on Jo, nothing else is blocked:**

1. **GBP + Facebook posts — HELD for his review** (his explicit instruction,
   twice). Kit: [gbp-post-kit-2026-08-28](../marketing/gbp-post-kit-2026-08-28.md)
   + 4 posters in `../marketing/gbp-kit-2026-08-28/`. Nothing has been posted
   anywhere. Before the Lexington post goes up, add the six Central-KY towns
   to the GBP service area.
2. **Two photo judgment calls** he hasn't answered: the Goddard coating frame
   with an identifiable crew face, and a Hatley "before" aerial that could not
   be confirmed as Rita's roof vs a neighbor's (he already caught one
   neighbor-roof mix-up on that card — the Ty Nicodemus one, itself a future
   card candidate).

**Next session's obvious first move:** work
[ourwork-candidate-pipeline-2026-08-28](../marketing/ourwork-candidate-pipeline-2026-08-28.md)
top-down. Jo said "perfect let's do it" to that queue; its staging agents died
on a session limit before producing anything, so **nothing is staged for those
cards yet** — start fresh from the pipeline doc (rank 1 = Srijan N. Milford
flagship, CRM-matched $24,975 → proposed $24,500–25,500).

Handoff from the /our-work content session
([session note](SESSION-2026-08-28-ourwork-areas-galleries-gbp.md)). The
08-26 handoff's §0 merge queue is DONE (main log shows #1279–#1284 merged);
[NEXT_SESSION-2026-08-26](NEXT_SESSION-2026-08-26.md) still carries Jo's
broader queue — nothing there is superseded except as noted.

## §0 — THE LIVE ITEM: the content PR gate

Branch `content/our-work-areas-galleries-2026-08-28` (draft PR) holds:
real towns on all 12 legacy /our-work cards (EXIF-verified), 3 new priced
projects (Goddard $22.5–23.5k re-roof · Hatley $3–3.5k thermal+vents ·
Higgins $300–500 same-day siding), a 2nd photo on the apartment-tearoff
card, and the [GBP post kit](../marketing/gbp-post-kit-2026-08-28.md).

**Jo answered same day (2026-08-28):** consent ✓ for all three projects
("yes, I gave you permission"); towns unchallenged; Higgins re-priced to
**$600–1,000** per Jo (applied). He noted the Goddard tear-off and the
existing Tudor-duplex card are similar — both stay ("either great"), but
**keep hunting more job variety** (a second Drive sweep of the unreached
folders was launched that session). PR flipped to ready; **merge is Jo's
tap** per the publish runbook, deploy verification follows.

**GBP/FB/IG posting is HELD on Jo's explicit instruction** — he reviews the
kit + posters first (`../marketing/gbp-post-kit-2026-08-28.md` +
`../marketing/gbp-kit-2026-08-28/`). Nothing posts anywhere until he says
so. When he does: add the Central-KY towns to the GBP service area BEFORE
the Lexington announcement.

## §0b — Same-day round 2 (PR #1286): expansion + corrections + Dindar

#1285 merged and VERIFIED LIVE same day (deploy green; served /our-work
carries the towns/prices, zero "Greater Cincinnati" left). Jo then, live in
session: (a) flagged that Hatley's third photo was **Ty Nicodemus's roof**
(neighbor, ANOTHER customer — future card candidate) → replaced with
Roofivent Roto-turbine/Eco-vent close-ups per his ask; (b) corrected Higgins
to THIRD-story; (c) asked for **5–10 photos per project** → Goddard 3→6,
Hatley 3→5, Higgins 2→4, A-frame/Evansville +1 each (Photo Library
companions); (d) approved **Dindar** (Sharonville, $1,000–1,500,
siding-repair + storm-damage, 4 photos; crew-face close-up excluded, his
call to add). The second Drive sweep's full report (Dindar find, soft-wash
job description, McGlynn hold-until-invoice-sent, SD-roll GPS fixes) is in
the sweep agent record; top leads folded into §5 below. Mesh-screens Content
photos were REJECTED for Gary's card — they read as pre-job existing
screens, not the new install.

## Fast lanes queued by the Drive survey (session note §5)

- Soft Wash: 16 new HEICs in INTERNAL/Content/Soft Wash → heic-convert →
  feature/imagery (needs Jo's job ID).
- Walgreens commercial set + Schumacher "New Build" set — Jo's call on
  third-party branding, then easy features.
- Coleman (Loveland) feature auto-unlocks when her proposal books.
- A-frame card: two recognizable people on the live photo — swap candidate
  `REAL_2026-03-06_DJI_0680` if Jo wants.

## Reusable infrastructure learned this session

- **NBD Photo Library** in Drive (id `1j8eAvgQldNEeRARlXiJiXUXvZtEbEoT9`):
  `REAL_<date>_DJI_<num>_<published-slug>.JPG` originals WITH EXIF for the
  whole legacy gallery — the provenance index; check it before any hunt.
- Drive MCP: `read_file_content` is EMPTY for images; use
  `download_file_content` → decode the saved base64 JSON locally; >10MB
  fails; `get_file_metadata` carries no EXIF.
- `build-projects.mjs --check` reds on a clean Windows checkout (CRLF
  false-fail, same as build-sitemap) — content-identical; trust CI.
- Prod read-only cross-ref pattern: `leads.jobValue` is the money field;
  `photos` isn't keyed by leadId; `estimates` root is sparse.
