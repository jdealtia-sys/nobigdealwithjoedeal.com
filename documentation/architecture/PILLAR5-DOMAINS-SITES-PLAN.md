# Pillar 5 — Custom domains & templated tenant sites

> Scoping doc, 2026-06-07. Final pillar in [MULTI-TENANT-ARCHITECTURE.md](MULTI-TENANT-ARCHITECTURE.md).
> This is what makes self-serve **scale** past hand-authoring: every tenant gets a
> branded public site on its **own domain**, generated from config — not a
> hand-built folder. Do it after Pillars 1 (provisioning) + 4 (billing).

## Current state (grounded)
- **One Firebase Hosting site** (`nobigdeal-pro`, serving `docs/`) with path rewrites (`firebase.json`). **No Host-header rewrites** — Firebase Hosting can't route by hostname within one site.
- **Oaks microsite = hand-authored static** at `docs/sites/oaks/` (index/about/contact/gallery/services/areas), driven by `shared.js`. Served at `nobigdealwithjoedeal.com/sites/oaks/` (noindex). Adding tenant #3 today = hand-authoring another `docs/sites/{t}/` tree — doesn't scale.
- **Vanity domain `oaksroofingandconstruction.com`** = a parked **Squarespace** "coming soon" page, unconnected to this repo.
- **The NBD city-page system** (`docs/areas/*`, `docs/services/*` — ~230 templated pages) is the proven model for **data-driven page generation** in this repo.

## Two sub-problems

### A. Templated tenant sites (replace hand-authoring)
- One **site template** (the Oaks layout is already a clean, brandable base) rendered from `companyProfile/{companyId}` brand + content (name, logo, colors, services, service areas, reviews, phone). Same approach as the city-page generator.
- A tenant's site = its `companyProfile` data through the template. New tenant → site exists automatically (no new folder).
- **Build vs runtime:** either (a) a build step that emits per-tenant static pages (fast, cacheable, fits the current static-hosting model — recommended), or (b) a runtime renderer (a function serves the page from config; simpler to update, more compute).

### B. Per-tenant custom domains (the big infra call)
Firebase Hosting has no Host-based rewrites, so pick one:
1. **Multi-site Firebase Hosting targets** — one Hosting site per tenant domain, IaC'd (`firebase.json` targets + `.firebaserc`). Native TLS + CDN; but each domain is a separate site to provision (scriptable via the Firebase API). **Recommended** for moderate tenant counts.
2. **Hostname-routing reverse proxy** (Cloud Run / a CDN worker) in front of Hosting that maps `oaks.com → /sites/oaks/` by `Host`. One deploy, N domains; but you own TLS + the proxy. Better at large scale.
3. Separate Firebase **projects** per tenant — strongest isolation, highest ops cost. Overkill unless a tenant demands it.

**Domain onboarding flow** (pairs with Pillar 1 provisioning): tenant adds their domain in Settings → we create the Hosting target / proxy route → show them the DNS records → verify → live.

## Phased plan
1. **Templatize** — extract the Oaks layout into a config-driven template; render NBD + Oaks from `companyProfile`. Prove parity with the current hand-authored Oaks site.
2. **Generator** — build step emits `/sites/{companyId}/*` for every active tenant from config (retire hand-authored folders).
3. **Custom domains** — implement the chosen routing (recommend multi-site targets); a `addTenantDomain` flow + DNS instructions + verification.
4. **Migrate Oaks** — point `oaksroofingandconstruction.com` at the generated Oaks site (off Squarespace); fold the in-repo `/sites/oaks/` into the generated path. (Also resolves the Pillar-2 BLEED-O2/O3 items — NBD-mobile.css navy + NBD og:image on Oaks pages — since generated pages get tenant-owned assets.)

## Open decisions for Jo
- **Generation model:** build-time static (recommended) vs runtime renderer.
- **Domain routing:** multi-site Firebase targets (recommended) vs reverse proxy.
- **Who owns DNS/TLS** per tenant, and whether domains are a paid add-on (ties to Pillar 4).
- **Oaks cutover:** when to move `oaksroofingandconstruction.com` off the parked Squarespace page.

---
**Roadmap now fully scoped:** Backbone (shipped) · Pillar 2 Brand (shipped) · [Pillar 1 Provisioning](PILLAR1-PROVISIONING-PLAN.md) · [Pillar 4 Billing](PILLAR4-BILLING-PLAN.md) · Pillar 5 (this). Recommended build order: 1 → 4 → 5, with Pillar 3 (data tenancy) hardening folded into 1.
