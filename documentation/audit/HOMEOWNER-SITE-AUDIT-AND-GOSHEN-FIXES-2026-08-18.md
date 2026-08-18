# Homeowner-site audit + Goshen residency-claim fix wave — 2026-08-18

Two connected lanes from one session: a six-dimension audit of all 212
homeowner-facing pages (templating, SEO, performance, a11y, conversion,
code hygiene), then a fix wave Jo picked from that audit's punch list,
which surfaced a much bigger problem than its own line item described —
a false "Joe lives in Goshen" residency claim repeated across the site.
Verification ran against the repo at each PR's base commit; PRs #1153,
#1154, #1155, #1256 are all merged and deployed, confirmed live via curl
against production, not just CI green.

## Audit summary

Six parallel passes over `docs/` (excluding `/pro`, `/admin`, `/dev`) —
home, tools, 140 service pages, 26 area pages, 24 blog posts. 42 findings,
2 critical / 13 high / 14 medium / 13 low. Root cause behind roughly a
third of them: **no shared-partial mechanism** at the time — every page
hand-duplicated its own nav/footer/CSS/CSP, kept in sync by one-off
regex scripts. (Note for anyone reading this later: `site-src/partials/`
+ `apply-partials.js` now exist and are CI-enforced — that gap has since
been closed by other work; see `CLAUDE.md`'s hard invariants. This audit
predates that system, so its "give the site a build step" recommendation
is done.)

Full findings artifact (HTML, not committed) covered: hardcoded
"Goshen, OH" footer city bug (135 pages), blog nav missing the services
dropdown (25 pages), `/tools` confused with a homeowner tool hub when
it's actually Jo's internal CRM launcher, Roof Score with zero internal
links, white-on-orange CTA contrast fails, an orphaned blog post, and
more (code hygiene, CSP drift, etc. — see PR bodies below for the ones
that shipped).

## What shipped

| PR | What |
|---|---|
| #1153 | Footer city fix (139 pages) → "Greater Cincinnati"; blog nav synced to the full dropdown (24 files); new `/free-tools` homeowner hub page; Roof Score + hub link wired into nav (164 desktop / 155 mobile pages) + missing mobile `/inspect` link; CTA contrast fixes (`.sc-cta-primary`, `.sr-cta-primary`, 4 index.html buttons) → existing `#B85400` band token |
| #1154 | Follow-up: PR #1153 hand-added `/free-tools` to `sitemap.xml`; CI's drift-check correctly caught that the generator didn't know the page existed. Added the one `CORE_PAGES` entry to `scripts/build-sitemap.js` |
| #1155 | **Goshen residency-claim removal.** Jo does not live in Goshen — he works there extensively but never claimed residency. The site said otherwise in ~20 places across 8 files: two homepage trust badges, a homepage FAQ, the Goshen area page's hero, a the-pledge FAQ, and — most directly — two Goshen service-combo pages with a literal FAQ item *"Is Joe really a Goshen resident?" → "Yes."* Also found `cincinnati-oh.html`/`covington-ky.html`'s "do you actually work here" FAQ had the visible-HTML and JSON-LD copies drifted into two different wordings on the same page (independent confirmation of the pre-partials duplication problem above). Replaced every instance with the true differentiator: 7+ years of insurance restoration work in Goshen/Clermont County specifically |
| #1256 | Two more instances the `*.html`-only sweep couldn't see: `docs/llms.txt:14` ("Based in: Goshen, OH" — plain text, invisible to an HTML grep) and a **new** paragraph on `goshen-oh.html` ("Goshen is home turf for me") added by an unrelated later commit (#1232, "Location depth round 3") after #1155 had already shipped |

Verification per PR: `check-site-integrity.js` (0 failures across ~210-212
pages each time), `apply-partials.js --check --diff` (clean once that
gate existed), `check-js-syntax.js`, `marketing-polish-contract.test.js`,
`inline-html-scripts.test.js`, plus a full repo-wide grep for every
residency-claim phrase variant (not scoped to `*.html`) before calling
each pass done. Live production curl checks after each deploy, not just
CI green — the deploy step and CI are independent gates on this repo
(see `CLAUDE.md`'s pre-push gates), so a merge does not by itself prove
anything shipped.

## Open — needs Jo, not another sweep

- **`addressLocality: "Goshen"` hardcoded in JSON-LD on all 25 `docs/areas/*.html` pages.** This is structured data (schema.org `PostalAddress`), not marketing prose — it's what Google reads as the business's registered location, not a "here's the vibe" claim. The 2026-08-15 designer-audit-verification note flagged this same field as an incidental finding and left it as "verify it wasn't meant to be the page city" without resolving it. Given everything found in #1155/#1256, it's likely wrong the same way the prose was — but unlike the marketing copy (safely generalized to "Greater Cincinnati" everywhere), this field should reflect Jo's *actual* business mailing/registration address if there is one, which this session has no way to know. **Don't guess at this one — ask Jo what the correct `addressLocality` value is, then fix all 25 in one pass** (same file, same field, trivial script once the answer is known).
- **`/tools` deliberately untouched** — confirmed genuinely rooted: has its own `firebase.json` rewrite (`/tools` → `/tools/index.html`) and links to 12 real `/pro/*` shortcuts (Ask Joe AI, CRM Dashboard, Vault, Diagnostics, Analytics, Leaderboard, etc.) — almost certainly Jo's actual daily bookmark. This is why `/free-tools` (new path) was built instead of rerouting it.
- **The noindex draft blog post** (`field-notes-joes-notebook-goes-public.html`) was **not** published. It carries a deliberate `<meta name="robots" content="noindex">`, and both `rebuild-blog-index.js` and `build-sitemap.js` correctly skip it for that reason — the original audit assumed this was an accidentally-missed publish step; it looks like an intentional draft instead. Ask Jo whether it's ready before ever removing that tag.
- **~15-page nav long tail not covered** by the sitewide Roof Score/hub insertion: the funnel tool pages themselves (self-referential, correctly skipped), premium-component sub-pages (gaf-pivot-boot, gaf-timberline, roofivent, tamko-storm-series, the-nbd-build — shorter nav variant), and a few utility pages (404, offline, Search Console verification).

## Why this matters beyond the specific fixes

Two process notes worth keeping for the next audit-flavored session:

1. **A pattern like this doesn't announce itself as one finding — it hides across file types.** The original punch-list item was "fix the Goshen footer." The real footprint was ~22 instances across 9 files including a non-HTML file (`llms.txt`) that a `*.html`-scoped grep structurally cannot see, and a JSON-LD field that reads as "just SEO data" until you notice it encodes the same false claim as the prose next to it. Always grep the whole repo, not just the file type the first instance happened to live in, before calling a copy-accuracy fix done.
2. **A merge is not a deploy, and CI green is not "verified live."** This repo runs CI and the Firebase deploy step as independent gates on push — a squash-merge to `main` does not by itself prove the change is serving to a real visitor. Every PR in this wave was followed by a live `curl` check against production, and one of the deploys was still queued behind a concurrent session's in-flight deploy for several minutes after merge — worth remembering before reporting something "shipped."
