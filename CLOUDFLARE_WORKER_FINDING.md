# Cloudflare worker finding — NEW critical vulnerabilities

**Status:** discovered during the stress-test audit after the first round
of hardening shipped. These are *additional* findings, not previously
listed in the main audit or `SECURITY_BATTLE_PLAN.md`.

**Why they were missed in round 1:** only one worker source file
(`workers/nbd-ai-proxy.js`) lived in the repo. The others exist only in
the Cloudflare dashboard and were never imported. A second-pass discovery
via the Cloudflare MCP tool `workers_list` surfaced all four.

**Summary:** four live Cloudflare workers are deployed under the
`jonathandeal459.workers.dev` account, and all four have one or more
serious vulnerabilities. One of them (`nbd-stripe-webhook`) lets any
anonymous caller grant themselves a free Pro subscription; another
(`nbd-ai-visualizer`) has a ~$69k/day DALL-E cost-bomb exposure.

The code changes in this branch remove every live caller of the AI proxy
worker from the site, so the worker can now be safely deleted (or
replaced) without breaking anything. **But** the workers themselves are
Cloudflare-side — they can only be deleted by Joe or someone with
dashboard access. Until that happens the endpoints are still reachable.

---

## 1. `nbd-stripe-webhook` — **HIGHEST SEVERITY**

### What it does
Listens for Stripe webhook events and writes subscription plan data to
Firestore via an embedded Firebase service-account JSON.

### Vulnerabilities
1. **No Stripe signature verification.** The worker parses the request
   body as JSON directly: `const event = JSON.parse(body);` — there is
   no `stripe.webhooks.constructEvent` call and no check against the
   `Stripe-Signature` header. An anonymous caller can forge a
   `checkout.session.completed` event and have it accepted as genuine.
2. **Firebase service-account JSON embedded in the worker's env.** The
   worker holds a full service account capable of admin-level Firestore
   writes. Even if the signature bug were fixed, leaking this key (or
   extracting it via any worker-side RCE) grants full project access.
3. **Trusts client-supplied plan metadata.** It reads
   `event.data.object.metadata.plan` and writes that value directly
   into the user's `subscriptions/{uid}` doc, so a forged event can
   set `plan=professional` for free.

### Exploit (illustrative)
```bash
curl -X POST https://nbd-stripe-webhook.jonathandeal459.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"checkout.session.completed",
    "data":{"object":{
      "metadata":{"plan":"professional","firebaseUid":"<victim-or-self>"},
      "customer_details":{"email":"me@example.com"}
    }}
  }'
```
Result: any Firebase user (or even a freshly created one) gets their
`subscriptions/{uid}` doc flipped to `plan: 'professional', status:
'active'`, unlocking the full Pro feature set without paying.

### What to do RIGHT NOW
1. Rotate the Firebase service account stored in the worker's env:
   Firebase Console → Project Settings → Service Accounts → *delete* the
   key the worker currently uses (and generate a new one only for
   whatever still needs it, e.g. GitHub Actions auto-deploy). **The
   hardened Cloud Functions do NOT need a service account JSON at all
   — they use the default runtime credentials.**
2. **Delete the worker** from the Cloudflare dashboard. Workers &
   Pages → `nbd-stripe-webhook` → Delete.
3. Verify the Stripe webhook endpoint URL currently configured in the
   Stripe dashboard. If it points at the worker, **repoint it at the
   hardened `stripeWebhook` Cloud Function**
   (`https://us-central1-nobigdeal-pro.cloudfunctions.net/stripeWebhook`)
   and copy the new endpoint's signing secret into
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` — or re-run
   `./scripts/rotate-secrets.sh` and fill in that step.
4. Audit `subscriptions/{uid}` docs for any activated plans that don't
   correspond to a real Stripe subscription. Any `status: 'active'` doc
   whose `uid` doesn't match a live Stripe customer was likely injected
   via the forged-event hole.

---

## 2. `nbd-ai-visualizer` — cost-bomb + key leakage risk

### What it does
Accepts an unauthenticated POST with a prompt + reference image,
proxies it to Google Gemini + OpenAI DALL-E 3 HD, returns the generated
image.

### Vulnerabilities
1. **`Access-Control-Allow-Origin: '*'`** — any website can invoke it,
   so any user can spam requests from a browser console.
2. **No auth, no rate limit, no App Check.** Literally `curl -X POST`
   works.
3. **DALL-E 3 HD at $0.08 per image.** Back-of-envelope: a single bot
   running 10 rps for a day = 864,000 images = ~$69,000/day billed to
   the OpenAI key stored in the worker's env.
4. **Gemini + OpenAI API keys held in worker env.** Same leak profile
   as above.

### Exploit
```bash
for i in $(seq 1 1000); do
  curl -sS -X POST https://nbd-ai-visualizer.jonathandeal459.workers.dev \
    -H 'Content-Type: application/json' \
    -d '{"prompt":"..."}' &
