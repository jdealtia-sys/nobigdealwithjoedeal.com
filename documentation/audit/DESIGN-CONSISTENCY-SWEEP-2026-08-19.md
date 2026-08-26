# Design & brand consistency sweep — 2026-08-19

*Full-surface audit of chrome (headers/footers), typography, colour, spacing,
voice, and the gate suite across all 253 pages: 211 marketing, 42 CRM/admin.*

**Method.** Eight parallel dimension sweeps, then one adversarial verifier per
finding instructed to *refute* it against the files on disk and to
independently recount the claimed scope. 141 raw findings → **83 confirmed, 43
refuted, 15 confirmed deliberate-by-design**. Every surviving finding carries a
`file:line` its verifier opened. Scope counts in the tables below are the
verifier's recount, not the finder's claim — the two disagreed often enough
that the finder's numbers are not trustworthy on their own.

**Read this first if you are here to fix something:** jump to *Fix waves*
below. Progress is tracked in
[NEXT_SESSION-2026-08-19](../projects/NEXT_SESSION-2026-08-19.md).

---

## Why the same ~29 files keep coming back

Three structural causes, in blast-radius order.

**1. The generator only governs pages that opted in.**
`scripts/apply-partials.js:176` skips any file lacking an `nbd:partial` marker.
22 of 211 marketing pages — including the homepage, `/the-pledge`, all 7 brand
microsites and the funnel tool pages — are outside every chrome check and
always have been. Every sitewide sweep since 2026-06 (the cert-bar rollout, the
American Operator badge, the WCAG contrast fix, the typography normaliser, the
privacy-link injection) reached the stamped pages and stopped at that boundary.
The residue lands on the same files each time. `apply-partials.js --check`
passing (559 regions, 189 files, currently clean) says nothing about them.

**2. Fixes land in partial *sources* that were themselves forked.**
`mobile-nav-hub.html` is a stale copy of `mobile-nav-standard.html`, 7
destinations short. `footer-blog.html` carries a TAMKO trademark line predating
HailGuard™. `footer-blog.html` and `footer-extended.html` never received the
`data-nbd-certbar="v1"` marker the other two carry. Restamping propagates all
three forever.

**3. Guards whose file-selection lists are narrower than the invariant they
protect.** `ensure-nav-css.js:49` still carries the exact stale exclusion list
that `ensure-icon-css.js` was widened out of one day earlier.
`marketing-polish-contract.test.js:56` blanket-excludes `docs/sites/` and
`docs/tools/`. Every cert-bar assertion keys on a marker that 53 real cert bars
do not have. **A hole in a guard is indistinguishable from a passing check** —
this is the fourth instance in this repo, after the three logged in
[SESSION-2026-08-18-site-qc-and-cost-leak](../projects/SESSION-2026-08-18-site-qc-and-cost-leak.md).

## What is genuinely clean

Worth recording so the next audit does not re-derive it: zero broken internal
links; zero broken asset paths (3,868 `/assets/*` references resolved against
disk); zero duplicate `<title>` or meta descriptions across 211 pages; one
phone number formatted identically in 1,489 places; the deliberate `jd@`
(marketing) / `info@` (documents + Zelle) split respected everywhere, with
`info@` correctly absent from the entire marketing tree; and every banned
phrase in [VOICE_BIBLE](../brand/VOICE_BIBLE.md) genuinely gone.


---

## The chrome variants that legitimately exist

### Header variants

| Variant | Source | Page families | Why it differs |
|---|---|---|---|
| `nav-standard` | `site-src/partials/nav-standard.html` | 159 pages — 116 services leaves, 25 areas leaves, about, our-work, privacy, review | The default: logo + Services dropdown + Instant Estimate + CTA |
| `nav-blog` | `site-src/partials/nav-blog.html` | 26 blog pages | Same link set plus a **top-level "The Pledge"** item before the Services dropdown; fully tokenised colours |
| `nav-tool` | `site-src/partials/nav-tool.html` | 3 pages — `estimate.html:455`, `storm-alerts.html:288`, `visualizer.html:388` | Slim funnel chrome: logo image, "Call Joe" with SVG icon, "Back to site", hamburger. **No desktop link list** — the hamburger is the only route to the menu |
| `mobile-nav-standard` | `site-src/partials/mobile-nav-standard.html` | 159 pages | 32 links across Featured / Premium Components / Services / Free Tools; CTA "Book Inspection →" via `{{cta_href}}` |
| `mobile-nav-blog` | `site-src/partials/mobile-nav-blog.html` | 26 blog pages | Same shape, first group labelled "The Promise" |
| `mobile-nav-hub` | `site-src/partials/mobile-nav-hub.html` | 15 pages — 13 pillar service pages + about + visualizer | *Intended* as a shortened menu for pillar pages. See §3 — it has drifted |
| Homepage hand-built nav | `docs/index.html:798` | 1 page | Mirrors `nav-blog` (has the top-level Pledge item). Legitimately hand-built; predates the partials |
| Brand-microsite nav | 7 × `docs/services/*/index.html` | the-pledge-adjacent product pages | Product-specific link set (Pledge / Guarantee / Build / *this product* / Services / About / Blog). Legitimate as a *family*; see §3 for the drift within it |
| Funnel tool header | 6 hand-built pages | free-roof, free-tools, roof-score, storm-check, storm-report, inspect | Deliberately stripped chrome for single-purpose capture pages. Should be `nav-tool`; see §3 |
| `.t-nav` tenant nav | `docs/sites/t/index.html:27` | 1 template | **Deliberate and correct.** Logo/name/phone are empty + `hidden`, populated at runtime from the tenant's `companyProfile`. Must never carry NBD branding — showing (859) 420-7382 on a tenant site is a cross-tenant leak. The `t-` namespace exists to keep sitewide regex patchers out |
| `/sites` B2B nav | `docs/sites/index.html:410`, `docs/sites/free-guide/index.html:851` | 2 noindex pages | Contractor-facing SaaS surface, separate design system (Barlow, `#C8541A`). `free-guide`'s badge logo and missing `id="mainNav"` are **on record** as deliberate at `scripts/migrate-nav-to-partial.js:53-58` |
| CRM chrome (8 variants) | `docs/pro/**` | 42 pages | Excluded from `apply-partials.js` by design: Pro landing nav, `#nbd-pro-nav` app bar, `.topbar` slim bar, split brand-panel (login/register), dashboard sidebar, customer-facing brand-locked (portal/estimate-view), marketing chrome (pro/blog), admin Syne |

### Footer variants

