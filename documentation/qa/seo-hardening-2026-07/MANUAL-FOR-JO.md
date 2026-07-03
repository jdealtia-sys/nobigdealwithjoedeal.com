# Manual items for Jo — SEO/Tech Hardening 2026-07

Everything here either needs console/DNS access this session didn't have, or a
brand decision that isn't mine to make. Each item is self-contained.

---

## 1. ~~DECISION NEEDED~~ DECIDED 2026-07-02 — remaining white-on-orange CTAs (F4)

> **Jo's decision (option "C", recorded here):** darken only the genuinely-tiny
> badge/pill/ribbon elements; primary CTA buttons keep brand orange `#E8720C`.
> Implemented in `scripts/fix-tiny-badge-contrast.js` (8 elements across 4
> pages: `.about-badge`, `.wc-ribbon`, `.sc-badge`, `.nbd-tier-pill.featured`,
> the "MOST CHOSEN" inline span, `.tc-pill`, `.progress-dot.active`,
> `.filter-btn.active`). Re-audit confirms 0 tiny badges remain on `#E8720C`;
> the 137 remaining hits below the table are all deliberately-kept primary
> CTAs (`.btn-primary`, `.nav-cta`, step numbers, CTA-panel links). Scanners
> will keep flagging those — that is the accepted tradeoff. The table below is
> kept for the record.

The announcement bar is fixed on this branch (now `#B85400`, passes AA). But
the headless-Chrome audit found ~35 more element patterns rendering white text
on brand orange `#E8720C` at small sizes — 3.06:1, which fails WCAG AA for
normal-size text (needs 4.5:1; only ≥24px regular or ≥18.66px bold text may be
3:1). I did **not** change these: recoloring every primary CTA site-wide is a
de-facto brand-palette change (locked per the ground rules), and growing them
all to 18.66px+ bold is a redesign.

Full enumeration (17 representative templates × desktop+mobile; a hit count of
2 usually means "one element, seen in both viewports"):

| Element/class | Hits (17-page sample) | Computed sizes | Weights | Example text | Already passes AA-large? |
|---|---|---|---|---|---|
| `btn-primary` | 46 | 13.6px, 14.72px, 14.08px, 15.2px, 14.4px, 16px, 13.12px | 700, 800 | "Call Joe — (859) 420-7382" | no |
| `nav-cta` | 15 | 11.2px, 12.48px, 12.8px | 700 | "Free Estimate →" | no |
| `a` (misc inline CTAs) | 12 | 13.12px, 17.6px, 14.08px, 14.4px | 800, 700 | "Explore the TAMKO Storm Series →" | no |
| `div` (step chips) | 8 | 13.6px | 800 | "1" | no |
| `h2` (hero display text) | 6 | 64px, 57.6px, 25.6px | 700 | "Call Joe. I'll Take Care of It." | **YES — no action needed** |
| `p` (orange CTA panels) | 6 | 16.8px, 15.2px | 500 | "I'll come out, take a real look…" | no |
| `q-num` | 6 | 14.4px | 800 | "1" | no |
| `phone` | 4 | 17.6px | 700 | "Or send a message:" | no |
| `wc-ribbon` | 2 | 10.56px | 800 | "The NBD Guarantee" | no |
| `span` ("MOST CHOSEN" badge) | 2 | 9.6px | 800 | "MOST CHOSEN" | no |
| `nbd-tier-pill` | 2 | 11.52px | 700 | "Preferred · Most Chosen" | no |
| `sc-badge` | 2 | 10.4px | 800 | "Most Requested" | no |
| `big-num` | 2 | 40px | 400 | "5★" | **YES — no action needed** |
| `small` | 2 | 10.4px | 700 | "Google Rated" | no |
| `form-submit` | 2 | 14.4px | 800 | "Get My Free Estimate →" | no |
| `hs-btn` | 2 | 14.08px | 800 | "Get My Free Estimate →" | no |
| `filter-btn.active` | 2 | 12.48px | 700 | "All Projects" | no |
| `progress-dot.active` | 2 | 11.2px, 10.4px | 800 | "1" | no |
| `phone-cta` | 2 | 16.32px | 800 | "Call or Text (859) 420-7382" | no |
| `ico` | 2 | 18.4px | 800 | "☎" | no |
| `submit-btn` | 2 | 16px | 800 | "Request Free Inspection" | no |
| `sc-callbtn` | 2 | 13.12px | 800 | "📞 Call Joe" | no |
| `sc-next` | 2 | 16px | 800 | "Continue →" | no |
| `btn-arrow` | 2 | 14.4px, 13.12px | 800 | "→" | no |
| `sig` | 2 | 28.8px | 400 | "— Joe" | **YES — no action needed** |
| `btn-ghost-white` | 2 | 16px, 13.12px | 800 | "Text Joe Directly" | no |
| `btn-submit` | 2 | 15.2px | 800 | "Submit Entry" | no |
| `tc-pill` | 2 | 10.88px | 800 | "Most Chosen · ~50% of jobs" | no |
| `tc-cta` | 2 | 13.12px | 800 | "Get a Preferred Estimate" | no |
| `col-preferred` | 2 | 16px | 700 | "Preferred" | no |
| `gtss-cta` | 2 | 13.12px | 800 | "Explore the TAMKO Storm Series →" | no |
| `cta-primary` | 2 | 14.72px | 800 | "📞 Call Joe — (859) 420-7382" | no |
| `trust-icon` | 2 | 16px | 400 | "🤝" | no |
| `vs` | 1 | 13.12px | 800 | "VS" | no |
| `sb-call` | 1 | 12.16px | 800 | "📞 Call Joe" | no |

