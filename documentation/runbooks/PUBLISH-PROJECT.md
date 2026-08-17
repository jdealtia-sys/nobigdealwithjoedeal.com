# Publish a Featured Project — /our-work + service-page strips

> Runbook for adding a completed job to the public site. Written 2026-08-06
> alongside the Thumbtack-style /our-work rebuild; **updated 2026-08-10** for
> the service taxonomy + hub strips. The gallery is GENERATED:
> `docs/assets/data/projects.json` is the only editing surface, and
> `scripts/build-projects.mjs` stamps **all** of these from it:
>
> - `docs/our-work.html` — gallery, filter buttons, head JSON-LD
> - the `OURWORK-STRIP` "Recent jobs" regions on the 8 `/services/` hub pages
> - `docs/assets/data/homeowner-wall.json` — the homepage photo wall
>
> CI fails any drift (`build-projects.mjs --check`). Never hand-edit inside
> markers. One edit → every surface updates.

## The fastest way: post a job from your phone (agent session)

Open a Claude Code session on the repo and paste this filled in — the session
does everything else (re-encode, entry, restamp, gates, PR) and you tap
**Merge** in the GitHub app:

```
Post a completed job to the site:
- Customer/lead in CRM: <name>            (or "photos texted/attached")
- Town: <City, ST>                        (town only — never a street address)
- Services: <pick 1+: roof-replacement | roof-repair | siding-replacement |
             siding-repair | gutter-replacement | storm-damage | roof-inspection>
- What we did (2–3 sentences, your voice): <...>
- Retail price range (optional, nearest $500–$1,000): <$X–$Y or "skip">
- Homeowner consent to publish photos is on file: yes
```

The session must follow the rest of this runbook (photos re-encoded via
`prepare-project-images.mjs`, alt text written fresh, entry APPENDED at the
end of projects.json, all stamped files committed). Nothing auto-publishes —
you review the PR preview and merge.

## Before you start — the three hard rules

1. **Retail ranges only.** `priceLow`/`priceHigh` are what a customer would
   pay, rounded to the nearest $500–$1,000, both-or-neither. Never internal
   cost, margin, or supplier figures — the build and
   `tests/catalog-cost-privacy.test.js` both fail on cost-family keys, on
   purpose. Skipping the price on a project is always allowed.
2. **City-level location only.** `"Mason, OH"`, never a street address. The
   photos show the house; the price is a range; the city keeps a neighbor
   from computing what a specific household spent.
3. **Consent + clean photos.** `consentOnFile: true` is you attesting the
   homeowner is fine with their (unidentified) house being shown. Photos must
   be re-encoded copies — the re-encode strips camera GPS/EXIF. **Never**
   paste CRM storage URLs (`firebasestorage.googleapis.com/...?token=` links
   bypass security rules forever — that pattern was deliberately retired in
   #698/#702), and never reuse CRM `photo.location`/`photo.description` text
   (it can be property-derived).

## Steps

1. **Pick the job.** Completed, consented, photos you're proud of. Check the
   photo set tells a story (before → during → after reads great in the
   carousel).

2. **Export the ORIGINAL photos** from the CRM photo hub to your machine
   (download, not link-copy).

3. **Re-encode them:**

   ```bash
   node scripts/prepare-project-images.mjs <slug> photo1.jpg photo2.jpg ...
   ```

   This writes 800×600 JPG+WebP pairs into `docs/assets/images/projects/`
   (metadata stripped) and prints a `photos[]` stub with **empty alt fields**.
   No sharp installed? Any editor re-export at 800×600 JPG ≤160KB works —
   re-exporting strips EXIF too.

4. **APPEND the entry at the END** of `docs/assets/data/projects.json`
   (surfaces render newest `published` first, so append is always the right
   edit; same-date entries keep array order):

   ```json
   {
     "slug": "mason-oh-hail-replacement-2026",
     "title": "Hail Claim → Full HDZ Replacement",
     "services": ["storm-damage", "roof-replacement"],
     "tag": "Hail Damage",
     "city": "Mason, OH",
     "priceLow": 18000,
     "priceHigh": 24000,
     "year": 2026,
     "duration": "2 days",
     "description": "One–two sentences, your voice, no fluff.",
     "hero": "/assets/images/projects/mason-oh-hail-replacement-2026-1.jpg",
     "photos": [
       { "src": "...-1.jpg", "alt": "Chalk-marked hail hits on gray architectural shingles" }
     ],
     "consentOnFile": true,
     "published": "2026-08-10"
   }
   ```

   - **`services` (required, 1+)** — the labels/sorting axis. Values are the
     `/services/` hub page slugs: `roof-replacement`, `roof-repair`,
     `siding-replacement`, `siding-repair`, `gutter-replacement`,
     `storm-damage` (covers hail — that strip also stamps the hail-claims
     hub), `roof-inspection`. A job may carry several — a hail-claim tear-off
     is `["storm-damage","roof-replacement"]` and appears on BOTH hub pages'
     "Recent jobs" strips, under both /our-work filters.
   - `category` is **legacy/optional** — still accepted on old entries, no
     longer drives anything. Don't add it to new entries.
   - `tag` is the free-text orange badge on the card ("Hail Damage",
     "Craftsmanship") — display only, not a filter.
   - **Alt text**: describe what's IN the photo for someone who can't see it.
     Write it fresh — the build refuses empty alts.
   - `published` in the future = staged; it flips live on the first deploy
     after that date (same as scheduled blog posts). Heads-up: once the date
     passes, CI's `--check` reads red on the next PR until someone restamps.
   - Insurance jobs: the range is the retail value of the work, not the
     claim math. Don't publish what a carrier paid.

5. **Build and verify:**

   ```bash
   node scripts/build-projects.mjs
   node scripts/build-projects.mjs --check
   node scripts/check-site-integrity.js --quiet
   node tests/catalog-cost-privacy.test.js
   ```

   The build fails loudly on anything rule-breaking — read the message, fix
   the entry, rerun.

6. **Commit ALL stamped files** — `projects.json`, `our-work.html`, any
   restamped `/services/` hub pages, `homeowner-wall.json`, plus the new
   images — one project per commit, message like `Our Work: add <slug>`.

## AI assist (optional)

A session can draft `description` and alt text for you from the job's CRM
photo captions — ask it to "draft a featured-project entry for <customer>'s
job". It must still go through this runbook (you review the draft, the build
validates it, nothing auto-publishes). Drafts must never reuse CRM
`photo.location`/`photo.description`/caption text verbatim — property-derived
wording stays out of public pages.
