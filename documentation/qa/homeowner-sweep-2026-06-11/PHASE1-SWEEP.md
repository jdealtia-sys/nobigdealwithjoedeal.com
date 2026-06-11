# Phase 1 — Automated Full-Coverage Sweep (all 220 pages)

> Method: static parse of every homeowner page (links/assets/anchors resolved against disk with
> Firebase `cleanUrls`/redirect/rewrite semantics) + headless Chromium load of all 214 in-scope
> pages (excl. `/admin/*`) on a local server simulating `firebase.json` behavior, capturing
> console errors, page errors, and failed requests at 1440px.
>
> Environment constraint: this session's network policy blocks ALL outbound hosts (apex domain
> and CDNs). External-link liveness and live www/apex/redirect behavior could NOT be tested —
> cataloged for a network-enabled pass. CDN-load failures during the console scan were
> classified as environment artifacts and excluded.

## Results by category

| Check | Pages | Defects found | Fixed inline | Remaining |
|---|---|---|---|---|
| Internal link integrity (incl. absolute self-refs) | 220 | 2 (both on `_TEMPLATE-last-job`) | 0 | 2 → PROPOSAL (template removal) |
| Asset integrity (img/script/css/font/srcset/og:image) | 220 | 3 (all on `_TEMPLATE-last-job`) | 0 | 3 → PROPOSAL (template removal) |
| Mixed content (http on https) | 220 | 0 | — | 0 |
| Console: JS page errors | 214 | **0** | — | 0 |
| Console: non-resource errors/warnings | 214 | **0** | — | 0 |
| Runtime first-party 404s | 214 | 48 GAF swatch probes (BY DESIGN — documented fallback, `docs/assets/gaf/timberline/README.md`) + template file | 0 | 0 real |
| Same-page anchors | 220 | 20 (TOC links → headings missing `id`, 3 blog posts) | **20** | 0 |
| Cross-page anchors | 220 | 0 | — | 0 |
| Internal links routed via redirect | 220 | 32 (breadcrumbs in 16 hail/storm location pages) | **32** | 0 (redirects kept as safety net) |
| Redirect chains/loops (firebase.json static) | 6 redirects | 0 | — | 0 |
| Sitemap accuracy | 195 entries | 1 missing (`/storm-report`) | **1** | 0 |
| robots.txt correctness | 1 | 1 (Disallow block attached only to `Timpibot` group per RFC 9309 — private-page blocks ignored by Googlebot/`*`) | **1** | 0 |
| External links (liveness) | 246 distinct URLs / 26 hosts | UNTESTABLE from this environment | — | → needs network-enabled pass or manual spot-check |

## Inline fixes applied (commits on this branch)

1. **Blog TOC anchors** — added missing `id` attributes to 20 headings across
   `how-long-does-roof-replacement-take-cincinnati`, `how-long-roof-insurance-claim-ohio`,
   `how-to-file-storm-damage-insurance-claim-ohio`.
2. **Breadcrumb canonicalization** — 16 hail/storm location pages linked the redirect aliases
   `/services/hail-damage` and `/services/storm-damage-insurance-claim`; now link the canonical
   `/services/hail-damage-insurance-claim` and `/services/storm-damage`. The 301s in
   `firebase.json` remain for external/printed links.
3. **Sitemap** — added `/storm-report` (homeowner tool, was the only public tool absent).
4. **robots.txt** — collapsed the per-bot `Allow: /` groups + orphaned Disallow block into a
   single multi-`User-agent` group so the "Block private app pages" rules actually bind for
   every crawler (previously only `Timpibot`).

## Findings carried to proposals (NOT fixed — propose-only)

- **P2 — `docs/our-work/_TEMPLATE-last-job.html` shipped to prod**: publicly reachable scaffold
  with TODO-slug links/images (the only dead links + 404 assets on the site). Recommend delete
  or move out of `docs/` (page-deletion authority required).
- **P2 — `docs/sites/template.html` shipped to prod**: second public scaffold (robots-blocked,
  but still reachable).
- **P2 — `scripts/build-sitemap.js` is stale/regressive**: running it produces 185 URLs vs the
  live 195 — it drops `/inspect`, `/storm-check`, `/the-pledge`, `/free-roof`, the
  directory-based service pages (lumanail, roofivent, gaf-pivot-boot, gaf-timberline,
  the-nbd-build, the-nbd-guarantee), `/areas/` + `/blog/` hubs, `/storm-report`, and would add
  `/pro` + `/pro/dashboard` (private). Also: it executes on ANY invocation (no arg guard) —
  verified the hard way in a scratch run during this sweep (restored from git, no harm done).
  Recommend regenerating the generator from the current sitemap before anyone runs it again.
- **INFO — GAF swatch probes**: `/services/gaf-timberline` intentionally fires ~48 image probes
  that 404 until real photos are dropped in. Documented fallback; consider a manifest file if
  the 404 noise ever matters.

## External-link catalog (for the network-enabled pass)

26 hosts, 246 distinct URLs — top: fonts.googleapis.com, cal.com (booking CTAs),
facebook/instagram/yelp/share.google (footer social), www.gaf.com (46 product links),
cdnjs.cloudflare.com, googletagmanager.com. No placeholder/example/localhost URLs found
outside the `_TEMPLATE` file. Full list: `/tmp` artifacts regenerable via the sweep script
(committed below as `tools` for the session).