**Your options** (can be mixed per element):
- **(a) Darken to `#B85400`** — same fix as the announcement bar. White text
  passes at 4.55:1; visually a deeper, brick-ish orange. One more codemod pass
  and it's done; I can execute on request.
- **(b) Keep `#E8720C` but switch the text to navy `#142A52` or black** — also
  passes; bigger visual departure for CTAs.
- **(c) Accept the risk** — WCAG AA on marketing CTAs is a quality bar, not a
  legal mandate for a site like this; the scan will keep flagging it.

Note: the WooRank scan said "10 elements"; the real number is ~35 patterns.
Whatever you pick, the fix mechanic is the same codemod pattern used for the
announcement bar (`scripts/fix-ann-bar-contrast.js`).

## 2. ACTION NEEDED — www → apex 301 (F1, ~2 minutes)

The site is **Firebase Hosting** (not Cloudflare Pages, whatever the scan
assumed). `firebase.json` redirects can't match hostnames, so this is a
console step:

**If www is connected as a Firebase Hosting custom domain (most likely):**
1. [Firebase Console](https://console.firebase.google.com) → your project →
   **Hosting** → custom domains.
2. If `www.nobigdealwithjoedeal.com` is listed: remove it and re-add it
   choosing **"Redirect to an existing website"** → target
   `nobigdealwithjoedeal.com`. (Firebase's domain wizard offers redirect mode
   during setup; an existing "serve content" domain has to be re-added to
   switch modes.)

**If DNS is proxied through Cloudflare** (the Wave-127 notes in `firebase.json`
mention Cloudflare edge caching, so this may be your setup): a zone Redirect
Rule is cleaner:
1. Cloudflare dashboard → your zone → **Rules → Redirect Rules → Create rule**.
2. Custom filter expression: `http.host eq "www.nobigdealwithjoedeal.com"`.
3. Then: Dynamic redirect, status **301**, expression
   `concat("https://nobigdealwithjoedeal.com", http.request.uri.path)`,
   **Preserve query string: ON**.

**Verify after (from any machine — this session's network can't reach the domain):**
```
curl -sI http://nobigdealwithjoedeal.com/            # → 301 https://nobigdealwithjoedeal.com/
curl -sI http://www.nobigdealwithjoedeal.com/        # → 301 (https, apex)
curl -sI https://www.nobigdealwithjoedeal.com/       # → 301 https://nobigdealwithjoedeal.com/
curl -sI https://nobigdealwithjoedeal.com/           # → 200 (no loop!)
curl -sI "https://www.nobigdealwithjoedeal.com/services/financing?utm_source=x"
#   → 301 to https://nobigdealwithjoedeal.com/services/financing?utm_source=x (path + query preserved)
```

## 3. VERIFY AFTER MERGE+DEPLOY — cache headers (F2)

Deploy happens automatically on merge to main (`firebase-deploy.yml`). Then:
```
curl -sI https://nobigdealwithjoedeal.com/assets/css/nbd-fonts.css | grep -i cache-control
#   expect: public, max-age=86400        (was: max-age=300)
curl -sI https://nobigdealwithjoedeal.com/assets/js/nav-faq.js | grep -i cache-control
#   expect: public, max-age=86400
curl -sI https://nobigdealwithjoedeal.com/assets/fonts/montserrat-700-latin.woff2 | grep -i cache-control
#   expect: public, max-age=2592000
curl -sI https://nobigdealwithjoedeal.com/assets/images/joe-hero.jpg | grep -i cache-control
#   expect: public, max-age=2592000      (unchanged)
curl -sI https://nobigdealwithjoedeal.com/pro/js/dashboard-app.js | grep -i cache-control
#   expect: public, max-age=0, must-revalidate
#   (changed in the follow-up round: the Wave-127 revalidation rule's ordering
#    was fixed, so CRM app code now revalidates per request as its author
#    intended — see FOLLOWUP-LOG.md §4)
```
New operational rule this creates: **if you hand-edit a file under
`docs/assets/css|js/`, returning visitors can hold the old copy for up to 24 h.**
If a change must go out instantly, add `?v=2` to that file's references.

## 4. FYI — pre-existing quirk found in `firebase.json`, not changed

The `**/*.@(js|css)` rule (the "Wave 127 P0" one, `max-age=0, must-revalidate`)
never actually applies: the `**` rule after it wins per last-match-wins, so
JS/CSS has really been shipping with `max-age=300` all along — including
`/pro/js/**`. If the Wave-127 stale-SW symptom ever resurfaces in the CRM,
this is why. Fixing it means moving that rule below `**` — deliberately left
alone here because it changes CRM caching behavior (out of scope for this pass).

## 5. REMINDER — DMARC (your list, 5 minutes, DNS)

TXT record at `_dmarc.nobigdealwithjoedeal.com`:
`v=DMARC1; p=none; rua=mailto:<your inbox>` — monitor 2–4 weeks, then tighten
to `p=quarantine`. (SPF verified present and correct; no change needed.)

## 6. FYI — things checked and deliberately left alone

- **Phone landmine sweep:** every number other than (859) 420-7382 turned out
  to be a form placeholder (`(859) 555-1234` etc.) or the Oaks template's own
  contact number (`(513) 827-5297`, only under noindexed `sites/oaks/`).
  Nothing looked like a live wrong number on the marketing pages; nothing was
  changed.
- **JSON-LD `"email"` fields** still carry the plain address (structured data
  is meant to be machine-readable; encoding it would break the JSON).
- **Sitemap** is complete and correct at 199 URLs — the scan's "~250 pages"
  included private surfaces (pro/admin/tools/oaks). No action ever needed.
- **Orphan images** (`roofing-3/4.{jpg,webp}`, `drone-completed-brick.{jpg,webp}`,
  `drone-hero-curb.webp`, `projects/commercial-apartment-underlayment.jpg`) are
  referenced nowhere; left in place. Delete whenever, ~1.6 MB.
- **F7 minification: skipped** on the brief's own "acceptable outcome" clause
  (~13 KiB total upside).

## 7. Your non-code SEO track — GBP & reviews checklist (item 5, 2026-07-02)

The technical house is now in order. For a 4-month-old local-service domain,
these move rankings more than anything left in the code:

- [ ] **Google Business Profile completeness**: every service you offer listed
      as a GBP service, service area set, hours set, the real phone
      (859) 420-7382, website link to the apex (not www).
- [ ] **Photos weekly**: 2–3 job photos per week to GBP (before/after roofs
      outperform logos/stock). You already have the pipeline — the same shots
      that go to `our-work`.
- [ ] **Reviews cadence**: ask every completed job, same-day, via the /r QR
      link you already print. Target: steady trickle (2–4/month) beats bursts.
- [ ] **Reply to every review** (including the old ones) — response rate is a
      ranking input and social proof.
- [ ] **GBP posts**: 1 short post/month (storm season notice, financing,
      free-roof program). Low effort, keeps the profile "active".
- [ ] After the www redirect is live (§2), spot-check that GBP and any
      directories/citations point at `https://nobigdealwithjoedeal.com` (apex).

## 8. LEAD ENGINE — three switches to check + what's new (2026-07-02, direction A)

Audit result: your lead machine is nearly all built — but two delivery
channels may be silently off, and one finished feature is in rehearsal mode.

**a) Recovery emails are built but likely in DRY-RUN.** When someone starts
/estimate and bails, an hourly job is supposed to email them "want me to
finish it?" signed by you. It only SENDS when the `FUNNEL_RECOVERY_ENABLED`
env var is `true` on the `runabandonrecovery` Cloud Run service. Check/enable:
```
gcloud run services update runabandonrecovery --region=us-central1 \
  --update-env-vars=FUNNEL_RECOVERY_ENABLED=true
```
(or Cloud Console → Cloud Run → runabandonrecovery → edit → env vars).
Before flipping it, look at its recent logs — `funnel_recovery_dry_run`
entries show exactly who WOULD have been emailed; that's your preview.