done
```

### What to do RIGHT NOW
1. **Rotate the OpenAI key** at console.openai.com → API keys → Revoke
   + New. Add any replacement ONLY as a Firebase secret
   (`firebase functions:secrets:set OPENAI_API_KEY`) — never back into
   the worker.
2. **Rotate the Gemini key** at console.cloud.google.com → APIs &
   Services → Credentials → regenerate. Same rule: Firebase secrets
   only.
3. **Delete the worker.** The hardened `publicVisualizerAI` Cloud
   Function in this branch (`functions/index.js`) already does the
   visualizer job with App Check enforcement, per-IP rate limiting,
   input validation, and no DALL-E cost path.
4. Review OpenAI + Google Cloud billing for the last 30 days for any
   surprise spend. If found, file a billing dispute citing
   "unauthorized worker endpoint exploited".

---

## 3. `nbd-ai-proxy` — stale vulnerable version still deployed

### Why it's still vulnerable
Round-1 remediation committed a 410-Gone stub in
`workers/nbd-ai-proxy.js` at the repo root. But Cloudflare workers
deploy via `wrangler deploy`, not via `firebase deploy`, so pushing to
`main` never updated the Cloudflare side. The live worker is still
running the original vulnerable source:

- Wide-open CORS with an `origin === ''` bypass (any server-side
  caller with no `Origin` header passes the check).
- Allows Opus model (expensive) and 4096 `max_tokens`.
- Holds the Anthropic API key in env.

### What this branch already fixes
Every in-repo caller has been migrated off the worker URL:

| File | Was | Now |
|---|---|---|
| `docs/estimate.html` | `POST https://nbd-ai-proxy...` | `POST publicEstimateAI` (new Cloud Function, App Check enforced) |
| `docs/admin/project-codex.html` | `POST https://nbd-ai-proxy...` | `POST claudeProxy` via new `_nbdCallClaudeProxy` helper |
| `docs/admin/vault.html` (×2 sites) | `POST https://nbd-ai-proxy...` | `POST claudeProxy` via `_nbdCallClaudeProxy` |
| `docs/pro/vault.html` (×2 sites) | `POST https://api.anthropic.com` (direct, CORS-broken) | `window.callClaude()` → `claudeProxy` |
| `docs/pro/js/pages/ask-joe-main.js` | `POST https://api.anthropic.com` with localStorage key | `window.callClaude()` → `claudeProxy` |
| `docs/pro/js/claude-proxy.js` | Cloud Function with localStorage-key fallback | Cloud Function only, fallback **deleted** |
| `docs/admin/js/pages/analytics.js` | stale `WORKER_URL` constant (dead code) | constant deleted |
| `docs/pro/dashboard.html` | `dns-prefetch` for `nbd-ai-proxy` | removed |

### What to do RIGHT NOW
1. **Rotate the Anthropic API key** at console.anthropic.com → API
   keys → create new, delete old. Put the new key into Firebase
   secrets via `./scripts/rotate-secrets.sh` (step 1). Never paste it
   back into the worker.
2. **Delete the worker.** Once Joe merges this branch, nothing on the
   site calls the worker URL anymore, so deleting it is safe.
3. **Delete the `workers/` directory from the repo** if it still
   exists — it's now dead weight.

---

## 4. `nbd-mailerlite` — spammable lead endpoint

### Vulnerabilities
- `Access-Control-Allow-Origin: '*'`
- No auth, no rate limit
- Holds a MailerLite API key with list-write scope

### What to do
1. Rotate the MailerLite key at mailerlite.com → Integrations → API.
2. Either **delete the worker** (and route lead creation through the
   marketing-site Firestore `leads` collection that's already
   shape-validated by `marketing-site-firestore.rules`) **or** rewrite
   it with:
   - Origin allowlist (exact match, no wildcards, no `startsWith`)
   - Per-IP rate limit
   - HMAC'd turnstile/reCAPTCHA token check
   - Minimal field allowlist before passing to MailerLite
3. Until it's deleted or rewritten, treat the MailerLite list as
   tainted — any signups since the worker went live could be bot
   spam.

---

## 5. One-page action list for Joe

Do these in order. Each step takes 1–5 minutes.

