# 05 — Optional integrations (pick-and-choose)

Each integration is **lazy-opt-in**: if the secret isn't set, the feature hides itself gracefully.
That means you can add them one at a time on your own schedule. None are required to launch.

Rough order of impact if you're picking what to do first:

| Order | Integration | Why first | Time |
|---|---|---|---|
| 1 | Sentry | free, catches production bugs before users report them | 10 min |
| 2 | Cloudflare Turnstile | essential for public forms — blocks bot signups | 15 min |
| 3 | Slack webhook | #new-lead + security alerts visible to the team | 10 min |
| 4 | BoldSign | biggest conversion win: sign contracts at the door | 20 min |
| 5 | HOVER | biggest revenue win: $75 line item on every estimate | 25 min |
| 6 | Cal.com | homeowner self-serve booking; cuts phone tag | 15 min |
| 7 | Regrid | structured parcel data; drops LLM usage | 15 min |
| 8 | Upstash Redis | scale upgrade — skip until you're at ~1k+ DAU | 15 min |
| 9 | Deepgram | voice memos for D2D reps | 10 min |
| 10 | HailTrace | free NOAA fallback works without this; paid upgrade for real-time | 15 min |

Each one follows the same 5-step pattern:

1. **Sign up** on the vendor's site.
2. **Set the secret** with `firebase functions:secrets:set NAME`.
3. **Paste any browser-side key** (if the vendor needs one; only reCAPTCHA, Sentry, Turnstile need this).
4. **Register any webhook URL** (if the vendor pushes events to us; BoldSign, HOVER, Cal.com).
5. **Verify** in the app.

---

## 5.1 Sentry (error monitoring)

**What you get:** every client-side and server-side error is captured, stack-traced, and grouped. You get an email when a new error appears. Emails and phone numbers are auto-redacted before leaving the browser.

### Sign up
1. https://sentry.io/signup/ → free tier is plenty.
2. Create a new project — type: **JavaScript (Browser)**.
3. After creation, Sentry shows you the **DSN** (looks like `https://abc123@o123.ingest.sentry.io/456`). **Copy it.**
4. Create a second project — type: **Node.js**. Copy its DSN too.

### Set secrets
```bash
firebase functions:secrets:set SENTRY_DSN_FUNCTIONS --project nobigdeal-pro
```
Paste the **Node.js** DSN when prompted.

### Paste browser key
Open `docs/pro/dashboard.html` → find:
```html
<script>window.__NBD_SENTRY_DSN = "";</script>
```
Paste the **JavaScript (Browser)** DSN between the quotes.

```bash
git commit -am "chore(sentry): paste production DSN"
git push
```

### Verify
1. After deploy, open the dashboard.
2. In browser DevTools Console, paste: `window.NBDSentry.capture(new Error('sentry test'))`
3. Sentry web UI → the error should appear within 30s.

---

## 5.2 Cloudflare Turnstile (human verification)

**What you get:** invisible bot check on the 4 public forms (contact, estimate request, free guide, storm alerts). Real humans never see it; bots get rejected silently.

### Sign up
1. https://dash.cloudflare.com/?to=/:account/turnstile → free.
2. **Add site** → name `NBD Pro Public Forms`.
3. **Domain:** `nobigdealwithjoedeal.com`
4. **Widget mode:** `Invisible`
5. Copy the **Site key** and the **Secret key**.

### Set secret
```bash
firebase functions:secrets:set TURNSTILE_SECRET --project nobigdeal-pro
```
Paste the **Secret key** when prompted.

### Paste browser keys (4 files)
The site key goes into 4 HTML files. Same key in all of them.

Open each and find the line `window.__NBD_TURNSTILE_SITEKEY = "";`:

- `docs/index.html`
- `docs/estimate.html`
- `docs/storm-alerts.html`
- `docs/free-guide/index.html`

Paste the site key between the quotes in each.

```bash
git commit -am "chore(turnstile): paste production site key on public forms"
git push
```

