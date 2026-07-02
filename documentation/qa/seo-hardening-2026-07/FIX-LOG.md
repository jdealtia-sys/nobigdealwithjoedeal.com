# SEO/Tech Hardening — Fix Log

Date: 2026-07-02 · Branch: `claude/seo-tech-hardening-ur3buf`
Companion docs: `REVISED-PLAN.md` (what changed vs the mission brief and why),
`MANUAL-FOR-JO.md` (items needing console access or a decision).

Verification context: the session's network policy blocks the live domain, so
all behavior verification below ran against a local static server
(`python3 -m http.server` over `docs/`) with headless Chromium (Playwright) and
Lighthouse. Server-header changes (F2) can only be confirmed post-deploy — the
exact curl checks are in `MANUAL-FOR-JO.md §3`.

---

## F2 — Asset cache lifetimes (`firebase.json`)

**Change:** appended three header rules at the END of `hosting.headers`
(placement matters: header matching is last-match-wins per key, which is also
why the existing `**/*.@(js|css)` rule near the top has been inert — the later
`**` rule's `max-age=300` overrides it; that pre-existing quirk is documented
for Jo in `MANUAL-FOR-JO.md §4`):

| Path | Before (effective, live-verified by the 2026-06-30 scan) | After |
|---|---|---|
| `/assets/css/**` | `public, max-age=300` | `public, max-age=86400` |
| `/assets/js/**` | `public, max-age=300` | `public, max-age=86400` |
| `/assets/fonts/**` | `public, max-age=300` | `public, max-age=2592000` |
| `/assets/images/**` | `public, max-age=2592000` | unchanged |
| `/assets/vendor/**`, `/pro/**` | `max-age=300` / no-store rules | deliberately unchanged (shared with the CRM app) |

**Why 24 h and not 1 year immutable:** asset filenames are not content-hashed
(`/assets/js/inline/*.js` names no longer match their content hashes — verified
by hashing) and there is no build step to stamp versions. A 1-year immutable
cache without cache-busting would strand users on stale code after deploys —
the same failure mode the Wave-127 comment in `firebase.json` describes.

**Rollback:** delete the three rules (single hunk at the end of the headers
array). `firebase.json` re-validated as JSON and rule order confirmed
programmatically.

## F4 (scoped) — Announcement-bar contrast

**Change:** `scripts/fix-ann-bar-contrast.js` (new, idempotent) rewrote
`background:var(--orange)` → `background:#B85400` **only inside `.ann-bar{...}`
style rules** — 193 declarations in 193 files. `sites/oaks/*`, `pro/`, `admin/`
untouched. Brand variable `--orange` itself is unchanged everywhere.

**Result:** white 10.4–12.8px bold bar text goes from 3.06:1 (AA fail) to
4.55:1 (AA pass). Headless-Chrome re-audit of 17 templates × 2 viewports:
`.ann-text`/`.ann-slide` white-on-#E8720C hits went **96 → 0**; pixel probe of
the rendered bar confirms `rgb(232,114,12)` → `rgb(184,84,0)`.
Evidence: `evidence/annbar-{before,after}-{desktop,mobile}.png`.

**This is a flagged per-element exception per the F4 remediation rules.** The
remaining ~29 white-on-orange element patterns (`.btn-primary`, `.nav-cta`,
badges, step chips — 155 audit hits) are **not changed**; the decision matrix
is in `MANUAL-FOR-JO.md §1`.

**Rollback:** revert the commit, or run the codemod's regex in reverse
(`background:#B85400` → `background:var(--orange)` within `.ann-bar` rules).

## F3 — Images

**WebP (empirical result, deviates from the brief):** at the specified ~q82,
WebP came out **larger than the already-compressed source JPG for 13 of 16**
project photos (100–115% of source). Shipping those would regress performance,
so WebP twins were kept only where they genuinely win:

| File | JPG | WebP | Saving |
|---|---|---|---|
| `joe-hero.webp` (new) | 92,512 B | 73,436 B | −21% |
| `projects/active-culdescac-crew.webp` (new) | 121,148 B | 98,594 B | −19% |
| `projects/completed-colonial-spring.webp` (new) | 136,240 B | 73,990 B | −46% |

Originals preserved; no `.jpg` deleted. The larger-than-source conversions were
discarded, not committed. (The drone/roofing heroes already serve WebP via CSS
`image-set()` from earlier work — verified, untouched.)

**Markup:**
- `our-work.html`: the two winning gallery photos wrapped in
  `<picture><source type="image/webp">…`; the 4 before/after `<img>`s gained
  `width="800" height="600" loading="lazy"` (they were the only project images
  missing dimensions; sizing is CSS-controlled — `.ba-images img{height:220px}`
  — so rendering is unchanged, verified 267×220 rendered pre/post).
- `index.html`: Joe portrait wrapped in `<picture style="width:100%;height:100%;display:block">`
  (the styled wrapper preserves the `height:100%` chain inside the
  `aspect-ratio:4/3` container — verified img fills container exactly, 536×402)
  + `width/height="1024"` attributes.