| # | Action | Where | Why |
|---|---|---|---|
| 1 | Rotate **OpenAI** API key | console.openai.com | kills nbd-ai-visualizer key leakage + cost bomb |
| 2 | Rotate **Gemini** API key | console.cloud.google.com | same, for Gemini |
| 3 | Rotate **Anthropic** API key | console.anthropic.com | kills nbd-ai-proxy key leakage |
| 4 | Rotate **MailerLite** API key | mailerlite.com | kills nbd-mailerlite spam path |
| 5 | Rotate / delete the Firebase service account currently embedded in `nbd-stripe-webhook` | Firebase Console → Service Accounts | kills forged-checkout attack |
| 6 | Delete worker **`nbd-stripe-webhook`** | Cloudflare dash → Workers & Pages | remove the forged-event endpoint |
| 7 | Repoint Stripe webhook endpoint to `stripeWebhook` Cloud Function + copy the new signing secret into `STRIPE_WEBHOOK_SECRET` | Stripe dashboard + `firebase functions:secrets:set` | the hardened Cloud Function takes over |
| 8 | Delete worker **`nbd-ai-visualizer`** | Cloudflare dash | hardened `publicVisualizerAI` Cloud Function replaces it |
| 9 | Delete worker **`nbd-ai-proxy`** | Cloudflare dash | hardened `claudeProxy` + new `publicEstimateAI` replace it |
| 10 | Delete worker **`nbd-mailerlite`** (or rewrite) | Cloudflare dash | no client-side caller remains after the migration |
| 11 | Run `./scripts/rotate-secrets.sh` and paste the rotated keys from steps 1–4 into Firebase secrets | local shell | the Cloud Functions pick them up on next deploy |
| 12 | Run `./scripts/verify-deploy.sh` | local shell | smoke-tests the hardened Cloud Functions |
| 13 | Audit OpenAI + Google Cloud + Anthropic + MailerLite billing for the last 30 days | each vendor dashboard | confirm no prior abuse of the exposed endpoints |

---

## What this branch changes in code

- **`functions/index.js`** — adds `publicEstimateAI` onRequest function
  with App Check enforcement, per-IP rate limit (5/hour), server-owned
  system prompt, allowlisted input fields, locked to Haiku + 700 token
  cap. The unauthenticated estimate funnel at `/estimate.html` calls
  this instead of the Cloudflare worker.
- **`docs/estimate.html`** — initializes Firebase App Check, drops the
  old `CONFIG.PROXY_URL` constant, calls `publicEstimateAI` through a
  new `window._nbdFetchEstimateAI` helper that attaches an App Check
  token.
- **`docs/admin/project-codex.html`** + **`docs/admin/vault.html`** —
  add Firebase App Check init, expose a new `_nbdCallClaudeProxy`
  helper that posts to the hardened `claudeProxy` Cloud Function with
  a Firebase ID token + App Check token, and rewrite every worker
  fetch call site to use it.
- **`docs/pro/js/claude-proxy.js`** — the localStorage-key
  direct-browser fallback has been **deleted**. The helper now always
  routes through the Cloud Function, and it attaches the App Check
  token from `window._nbdGetAppCheckToken` (set by nbd-auth.js).
  **Security impact:** a logged-in user can no longer bypass the
  server-side subscription gate, rate limit, or daily token budget by
  pasting their own key into the Settings → Ask Joe AI tab. The
  localStorage value is now inert.
- **`docs/pro/js/nbd-auth.js`** — initializes Firebase App Check with
  a reCAPTCHA Enterprise provider and exposes
  `window._nbdGetAppCheckToken` for the rest of the app.
- **`docs/pro/vault.html`** + **`docs/pro/js/pages/ask-joe-main.js`**
  — migrated from direct `api.anthropic.com` calls to `window.callClaude`.
- **`docs/pro/dashboard.html`**, **`docs/pro/ask-joe.html`**,
  **`docs/pro/vault.html`**, **`docs/pro/project-codex.html`**,
  **`docs/pro/ai-tool-finder.html`** — added
  `window.__NBD_RECAPTCHA_KEY__ = 'REPLACE_WITH_RECAPTCHA_SITE_KEY'`
  placeholder before `nbd-auth.js` import so App Check initializes
  once Joe pastes the real key.
- **`docs/admin/js/pages/analytics.js`** + **`docs/pro/dashboard.html`
  dns-prefetch** — stale references to the Cloudflare worker URL
  removed.

## What Joe still has to do by hand

Cloudflare worker operations (delete, redeploy, rewrite) are not
automatable from Claude Code — the available Cloudflare MCP tools can
read `workers_list` / `workers_get_worker_code` but cannot delete or
update worker scripts. Joe has to do those in the Cloudflare dashboard.
Same for Stripe webhook endpoint URL changes and all API key
rotations at the vendor consoles.

Once the rotations and deletions are done, the auto-deploy GitHub
Actions workflow in `.github/workflows/firebase-deploy.yml` will pick
up the new Cloud Functions (including `publicEstimateAI`) and the
migrated client pages on the next push to `main`.
