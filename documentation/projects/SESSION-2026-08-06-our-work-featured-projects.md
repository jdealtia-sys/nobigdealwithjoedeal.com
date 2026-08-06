# Session log 2026-08-06 — Featured Projects (/our-work rebuild) + four-lane sweep

> Session note per the new vault-logging rule (now codified in the repo-root
> [CLAUDE.md](../../CLAUDE.md)). Two workstreams ran today: the morning
> four-lane power session from [NEXT_SESSION-2026-08-05](NEXT_SESSION-2026-08-05.md),
> then a mid-session pivot to the Featured Projects build (Jo's ask).

## Featured Projects — what shipped and why

Jo's ask: a Thumbtack-style /our-work — hand-authored projects with **numeric
retail price ranges**, photos, filters, a carousel; authorable like blog
posts. Decisions (Jo, this session): numeric ranges (not bands), hand-curated
(nothing auto-publishes from the CRM), keep `/our-work` (410 inbound links),
index-only first (detail pages = phase 2).

Architecture — the blog model, deliberately:

- `docs/assets/data/projects.json` = single editing surface (12 legacy cards
  migrated as seeds, no invented prices).
- `scripts/build-projects.mjs` stamps `OURWORK-STATIC` + `OURWORK-HEAD-SCHEMA`
  regions in `docs/our-work.html`; `--check` is a CI drift gate
  (ci.yml site-integrity job) and the deploy workflow restamps (soft-fail),
  which is also what flips future-dated projects live.
- Validators HARD-FAIL on: cost/margin/token/address-family keys anywhere in
  the manifest, `consentOnFile !== true`, missing photos on disk, empty alt
  text, one-sided price ranges, non-repo image paths.
- Schema: `@graph` with RoofingContractor `#org` + ImageGallery +
  BreadcrumbList + ItemList of `Service` items with `AggregateOffer`
  (low/high/USD). **Service, not Product** — Product markup on portfolio
  pages is a manual-action risk.
- Carousel/lightbox: `docs/assets/js/project-carousel.js` +
  `docs/assets/css/project-carousel.css`, lifted from the GAF Timberline
  inline carousel with class-scoped (multi-instance) internals; Timberline
  keeps its own copy for now (same class names → future swap is mechanical).
  `docs/assets/js/our-work.js` = filters + lightbox + focus management;
  the client never renders into the grid (static HTML is the source).
- Photos: EXIF-stripped re-encoded copies only, via
  `scripts/prepare-project-images.mjs` (sharp from functions/node_modules,
  zero new deps) or any 800×600 re-export. **Never CRM `?token=` URLs** —
  that pattern was retired in #698/#702.
- Runbook: [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md).
- Footer converted to `nbd:partial footer-standard` markers (132nd region).

### Key recon findings (so nobody re-derives them)

- **Retail price publishing is unblocked**: `catalog-cost-privacy` protects
  the internal cost basis and *asserts retail stays public*; the blog already
  publishes "$13,000 and $18,500". The privacy line is cost/margin, not price.
- **CRM photos cannot be linked from public pages**: Storage rules are
  owner-only, signed URLs are 15-minute, and permanent download-token URLs
  are a documented retired anti-pattern. Public photos = committed copies.
- No public Firestore read exists anywhere in the rules; every public data
  path is a Cloud Function whitelist (`getPublicSiteConfig` shape). A
  Firestore-fed gallery would be the repo's first `allow read: if true` —
  rejected.
- `homeowner-wall.js` (+ empty `/assets/data/homeowner-wall.json`) is a
  built-and-waiting JSON photo grid on the homepage — its manifest is still
  `[]`; filling it is cheap follow-up content work.

### Phase 2 sketch (not started)

- Per-project detail pages at `/our-work/<slug>` (needs a
  `build-sitemap.js` rule for the directory).
- Rep-authenticated, text-only Haiku "draft a project blurb" function over
  the job's existing photo `aiSuggestion.caption`/`tags` + lead service/city,
  following `photo-vision.js` patterns (kill-switch, rate limit, cost meters).
  No vision calls needed.
- Backfill price ranges + real cities on the 12 seeded legacy cards (Jo, via
  the runbook).
- Swap the Timberline page onto the shared carousel file.

## Four-lane power session status (from the 2026-08-05 brief)

| Lane | Status |
|---|---|
| SEO lane B | **PR #1185** (draft): ~857 trailing-slash 301 hops fixed (incl. via footer partials), 6 titles + 7 descriptions trimmed. Audit doc was stale — canonicals/sitemap/BreadcrumbList/image-dims//inspect were already done. |
| Rock 2 PR 6 | **PR #1186** (draft): estimates.js keeper code re-homed (estimate-entry.js, estimate-crm-ops.js, rates → product-library.js); audit doc corrected in place. **`startNewEstimateOriginal` is NOT dead** (live fallback chain via `showEstimateTypeSelector`'s Classic Builder card) — kept, deletes with the wizard. |
| A11y lane D | Not started. Real remaining scope: `--gray #6b7280` → `#5f6875` (validated 5.09:1 on #f5f3ef) across ~201 inline `:root` blocks + ~10 low-alpha navy declarations in estimate.html/storm-alerts.html. Everything else in the audit already shipped. |
| Partials | Not started. **Exclude `our-work.html` from its footer cohorts** — converted in the Featured Projects branch. Nav catalog recon: 158 pages share ONE nav with a single `{{cta_href}}` param; 13-page short mobile menu stays its own partial (Jo); `nav-tool` for the 3 tool pages (Jo); `migrate-footer-to-partial.js` is reusable (`&middot;` widening → 9 EXACT pages). |

Merge order note: **#1185 before the Featured Projects PR** (both touch
our-work.html; the rebuild is authored slash-less so a conflict resolves as
"ours", then restamp the footer region and rerun `apply-partials --check`).
