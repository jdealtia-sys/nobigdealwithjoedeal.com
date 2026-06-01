# Live Verification Playbook — Audit #4

Run these in **Chrome on the live dashboard** (logged in) + the named cloud
consoles. Goal: (1) confirm/refute the audit findings against production *as it
is now*, and (2) baseline what Audit #4 changed so we can compare after deploy.

> ⚠️ Audit #4 changes are on branch `claude/nbd-pro-ops-audit-sinpn`, **not yet
> deployed**. Tests marked **[POST-DEPLOY]** only pass once the branch is merged
> + deployed. Tests marked **[NOW]** validate current prod / audit findings.

Paste console output back to the assistant for interpretation.

---

## Phase 0 / 6 — Security headers  **[NOW]**
DevTools → Network → click the top document request → **Headers** → Response.
Confirm the finding "CSP live, HSTS + nosniff missing":
```
content-security-policy:      should be PRESENT  (Phase 0 says live ✓)
strict-transport-security:    EXPECTED MISSING   (finding: add HSTS)
x-content-type-options:       EXPECTED MISSING   (finding: add nosniff)
referrer-policy:              should be PRESENT
permissions-policy:           should be PRESENT
```
Or from your desktop terminal: `curl -sSI https://nobigdealwithjoedeal.com/ | grep -iE 'content-security|strict-transport|x-content-type|referrer|permissions'`

## Phase 3 — Sentry actually ingesting?  **[NOW]**
The audit found server-side Sentry was wired to ~0 functions; this checks the
**client** side is live. In the dashboard console:
```js
console.log('client Sentry configured:', window.NBDSentry && window.NBDSentry.configured);
console.log('DSN set:', !!window.__NBD_SENTRY_DSN);
```
Then DevTools → Network → filter `sentry` → reload. Healthy = you see ingest
requests (or at least the SDK loaded). If `configured:false`/no DSN → client
Sentry isn't active in prod (finding 3.3 / console item #3).

## Phase 5 — Lead-load weight & shape (BASELINE for Stage A)  **[NOW]**
This baselines the cliff Stage A addresses. In the dashboard console after it
finishes loading:
```js
console.log('leads loaded flag:', window._leadsLoaded);
console.log('lead count in memory:', (window._leads||[]).length);
console.log('approx bytes in _leads:', JSON.stringify(window._leads||[]).length);
console.log('role:', window._userClaims && window._userClaims.role);
```
DevTools → Network → filter `Listen` or `firestore` → reload → note how the
leads come down (today: **one** big query; after Stage A deploy: **pages of
500**). Record the count — that's our before/after number.

DevTools → Performance → reload → record: **Time to first contentful paint**,
total **JS transferred** (Network tab, JS filter, "transferred" total). Audit
says ~5.5 MB / 218 modules eager — confirm the real transferred number.

## Phase 4 — AI kill-switch  **[POST-DEPLOY]**
After deploy only. In Firebase console → Firestore → create/edit
`feature_flags/global` → set `aiDisabled: true`. Wait ~60s. In the dashboard,
trigger any AI feature (Ask Joe / photo analysis / property intel). Expect it
to fail with a 503 / "AI temporarily disabled". **Then set `aiDisabled` back to
`false`** and confirm AI works again. This proves the one-button switch.

## Phase 5 — Stage A pagination regression  **[POST-DEPLOY]**
After deploy, load the dashboard as a real rep and confirm **nothing
regressed**:
- Board renders all the same leads; counts match pre-deploy `_leads.length`.
- KPIs, search/command-palette (Cmd-K), Ask Joe all still see leads.
- Console: no new errors; `window._leadsLoaded === true`.
- Network: leads now arrive in **500-doc pages** (multiple query round-trips).

---

## Console-only (not the dashboard browser, but your cloud consoles) — **[NOW]**
Consolidated from the audit's Console Verification Checklist
(`OPS_AUDIT_2026-06.md` §3). These are the P0/P1 confirmations only you can do:

1. **Cloud Monitoring → Alerting:** are the `monitoring/*.json` policies created,
   enabled, and wired to a **phone/SMS** channel (not the `NOTIFICATION_CHANNEL_ID`
   placeholder)? → the #1 open P0.
2. **GCS:** do `nobigdeal-pro-firestore-backups` AND `nobigdeal-pro-backups`
   both exist, and which has a fresh dated folder with `*.overall_export_metadata`?
   → resolves the backup split-brain.
3. **Cloud Scheduler:** last-success per job (backups, retention, digests, storm,
   migrations, email worker).
4. **GCP Billing → Budgets:** is the $50/day budget set and routed to your phone?
5. **Stripe → Developers → Webhooks:** delivery success rate ~100%?