- `about.html`: Joe portrait wrapped in `<picture>` (img already had
  width/height/eager/fetchpriority — all preserved, verified 360×360 rendered).
- **`og:image` / `twitter:image` / JSON-LD `image` all still point at `.jpg`** —
  verified by grep, zero meta references changed.

**Logo dimensions:** `scripts/add-logo-dimensions.js` (new, idempotent) added
`width="240" height="160"` (intrinsic, PIL-verified) to every
`/assets/images/nbd-logo.png` `<img>` lacking a width attribute — 199 tags in
196 files. Nav rendering unchanged (inline `height:42px;width:auto` still
governs; attributes only supply the pre-load aspect ratio).

After these changes, every `<img>` referencing `assets/images/**` on the public
site carries explicit dimensions.

**Verified in headless Chromium:** wrapped images serve `.webp` as
`currentSrc`, rendered sizes identical to pre-change CSS values, lazy-loading
attributes present.

## F5 — Sitemap: audit only, **no change** (the brief's premise was wrong)

`node scripts/build-sitemap.js` (dry-run): **zero diff, 199 URLs.** Full
filesystem-vs-sitemap diff:
- 7 "missing" entries are the directory-index pages the sitemap correctly lists
  in canonical no-trailing-slash form (`services/lumanail` etc. — `trailingSlash:false`).
- Genuinely absent from the sitemap and **correctly so**: `404.html`,
  `offline.html`, `googlee5b8f461f0f8e74b.html` (Search Console verification),
  `sites/index.html` + `sites/free-guide/` (contractor SaaS surface, not
  homeowner SEO), `sites/oaks*` (private customer template, robots-blocked +
  noindexed), `tools/`, `admin/`, `pro/` (robots-blocked / X-Robots-Tag).
The "199 vs ~250" gap in the scan was counting private surfaces.

## F6 — Email exposure

**Change:** `scripts/obfuscate-public-emails.js` (new, idempotent)
entity-encoded `@` → `&#64;` and domain dots → `&#46;` for every
`*@nobigdealwithjoedeal.com` address **outside `<script>` blocks** — 527
addresses in 185 files. Browsers decode character references in both attribute
values and text nodes, so `mailto:` links keep working and the visible address
renders identically (verified in headless Chromium: `a.href` resolves to
`mailto:jd@nobigdealwithjoedeal.com`, displayed text unchanged).

**Deliberately kept as-is:** the ~30 JSON-LD `"email"` fields (entities are
illegal in raw JSON; the field is intentional LocalBusiness structured data,
and stripping it would hurt local SEO). This is honest-scoped protection
against naive regex harvesters — a JS-executing harvester can still read the
address, but every stronger option (JS assembly, contact-form-only) either
adds CSP surface or removes a live contact channel.

**Rollback:** reverse replace `&#64;nobigdealwithjoedeal&#46;com` →
`@nobigdealwithjoedeal.com` across `docs/`.

## F7 — Minification: **skipped** (allowed by the brief; ~13 KiB upside not
worth complicating the F2 story).

## F1 — www→apex: no code component

Zero absolute `www.` internal links in `docs/` (verified by grep across
html/js/css). The redirect itself requires console access — recipe in
`MANUAL-FOR-JO.md §2`.

---

## Gate results

| Gate | Result |
|---|---|
| `scripts/check-site-integrity.js` | 215 pages, 17,511 internal refs, 942 anchors — **0 failures** |
| `scripts/build-sitemap.js` dry-run | zero diff (still 199 URLs) |
| `firebase.json` parses; new rules last in array | ✅ |
| Contrast re-audit (17 pages × 2 viewports) | ann-bar hits 96 → 0; no new offenders introduced |
| Lighthouse (local server, homepage / our-work / service page) | perf 0.71→0.71 / 0.84→**0.85** / 0.86→0.86; a11y 0.96/0.93/0.93 unchanged — **no regressions** |
| mailto decode + `<picture>` render checks (headless Chromium) | all pass (webp served, layouts pixel-consistent) |
| Visual spot-check | desktop+mobile screenshots of home/our-work/service in `evidence/` |
| Phone-number landmine sweep | only real number + form placeholders found; **nothing changed**; details in `REVISED-PLAN.md` correction #8 |

## Files touched (summary)

- `firebase.json` — 3 appended header rules (F2)
- `docs/**/*.html` — 193 files (ann-bar bg), 196 files (logo dims), 185 files
  (email encoding), plus `our-work.html`/`index.html`/`about.html` picture markup
  (sets overlap; net ~200 files, all via idempotent codemods committed under `scripts/`)
- `docs/assets/images/` — 3 new `.webp` files, no deletions
- `scripts/fix-ann-bar-contrast.js`, `scripts/add-logo-dimensions.js`,
  `scripts/obfuscate-public-emails.js` — new codemods, safe to re-run
- `documentation/qa/seo-hardening-2026-07/` — this audit trail
