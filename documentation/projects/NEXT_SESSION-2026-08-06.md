# Next Session — after the 2026-08-06 seven-PR power session

> **EXECUTED 2026-08-07** — superseded by
> [NEXT_SESSION-2026-08-07](NEXT_SESSION-2026-08-07.md). Two corrections for
> the record (both bit the follow-up session's recon):
> - **Item 1's framing was misleading**: the hail-damage footer's "46 lines
>   adrift" was ONE inserted line (a codemod-misfire duplicate link from PR
>   #1143) plus 45 lines of index-offset artifact from `diffLines()`.
>   Converged + governed 2026-08-07.
> - **Item 3's instruction was wrong**: `migrate-nav-to-partial.js` HARD-
>   EXCLUDED docs/our-work.html, so "run it, it will classify" reported
>   UNMATCHED and changed nothing until the stale exclusion was deleted.
>   Both nav regions then converted EXACT (0-diff) on 2026-08-07.

> Cold-start brief, written 2026-08-06 at session end. Self-contained.
> Predecessors ([NEXT_SESSION-2026-08-05](NEXT_SESSION-2026-08-05.md) and the
> session log
> [SESSION-2026-08-06-our-work-featured-projects](SESSION-2026-08-06-our-work-featured-projects.md))
> are fully executed — do not re-run them. Read the repo-root
> [CLAUDE.md](../../CLAUDE.md) first; it carries the standing conventions
> (vault logging, generator-owned markers, publishing invariants).

## What this session shipped (all merged + deployed; prod verified good)

| PR | Squash | What |
|---|---|---|
| #1185 | `4f85869` | SEO lane B: ~857 trailing-slash 301 hops removed (incl. via footer partials); 6 titles + 7 metas trimmed |
| #1190 | `f30c73d` | CL8: dead `sendTeamInviteEmail` deleted (prod deletion deployed clean); `public-intake.test.js` wired into the referral-trigger CI job |
| #1191 | `36af009` | P5 indirection: public `siteKey` replaces the tenant uid on the microsite surface; shared `resolveCompanyByKey`; 8 new emulator cases |
| #1186 | `590d379` | Rock 2 PR 6 part 1: estimates.js keeper code re-homed (`estimate-entry.js`, `estimate-crm-ops.js`, rates → `product-library.js`); audit doc corrected |
| #1188 | `054aa4e` | A11y lane D: `--gray` → `#5d6673` (AA on every surface, 201 pages) + 11 navy alpha raises; pinned as polish-contract checks 13–14 |
| #1189 | `8faa988` | Partials: 131 → **546 governed regions** across 185 pages (8 new partials incl. nav-standard/mobile-nav-standard with one `{{cta_href}}` param); REQUIRED_MARKUP hardened; 7 dormant nav codemods deleted; fixed 4 self-pointing footer links + stale areas dropdown |
| #1187 | `f6adb09` | **Featured Projects**: /our-work rebuilt Thumbtack-style — `projects.json` → `build-projects.mjs` → OURWORK-* markers, retail price ranges, carousel/lightbox, hard-fail privacy validators, PUBLISH-PROJECT runbook, repo-root CLAUDE.md |

Verification at close: main CI green on every squash; final deploy run #1279
success (12:47Z); live /our-work verified serving the 12-card gallery; the
CL8 function deletion went through without a manual step.

## Deferred queue (ranked; verified open at session end)

1. **hail-damage-insurance-claim footer** — 46 lines adrift from
   `footer-extended`; the only hub page left unconverted. Needs a human-read
   diff (deliberate content vs rot), then converge or bless.
2. **`docs/assets/css/project-carousel.css` gray fallbacks** — the
   `var(--gray,#6b7280)` literals predate the #1188 sweep; align to `#5d6673`
   (cosmetic; the var always resolves on the page, so nothing renders wrong).
3. **our-work.html nav conversion** — excluded from #1189 while #1187 was in
   flight; both are merged, so `nav-standard`/`mobile-nav-standard` markers can
   go on now (run `scripts/migrate-nav-to-partial.js`, it will classify).
4. **Featured Projects phase 2** — detail pages at `/our-work/<slug>` (needs a
   `build-sitemap.js` rule for the new directory) and the rep-authenticated
   text-only Haiku blurb drafter over photo `aiSuggestion` captions/tags
   (follow `photo-vision.js` patterns: kill-switch, rate limit, cost meters).
5. **Globals residual** — zone-draw unwind (`maps.js` unguarded window
   assignments), `damagNearMe` 4-way dedup; Tranche 3 (~515 globals) still
   needs its own dependency-ordered plan first.
6. **Classic-wizard deletion (Rock 2 PR 6 part 2)** — GATED ON JO: prod
   deprecation-warn logs. The only clean signal is zero
   `[estimates.js DEPRECATED] startNewEstimateOriginal…` warns; a
   `calcTierPrices` hit only means a rep reopened a pre-V2 doc. Also requires
   the pre-V2 stored-doc migration decision (migrate vs read-only) and the
   `dashboard.legacy.html` rollback-snapshot call.
7. **Functions emulator widening** to @shard1/@shard2/@audit — still parked on
   boot cost (ci.yml comment).

## Parked on Jo (decisions / console actions — not agent work)

- **First priced project** on /our-work — `runbooks/PUBLISH-PROJECT.md`, ~10
  min end to end. The 12 seeds ship unpriced on purpose.
- kie.ai visualizer flip (`runbooks/VISUALIZER-KIE-PROVIDER.md`).
- TAMKO placeholder pricing — 8 SKUs still live with GAF-mirrored numbers.
- Blog drafts: 3 posts in `documentation/drafts/` with 25 `JO:` markers.
- GBP/reviews checklist, DMARC tightening (seo-hardening MANUAL-FOR-JO).
- Prod deprecation-log check (item 6 above).

## Environment notes (unchanged from 2026-08-05, still true)

- Emulator suites need the proxy env scrubbed for the child process:
  `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx firebase-tools emulators:exec …`
- Dummy-secret generation must exclude `TURNSTILE_SECRET` (present ⇒
  configured ⇒ fail-closed 403 on tokenless `submitPublicLead`).
- A local `npm install` in tests/ adds `proxy-agent-negotiate` lockfile drift —
  don't commit it.
- The `@stranger` E2E shard's known flake class (emulator dropped reads)
  appeared once this session on a docs-only commit and passed on the next run —
  if it recurs, the ci.yml guidance stands: fix the race, don't chase the test.
