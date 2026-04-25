# NBD Pro — Cowork Deploy Dispatch
## Execute all steps below in order. Do not skip any step.

---

## CONTEXT

You are working on the NBD Pro website and CRM platform. The GitHub repo is at `https://github.com/jdealtia-sys/nobigdealwithjoedeal.com`. 33 commits have been pushed today with bug fixes, performance improvements, 3 new products, and SEO enhancements. The code is ready — this dispatch handles deployment and verification.

The local repo path is wherever Jo has it cloned. Firebase project is `nobigdeal-pro`. Cloudflare zone is `4be580f3875937e7e4860afedffc035c`.

---

## STEP 1: PULL ALL CHANGES

```bash
cd <repo-path>
git pull origin main
```

Verify: Should show 33 commits pulled. If merge conflicts appear, resolve by accepting remote (theirs).

---

## STEP 2: FIREBASE CLI SETUP

If Firebase CLI is not installed:
```bash
npm install -g firebase-tools
firebase login
```

Verify: `firebase projects:list` should show `nobigdeal-pro`.

---

## STEP 3: DEPLOY FIRESTORE RULES

```bash
firebase deploy --only firestore:rules
```

**What this does:**
- Enables 9 new Firestore collections (invoices, drip_queue, drip_log, email_log, sms_log, lead_documents, referrals, review_requests, reports)
- Enables 3 public lead capture collections (contact_leads, guide_leads, estimate_leads, storm_alert_subscribers) with field validation + honeypot protection
- Fixes customer portal "Failed to load" errors (photos, documents, invoices, messages, reports)

Verify: Go to Firebase Console → Firestore → Rules tab. Should show ~360 lines of rules with all collections listed.

---

## STEP 4: DEPLOY FIRESTORE INDEXES

```bash
firebase deploy --only firestore:indexes
```

**What this does:**
- Creates 21 composite indexes for compound queries
- Fixes: photos(leadId+userId), notifications(userId+createdAt), leads(userId+deleted), customer portal queries (documents, notes, tasks, invoices, email_log, sms_log)
- Without these, queries with multiple where clauses fail silently

Verify: Firebase Console → Firestore → Indexes tab. Should show 21 indexes (some may take a few minutes to build).

---

## STEP 5: DEPLOY FIREBASE STORAGE RULES

```bash
firebase deploy --only storage
```

**What this does:**
- UNBLOCKS PHOTO UPLOADS — this was the #1 bug
- Allows authenticated users to upload images <15MB to `photos/` path
- Allows authenticated users to upload files <25MB to `docs/` path

Verify: Go to Firebase Console → Storage → Rules tab. Should show rules allowing authenticated read/write to `photos/` and `docs/`.

---

## STEP 6: DEPLOY CLOUD FUNCTIONS

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

**What this does:**
- Deploys the Claude AI proxy (claudeProxy) — routes AI calls server-side
- Deploys Stripe checkout/webhook/portal functions
- Deploys email and SMS sending functions
- Deploys the storm alert scheduler (checkStormAlerts — runs every 30 min)
- Deploys subscription status endpoint

Verify: Firebase Console → Functions tab. Should show: claudeProxy, createCheckoutSession, stripeWebhook, createCustomerPortalSession, getSubscriptionStatus, sendSMS, sendD2DSMS, incomingSMS, checkStormAlerts, plus email functions.

**If functions fail to deploy** due to missing secrets, set them:
```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_PRICE_FOUNDATION
firebase functions:secrets:set STRIPE_PRICE_PROFESSIONAL
```

---

## STEP 7: UPDATE CLOUDFLARE WORKER

**This is critical — the existing worker routes to Gemini (broken). Must replace with Anthropic routing.**

1. Open: https://dash.cloudflare.com
2. Navigate to: Workers & Pages
3. Click on the `nbd-ai-proxy` worker
4. Click "Edit Code" or "Quick Edit"
5. **Delete ALL existing code**
6. Open the file `workers/nbd-ai-proxy.js` from the repo
7. Copy the entire contents and paste into the Cloudflare editor
8. Click "Save and Deploy"
9. Go to: Settings → Variables and Secrets
10. Click "Add Secret"
11. Name: `ANTHROPIC_API_KEY`
12. Value: your Anthropic API key (starts with `sk-ant-`)
13. Click Save

**Test it works:**
```bash
curl -X POST https://nbd-ai-proxy.jonathandeal459.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

Expected: JSON response with `content` array containing Claude's reply.
If you see "Gemini API error" — the old worker is still active. Redeploy.

---

## STEP 8: TWILIO SETUP (optional — for storm alert SMS)

Only needed if you want the storm alert SMS system active:

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_PHONE_NUMBER
```

Get these values from: https://console.twilio.com
The `checkStormAlerts` function will automatically run every 30 minutes and send SMS when severe weather is detected in subscriber zip codes.

---

## STEP 9: GOOGLE ANALYTICS (optional)

1. Go to https://analytics.google.com and create a property for nobigdealwithjoedeal.com
2. Get your Measurement ID (looks like `G-XXXXXXXXXX`)
3. In these 5 files, find the commented-out GA block and:
   - Remove the `<!-- ` and ` -->` comment markers
   - Replace `GA_MEASUREMENT_ID` with your actual ID