**b) Your lead-alert TEXTS depend on Twilio A2P 10DLC registration.** The
code texts your cell instantly on every lead, but US carriers silently drop
messages from unregistered numbers (error 30034). Twilio Console →
Messaging → Regulatory Compliance: if the campaign isn't approved, emails
are currently your only alert channel. Finish the registration.

**c) Both email features need a REAL Resend key.** The deploy pipeline
creates placeholder secrets when missing. Firebase/GCP Console → Secret
Manager → `RESEND_API_KEY`: if the value is a stub, alerts/recovery/ack
emails all fail quietly. Also confirm your sending domain is verified in
Resend so mail doesn't land in spam.

**d) NEW as of today: homeowners get an instant "Got it — Joe here" email**
on every form submit (estimate, inspect, contact, free-roof, high-intent
storm reports), with your direct number for urgent cases. NBD leads only —
tenant leads are excluded on purpose. Test with a ZZ_QA_ lead + your own
email after deploy.

**e) Your decision, when ready:** an instant auto-TEXT to the homeowner
("Got it — Joe will call you shortly") converts even better than email, but
auto-texting requires express consent wording on the forms (TCPA). If you
want it, say so — it's a small forms-copy change + ~20 lines of code.

**f) NEW: morning digest + gated SMS ack (2026-07-02, round 2).** Every day
at 7am ET you'll get one email listing the last 24h of leads (skips when
zero). And the homeowner ack now has a TEXT version, estimate-funnel only
(that form's TCPA checkbox = express consent), default OFF. To turn on:
set `LEAD_ACK_SMS_ENABLED=true` on the leadAlert* Cloud Run services —
same mechanics as (a). Requires the A2P registration from (b) first.

**g) NEW: 24h follow-up email (2026-07-03).** Every 3 hours, leads 20-48h
old whose CRM card you never touched (stage/status still "new") get ONE
"we haven't connected yet" email from you — reply-able, with your direct
number. Ships ACTIVE (it's a service message on their own open request);
kill switch if ever needed: set LEAD_FOLLOWUP_ENABLED=false on the
leadfollowupsweep Cloud Run service. Operational note: this makes moving
a lead's stage in the dashboard meaningful — touch the card when you
reach someone, and they'll never get the follow-up.

## 9. STORM WATCHER (direction C, 2026-07-03)

Every 30 minutes the site now checks NWS Local Storm Reports for your
service area. When hail >=0.75", damaging wind (>=58mph or a damage
report), or a tornado report lands within 25mi of a service city, you get
an instant SMS + email: what fell, where, and how many /storm-alerts
subscribers sit within 15 miles (grouped by zip).

