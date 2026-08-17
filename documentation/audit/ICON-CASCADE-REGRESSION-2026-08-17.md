# Invisible icon chips — cascade regression root-cause — 2026-08-17

**Symptom** (reported by Jo with screenshots of the live homepage): the orange
chips next to the phone/email contact methods (`.cm-icon`, homepage contact
section) and the hero wall-card phone chip (`.wc-phone-icon`) rendered as blank
solid-orange boxes — icon shapes missing.

## Root cause

Two generators disagree about icon color on solid-orange chips, and PR #1194
(`caab17ec`, the 2026-08-07 stability session) silently flipped which one wins:

- `scripts/fix-trust-icons.js` stamps a per-page `<style>` "trust-icon fix"
  block; the homepage's copy (upgraded in `8968636c`) sets `.cm-icon svg.ico`
  and `.wc-phone-icon svg.ico` to **`#fff`** — correct, the chips are solid
  orange (`background:var(--orange)`).
- The #1194 extraction moved the legacy per-page icon CSS into shared
  [`docs/assets/css/nbd-icons.css`](../../docs/assets/css/nbd-icons.css) and
  `scripts/ensure-icon-css.js --write` inserts its `<link>` **immediately
  before `</head>`** — i.e. *after* every page `<style>` block. The shared
  sheet's legacy rule colored those same icons **`var(--orange)`**. Equal
  specificity (0,2,1) + later in document order ⇒ the orange rule won ⇒
  orange-on-orange, invisible.

Live-DOM sweep confirmed exactly 3 invisible icons of 37 on the homepage
(`getComputedStyle` color == effective chip background), zero on service pages
(`cm-icon`/`wc-phone-icon` markup is homepage-only; `trust-icon` was already
`#fff` in both sources, `aci-icon` sits on a navy chip).

## Fix (this session)

- `nbd-icons.css`: moved `.cm-icon svg.ico` and `.wc-phone-icon svg.ico` into
  the `#fff` group, with a "chip contract" comment stating the sheet loads
  last and must be correct on its own.
- `fix-trust-icons.js`: EXTRA_CSS updated to the same split so a future stamp
  can't reintroduce the orange rule.

Verified on `http-server` against `docs/`: 0 invisible icons homepage +
roof-replacement spot-check; gates green (`check-js-syntax` 465 files,
`check-site-integrity` 208 pages, `ensure-icon-css` clean,
`marketing-polish-contract` 51/51).

## Same-day follow-up: nav-base CSS missing on 18 hand-built pages

Jo then spotted the Services dropdown rendering as a permanently-expanded
unstyled bullet list splattered over the header on `/the-pledge`. Different
mechanism, same family: the `nav base (injected)` `<style>` block (dropdown
hide/position rules + mobile-nav/hamburger + the ≤1024px collapse) had **no
owning generator** — 177 pages carry one byte-identical copy, but 18
hand-built pages (the-pledge, the areas index, the 7 directory-style product
pages under `services/*/`, and 9 blog posts) were created without it, so the
dropdown was never hidden and mobile nav never worked there.

Fix: new `scripts/ensure-nav-css.js` (mirrors ensure-icon-css.js — assert by
default, `--write` stamps the canonical block before `</head>`; presence
contract, so the one deliberate variant page is untouched). Stamped all 18,
wired into ci.yml after the icon-CSS gate. Verified locally: dropdown
`display:none`/`position:absolute`, hamburger hidden at desktop, on
`/the-pledge/`, `/services/lumanail/`, `/blog/the-pipe-boot-fork.html`,
`/areas/`.

## Durable lesson

The end-of-head `<link>` position makes `nbd-icons.css` the **cascade
authority** for icon color at equal specificity. Any per-page icon color
override either needs higher specificity or (better) belongs in the shared
sheet itself. See also
[SYSTEM-STABILITY-PERF-2026-08-07](SYSTEM-STABILITY-PERF-2026-08-07.md)
(the session that shipped the extraction).