| Variant | Source | Pages | Distinguishing content |
|---|---|---|---|
| `footer-standard` | `site-src/partials/footer-standard.html` | 117 | Centred single-paragraph. Cert bar **with** `data-nbd-certbar="v1"`, 3 badges, social, phone, `jd@`, © "— Greater Cincinnati", service/city breadcrumb, pro door, Privacy, Free Roof |
| `footer-area` | `site-src/partials/footer-area.html` | 25 | Identical to standard; breadcrumb reads "Serving {{city}}, {{state}} & Greater Cincinnati" |
| `footer-blog` | `site-src/partials/footer-blog.html` | 26 | 4-column grid, text wordmark, 4 trust chips, cert bar **without** the marker, Privacy + Free Roof, © "All rights reserved." |
| `footer-extended` | `site-src/partials/footer-extended.html` | 14 | Longest link set, 4-column grid, cert bar **without** the marker, trust chips. **No Privacy, no Free Roof** |
| Hand-built rich grid | 28 pages | index, privacy, review, the-pledge, visualizer, areas/index, 7 microsites, blog/roof-financing | Pre-dates the partial migration. `.footer-grid{max-width:1200px}`; never restamped |
| Slim funnel footer | 8 pages | `.sc-foot` / `.fr-foot` / `.sr-foot` / `.mini-footer` / `.foot` | One-line phone + link row for conversion pages. `inspect.html:242` and `estimate.html:944` are the correct exemplars (they carry © + Privacy) |
| No footer | 5 pages | 404, offline, sites/index, tools/index, google stub | System / noindex / internal — correct as-is |
| Tenant footer | `docs/sites/t/index.html:83` | 1 | `<div id="footIdentity">` injected at runtime from tenant config |

**Deliberate and verified — do not "fix":** the cert bar's absence from `footer-blog`/`footer-extended` is a partial-level decision (142 pages carry the marker; a perfect partition, zero pages diverge from their partial). `jd@` in all four footers is correct; `info@` correctly appears nowhere in the marketing tree. The `.section-inner` width tiering (900px services / 1000px areas / 1200px hubs) has zero mixing across 143 pages. The 1100px cert bar and the 1200px footer grid never appear on the same page.

---

## Pages that match no variant

| Page | What it should be | How it diverges |
|---|---|---|
| `docs/blog/roof-financing-cincinnati-explained.html` | `nav-blog` + `footer-blog` | The only blog page with **zero** `nbd:partial` markers. Hand-built footer (`:374-386`) has no cert bar, no GAF/TAMKO independent-contractor disclaimer, no social icons, no Privacy, no Free Roof, no trust chips, `<h4>` instead of `<h2 class="footer-col-title">`, and 4 × bare `tel:8594207382`. Also missed the whole CTA colour sweep (`:52`, `:87`, `:117`, `:66` all still `var(--orange)` = 3.07:1) |
| `docs/free-roof/index.html` | `nav-tool` + slim footer w/ © + Privacy | Hand-rolled `.fr-head` header (`:218`), CSS forked from `storm-check.html`. Footer (`:395`) has no ©, no Privacy — and the page collects name/address/phone |
| `docs/free-tools/index.html` | `nav-tool` + slim footer w/ © + Privacy | Hand-rolled `.fr-head` (`:88`), footer (`:168`) no © / no Privacy |
| `docs/roof-score.html` | `nav-tool` + slim footer w/ © + Privacy | `.sc-head` (`:153`), emoji "📞 Call Joe" instead of SVG, Bebas wordmark instead of the logo image, footer (`:290`) no © / no Privacy |
| `docs/storm-check.html` | same | `.sc-head` (`:130`), same three divergences, footer (`:253`) |
| `docs/storm-report.html` | same | `.sr-head` (`:118`), same, footer (`:193`) |
| `docs/inspect.html` | `nav-tool` | `.topbar` (`:146`) — **no `position:sticky`**, so the header scrolls away only on this page; call button is "☎ (859) 420-7382", a third treatment. Footer is correct |
| `docs/services/gaf-timberline/index.html` | brand-microsite nav + hand-built grid footer | Nav (`:306`) drops Pledge/Guarantee/Build entirely and points "Services" at `/services/roof-replacement`; mobile menu has no route to the three promise pages at any breakpoint. Footer cert bar (`:661`) has only 2 badges. Four `<h2 class="footer-col-title">` (`:623,633,644,653`) with **no matching CSS rule** — renders ~1.275rem mixed-case at 70% opacity. `:673` says GAF trademarks belong to "GAF Materials LLC" three lines below its own cert bar saying "BMIC LLC" |
| `docs/services/tamko-storm-series/index.html` | same | Byte-identical nav to gaf-timberline; cert bar (`:713`) 2 badges; unstyled `footer-col-title` (`:676,686,696,705`); self-contradicting trademark owner at `:725` |
| `docs/services/gaf-pivot-boot/index.html` | brand-microsite nav | Nav (`:216`) drops both "Services" and "About Joe"; cert bar (`:437`) 2 badges; trust-chip row (`:406`) 3 chips instead of 4 |
| `docs/services/roofivent/index.html` | same | Nav (`:211`) drops "About Joe"; cert bar (`:470`) 2 badges; chip row (`:439`) 3 chips |
| `docs/services/the-nbd-build/index.html` | same | Cert bar (`:486`) 2 badges; chip row (`:453`) 3 chips |
| `docs/services/lumanail/index.html` | same | Nav (`:403`) drops `/#services`; cert bar (`:788`) 2 badges; chip row (`:734`) 3 chips; **footer column repeats three links** (`:743-747`) — LumaNail and GAF Timberline render twice, in two different oranges |
| `docs/services/the-nbd-guarantee/index.html` | same | Cert bar (`:874`) 2 badges; `.decide-result` (`:189`), `.decide-options button.selected` (`:187`) and `.gtss-cta` (`:667`) still white-on-`#e8720c` |
| `docs/areas/index.html` | `footer-area`-class chrome | Cert bar (`:520`) 2 badges — the only non-microsite page in that set |
| `docs/the-pledge/index.html` | hand-built grid footer (accepted) | Sticky CTA bar collapses at **680px** while the other 202 pages collapse at 768px — no CTA bar renders between 681–768px. No `env(safe-area-inset-bottom)` despite `viewport-fit=cover` |
| `docs/index.html` | hand-built (accepted) | Carries a private inlined fork of `mobile-cta.css` (`:391-401`) using the shared file's exact class names. A July 2026 WCAG fix (`scripts/fix-cta-a11y-jul2026.js:209`) landed on 202 pages and skipped the homepage — `:396` still `:hover{background:var(--orange)}` where the shared file is `:active{background:#B85400}` |
| `docs/sites/free-guide/index.html` | `/sites` B2B family | Mobile menu (`:885-916`) is a byte-for-byte drifted copy of `mobile-nav-standard` missing 6 destinations, closing "Free Estimate →" while the desktop CTA says "Get Free Guide". Nav logo is a non-anchor `<div>` (`:851`) — the only one in `docs/`. `/about.html` at `:861` and `:1082` — the only `.html` self-link under `cleanUrls:true`. Footer copyright names the show ("No Big Deal with Joe Deal") not the entity (`:1081`). Footer paints `var(--navy)` #1e3a6e while its own nav paints `--navy-dark` #142a52 (`:585`) |
| `docs/pro/terms.html` | Pro chrome | Wears the **full homeowner marketing nav** — 20-item roofing dropdown, "LumaNail™ Upgrade", "Book Inspection →" to a homeowner lead form (`:267-355`) — directly above a footer that addresses the reader as a contractor (`:578`, `:617`). Also the only /pro page with no favicon link |
| `docs/pro/pricing.html` | Pro public funnel | **No nav, no header, no topbar at all** (`:88`). One of 4 URLs in `sitemap-pro.xml`. No Login control anywhere; only site links are an 11px footer run at `:230` led by "Back to Dashboard" |
| `docs/pro/how-to.html` | Pro `.topbar` | `<html style="visibility:hidden">` (`:2`) with the reveal in a **non-deferred** script at the very bottom of a 1300-line body (`:1300`). No auth gate to justify the preboot — the other 10 pages using it all have one. No `rel=canonical` despite being indexable and sitemapped. Brand mark reads **"NB"** (`:186`) — the only non-"NBD" mark in the tree |
| `docs/pro/blog/index.html` | pro/blog family | Collapses its nav at **760px** while its 5 sibling posts collapse at 900px — identical nav content, different breakpoint |
| `docs/pro/codex.html` | should not exist | Meta-refresh redirect stub (`:11`) — the last `http-equiv="refresh"` in `docs/`, the exact pattern `firebase.json:34` records as replaced by a server 301. Linked from 9 places including the primary dashboard nav |

