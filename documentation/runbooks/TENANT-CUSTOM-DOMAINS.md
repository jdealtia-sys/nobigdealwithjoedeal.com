# Runbook — Custom domains for tenant microsites (Pillar 5 phase 2)

> For Jo. Written 2026-07-03. Everything here is console/DNS work — no code
> changes are required for options A or B; option C is ~10 lines of
> Cloudflare Worker if/when a tenant is worth it.
>
> Context: every tenant already has a live site at
> `nobigdealwithjoedeal.com/sites/t/<slug-or-id>` (Pillar 5 phase 1), and
> tenants can set their slug in Settings → Company Profile → Your Website.
> A "custom domain" means the tenant's own `acmeroofing.com` shows that page.

## The constraint to know first

Firebase Hosting serves ONE site's content per Hosting site — every custom
domain you connect in the Firebase console serves the SAME content from the
same root. There is no "route this hostname to /sites/t/acme" in
`firebase.json`. So tenant domains need one of the three patterns below.

## Option A — 301 redirect at the tenant's DNS (start here; free, 5 min)

The tenant's domain simply redirects to their microsite URL. The address bar
changes after the click — fine for truck decals, yard signs, GBP links.

If the tenant's DNS is on Cloudflare (recommend they use it — free):
1. Cloudflare dashboard → their zone → **Rules → Redirect Rules → Create**.
2. Filter: `http.host eq "acmeroofing.com" or http.host eq "www.acmeroofing.com"`.
3. Redirect: static, **301**, target
   `https://nobigdealwithjoedeal.com/sites/t/<their-slug>`.
Most registrars (GoDaddy/Namecheap) also offer built-in domain forwarding —
same result, set "forward to" the microsite URL.

## Option B — separate Firebase Hosting SITE per tenant (only if asked)

Firebase supports multi-site Hosting (dozens of sites per project). Each
tenant site gets its own deploy target serving a copy of the template that
hardcodes their key. Real vanity URL, but every tenant added means console
setup + a deploy-target change, and the deploy workflow grows per tenant.
Not recommended until a tenant is paying enough to justify it — and at that
point option C is better anyway.

## Option C — proxy at the edge (real vanity URL, ~10 lines, later)

A Cloudflare Worker on the tenant's domain fetches
`https://nobigdealwithjoedeal.com/sites/t/<slug>` and returns it, so the
tenant's domain stays in the address bar for every page and asset. This is
the "white-label for real" option:
1. Tenant's DNS on Cloudflare, domain proxied (orange cloud).
2. Worker route `acmeroofing.com/*` →

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const upstream = new URL('https://nobigdealwithjoedeal.com');
    // Assets keep their real paths; everything else lands on the tenant page.
    upstream.pathname = url.pathname.startsWith('/sites/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/')
      ? url.pathname
      : '/sites/t/ACME-SLUG';
    upstream.search = url.search;
    return fetch(upstream, req);
  }
}
```
3. Replace `ACME-SLUG` per tenant. Ask me to productize this (one Worker,
   slug looked up by hostname from a KV map) when more than ~3 tenants want it.

## SEO note

The microsite pages are `noindex` today (same posture as /sites/oaks). If a
tenant wants their domain to RANK, that's a product decision: flipping
noindex off for tenant pages means NBD's Hosting serves indexable content
for other businesses. Fine under option C (their domain), think twice under
option A. Flag it to me and I'll split the header rule per surface.

## When a tenant asks, the 2-minute script

1. Have them set their slug (Settings → Company Profile → Your Website).
2. Open their registrar/Cloudflare, set up option A forwarding.
3. Test: their domain → 301 → the microsite renders their brand; submit the
   quote form with a `ZZ_QA_` name and confirm the lead hits THEIR pipeline.