Subscriber texting ("we'll only text you when severe weather actually hits
your zip") ships OFF. Until you flip it, every storm email shows exactly
who WOULD have been texted — your dry-run preview. To go live (needs A2P
from §8b first):
```
gcloud run services update stormwatch --region=us-central1 \
  --update-env-vars=STORM_TEXT_ENABLED=true
```
Protections: max one storm text per subscriber per 24h, STOP honored by
Twilio, unknown zips never texted (they show in your email instead).
Every processed report is stored in the storm_events collection for audit.

## 10. PRO FUNNEL — one console flip + what changed (2026-07-03)

**Your 1-minute fix (audit gap #2):** the access-code signup path
("NBD-PRO" hint on /pro/register) fails in prod because the compute
service account can't mint custom tokens. Fix:
```
gcloud projects add-iam-policy-binding nobigdeal-pro \
  --member="serviceAccount:717435841570-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```
Then test: register with an access code from your access_codes collection.

**Shipped in code (gaps #3-4):**
- /pro/landing.html advertised stale plans at $29/$49/$79 ("Foundation/
  Blueprint/Professional") while checkout charges $99/$299 — the cards,
  footer, and FAQ now mirror pricing.html exactly (Free $0 / Starter $99 /
  Growth $299, trial wording accurate).
- The free-guide magnet's "guide is ready" screens now hand contractors to
  /pro/register (UTM-tagged free-guide/magnet so the new monthly report
  shows whether the magnet converts).
- Checkout no longer 403s unverified emails — a fresh signup can pay
  immediately (logged for visibility; Stripe re-collects receipt email).