---

## The placeholder logo badges

**Found — one, and it is exactly what you described.**

`docs/index.html:1574` — the sixth tile of the "Certifications & Brand Partners" strip fakes the Acorn Finance logo with two Arial text spans inside the same 96×96 white rounded chip that United Restore and James Hardie use for real `<img>` marks:

```html
<div role="img" aria-label="Acorn Finance — homeowner financing marketplace partner"
     style="background:white;border-radius:6px;…width:96px;height:96px;…">
  <span style="font-family:Arial…;font-weight:800;color:#142a52;…">ACORN<br>FINANCE</span>
  <span style="font-family:Arial…;color:#5d6673;…">FINANCING<br>MARKETPLACE</span>
</div>
```

It is the only `role="img"` text substitute on the entire marketing site (the other 8 wrap real inline `<svg>` stars in `docs/review.html`). No asset exists to swap in — `docs/assets/partners/` holds only `james-hardie.svg` and `united-restore.png`, and `find docs site-src -iname '*acorn*'` returns nothing. `documentation/brand/VOICE_BIBLE.md:141` lists "Acorn Finance … partner card" under *trust signals that must become visible*, so this was meant to be a real mark. The strip is two deliberate visual groups — tiles 1-3 are orange-tinted manufacturer/certification cards with "Verify on…" links; tiles 4-6 are white-tinted partner cards. Within the 3-tile partner group, Acorn is the only one without a real mark.

**The asset exists — this is not blocked.** Checked 2026-08-19: Drive folder
`Companies › NBD › Internal › Partners › Acorn` holds five files, two added
2026-08-06:

| File | Drive ID | Size | Verdict |
|---|---|---|---|
| `download.png` | `13n-ZZ64D9kWllk4SYTocLO1T9AECezgO` | 3.9 KB | 204×192, 8-bit indexed PNG, blue/grey — correct aspect for the 96×96 tile |
| `images.png` | `1Xt2bDwLxvXhg3VApZnPB8WJQlLtKOM0W` | 10.9 KB | larger; prefer if higher-res |
| `sm-`/`lg-acorn-finance-banner.png` | — | 59/89 KB | wide banners — wrong aspect for the tile, usable on `/services/financing` |

Import as `docs/assets/partners/acorn-finance.png` and run
`check-image-privacy.js` (new image asset — the EXIF/GPS strip invariant is
CI-enforced).

**Nearest other candidates, in case you meant one of these:**

| Candidate | file:line | What it is |
|---|---|---|
| Missing American Operator badge | `docs/areas/index.html:520` + 7 microsites | 8 cert bars ship **2 badges where 187 pages ship 3**. The asset exists on disk; it is purely missing markup. The disclaimer text on those same 8 pages *was* updated — the signature of a partial copy-paste |
| "NB" brand mark | `docs/pro/how-to.html:186` | `<div class="tb-mark">NB</div>` — one character short of "NBD", in a 30px orange badge whose CSS is byte-identical to three siblings that fit "NBD" |
| Text-badge nav logo | `docs/sites/free-guide/index.html:852` | `<div class="nav-logo-badge">NBD</div>` — a text badge where every other page uses the logo image. **Deliberate**, on record at `scripts/migrate-nav-to-partial.js:53-58` |
| Bebas wordmark instead of logo image | `free-roof:219`, `free-tools:89`, `roof-score:154`, `storm-check:131`, `storm-report:119` | `<b>NO BIG <span>DEAL</span></b><small>Home Solutions</small>` where `nav-tool` and `inspect.html` use `/assets/images/nbd-logo.png`. `/estimate` and `/roof-score` — adjacent funnel steps — show different brand marks |
| Orphaned partner asset | `docs/assets/roofivent/logo-roofivent-footer.png` | Committed, referenced by nothing — but this is the vendor's own `logo2.png` per `CREDIT.txt:5`, and every brand folder has an unreferenced master. Not a placeholder |

---

## Findings by severity

### HIGH

| # | Finding | Scope | file:line | Fix |
|---|---|---|---|---|
| 1 | CTA **hover** state is *lighter* than rest and drops from 4.88:1 to 4.24:1 — below AA | 32 pages / 102 rules incl. homepage + every funnel entry | `docs/index.html:448`, `docs/storm-report.html:36`, `docs/free-roof/index.html:112`, `docs/roof-score.html:42`, `docs/storm-check.html:43`, `docs/inspect.html:71`, `docs/blog/architectural-shingles-vs-3-tab.html:96` | Replace `background:var(--orange-dark)` with `#A64B00` in all 102 `:hover` rules, matching the 123 that already use it |

