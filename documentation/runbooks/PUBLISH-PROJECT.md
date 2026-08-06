# Publish a Featured Project — /our-work

> Runbook for adding a project to the Featured Projects gallery. Written
> 2026-08-06 alongside the Thumbtack-style /our-work rebuild. The gallery is
> GENERATED: `docs/assets/data/projects.json` is the only editing surface,
> `scripts/build-projects.mjs` stamps `docs/our-work.html` between the
> `OURWORK-*` markers, and CI fails any drift. Never hand-edit inside markers.

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

4. **Add the entry** to `docs/assets/data/projects.json` (array order =
   display order; newest usually goes first):

   ```json
   {
     "slug": "mason-oh-hail-replacement-2026",
     "title": "Hail Claim → Full HDZ Replacement",
     "category": "storm",
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

   - `category` must be one of: `replacement`, `storm`, `active`,
     `specialty`, `commercial` (drives the filter buttons). `tag` is the
     free-text label shown on the card.
   - **Alt text**: describe what's IN the photo for someone who can't see it.
     Write it fresh — the build refuses empty alts.
   - `published` in the future = staged; it flips live on the first deploy
     after that date (same as scheduled blog posts).
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

6. **Commit BOTH files** (`projects.json` + the restamped `our-work.html`,
   plus the new images) — one project per commit, message like
   `Our Work: add <slug>`.

## AI assist (optional)

A session can draft `description` and alt text for you from the job's CRM
photo captions — ask it to "draft a featured-project entry for <customer>'s
job". It must still go through this runbook (you review the draft, the build
validates it, nothing auto-publishes).
