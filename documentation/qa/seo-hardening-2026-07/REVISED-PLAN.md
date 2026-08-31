# SEO/Tech Hardening — Revised Plan (Phase 0 output)

Date: 2026-07-02 · Branch: `claude/seo-tech-hardening-ur3buf`
Verification environment: remote Linux container. **Outbound network to the live
site is blocked by the session's network policy** (CONNECT 403 at the gateway for
`nobigdealwithjoedeal.com` and `www.`), so every live-site claim below is
re-verified from the repo (which is authoritative for hosting config) plus local
headless-Chrome rendering of the actual pages. Items that can only be confirmed
against production are called out and collected in `MANUAL-FOR-JO.md`.

---

## Corrections to the mission brief (verified 2026-07-02)

| # | Brief said | Actually |
|---|-----------|----------|
| 1 | "Cloudflare Pages hosting", fix caching via root `_headers`, redirects via `_redirects`/zone rule | **Hosting is Firebase Hosting** — `firebase.json` → `"public": "docs"`, `cleanUrls: true`, rewrites to Cloud Functions, and a full `headers` array. `_headers`/`_redirects` files would be inert. Comments in `firebase.json` reference Cloudflare *CDN* caching, so Cloudflare may sit in front as proxied DNS — but header/caching config lives in `firebase.json`. A `docs/CNAME` file also exists (GitHub Pages relic; harmless under Firebase). |
| 2 | "Repo root = public marketing site, ~250 static pages" | Site root is **`docs/`**. Public (indexable-scope) inventory is **204 files → 199 canonical URLs**; the ~250 count includes `pro/`, `admin/`, `tools/`, `dev/`, `sites/oaks` — all intentionally private/noindexed. |
| 3 | "`sitemap.xml` lists 199 URLs vs ~250-page site" (F5 gap) | **No gap.** `scripts/build-sitemap.js --dry-run` reproduces the live sitemap byte-identically (199 URLs). Full file-vs-sitemap diff shows only: URL-form artifacts (7 directory pages listed canonically without trailing slash, correct under `trailingSlash: false`) and intentional exclusions (`404`, `offline`, Google verification stub, `sites/` contractor surface). F5 → **no code change; audit documented**. |
| 4 | `nbd-fonts.css` max-age=300 is the css cache problem | Confirmed, and the root cause is visible: `firebase.json` has a `**/*.@(js|css)` rule (max-age=0) that is **dead** — the later `**` rule (max-age=300) wins under Firebase's last-match-wins-per-key semantics (matches the live observation). Note the fonts themselves (`/assets/fonts/*.woff2`) also ride the 300s default. |
| 5 | F4: "Most CTAs are probably already close" to 18.66px bold | **No.** Headless-Chrome computed-style audit of 17 representative templates × 2 viewports found **251 white-on-#E8720C text elements in ~30 distinct patterns; all CTA/badge patterns render at 9.6–17.6px** (`.ann-text` 10.4–12.8px/700, `.nav-cta` 11.2–12.8px/700, `.btn-primary` 13.1–16px/700–800, plus ~25 more). Only decorative h2/signature elements pass AA-large already. Bumping them all to ≥18.66px is a redesign; recoloring them all to `#B85400` is a sitewide brand-color change (Rule 0 violation). F4 is re-scoped below. |
| 6 | "At least one plaintext email address" (F6) | `jd@nobigdealwithjoedeal.com` appears **567 times** across public pages: ~333 `mailto:` links + visible anchor text (footer contact block on nearly every page), ~30 JSON-LD `"email"` fields (intentional LocalBusiness structured data), plus `info@`/`support@`/`pro@` a handful of times. |
| 7 | Typefaces "Manrope/Fraunces" | Self-hosted fonts are Montserrat/Bebas Neue/Dancing Script. Irrelevant to the fixes; noted for accuracy. Not touching type. |
| 8 | Phone landmine | Real number `(859) 420-7382` ×1428 everywhere — untouched. All other numbers found are form **placeholders** (`(859) 555-1234` estimate.html, `(859) 555-0123` storm-alerts.html, `(513) 555-0100` sites/index.html, `(123) 456-7890` sites/oaks.html) or the private Oaks template's own contact number (`(513) 827-5297`, confined to noindexed `sites/oaks/*`). **Nothing changed; flagged here per Rule 0.** |
| 9 | Verify on "Cloudflare Pages preview deployment" | Not possible from this session: no Firebase/Cloudflare credentials and the network policy blocks the domains. Deploys happen via `.github/workflows/firebase-deploy.yml` on push to `main`. All server-header/redirect verification steps are written up as post-merge curl checks in `MANUAL-FOR-JO.md`. |