### MEDIUM

| # | Finding | Scope | file:line | Fix |
|---|---|---|---|---|
| 2 | `data-nbd-certbar="v1"` missing from 53 of 195 cert bars → 79 real cert bars sit outside every cert-bar test | 53 pages + 2 partials | `site-src/partials/footer-blog.html:18`, `footer-extended.html:67`, `docs/index.html:1941`, `privacy.html:655`, `review.html:762`, `the-pledge/index.html:641`, `visualizer.html:715` | Add the attribute to both partial sources + the 13 hand-built bars; assert "GAF badge ⇒ marker" in `tests/marketing-polish-contract.test.js` |
| 3 | Primary lead-form button calls for **Barlow Condensed**, which no marketing page loads | 154 pages via `quick-lead-form.css` | `docs/assets/css/quick-lead-form.css:16` | `font-family:'Bebas Neue',sans-serif` to match `.qlf-title` in the same card |
| 4 | Montserrat ships **6× under 6 filenames**, byte-identical; 6 `@font-face` rules → the same 38KB downloaded per weight | 206 pages, 12 redundant files, 594 KB | `docs/assets/css/nbd-fonts.css:63,111,127` | One file per subset (it is already a variable font); collapse to `font-weight:400 900`; delete the 12 dupes |
| 5 | Sticky mobile bar reads **"Call Joe"** beside **"Text Us"** | 202 pages | `docs/index.html:1987` / `:1992`, `docs/about.html:915` | "Text Joe". 192 of those pages already say "Call or Text Joe" in the announcement bar directly above |
| 6 | `docs/index.html` carries a private fork of `mobile-cta.css`; a July 2026 AA fix landed on 202 pages and skipped it | 1 fork / 202-page shared asset | `docs/index.html:392-401` vs `docs/assets/css/mobile-cta.css:6-14` | Load the shared file, keep only the two colour overrides inline (check selector specificity — the fork uses bare classes) |
| 7 | `footer-blog` ships a TAMKO trademark line **omitting HailGuard™** — including on the two posts *about* HailGuard | 26 pages + 1 partial | `site-src/partials/footer-blog.html:31` | Copy the sentence from `footer-standard.html:16`, restamp. Separately patch `privacy.html:668` and `review.html:775`, which carry an even older variant missing ProShield® too |
| 8 | American Operator cert badge missing — 2-badge cert bars | 8 pages | `docs/areas/index.html:520` + 7 microsites | Paste the third anchor from `footer-standard.html:12-15` after the TAMKO anchor |
| 9 | 13 service pages send their nav CTA to `/#contact` while their own `id="quote"` form sits on the page | 13 pages | `docs/services/roof-replacement.html:567`/`:611` vs `:923` | `cta_href="#quote"` on the 13 markers + restamp. Note: the mobile CTA is hardcoded at `mobile-nav-hub.html:29` and needs a separate edit |
| 10 | `mobile-nav-hub` is a stale fork of `mobile-nav-standard` — 7 destinations short | 15 pages | `site-src/partials/mobile-nav-hub.html:1` vs `mobile-nav-standard.html:1` | Bring to parity or delete and restamp with `mobile-nav-standard`. `/visualizer`, `/roof-score`, `/free-tools` are genuinely unreachable from mobile chrome on those 15 |
| 11 | Same button labelled "Book Inspection →" on desktop, "Free Estimate →" in the mobile menu | 22 pages + 1 partial | `site-src/partials/mobile-nav-hub.html:29`; hand-built at `the-pledge:397`, `gaf-timberline:331`, `tamko-storm-series:291`, `pro/terms.html`, 4 microsites | Standardise on "Book Inspection →" (194 instances). `tests/marketing-polish-contract.test.js:178` already asserts this intent but its regex only matches `class="nav-cta"` |
| 12 | Five hand-rolled forks of the tool-page header under 4 class prefixes | 6 pages (+3 with inline dupes of the partial's CSS) | `free-roof:218`, `free-tools:88`, `roof-score:153`, `storm-check:130`, `storm-report:118`, `inspect:146` vs `site-src/partials/nav-tool.html` | Stamp `nav-tool` (requires the mobile-nav partial + its CSS block; not a drop-in) and delete the `.fr-`/`.sc-`/`.sr-`/`.topbar` blocks |
| 13 | 7 microsite navs, 4 divergent link sets; "Services" resolves to 2 different URLs | 7 pages | `the-nbd-guarantee:376`, `the-nbd-build:202`, `lumanail:403`, `roofivent:211`, `gaf-pivot-boot:216`, `gaf-timberline:306`, `tamko-storm-series:266` | Define `nav-microsite` with a fixed link set + one `active` param; at minimum normalise "Services" to `/#services` |
| 14 | Four footer column headings render as unstyled browser-default `<h2>` (~1.275rem mixed case, 70% opacity) | 2 pages, 8 headings | `gaf-timberline:623,633,644,653` + `:219`; `tamko-storm-series:676,686,696,705` + `:191` | Extend the existing selector in place: `.footer-grid h4,.footer-grid .footer-col-title{…}` |
| 15 | Orphan hand-built blog footer: no cert bar, **no GAF/TAMKO independent-contractor disclaimer**, no social, no Privacy, no Free Roof | 1 page | `docs/blog/roof-financing-cincinnati-explained.html:374-386` | Wrap in `<!-- nbd:partial footer-blog -->` and restamp — fixes all of it plus the bare `tel:` in one move |
| 16 | Two microsite footers attribute GAF marks to "GAF Materials LLC" three lines below their own bar saying "BMIC LLC" | 5 occurrences, 5 pages (all self-contradicting) | `gaf-timberline:673`, `tamko-storm-series:725`, `blog/gaf-timberline-hdz-vs-tamko-stormfighter-flex:412`, `blog/gaf-timberline-vs-tamko-storm-series:412`, `blog/owens-corning-duration-vs-tamko-hailguard:413` | Change to "BMIC LLC" (the 195-page standard) and record the decision in the vault |
| 17 | Five lead-capture pages render a footer with **no copyright and no Privacy link** — four of them collect name/address/phone | 5 pages | `free-roof:395`, `free-tools:168`, `roof-score:290`, `storm-check:253`, `storm-report:193` | Extend to the `inspect.html:242` pattern: `&copy; 2026 No Big Deal Home Solutions · … · <a href="/privacy">Privacy</a>` |
| 18 | `review.html` — the page whose job is routing customers to review platforms — links a Yelp slug that differs from the 196 footer icons and its own JSON-LD | 1 page, 1 link | `docs/review.html:685` vs `:30` | Change to `…-cincinnati`. Docs name that as the only listing that exists |
| 19 | 10 remaining white-on-`#e8720c` text surfaces (3.07:1) on marketing pages | 10 rules / 5 pages | `estimate.html:212,215`, `the-nbd-guarantee:187,189,667`, `roof-financing:52,87,117`, `the-pledge:149`, `visualizer:146` | `background:#B85400` |
| 20 | Homeowner-facing CRM controls still white-on-`#e8720c` | 3 rules / 2 pages | `portal.html:168-169`, `portal.html:238-239`, `estimate-view.html:187-188`; token pair at `nbd-brand.css:41,49` | Add `--nbd-orange-cta:#B85400` for text-bearing orange surfaces |
| 21 | Blog author bios claim **20+ / 15+ / 7+ years** — three incompatible, unsourced numbers | 2 wrong bios of 18 | `cincinnati-hail-season-2026.html:653`, `gaf-vs-owens-corning-vs-atlas-shingles.html:717` | Bring both to the 41-page canonical "7+ years in insurance restoration" |
| 22 | Two broken sentences from a botched we→I conversion, one in the **meta description** | 1 page, 2 strings | `docs/storm-report.html:9`, `:187` | "I document … and handle" / "I document the damage and manage the filing" — `storm-check.html:247` has the correct twin |
| 23 | "bullshitting" ships in boilerplate on 9 blog bios against a documented **1–2 site-wide** profanity budget | 9 pages (11 total instances site-wide) | `the-pipe-boot-fork.html:565` + 8 siblings; rule at `VOICE_BIBLE.md:61-63` | Rewrite the shared bio; keep the single homepage "no BS" as the deliberate instance |
| 24 | Author bio missing entirely on 8 of 26 blog posts; the 18 that have one use 9 different bios | 26 pages | `how-much-does-roof-cost-cincinnati-2026.html`, `how-to-choose-a-roofer-after-a-storm.html`, `signs-your-roof-needs-replacement-vs-repair.html` + 5 | One canonical bio; make it a partial so it cannot drift |
| 25 | Unsourced third-party statistics in customer-facing copy | 4 claims / 4 pages | `sites/index.html:477` (85%), `gaf-timberline:369` (2%), `areas/cincinnati-oh.html:460` (23% hail), `blog/architectural-shingles-vs-3-tab.html:27` (JSON-LD, 1-3%) | Cite or cut. The 23% sits 4 lines above "no manufactured urgency" on the same page |
| 26 | Two invented email aliases on public /pro pages — `support@` and `pro@` exist nowhere else in the repo | 6 pages | `pro/how-to.html:1287`; 5 × `pro/blog/*:542` etc. | Point at `jd@`, or provision the aliases and record the decision |
| 27 | `/pro/how-to` starts `visibility:hidden` with a **non-deferred** reveal script at line 1300 — no auth gate to justify it | 1 indexable page | `pro/how-to.html:2`, `pro/js/how-to.js:5`, `pro/how-to.html:1300` | Drop the hide + the reveal line; add `defer` |
| 28 | AA button fix reached index/pricing/demo/blog but not `register.html`'s "Create account" | 1 control | `pro/register.html:346-350` | Use the `#B85400` the 2026-08-18 pass applied elsewhere (login's pairing is the documented CRM contract — leave it) |
| 29 | `login.html` sells an **"Infused" tier** that exists in no plan table | 2 claims / 1 page (+ `ai-tool-finder.html:881`) | `pro/login.html:237`, `:239` | Rewrite against Free/Starter/Team/Growth/Enterprise. One claim promises Joe's personal contact against a tier nobody can buy |
| 30 | `/pro/terms` wears the full homeowner nav above a Pro footer | 1 page | `pro/terms.html:267-355` | Swap for the Pro nav pattern at `pro/index.html:1114-1133` |
| 31 | `/pro/pricing` has no navigation at all | 1 indexable page | `pro/pricing.html:88`, `:230` | Give it the `pro/index.html` sticky nav |
| 32 | `/pro/how-to` has no `rel=canonical` — the only indexable page on the site without one | 1 page | `pro/how-to.html:5`; `docs/sitemap-pro.xml` | Add `<link rel="canonical" href="https://nobigdealwithjoedeal.com/pro/how-to">` |
| 33 | `/the-pledge` sticky CTA collapses at 680px — **no CTA bar renders 681–768px** — and has no bottom safe-area inset under `viewport-fit=cover` | 1 page | `the-pledge/index.html:246`, `:251` vs `mobile-cta.css:6`,`:14` | `max-width:768px` + `calc(12px + env(safe-area-inset-bottom,0px))`. `docs/index.html:392` already does both |
| 34 | The same photo appears twice on `/our-work` under two filenames as two different jobs | 1 page + JSON-LD + homeowner wall | `our-work.html:417` and `:510`; `projects.json:75` — md5 `839995285c0d…` identical | Swap the "Multi-Section Complex Roof" hero in `projects.json` and rerun `build-projects.mjs` |
| 35 | `ensure-nav-css.js` still carries the exact stale exclusions `ensure-icon-css.js` was widened out of, incl. a dead `free-guide` entry | 1 script, 46 pages unwalked | `scripts/ensure-nav-css.js:49` vs `scripts/ensure-icon-css.js:29-33` | See §7 |
| 36 | Nothing requires a marketing page to have chrome markers — 22 pages are ungoverned | gate | `scripts/apply-partials.js:176` | See §7 |
| 37 | Inline-event-handler CSP guard is a 9-page hardcoded array that silently skips missing files; 0/211 marketing pages covered | gate | `tests/smoke/dashboard.test.js:523`, `:536` | See §7 |