### Verify
1. Deploy the HTML change.
2. Submit the contact form on https://nobigdealwithjoedeal.com → success.
3. Try `curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/submitPublicLead -H 'Content-Type: application/json' -d '{"kind":"contact","firstName":"T","phone":"5551112222","source":"test"}'` → should return 403 with `{"error":"Verification failed"}` because curl has no Turnstile token.

---

## 5.3 Slack webhook

**What you get:** a `#nbd-ops` channel gets pinged when a deal is signed, a storm alert fires, or the security-admin-grant tripwire trips. Also: new-device sign-in alerts + hail-cron summaries + Stripe dunning failures.

### Sign up
1. Slack → **Apps** → find or create an **Incoming Webhooks** app.
2. Pick the channel (`#nbd-ops` or similar).
3. Copy the **Webhook URL** — looks like `https://hooks.slack.com/services/T00/B00/XXXX`.

### Set secret
```bash
firebase functions:secrets:set SLACK_WEBHOOK_URL --project nobigdeal-pro
```

### Verify
After the next deploy, a signed deal in your pipeline will post a 💰 message to the channel.
You can also force a test: from an admin console, write `audit_log/test1` with `type: 'security_admin_grant_attempt'` and watch for the 🚨 message.

---

## 5.4 BoldSign (e-signature)

**What you get:** reps tap "Send for Signature" on a V2 estimate → homeowner signs in the portal iframe → estimate flips to ✓ SIGNED → Stripe invoice auto-drafts. Close rates up ~20% vs. email-back signatures.

### Sign up
1. https://boldsign.com/pricing → Starter or Business tier.
2. Confirm email.
3. Dashboard → **Settings** → **API** → **Generate API Key**. Copy the key.

### Set up the webhook
1. BoldSign → **Settings** → **Webhooks** → **Add Webhook**.
2. **URL:** `https://us-central1-nobigdeal-pro.cloudfunctions.net/esignWebhook`
3. **Events:** select Completed, Declined, Expired, Viewed.
4. BoldSign shows a **Webhook Secret** → copy it.

### Set secrets
```bash
firebase functions:secrets:set BOLDSIGN_API_KEY        --project nobigdeal-pro
firebase functions:secrets:set BOLDSIGN_WEBHOOK_SECRET --project nobigdeal-pro
```

### Verify
1. Open any V2 estimate with a customer email + address filled in.
2. Click **✍️ Send for Signature**.
3. Homeowner's inbox receives the BoldSign link + the estimate card flips to `✍ AWAITING`.
4. After the homeowner signs: card flips to `✓ SIGNED` within a few seconds (thanks to the live Firestore listener).

---

## 5.5 HOVER (aerial roof measurements)

**What you get:** "Auto-measure" button in the V2 estimate builder. Type an address → 15-30 min later, roof dimensions auto-fill + a $75 pass-through line lands on the estimate. Your margin.

### Sign up
1. https://hover.to/ → **For Contractors** → contact sales for API access. Self-serve signup is limited.
2. Once approved, Dashboard → **Settings** → **API** → **Generate Token**.

### Set up the webhook
HOVER pushes completed jobs to:
```
https://us-central1-nobigdeal-pro.cloudfunctions.net/measurementWebhook?provider=hover
```
Register this URL in the HOVER partner portal under "Callbacks" or "Webhooks."

### Set secret
```bash
firebase functions:secrets:set HOVER_API_KEY --project nobigdeal-pro
```

### Verify
1. V2 Builder → Auto-measure → enter a valid residential address in one of HOVER's covered regions.
2. Toast: "Measurement requested."
3. Wait ~20 min. The fields (rawSqft, ridge, eave, etc.) auto-fill; a "Aerial measurement report — $75" line appears in the scope.

**Alternative providers:** EagleView + Nearmap use the same adapter. Set `EAGLEVIEW_API_KEY` or `NEARMAP_API_KEY` and change `NBD_MEASUREMENT_PROVIDER` env var.

---

## 5.6 Cal.com (scheduling)

**What you get:** each rep has a shareable booking URL (`cal.com/<username>/roof-inspection`). Homeowners pick a time. An appointment row and reminder task automatically land in Firestore.