Other Phase-0 facts:
- **Zero** absolute `www.nobigdealwithjoedeal.com` internal links in `docs/` (F1 link cleanup is a no-op).
- `docs/sw.js` is a **self-unregistering stub** — no service-worker cache interaction on the public site; caching changes are safe from SW staleness loops.
- `/assets/js/inline/*.js` filenames are hash-like but do **not** match current content hashes → not content-addressed → `immutable` caching is off the table (matches F2's fallback branch).
- Asset references are centralized (3 shared CSS + ~10 shared JS, absolute paths, unversioned); there is no build pipeline that could stamp `?v=` on deploy.
- Repo precedent for sitewide style fixes: codemod scripts injecting a `<style>` override block before `</head>` (`scripts/fix-footer-contrast.js`).

---

## Revised fix list

### F1 — www → apex 301 (YELLOW: needs console access)
- Repo side: verified zero `www.` internal links; nothing to change in code.
- Mechanism: **Firebase Hosting custom-domain redirect** (Console → Hosting → add/edit `www` custom domain → "Redirect to" apex), or — *if* DNS is proxied through Cloudflare — the zone Redirect Rule from the original brief also works. Both recipes + verification curl matrix are in `MANUAL-FOR-JO.md`. Firebase `redirects` in `firebase.json` cannot match hostnames, so no code fix exists.

### F2 — Asset caching via `firebase.json` (GREEN)
- Append three rules **after** the `**` rule (last-match-wins):
  - `/assets/css/**` and `/assets/js/**` → `public, max-age=86400` (brief's fallback branch: no safe cache-busting exists, so no 1-year immutable).
  - `/assets/fonts/**` → `public, max-age=2592000` (30 d, aligned with images; woff2 binaries are stable).
- `/assets/images/**` already at 2592000 — unchanged.
- `/assets/vendor/**` deliberately untouched (shared with the `pro/` CRM app — Rule 0).
- Leave the dead `**/*.@(js|css)` rule in place (removing it is a zero-behavior-change cleanup, but it encodes Wave-127 intent for Jo to reconcile — noted in MANUAL-FOR-JO).
- Verification: local emulator not run (functions deps not installed); post-deploy curl checks documented.

### F3 — Images (GREEN)
- Generate WebP (quality 82, same dimensions) for the 16 referenced `projects/*.jpg` + `joe-hero.jpg`; originals kept.
- `our-work.html`: wrap the 12 gallery + 4 before/after `<img>` in `<picture>` with WebP source; add missing `width`/`height` (and `loading="lazy"`) to the 4 before/after images.
- `index.html`/`about.html`: `<picture>` + WebP for the `joe-hero.jpg` portrait; add intrinsic `width`/`height` on index.html's instance.
- Nav/footer logo (`nbd-logo.png`, 199 tags missing dimensions): add intrinsic `width`/`height` attributes via codemod (rendering unchanged — inline `height:42px;width:auto` still governs). PNG is 3.6 KB; WebP conversion skipped as pointless.
- `og:image`/`twitter:image` stay `.jpg` everywhere (scraper compatibility).
- Orphan images (roofing-3/4, drone-completed-brick, drone-hero-curb.webp, one unused project photo) left in place, documented.

### F4 — Contrast (split GREEN / YELLOW)
- GREEN (the brief's own sanctioned example): announcement bar (`.ann-bar`, white 10.4–12.8px bold text) → background `#B85400` (4.55:1 with white) via injected per-page override style, matching repo codemod precedent. Flagged as a per-element exception with before/after screenshots.
- YELLOW (for Jo): the remaining ~29 small-text patterns (`.btn-primary`, `.nav-cta`, badges, step-number chips, etc.). Fixing them requires either a sitewide CTA recolor to `#B85400` (conflicts with locked-palette Rule 0) or a typographic redesign (≥18.66px bold). Full enumeration + a ready-to-apply override CSS block ship in `MANUAL-FOR-JO.md`; awaiting Jo's pick.

### F5 — Sitemap (GREEN, no-op)
- Audit complete: sitemap is correct and complete; exclusions documented in FIX-LOG. No change shipped. (`build-sitemap.js` dry-run: zero diff.)

### F6 — Email exposure (GREEN, conservative)
- HTML-entity-encode every `@nobigdealwithjoedeal.com` address in `mailto:` hrefs and visible text across public pages (naive-harvester protection, zero visual/functional change, no JS, no CSP surface).
- JSON-LD `"email"` fields are **left intact** (entities are illegal in raw JSON; the field is intentional LocalBusiness structured data). Routing to the contact form was rejected: it would remove a live contact channel (Rule 0 business-content lock).

### F7 — Minification: **skipped** (explicitly permitted by the brief; risk/benefit poor at ~13 KiB).

## Testing gates (adapted to environment)
- Local headless-Chrome contrast re-audit after F4 (same script, same 17 pages × 2 viewports).
- Local visual screenshots (desktop + mobile) of homepage, our-work, a service page, before/after each visual-adjacent change.
- Lighthouse (local server) homepage + our-work + one service page, before vs after — perf/accessibility must not regress.
- `node scripts/build-sitemap.js` (dry-run) and `node scripts/check-site-integrity.js` if runnable, before commit.
- Live-header/redirect curl matrices: **deferred to post-deploy** (documented for Jo).

---

## Companion docs in this folder

The rest of this campaign, linked so each doc is reachable from the vault:

- [BLOG-OUTLINES-FOR-JO](BLOG-OUTLINES-FOR-JO.md) — Three blog outlines for Jo — 2026-07
- [FIX-LOG](FIX-LOG.md) — SEO/Tech Hardening — Fix Log
- [FOLLOWUP-LOG](FOLLOWUP-LOG.md) — SEO/Tech Hardening — Follow-up round (items 1–5)
