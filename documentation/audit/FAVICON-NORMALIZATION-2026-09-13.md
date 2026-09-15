# Favicon normalization — 2026-09-13

Jo: *"make the homeowner facing pages all have the same favicon and same for
the pro pages. only two across every page."* Lane A of
[NEXT_SESSION-2026-09-13](../projects/NEXT_SESSION-2026-09-13.md); the
inventory that motivated it is §3.4 of
[GROKBOT-BRIEF-VERIFICATION-2026-09-13](GROKBOT-BRIEF-VERIFICATION-2026-09-13.md).
Branch `fix/favicon-normalization`, cut from `origin/main` at `9496f859`.

## What was wrong (measured on `9496f859`, 286 HTML pages)

| Tag string | Pages |
|---|---|
| `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` | 256 |
| `<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">` | 218 |
| `<link rel="apple-touch-icon" href="/pro/img/nbd-icon-192.png">` | 23 |
| `<link rel="icon" href="/favicon.svg">` (no type) | 3 |
| `<link rel="icon" href="/pro/favicon.svg">` | 1 |
| Oaks relative `assets/img/icon.svg` / `../assets/img/icon.svg` | 11 |
| `/sites/t/site-icon.svg` | 1 |

- **The CRM flew the homeowner mark.** 31 of 36 `/pro` pages used
  `/favicon.svg` (the roof), and 23 of those paired it with the NBD PRO
  apple-touch icon — two different brands' marks on one page.
- **The one page carrying the PRO favicon was homeowner-facing**
  (`pro/photo-review.html`).
- **13 pages had no icon at all:** `admin/*.html` ×6, `pro/esign.html`,
  `pro/esign-setup.html`, `pro/refer.html`, `pro/sign.html`,
  `sites/index.html`, `sites/oaks/404.html`, `tools/index.html` (plus the
  Google verification stub, which must never have one).
- **17 homeowner pages had a favicon but no apple-touch icon** (7 blog posts,
  `book`, `careers`, `free-roof`, `free-tools`, `partners`, `privacy`,
  `roof-score`, `storm-check`, `storm-report`).
- `pro/index.html` carried the PRO apple-touch icon **twice**.
- **`docs/manifest.json` was a Pro-branded orphan**: "NBD Pro — Contractor
  Platform", `start_url /pro/dashboard.html`, **scope `/`**, linked by no
  page. An install from any homeowner page would have claimed the whole
  origin for the CRM. `docs/pro/sw.js:86` precaches only `/pro/manifest.json`.
- **No test pinned a per-page icon.** `tests/marketing-polish-contract.test.js`
  1c checks only that the two SVG files are real markup;
  `privacy.html has a favicon` checks presence of any. No `<head>` partial
  exists, so `apply-partials` could never own this.

## The rule

By **path**, then a short override map — never a page list.

| Class | Paths | Icons |
|---|---|---|
| homeowner | everything not below | `/favicon.svg` + `/assets/images/apple-touch-icon.png` |
| pro | `pro/**`, `admin/**`, `tools/**` | `/pro/favicon.svg` + `/pro/img/nbd-icon-192.png` |
| excluded | `sites/oaks/**`, `sites/t/**` | never written; must carry **no** NBD icon href |
| skip | `googlee<hex>.html` | never read for icons, never written |