### LOW

| # | Finding | Scope | file:line |
|---|---|---|---|
| 38 | Placeholder logo chip never swapped for the real Acorn Finance mark | 1 tile | `docs/index.html:1574` |
| 39 | `footer-extended` omits Privacy + Free Roof that the other 3 partials carry → 31 marketing pages have no route to the privacy policy | 14 pages + 1 partial | `site-src/partials/footer-extended.html:83` |
| 40 | Five brand/microsite footers drop the "5-Star Rated" trust chip that 48 siblings show | 5 pages | `the-pledge:608`, `gaf-pivot-boot:406`, `roofivent:439`, `the-nbd-build:453`, `lumanail:734` |
| 41 | LumaNail footer repeats 3 links in one column, two rendering in different oranges | 1 page | `lumanail:743-747` |
| 42 | `sites/free-guide` copyright names the show, not the entity; `/about.html` ×2 | 1 page, 3 lines | `sites/free-guide:1081`, `:1082`, `:861` |
| 43 | `estimate.html` + `storm-alerts.html` carry social icons and Privacy but no `jd@` email — the only 2 of 197 that break the pairing | 2 pages | `estimate.html:949`, `storm-alerts.html:431` |
| 44 | Footer "pro door" renders at 3.36:1 — `opacity:.55` compounds with an inherited `.7` | 142 pages, 2 partials | `footer-standard.html:27`, `footer-area.html:27` |
| 45 | `sites/free-guide` footer is `--navy` #1e3a6e while its own nav is `--navy-dark` #142a52 | 1 page | `sites/free-guide:585`, `:8` |
| 46 | `docs/sites/index.html` + `docs/tools/index.html` redefine `--orange` to off-palette `#C8541A`; free-guide footer text 3.77:1 | 2 pages | `sites/index.html:34,35,401` |
| 47 | Partial sources mix `#f08030` and `var(--orange-light,#f08030)` — 5 of 6 partials internally mixed | 189 pages, 6 partials | `nav-standard.html:13` vs `nav-blog.html:7` |
| 48 | 3 CRM pages set `theme-color` to `var(--bg)` — browsers ignore it | 3 pages | `pro/customer.html:8`, `pro/dashboard.html:40`, `dashboard.legacy.html:40` (correct value is `#19305a`) |
| 49 | 9 blog pages with a Services dropdown never load `nav-faq.js` — dead `.dropdown.open` CSS; clicking Services navigates away | 9 pages | `blog/the-pipe-boot-fork.html:324`; `docs/assets/js/nav-faq.js:42` |
| 50 | Dead orphan nav script, would throw if loaded | 1 file | `docs/assets/js/inline/a480f74bc8.js:97` (do **not** delete `sites/js/marketing-firebase.js` — it is live) |
| 51 | `apply-partials.js` asserts the hamburger contract on `nav-standard` only | 29 pages | `scripts/apply-partials.js:81`, `:84` |
| 52 | No `aria-current` anywhere; 3 competing you-are-here conventions | ~19 pages | `the-nbd-guarantee:377`, `gaf-timberline:322` |
| 53 | Font preload (1 page) and CLS metric-override fallbacks (2 pages) never rolled out | 206 pages | `docs/index.html:23`, `roof-score.html:27`, `storm-check.html:28` |
| 54 | 39 of 43 Google-Fonts pages omit the `fonts.gstatic.com` preconnect; `photo-editor.css` names Inter, which nothing loads | 39 + 1 | `pro/customer.html:13`, `pro/css/photo-editor.css:40` |
| 55 | 2 CRM pages style in Barlow but load no font source; `diagnostic.html` renders in Courier | 2 pages | `pro/codex.html:14`, `pro/diagnostic.html:12` |
| 56 | 11 category-mixed font stacks (sans falling back to mono) | 9 files | `dashboard-app.css:406`, `kanban-force.css:78`, `theme-bridge.css:101`, `pro/diagnostic.html:12` + 7 |
| 57 | `areas/index.html` hero uses clamp+em while its own 25 city leaves use fixed 3.2rem + `1px` — hub headline up to 50% larger | 26 pages | `areas/index.html:68` vs `areas/mason-oh.html:83` |
| 58 | `.btn-primary` ships 9 padding values and 2 radii | 28 rules / 27 files | `the-pledge:103`, `index.html:109`, `review.html:193`, `estimate.html:90` + 24 |
| 59 | Wide-desktop nav tier (1441/1600px) missing from 28 pages incl. 21 of 27 blog posts | 28 pages | `areas/mason-oh.html:279`, `:286` |
| 60 | Dead layered nav-collapse rules: 62 pages carry 900+1024, 5 blog posts carry 780+900+1024×2 | 67 pages | `blog/why-class-4-impact-shingles.html:42`, `:131`, `:160`, `:212` |
| 61 | `pro/blog/index.html` collapses nav at 760px, its 5 siblings at 900px | 6 pages | `pro/blog/index.html:61` |
| 62 | 14 distinct radii on marketing; the pill radius spelled 3 ways | site-wide | `sites/index.html:133`, `the-pledge:206` |
| 63 | Sticky mobile bar's two buttons have 2px vs 1px borders → 2px height mismatch | 202 pages | `mobile-cta.css:9`, `:11`; `index.html:395`, `:397` |
| 64 | Two favicons across /pro, assigned backwards — the homeowner portal flies the contractor app icon | 29 + 6 pages | `pro/portal.html:8`, `pro/photo-review.html:8` |
| 65 | `login.html` ships a stale inline copy of the theme table contradicting `theme-system.css` (incl. the bug audit F-3 fixed) | 1 page, 18 lines | `pro/login.html:193-210` vs `pro/css/theme-system.css:7` |
| 66 | Every `/pro/blog` post carries the same ~135-line `<style>` twice; the 2nd copy reverts a 2026-08-11 fix | 5 pages, ~670 dup lines | `pro/blog/google-maps-contractor-ranking.html:96` vs `:232` |
| 67 | `codex.html` meta-refresh stub — last of a pattern already replaced by server 301s | 1 stub + 9 links + 3 JS maps | `pro/codex.html:11`; `firebase.json:34` |
| 68 | Brand mark reads "NB" | 1 line | `pro/how-to.html:186` |
| 69 | `dashboard.legacy.html` has drifted to 670 diff-lines (handoff says 562); missing Job Templates + the keyboard retrofit on 31 nav items | 1 page | `pro/dashboard.legacy.html:720`; `NEXT_SESSION-2026-08-07.md:70` |
| 70 | 4 lead forms use **NBD's own number** as the homeowner's phone placeholder | 4 pages | `index.html:1721`, `roof-score.html:256`, `storm-check.html:222`, `storm-report.html:162` |
| 71 | "Start Your Free Trial" survives on the /pro final CTA after the sweep relabelled nav + hero | 1 control | `pro/index.html:1916` |
| 72 | "The Pledge" is a top-level nav item on 32 pages and absent (desktop only) from 162 | 1 partial | `site-src/partials/nav-standard.html:9` vs `nav-blog.html:7` |
| 73 | 10 bare `tel:8594207382` vs 1,005 E.164; generator `wrap-ann-bar-phone-tel.js:19` stamps the bare form | 8 static + 2 JS | `blog/roof-financing:170,310,350,383`; `scripts/wrap-ann-bar-phone-tel.js:19` |
| 74 | One blog page points `apple-touch-icon` at an SVG (iOS ignores SVG) | 1 page | `blog/roof-financing:22` |
| 75 | 22 orphaned assets, ~2.99 MiB, incl. two byte-identical LumaNail dupes | 22 files | `assets/lumanail/pack-blog-1.jpg`, `pack-blog-2.jpg`, `images/roofing-3/4.*`, `drone-completed-brick.webp` |
| 76 | `/pro/terms.html` ships no favicon link at all | 1 page | `pro/terms.html:10` |
| 77 | `marketing-polish-contract.test.js` excludes `sites/` + `tools/` from 11 applicable assertions | 4 pages | `tests/marketing-polish-contract.test.js:56` |
| 78 | Shared-stylesheet coverage enforced on 4 hardcoded pages while 209 of 211 depend on it | gate | `tests/marketing-polish-contract.test.js:100` |
| 79 | `firebase.json` header `source`s are verified by nothing; `/sites/template` targets a path that no longer exists | 1 dangling of 29 | `scripts/check-site-integrity.js:70`; `firebase.json:206` |
| 80 | `check-site-integrity.js`'s admin exclusion is justified by a KNOWN DEFECT comment describing a bug fixed in `37ebd865` | 1 comment block | `scripts/check-site-integrity.js:29-36` vs `docs/admin/index.html:17` |

