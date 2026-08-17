# Session 2026-08-13 — American Operator "Locally Owned & Operated" badge rollout

NBD is now certified **Locally Owned & Operated by American Operator**
(confirmation email to jd@ on 2026-08-11; official digital badge kit
supplied). This session added the badge across the public site, joining the
existing GAF/TAMKO certification rails. Jo's calls at plan time: standard
rollout (footers everywhere + homepage card + About chip + FAQ/schema),
shield art only (banners reserved for social/print), and — since American
Operator issues **no per-business profile URL and no cert ID** — the badge
links to the certifier's site generally.

## What shipped where

- **Assets** — `docs/assets/american-operator/`:
  `american-operator-badge{,-320,-120}.png` (sharp re-encode of the kit's
  649×739 `Badge.png`; palette PNG, metadata stripped; 18/17/6 KB) +
  `CREDIT.txt` provenance. Kit banners/PDFs deliberately not committed.
- **Footer cert bar, site-wide** — third anchor after TAMKO in all four
  footer partials (`site-src/partials/footer-{standard,area,blog,extended}.html`)
  → restamped 179 pages; hand-inserted into the five unpartialed cert bars:
  `docs/index.html`, `docs/privacy.html`, `docs/review.html` (entity-style
  `&rarr;`/`&amp;` matched), `docs/the-pledge/index.html`,
  `docs/visualizer.html`. Label: "Locally Owned & Operated / Certified by
  American Operator →" — deliberately **not** "Verify on …" since there is
  no per-business listing to verify against. GAF/TAMKO markup and the
  pinned disclaimer untouched.
- **Homepage** (`docs/index.html`):
  - 6th card in "Certified Installer. Real Partners. Real Backing." —
    orange-tinted certification style, shield at 96px, category
    "Certification", copy: "Independently certified · One owner on your
    project, start to finish — never a franchise or national rollup."
  - FAQ "Are you licensed, insured, and certified?" answer extended
    (HTML + FAQPage JSON-LD kept in sync).
  - LocalBusiness JSON-LD `hasCredential[]` gained the AO entry
    (`recognizedBy` americanoperator.com; no `identifier` — none exists).
- **About** (`docs/about.html`): "Certified Locally Owned & Operated" chip
  added to `.credential-strip`, right after "Owner & Operator".
- **Test pin** — `tests/marketing-polish-contract.test.js` batch-3 cert-bar
  assertion now also requires `american-operator-badge-120.png` on all 142
  city/area pages ("cert bar carries all three badges + IDs + disclaimer").

## Verification

All CLAUDE.md gates green post-change: apply-partials `--check --diff`
clean (550 regions/186 files), site-integrity 0 failures (22k refs),
image-privacy clean (PNGs aren't scanned; re-encode stripped the kit's
Figma tEXt anyway), inline-scripts/js-syntax clean, sitemap zero-diff,
build-projects clean, marketing-polish-contract **51/51** including the new
three-badge pin. Playwright visual pass (desktop 1280 + mobile 390):
homepage cert grid, homepage/city footers, About strip — no wraps/regressions.

## Notes for future sessions

- americanoperator.com apex 308s to `https://www.americanoperator.com/` —
  links use the www form.
- If American Operator ever ships per-business listing pages or cert IDs,
  upgrade the footer label to the "Verify on …" convention and add the ID —
  edit the 4 partials + 5 hand-authored bars + homepage card link, restamp.
- Physical badge is en route by mail (per their email); unrelated to the site.
