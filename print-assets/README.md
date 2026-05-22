# NBD Print + QR Tracking — Reference Sheet

What we built on 2026-05-22 (commits [cab8bef](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/commit/cab8bef) + [5855da7](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/commit/5855da7)), why it exists, and the tradeoffs.

---

## TL;DR

Two new permanent routes on the site, seven QR codes that point to them, and a way to tell at the end of a campaign which **printed piece** drove which lead or review.

- [`/inspect`](https://nobigdealwithjoedeal.com/inspect) — lead-capture landing page
- [`/r`](https://nobigdealwithjoedeal.com/r) — 302 redirect → Google review form

Every QR carries a unique `utm_source` (yard-sign, hanger, sticker, etc.) so scans are attributable to the specific physical piece.

---

## How the tracking actually works

```
┌─────────────────────┐   prospect scans   ┌──────────────────────────┐
│  Printed piece      │   ───────────────► │  URL embedded in QR      │
│  (yard sign, card)  │                    │  /inspect?utm_source=... │
└─────────────────────┘                    │  /r?utm_source=...       │
                                           └────────────┬─────────────┘
                                                        │
                              ┌─────────────────────────┴───┐
                              ▼                             ▼
                  ┌────────────────────┐         ┌─────────────────────┐
                  │  /inspect page     │         │  /r redirect (302)  │
                  │  • GA4 pageview    │         │  • UTMs pass through│
                  │  • UTMs → hidden   │         │    in Location hdr  │
                  │    form fields     │         │  • lands on Google  │
                  │  • on submit, the  │         │    review form      │
                  │    UTMs ride along │         │  • no GA event (no  │
                  └────────────────────┘         │    JS runs on a 302)│
                                                 └─────────────────────┘
```

### Where the data lands

| Signal | Where you see it | How to query |
|---|---|---|
| `/inspect` pageview with UTMs | **GA4** (Analytics → Reports → Acquisition → Traffic acquisition) | Filter Source/Medium/Campaign |
| `/inspect` form submission | Currently **browser console only** (first-ship — TODO is to wire to `submitPublicLead`) | n/a until wired |
| `/r` scan → review form open | UTMs visible in the Google profile's referral data; not in our GA | Coarse — can only see total /r hits in Firebase hosting logs |
| Total /r 302 redirects | **Firebase Hosting logs** | `firebase hosting:channel:list` / Firebase console |

### What questions you can actually answer

- "Which physical piece is generating the most leads?" → **Yes**, via GA4 source breakdown on `/inspect`
- "Which piece is driving the most Google reviews?" → **Indirect** — we know how many people scanned each `/r`-tagged piece via Firebase logs, but we can't directly connect a scan to a posted review (Google doesn't expose that)
- "What was the conversion rate per piece (scan → submitted form)?" → **Yes**, once the form is wired to a backend. Currently no.
- "Which neighborhood is responding?" → **No** — address goes into the form, but no per-piece geographic mapping yet
- "Are people scanning at night vs day?" → **Yes**, via GA4 time-of-day reports filtered by utm_source

---

## The 7 pieces — what each one is for

| File | Piece | Funnel | Why this URL? |
|---|---|---|---|
| `qr-yard-sign.png` | Yard sign at a job site | Lead | Drivers see it from the street — they need the lead form |
| `qr-banner-neighbor.png` | Banner on a fence/house during install | Lead | Neighbors of an active job; the banner is the campaign |
| `qr-banner-event.png` | Booth banner at storms/community events | Lead | Cold prospects at events — capture them |
| `qr-card-front.png` | Front of business card | Lead | "Need work?" — the lead funnel |
| `qr-card-back.png` | Back of business card | Review | "Loved working with us?" — review funnel for finished customers |
| `qr-hanger.png` | Door hanger left on neighbor doors | Lead | Cold canvass — get them to the form |
| `qr-sticker.png` | Sticker on a job-site dumpster, truck, etc. | Review | Existing customers who see "we did this work" — push them to review |

Two funnels, two URLs:
- **`/inspect`** for *acquiring* customers
- **`/r`** for *converting happy customers into Google reviews*

---

## The good (what this system gets right)

✅ **Permanent URLs, swappable destinations.** `/r` is a 302 (not 301) by design — we can repoint it from one Google listing to another, or to a different platform, by editing `firebase.json` and redeploying. The QRs printed on physical pieces never need to change.

✅ **High-error-correction QRs.** All 7 use ECC `H` (~30% redundancy), which means a yard sign covered in mud or a card with a crease still scans. Print survival was prioritized over compactness.

✅ **Self-identifying files.** Each PNG has a label strip under the QR — piece name, destination, campaign, utm_source. You can't ship a `card-back` QR to the printer thinking it was a `card-front` QR.

✅ **Single source of truth.** [scripts/generate_qrs.py](../scripts/generate_qrs.py) defines every QR. To change a destination, change one tuple and re-run.

✅ **No vendor lock-in for tracking.** UTM params are just URL query strings — they work in any analytics platform, and they're embedded in the QR itself. Even if we drop GA4, the attribution data is in the page logs forever.

✅ **Cleanly separated from /review SEO page.** `/review` is still the canonical reviews landing page (live Google Reviews widget + schema.org aggregateRating for SEO). The new `/r` is purely a print-funnel redirect — they don't compete.

---

## The bad (what to know about before you trust it)

⚠️ **`/r` can't fire a GA event.** A 302 is a server-side instruction — no JavaScript runs before the browser jumps to Google. We see `/r` hits in Firebase Hosting logs but not in GA4. If you want per-scan-on-card-back tracking in GA, we'd need an interstitial HTML page at `/r` (slower scan, ~200-400ms extra) — open follow-up.

⚠️ **Form submissions don't hit a backend yet.** First-ship `/inspect` logs the payload to the browser console and shows a success message. It does **not** write to Firestore, email Joe, or notify anyone. Until we wire it to `submitPublicLead`, leads will be lost on refresh.

⚠️ **UTMs only survive the first hop.** If someone scans `/inspect?utm_source=hanger`, then clicks a nav link to `/about`, the UTMs are gone. GA4 stitches the session attribution correctly, but anything stored in our DB needs to capture them on the *first* page load (which is what the hidden form fields do).

⚠️ **One `utm_source` per physical piece type, not per copy.** All 200 door hangers carry `utm_source=hanger`. We know "hangers are working" but not "the hangers I dropped in Loveland are working better than the ones in Mason." For per-batch tracking we'd need to print different `utm_content` or `utm_term` values — a future enhancement.

⚠️ **Card-front + card-back share `utm_source=card`.** Both sides of the business card are tagged the same, just with different routes (`/inspect` vs `/r`). If we ever want to split front-vs-back conversion rates, the back's source needs to become `card-back`.

⚠️ **Google review attribution is murky.** When someone scans `qr-sticker.png` → `/r` → Google review form, then writes a 5-star review, **we have no way to know** that scan came from the sticker. Google doesn't expose UTM params back to merchants. The best we can do is correlate `/r` scan volume with new review volume.

⚠️ **Brave / aggressive content blockers may strip query strings.** Rare, but some browser-side privacy extensions remove `utm_*` params. The route still works, just without attribution.

---

## Print specs cheat sheet

Always use **pure white background** and a "**Scan Me**" label nearby. Without the affordance, most people walk past a QR even if it's well-printed.

| Piece | Minimum printed QR size |
|---|---|
| Business cards, stickers | **0.8″** (20 mm) |
| Door hangers | **1.5″** (38 mm) |
| Yard signs, banners | **6″** (150 mm) or bigger |

These are floors. Bigger is always better — error correction H gives a lot of headroom but real-world print + lighting can be hostile.

---

## Changing things later

### Repoint the review URL (e.g., to a different listing or platform)

Edit `firebase.json` → `redirects` block → `/r` entry's `destination`. Redeploy. Printed QRs don't change.

```json
{ "source": "/r", "destination": "https://NEW-URL", "type": 302 }
```

### Add a new piece (e.g., truck door magnet)

1. Append to [scripts/generate_qrs.py](../scripts/generate_qrs.py)'s `PIECES` list:
   ```python
   ("qr-truck.png", "/inspect", "truck", "TRUCK DOOR", "Scan → /inspect (lead form)"),
   ```
2. Re-run:
   ```bash
   python scripts/generate_qrs.py
   ```
3. Update REFERENCE.md table.
4. Commit.

### Wire `/inspect` to the real backend (open follow-up)

[docs/assets/js/inspect-form.js](../docs/assets/js/inspect-form.js) currently does `console.log(data)`. Replace the `console.log` with `window.submitPublicLead('inspect', data)` — but first the server-side [submitPublicLead Cloud Function](../functions/submitPublicLead.js) needs to accept `'inspect'` as a kind. See [docs/assets/js/public-lead-submit.js](../docs/assets/js/public-lead-submit.js) for the client-side gateway.

---

## File map

```
print-assets/
├── README.md                  ← this file
└── qr-codes/
    ├── REFERENCE.md           ← QR catalog: filename → encoded URL
    ├── qr-yard-sign.png
    ├── qr-banner-neighbor.png
    ├── qr-banner-event.png
    ├── qr-card-front.png
    ├── qr-card-back.png
    ├── qr-hanger.png
    └── qr-sticker.png

docs/
├── inspect.html               ← the lead landing page
└── assets/js/inspect-form.js  ← UTM capture + submit handler

scripts/
└── generate_qrs.py            ← re-generates all 7 QRs in one shot

firebase.json                  ← /r and /yardsign redirects live here
```

---

## Open follow-ups

- [ ] Wire `/inspect` submit to `submitPublicLead` so leads actually persist
- [ ] Add a thank-you page redirect after submit (better than just hiding the form)
- [ ] Decide whether to add a GA `review_qr_scan` event via a tiny HTML interstitial at `/r`
- [ ] Add `utm_content` per print batch if/when we want per-region attribution
- [ ] Split `card-front` / `card-back` utm_source if we want per-side conversion analysis