Files to edit:
- `index.html`
- `about.html`
- `our-work.html`
- `review.html`
- `visualizer.html`

The block looks like:
```html
<!-- <script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","GA_MEASUREMENT_ID");</script> -->
```

---

## STEP 10: ROTATE GITHUB TOKEN

The personal access token `[REVOKE-THIS-TOKEN-ON-GITHUB]` was exposed in chat. Revoke it immediately:

1. Go to: https://github.com/settings/tokens
2. Find and delete the exposed token
3. Generate a new one with `repo` scope
4. Store securely

---

## STEP 11: VERIFY EVERYTHING WORKS

Open each URL and test:

### Public Site
- [ ] https://nobigdealwithjoedeal.com — homepage loads, hero CTAs work, contact form submits
- [ ] https://nobigdealwithjoedeal.com/estimate — enter address, get AI estimate with tier tabs
- [ ] https://nobigdealwithjoedeal.com/storm-alerts — fill form, check Firestore for new subscriber
- [ ] https://nobigdealwithjoedeal.com/visualizer — upload photo, get AI assessment
- [ ] https://nobigdealwithjoedeal.com/free-guide/ — submit form, see PDF download button (not "check inbox")
- [ ] https://nobigdealwithjoedeal.com/about — page loads, CTA buttons work
- [ ] https://nobigdealwithjoedeal.com/our-work — gallery loads
- [ ] https://nobigdealwithjoedeal.com/review — Google review link works
- [ ] https://nobigdealwithjoedeal.com/404-test — custom 404 page shows
- [ ] https://nobigdealwithjoedeal.com/blog/ — posts listed, free guide CTA visible

### NBD Pro Dashboard
- [ ] Register new account WITHOUT access code → should create lite plan
- [ ] Login → dashboard loads, no blank screen
- [ ] CRM kanban → cards display, drag works, all buttons functional
- [ ] Photos tab → upload a photo → should succeed (not fail silently)
- [ ] Map → pins load, search works, FAB button works
- [ ] Settings → save name → should persist
- [ ] Joe AI → add API key → send message → get response
- [ ] Estimates → create new → save → verify in list
- [ ] Documents → open template → should not fail

### Customer Portal
- [ ] Open a lead → Photos tab → should load (not "Failed to load")
- [ ] Documents tab → should load
- [ ] Contact tab → messages should load
- [ ] All action buttons work (Call, Email, Export PDF, etc.)

### Browser Console
- [ ] Open DevTools (F12) → Console → look for red errors
- [ ] Should see no `permission-denied` Firestore errors
- [ ] Should see no `undefined function` errors

---

## WHAT WAS BUILT (33 COMMITS)

### Bugs Fixed
- 64 broken dashboard buttons (window scope assignments were commented out)
- Estimate save/load function was nested incorrectly
- Service worker was cache-first, blocking all code updates
- Visualizer was routing to Gemini API (always 401)
- Photo uploads blocked (no Firebase Storage rules existed)
- 12 broken internal links across the site
- Free guide form showed "check inbox" but never delivered anything
- Customer portal: all queries missing userId filter (Firestore denied all reads)
- 9 Firestore collections used in code had no security rules

### New Products
- `/estimate` — AI-powered instant roof estimate (address → ballpark cost in 30 seconds)
- `/storm-alerts` — SMS opt-in for hail/storm notifications by zip code
- NBD Pro Lite — free tier registration without access code (25 lead limit)

### Security
- 5 direct browser Anthropic API calls → routed through callClaude proxy
- `rel="noopener noreferrer"` added to all `target="_blank"` links (55+ files)
- Honeypot spam protection on 3 public forms
- Firestore rules hardened with field type + length validation
- Admin pages noindexed
- Cloudflare Worker rebuilt from Gemini to Anthropic

### Performance
- 56 of 69 JS scripts deferred (789KB+ moved to non-blocking)
- 21 images compressed: 4.9MB → 2.5MB (49% reduction)
- Preconnect hints for 5 CDN domains
- DNS prefetch for 5 API endpoints
- Hero image preloaded for faster LCP
- Critical JS (crm.js, maps.js) preloaded
- Service worker switched to stale-while-revalidate
- All 63 JS files cache-busted from v1 to v2

### SEO
- Open Graph + Twitter card tags on 81 pages
- 83 FAQ questions across all 18 blog posts (Google rich snippets)
- 70 BreadcrumbList schema trails
- 10 service page breadcrumbs
- Sitemap expanded from 79 to 88 URLs
- robots.txt fixed (was blocking /pro/landing.html from Google)
- WebApplication schema on estimate + storm alerts + visualizer

### Infrastructure
- Firebase Storage rules (new file)
- 21 Firestore composite indexes (was 11)
- 14 Firestore collection rules added
- PWA icons (192px + 512px) generated
- Manifest.json enhanced with shortcuts (CRM, D2D, Map, Estimate)
- Offline fallback page created
- Print stylesheets on dashboard + 3 public pages
- Google Analytics placeholder on 5 pages
- Cloudflare Worker source code committed to repo
- Storm alert Cloud Function (scheduled every 30 min)

### Cross-Linking
- `/estimate` linked from 78 pages
- `/storm-alerts` linked from 77 pages
- Email capture on estimate results
- Free guide PDF download fixed
- All blog/service/area footers link to new products