### Sign up
1. https://cal.com/signup → free tier is fine for a single rep.
2. Create an event type called **roof-inspection** (or match whatever slug you want reps to share).
3. **Settings** → **Developer** → **Webhooks** → **Add**.
   - **URL:** `https://us-central1-nobigdeal-pro.cloudfunctions.net/calcomWebhook`
   - **Events:** `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`.
   - **Secret:** generate a random 32-char string. Save it.

### Set secret
```bash
firebase functions:secrets:set CALCOM_WEBHOOK_SECRET --project nobigdeal-pro
```

### Each rep needs to set their username
In the dashboard → Settings → Profile → **Cal.com username** → enter (just the username, e.g. `joedeal`). Save.

### Verify
1. From a private browser window, book a slot on `https://cal.com/<rep-username>/roof-inspection`.
2. Check the rep's dashboard → Tasks. A new task "Inspection: <name>" should appear 1h before the booked time.

---

## 5.7 Regrid (parcel data)

**What you get:** typing an address in the map search returns real owner names, APNs, year built, last sale price, assessed value. Replaces LLM scrapes with structured data; cheaper + faster.

### Sign up
1. https://regrid.com/pricing → API tier (Tier 2, ~$30/month for 3k lookups).
2. Dashboard → **API** → **Generate Token**.

### Set secret
```bash
firebase functions:secrets:set REGRID_API_TOKEN --project nobigdeal-pro
```

### Verify
1. Map view → search an address in your territory.
2. The Property Intel card should now show `dataSource: Regrid` instead of an LLM-extracted block.

---

## 5.8 Upstash Redis (rate limit infra)

**What you get:** all rate-limit checks switch from a Firestore hot doc to Redis. Sub-20ms latency and no more 500-write/sec contention. Skip this unless you're seeing rate-limit warnings under load.

### Sign up
1. https://console.upstash.com/ → free tier (10k commands/day) is plenty.
2. **Create Database** → **Global** region, closest to us-central1.
3. **REST API** tab → copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.

### Set secrets
```bash
firebase functions:secrets:set UPSTASH_REDIS_REST_URL   --project nobigdeal-pro
firebase functions:secrets:set UPSTASH_REDIS_REST_TOKEN --project nobigdeal-pro
```

### Enable via env var (in `firebase.json` or via CLI)
```bash
firebase functions:config:set providers.rate_limit=upstash --project nobigdeal-pro
```

### Verify
`rate_limits/*` docs in Firestore stop growing — Redis is now handling counts.

---

## 5.9 Deepgram (voice memos)

**What you get:** "🎙 Record Voice Memo" button on every lead detail. Rep holds to record, release to auto-transcribe via Deepgram Nova-3, transcript lands on the lead's activity timeline.

### Sign up
1. https://console.deepgram.com/signup → $200 free credits on signup.
2. **API Keys** → **Create new API key**. Copy it.

### Set secret
```bash
firebase functions:secrets:set DEEPGRAM_API_KEY --project nobigdeal-pro
```

### Verify
1. Open any lead.
2. Click **🎙 Record Voice Memo**.
3. Allow microphone when browser asks.
4. Speak for 5-10 seconds, then tap again to stop.
5. Toast: "✓ Memo saved."
6. Lead activity feed shows a new `voice_memo` row with the transcript.

---

## 5.10 HailTrace (real-time hail)

**What you get:** the "⛈ Hail" button on the D2D map shows hail swath polygons from the last 24h instead of the 3-month-delayed NOAA data.

**Skip this unless** you know you need real-time hail — NOAA/IEM is free and already wired as the fallback.

### Sign up
1. https://hailtrace.com/pricing → contact sales for API.
2. Get API key.

### Set secret
```bash
firebase functions:secrets:set HAILTRACE_API_KEY --project nobigdeal-pro
firebase functions:config:set providers.hail=hailtrace --project nobigdeal-pro
```

### Verify
Tap "⛈ Hail" on the D2D map. The polygons should be recent (within hours, not months).

---

## Done when

At minimum: Sentry + Turnstile + Slack are wired (they're all free and they protect the app).
Everything else is a revenue or UX decision — add on your schedule.

---

Next: [`06-verify.md`](06-verify.md)