---

## Fix waves (tracked in the handoff)

### Wave 1 — Contrast completion ⚠️ **MERGE-COLLISION RISK**
**Changes:** #1 (102 hover rules → `#A64B00`), #19 (10 remaining white-on-`#e8720c`), #20 (CRM `--nbd-orange-cta`), #28 (`register.html` submit), #46 (free-guide footer text), **#44 (pro-door contrast)**.
**Files:** 32 marketing pages' inline `<style>` blocks; `docs/pro/css/nbd-brand.css`; `docs/pro/portal.html`, `estimate-view.html`, `register.html`; **`site-src/partials/footer-standard.html:27` and `footer-area.html:27`**.
**⚠️ Collision:** another agent is on `feat/footer-standard-careers-partners` editing `site-src/partials/footer-standard.html` right now. **Split #44 into its own commit at the end of this wave, or defer it entirely** — it is a 2-line change in a file being concurrently rewritten, and its 142-page restamp will produce a large diff that guarantees conflict. Everything else in Wave 1 touches zero partials and is collision-free.
**Gate:** `node tests/marketing-polish-contract.test.js` (contract 13 pins `--gray`/`#6b7280`); manual contrast recheck. **Size: M**

### Wave 2 — Cert bar, badges, and trademark truth
**Changes:** #8 (American Operator badge ×8), #7 (HailGuard™ in `footer-blog` + hand-patch privacy/review), #16 (BMIC LLC ×5), #2 (`data-nbd-certbar` markers in 2 partials + 13 hand-built bars), #14 (`footer-col-title` CSS on 2 pages), #40 ("5-Star Rated" chip ×5).
**Files:** `site-src/partials/footer-blog.html`, `footer-extended.html`; 8 microsite/area pages; `privacy.html`, `review.html`; `gaf-timberline`, `tamko-storm-series`. **Does not touch `footer-standard.html`** — it is the source you copy *from*.
**Gate:** `node scripts/apply-partials.js --check --diff`, `node tests/marketing-polish-contract.test.js`. **Size: M**