**Overrides** (Jo, 2026-09-13 — pages whose audience is not their directory's):

- → homeowner: `pro/portal.html`, `pro/estimate-view.html`,
  `pro/photo-review.html`, `pro/sign.html`, `pro/esign.html`,
  `pro/refer.html` — Jo's call: a homeowner signing a contract or viewing
  their portal sees the roof mark. **`pro/invoice-success.html` was added by
  the same rule during implementation**: it was not in the list Jo was shown,
  but `functions/stripe.js:1332` sends the homeowner there after paying an
  invoice and the page is styled in the light homeowner brand. Flip it with
  one line if Jo disagrees.
- → pro: `sites/index.html` (contractor-websites offering) and
  `sites/free-guide/index.html` (contractor lead magnet).

A new page under `pro/` defaults to the PRO mark. If a homeowner will see it,
add one line to `OVERRIDES` in `scripts/normalize-favicons.js`; the contract
test pins the map's exact contents, so that is a deliberate edit.

**Why the Oaks 404 stays iconless.** It is served by the `/sites/oaks/**`
rewrite (`firebase.json`) for any mistyped URL, so a relative href resolves
against the bogus path and a site-absolute one puts NBD's mark on a client's
404 — the cross-brand leak that rewrite exists to stop.

## What shipped

- **`scripts/normalize-favicons.js`** — pure exported `classify()` and
  `normalizeIcons()`; `--check` (exit 1 on drift, on a refused page, on an
  NBD href in an excluded page, on a stale override, on a dead exclusion),
  `--list`, `--root` for fixtures. Removes every `icon` / `shortcut icon` /
  `apple-touch-icon(-precomposed)` / `mask-icon` link and inserts the
  canonical pair where the first removed tag was (keeping its indentation),
  or after `<title>`, or before `</head>`. Lines are split and rejoined on
  the file's own EOL; the output is asserted free of lone CR and bare LF
  before anything is written. Modelled on `add-ga4-tag.js` (shape) and
  `ensure-nav-css.js` (walk); **not** on `ensure-icon-css.js`, which
  hardcodes `\n`.
- **61 pages rewritten by the script, no hand edits**; 211 unchanged
  byte-for-byte; 13 excluded untouched; every changed file still
  `i/lf w/crlf`; diffs are 1–2 lines each.
- **`docs/manifest.json` deleted.** `tests/pwa-manifest.test.js` now asserts
  it stays gone (proven red with the file present). A homeowner manifest was
  rejected: no homeowner 192/512/maskable PNG exists, and that test's icon
  checks only test existence, so a rewrite could pass by lying about sizes.
- **`tests/favicon-contract.test.js`** (node bucket, 75 assertions) — the
  transform, the classifier (including never-existing paths, so the rule is
  proven rather than a list), a filesystem walk of every page, the four
  assets (SVG markup; PNG signature + IHDR 180×180 / 192×192), `--check`
  going red on a scratch tree and green once written, and the manifest.
- **CI:** `node scripts/normalize-favicons.js --check` in the
  `site-integrity` job after the nav-CSS step. Deliberately **not** in the
  deploy pre-flight until it has a green streak on `main`. FLOORS measured
  at 109/67/194.

## Proven able to fail

Against the **real pre-fix tree** (pages and manifest from `9496f859`, script
and test from this branch): exactly three assertions red — the tree walk
(61 pages), `--check` on the tree, and the root manifest.

Nine targeted breaks, each applied with a match-count guard and checked for
**which** assertion reddened:

| Break | Reddened |
|---|---|
| a PRO page reverts to the homeowner favicon | tree walk, `--check` on tree |
| the tenant template gains `/favicon.svg` | excluded-leak, `--check` on tree |
| transform joins with `\n` and the EOL guard is removed | the three CRLF assertions |
| the canonical no-op short-circuit is removed | "either order", `--check` on tree |
| the `pro/admin/tools` path rule is removed | 8 classification + tree + populated + `--check` |
| the portal override is dropped | portal override, exact override map, tree, `--check` |
| the excluded-leak check is removed from `--check` | "exits 1 when an Oaks page carries an NBD icon" |
| a new PRO page ships with no icon | tree walk, `--check` on tree |
| the root manifest comes back | "docs/manifest.json does not exist" |

**One trap hit, recorded so the next lane does not repeat it.** The first
break run restored files with `git checkout --` while an edit to the script
was still uncommitted; the checkout silently reverted it, so breaks B4–B9 ran
against old code and two unrelated assertions went red and stayed red after
"restore". The break script now refuses to run on a dirty tree, and all nine
were re-run clean. Same class as the memory note on `git checkout` reverting
the whole file: **commit before break-testing.**

## Not done, deliberately

- `/pro/favicon.svg` draws "NBD" / "PRO" with `<text font-family="Arial
  Black">`. On a system without Arial Black (most Linux/Android) the tab icon
  falls back to another font and can differ from the PNG. Converting the
  text to paths is a separate asset change.
- No homeowner web-app manifest. If "Add to Home Screen" on the marketing
  site is ever wanted, draw 192/512/maskable PNGs from the roof mark first.
- `docs/assets/images/nbd-logo.png` does not start with a PNG signature
  (found by the PNG sweep below). Browsers sniff image bytes, so it renders;
  it is not an icon and was left alone. Worth a one-line check of what format
  it really is before anything validates it strictly.

## The home-screen icon was broken, and no gate could see it

The last verification step rendered the four icons in Chromium from the
worktree. **The homeowner `apple-touch-icon.png` drew a navy band over a black
square.** The planning session had already hit the symptom without naming
it: its image read of the same file was rejected.

- Not line endings: the worktree file, the git blob and the file served by
  production were byte-identical (md5 `81dbf895…`); git marks it `-text`.
- A chunk walk found it: valid signature, valid IHDR (180×180, 8-bit RGB),
  then an IDAT whose **declared length (3,337) ends mid-stream and whose CRC
  is wrong**; the bytes after it are more compressed data, not a CRC and
  IEND. Decoders render the rows they can inflate and give up.
- **Live since #1467 (`d1250079`, 2026-09-07)**, which hand-exported it
  when the favicon was redrawn. The previous file (#944) was fine. That makes
  it the iOS "Add to Home Screen" icon for 218 homeowner pages for six days —
  and this lane was about to add it to 24 more.
- **Every gate passed it**: `pwa-manifest` checks existence, the favicon
  contract's first draft checked signature + IHDR dimensions, and
  `check-image-privacy` reads metadata. A shape check passed with the bug
  present — the same lesson as the regex tests that matched #1416's defect.
- A sweep of all 40 PNGs under `docs/` found one other structural oddity
  (`nbd-logo.png`, above) and nothing else.

**Fixed by making the PNG a build product.** `scripts/render-apple-touch-icon.js`
draws `favicon.svg` onto a 180×180 canvas in Chromium over the tile navy
(full-bleed, for iOS's own mask), re-encodes 8-bit RGB with correct chunks,
and refuses to write unless a second Chromium decode of the new bytes matches
the SVG render channel-for-channel. It is deterministic (two runs,
byte-identical, 2,537 bytes). `tests/favicon-contract.test.js` now walks every
chunk of both PNG icons — bounds, CRC, nothing after IEND, IDAT inflating to
exactly the IHDR size — **proven red on the #1467 bytes** ("bad CRC on IDAT at
byte 33") and green on the rebuild. Rerun the script whenever `favicon.svg`
changes; CI does not run it (it needs a browser), but the contract test
will fail on any malformed replacement.

## Supersedes

[DESIGN-CONSISTENCY-SWEEP-2026-08-19](DESIGN-CONSISTENCY-SWEEP-2026-08-19.md)
rows 64 (two favicons across `/pro`, assigned backwards), 74 (a blog
apple-touch icon pointing at an SVG) and 76 (`/pro/terms.html` with no
favicon) — see the dated update at the bottom of that note.

## Update 2026-09-14 — both "not done" items closed, one of them twice over

[SESSION-2026-09-14-brand-refresh-logo-favicon](../projects/SESSION-2026-09-14-brand-refresh-logo-favicon.md)
shipped a full logo/favicon artwork refresh from a new design pack. Both
items in "Not done, deliberately" above are now stale:

- **The Arial-Black `<text>` glyph is gone.** Both `docs/favicon.svg` and
  `docs/pro/favicon.svg` now draw the roofline mark as vector `<path>` data
  (from the new pack) — no font dependency, so the font-fallback risk this
  section warned about no longer applies. (The new marks *are* wordless at
  favicon size, same as the paths they replace — the "NBD" wordmark only
  appears on the 192px-and-up app icons, e.g. `docs/pro/img/nbd-icon-192.png`.)
- **`docs/assets/images/nbd-logo.png`'s PNG-signature problem was already
  fixed once, independently, the same day** — PR #1554 (`fix(brand): crop the
  wasted whitespace out of the header logo, size it up`, `516c2f5d`,
  2026-09-14 11:37) re-encoded it as a real PNG (135×75) before this session
  ever touched it. The 2026-09-14 brand-pack swap then replaced its content
  again with new 600×308 artwork — still a genuine PNG (`89 50 4E 47…`), and
  now sized closer to its actual display width. `docs/pro/js/nbd-logo-asset.js`
  and `print-assets/nbd-logo-print.png` were regenerated from the new master
  too. Full mapping and the two tooling substitutions (sharp in place of the
  repo's Python/Playwright pipelines, unavailable in that session's
  environment) are in the session note linked above.