### Wave 3 — Nav contract normalization
**Changes:** #9 (13 × `cta_href="#quote"`), #10 (mobile-nav-hub parity or deletion), #11 (unify the mobile CTA label to "Book Inspection →" across 1 partial + 8 hand-built), #13 (define `nav-microsite`, normalise "Services" to `/#services`), #49 (`nav-faq.js` on 9 blog pages), #72 (top-level Pledge in `nav-standard`), #61 (`pro/blog/index.html` 760→900px).
**Files:** `site-src/partials/mobile-nav-hub.html`, `nav-standard.html`; 13 service pages' markers; 7 microsites; 9 blog pages.
**Gate:** `node scripts/apply-partials.js --check --diff`, `node scripts/ensure-nav-css.js`, `node scripts/check-site-integrity.js --quiet`. **Size: M** (L if `nav-microsite` is built rather than hand-normalised)

### Wave 4 — Orphan-page adoption
**Changes:** #15 (`roof-financing` footer → `footer-blog` marker; also fixes its bare `tel:`, `<h4>` headings, missing disclaimer — findings #73/#74 partly), #17 (© + Privacy on 5 slim footers), #39 (Privacy + Free Roof into `footer-extended`), #12 (stamp `nav-tool` on 6 funnel headers), #41 (LumaNail dupes), #42 (free-guide copyright + `/about.html`), #45 (free-guide footer navy), #43 (`jd@` on estimate + storm-alerts), #33 (`/the-pledge` breakpoint + safe-area), #30/#31 (`/pro/terms` nav, `/pro/pricing` nav).
**Files:** `site-src/partials/footer-extended.html`; `blog/roof-financing-cincinnati-explained.html`; 6 funnel pages; `sites/free-guide/index.html`; `the-pledge/index.html`; `pro/terms.html`, `pro/pricing.html`.
**Gate:** `node scripts/apply-partials.js --check --diff`, `node scripts/check-site-integrity.js --quiet`, `node scripts/ensure-nav-css.js`. **Size: L** — split the `nav-tool` stamping into its own commit; it needs the mobile-nav partial and the injected CSS block, so it is not a drop-in.

### Wave 5 — Copy, claims, and CRM funnel truth
**Changes:** #5 ("Text Us" → "Text Joe" ×202 + the two plural leaks at `index.html:1332` and `free-tools:96`), #21 (bios ×2), #22 (storm-report grammar), #23 (profanity ×9), #24 (canonical bio on 26 blog pages), #25 (source or cut 4 statistics), #26 (`support@`/`pro@` → `jd@`), #29 ("Infused" tier), #71 ("Start Your Free Trial"), #18 (Yelp URL), #70 (555 placeholders ×4), #34 (`/our-work` duplicate photo via `projects.json`), #38 (Acorn logo — **unblocked, see below**: the mark exists in Drive).
**Files:** 202 marketing pages (mechanical string swap), 11 blog pages, `pro/login.html`, `pro/index.html`, `pro/how-to.html`, 5 `pro/blog` pages, `docs/assets/data/projects.json`, `docs/index.html`.
**Gate:** `node scripts/build-projects.mjs --check`, `node tests/marketing-polish-contract.test.js`. **Size: M**

### Wave 6 — Bytes and gate widening
**Changes:** #4 (Montserrat/Dancing Script dedupe, −594 KB), #3 (`.qlf-btn` font), #6 (de-fork `mobile-cta.css` from the homepage), #63 (`align-items:stretch` on the CTA strip), #75 (delete 22 orphan assets / move brand masters to `hosting.ignore`), #50 (`a480f74bc8.js`), #67 (`codex.html` → 301), #66 (dedupe `pro/blog` `<style>` ×5), #65 (`login.html` theme stub), #48 (`theme-color` literals), plus every gate widening in §7.
**Files:** `docs/assets/css/nbd-fonts.css`, `docs/assets/fonts/`, `quick-lead-form.css`, `docs/index.html`, `firebase.json`, `scripts/ensure-nav-css.js`, `tests/marketing-polish-contract.test.js`, plus 2 new scripts.
**Gate:** `node scripts/check-js-syntax.js`, `node scripts/check-site-integrity.js --quiet`, `node scripts/build-sitemap.js`, `node tests/marketing-polish-contract.test.js`, and the two new gates run green against their seeded EXEMPT lists. **Size: M**

---

## Gate gaps

| Defect | Which gate should have caught it | Smallest widening |
|---|---|---|
| #8 American Operator badge missing on 8 pages | `tests/marketing-polish-contract.test.js:244` **does** assert the badge — but `:227/:233` scope `certBarTargets` to pages carrying `data-nbd-certbar="v1"`, exactly the attribute those 8 hand-built bars lack | Assert the invariant on the *asset*, not the marker: **every page containing `gaf-certified-badge-120.png` must also contain `american-operator-badge-120.png` and `data-nbd-certbar`.** ~4 lines. This closes #2 and #8 together and makes the two counts unable to diverge again |
| #15/#36 orphan pages with hand-built chrome | Nothing. `apply-partials.js:176` skips markerless files before any check runs | New `scripts/check-chrome-governance.js` in the zero-install `site-integrity` job: walk `docs/` minus `pro\|admin\|dev\|assets`; every page containing `<footer` or `class="nav-links"` must carry an `nbd:partial (nav-\|footer-\|mobile-nav-)` marker **or** appear in an explicit `EXEMPT` array with a one-line reason. Seed with the 22+7 current pages — the list becomes the decision record that does not exist today, and page #23 fails CI |
| #3 unloadable font, #53 preloads, #78 stylesheet coverage | `tests/marketing-polish-contract.test.js:100` checks `nbd-mobile.css` on a hardcoded 4 pages | New `scripts/check-shared-css.js`: a table of `{ css, EXEMPT: [page, reason] }` for `nbd-fonts.css` (206/211), `nbd-mobile.css` (209/211), `mobile-cta.css` (202/211). Seed EXEMPT with the real absences — note `mobile-cta.css` needs 9 entries (404, offline, index, the-pledge, sites/×3, tools, google stub), not the 4 an obvious seed would give |
| #35 `ensure-nav-css.js` blind to `docs/sites/**` | The gate itself | `scripts/ensure-nav-css.js:49` → `['admin','assets','deploy']`, matching `ensure-icon-css.js:33`. **Two adjustments required or the widen false-fails:** `docs/sites/free-guide/index.html` satisfies the contract with its own CSS (lines 138-207) not the marker, and `docs/pro/blog/index.html` + `docs/pro/vault.html` carry nav markup without the marker. Broaden the satisfying condition to `MARKER present OR (/\.dropdown-menu\s*\{[^}]*display:\s*none/ && /max-width:\s*1024px/)` |
| #77 `sites/`+`tools/` exempt from 11 marketing assertions | The test's own filter | Delete `!/^(sites|tools)\//` at `tests/marketing-polish-contract.test.js:56`. Most checks are already conditional on markup the page must have (`if (!s.includes('class="ico"')) continue;`), so they need no exemption. Add named per-check exemptions only for genuine failures — never a blanket directory filter |
| #79 `/sites/template` header targets a deleted path | `check-site-integrity.js` resolves redirects and rewrites at runtime, but `loadHostingConfig()` at `:70-74` never returns `headers` | Return `headers` too; for each rule whose `source` has no glob, `resolvePath(source)` must be non-null. ~8 lines, reuses everything already built |
| #37 `on*=` handlers ungated on 211 marketing pages | `tests/smoke/dashboard.test.js:523` is a 9-page hardcoded array whose `existsSync … continue` at `:536` means a rename removes a page from the guard silently | Replace the array with a walk of `docs/` minus `assets` (the global `**` CSP at `firebase.json:69-79` applies `script-src-attr 'none'` to all 253 pages anyway) applying the existing `INLINE_HANDLER_RE`. Turn the `existsSync … continue` into an explicit failure. Add the same walk for inline `<script>` bodies with no `src` — currently 0/211, so it lands green as a tripwire |
| #67 dead `pro/blog` coverage | `qc-render-sweep.js:63-68`'s `PRO_PUBLIC` list omits `docs/pro/blog/*` | Add the 6 pages to `PRO_PUBLIC`, and drop `continue-on-error: true` from the `qc-render-sweep` job (`ci.yml:1062`) once the streak reaches the 10-run bar `WEEKLY_CADENCE.md:60-65` already tracks |
| #46/#47 per-page token forks (`--orange:#C8541A`) | Only `--gray` is pinned, at `tests/marketing-polish-contract.test.js:355` | Reuse that exact idiom for `--orange:`, `--navy:`, `--navy-dark:`: scan marketing pages for the token *definition* and assert it equals the canonical value, with a named exemption for the `/sites` + `/tools` B2B design system. ~10 lines |
| #80 stale gate rationale | Nothing checks comments | Not a gate change: replace `scripts/check-site-integrity.js:29-36` with a dated note that the defect was fixed in `37ebd865`. **Do not** delete `'admin'` from `SCAN_EXCLUDED_TOP_DIRS` — the real justification for that exclusion (`:23-27`, internal non-homeowner surfaces, matching the manual sweep's documented scope) is independent and still valid |

**Already well gated, no change needed:** cost/margin privacy (`tests/catalog-cost-privacy.test.js`, three layers, mutation-tested, honours `hosting.ignore`), EXIF/GPS stripping (`check-image-privacy.js`, unconditional `docs/` walk — the cleanest selector in the suite), money-in-cents, JS syntax, and `run-test-manifest.js --check`'s completeness + self-attestation logic.
