# Rock 4 — what's left for you (Joe)

Everything I could safely ship without your involvement is shipped.
This doc lists what remains, ordered by impact. Most are 5-30 minute
tasks. Two are dedicated focus sessions.

Last updated: 2026-04-26 after PR #81 (Sentry DSN paste).

---

## ✅ What shipped this session — 8 PRs

| PR | What | Where |
|---|---|---|
| [#75](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/75) | Image pipeline — Storage trigger generates 200/600/1600 px WebP variants | `functions/image-pipeline.js` |
| [#76](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/76) | NBDStore pub/sub state store | `docs/pro/js/state-store.js` |
| [#77](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/77) | Bulk lead ops — carrier/damage assign + writeBatch delete | `docs/pro/js/crm.js` |
| [#78](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/78) | Server-rendered `/share/:token` preview | `functions/share-ssr.js` |
| [#79](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/79) | IndexedDB offline cache | `docs/pro/js/idb-cache.js` |
| [#80](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/80) | Homeowner-facing portal photo gallery | `functions/portal.js` + `docs/pro/portal.html` |
| [#81](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/81) | Sentry DSN paste — error reporting live | `docs/pro/js/sentry-config.js` |

Smoke tests: 807 → 898 passing.

---

## 🟢 Quick wins (do these next — under an hour total)

### 1. Set Sentry **Allowed Domains** — 2 minutes

Stops a third party who lifts the DSN from spamming your Sentry quota.

1. https://sentry.io → click your `nbd-pro` project
2. **Settings** (gear icon top-right of project view) → **Security & Privacy**
3. Scroll to **Allowed Domains**, paste these (one per line):
   ```
   nobigdealwithjoedeal.com
   www.nobigdealwithjoedeal.com
   nobigdeal-pro.web.app
   localhost
   ```
4. Save.

### 2. Verify Sentry actually fires — 1 minute

After the #81 deploy lands (check **Actions** tab → Firebase deploy → succeeded):

1. Open https://nobigdealwithjoedeal.com/pro/dashboard
2. Sign in
3. DevTools console → run: `throw new Error('sentry test from console')`
4. Within 30 seconds, https://sentry.io → your project → **Issues** should show the error with browser, OS, and user info.

If nothing shows up after 60 sec: re-check the Allowed Domains step above, or check the **Inbound Filters** section of Security & Privacy.

### 3. Enable App Check **enforce** — 15 minutes

App Check tokens are already minted (PR #54 wired the reCAPTCHA v3 site key). Right now Firebase **logs** the token but doesn't require it. Flipping enforce on means anyone calling Firestore / Storage from a browser without a valid token gets rejected — kills 99% of scraping + bot abuse.

1. https://console.firebase.google.com/project/nobigdeal-pro/appcheck
2. **APIs** tab
3. For each row (Cloud Firestore, Cloud Storage, Cloud Functions):
   - Click the row
   - Toggle **Enforce** to ON
   - Confirm

**Risk**: a small fraction of users on browsers without working reCAPTCHA (locked-down corporate networks, old WebViews, ad blockers blocking `recaptcha.net`) will hit auth errors. Watch the Sentry Issues feed for the first hour; if you see a flood of `app-check-token-is-invalid`, flip enforce back off and message me.

---

## 🟡 30-minute tasks (low risk, real value)

### 4. Wire auto-bumping Sentry release tag from git SHA

Every deploy will then tag a new "release" in Sentry, so a regression introduced today doesn't get grouped with a 6-month-old bug.

I tried to ship this as a workflow change but the auth I'm running under doesn't have `workflow` scope, so I couldn't push a `.github/workflows/*.yml` change. Apply this patch yourself when you have a sec:

**Edit** `.github/workflows/firebase-deploy.yml` — find the `Deploy Hosting` step (around line 438) and insert this **immediately before** it:

```yaml
      # Stamp the Sentry release tag with the deploy SHA so every
      # deploy groups its errors under a fresh release in Sentry.
      # Replaces the placeholder line in docs/pro/js/sentry-config.js.
      # Runner-local — NOT committed back to the repo. Source tree
      # keeps the generic placeholder so feature branches don't get
      # noisy release-stamp diffs on every push.
      - name: Stamp Sentry release with git SHA
        if: ${{ github.event_name == 'push' || github.event.inputs.scope == 'all' || github.event.inputs.scope == 'hosting' }}
        run: |
          set -e
          SHORT_SHA="${GITHUB_SHA::8}"
          DATE=$(date -u +%Y-%m-%d)
          NEW_TAG="web@${DATE}-${SHORT_SHA}"
          if [ -f docs/pro/js/sentry-config.js ]; then
            sed -i "s|window\.__NBD_RELEASE = 'web@[^']*';|window.__NBD_RELEASE = '${NEW_TAG}';|" docs/pro/js/sentry-config.js
            echo "::notice::Sentry release stamped → ${NEW_TAG}"
          else
            echo "::warning::sentry-config.js not found — skipping release stamp"
          fi
```

Commit message: `ci(sentry): auto-stamp __NBD_RELEASE with git SHA on every deploy`. Push to main, deploy will start tagging releases automatically.

### 5. Create dev GCP project (Item #19)

Unlocks the auth-page Playwright visual regressions (PR #74 covers public pages only because there's no test account).

1. https://console.firebase.google.com → **Add project** → name `nobigdeal-pro-dev`
2. Project Settings → **Service Accounts** → Generate new private key → download JSON
3. GitHub → repo → Settings → Secrets → **New repository secret**:
   - Name: `FIREBASE_DEV_SERVICE_ACCOUNT`
   - Value: paste the JSON contents
4. Tell me the project ID and I'll wire the visual regression tests in a follow-up PR.

---

## 🔴 Dedicated session needed — don't squeeze this in

### 6. Build pipeline (Items #8 + #9 + #10)

These three are one coordinated change:

- **#8 esbuild** — minify + bundle the 73 JS modules. Adds a build step where there is none today. Changes `firebase deploy` to ship `docs/dist/` instead of `docs/`. Touches every HTML file's `<script>` tags.
- **#9 critical CSS** — extract above-the-fold CSS, inline it. Depends on #8 having a build step.
- **#10 Sentry source-map upload** — once minified, source maps need to be uploaded to Sentry so stack traces are readable. Depends on #8.

Plan ~3-4 hours of focus time when you tackle this. Test plan: open every page (login, register, dashboard, customer, vault, portal, share-ssr, pricing, marketing pages, admin pages), verify no JS errors in console, smoke-test one flow per page. If anything breaks, the rollback is `git revert <build-pipeline-PR>`.

Don't tackle this on a Friday afternoon.

### 7. CSP nonce (Item #14)

Drop `'unsafe-inline'` from the `script-src` CSP directive. Currently blocked by inline event handlers across:

| File | Inline handlers | Inline `<script>` blocks |
|---|---|---|
| dashboard.html | **490** | 16 |
| customer.html | 134 | 6 |
| vault.html | 31 | 0 |
| pricing.html | 7 | 0 |
| login.html | 0 | 0 ✅ |
| register.html | 0 | 0 ✅ |
| portal.html | 0 | 1 |

662 inline handlers + 23 inline `<script>` blocks must be extracted to external `.js` files before CSP nonce can land without breaking the app. This was tracked under "Rock 4 Phase 5" in the original architecture review and is genuinely a multi-day refactor on its own — don't attempt as a side quest.

The simplest start: pick one file (say `vault.html` with 31 handlers) and do the extraction as a standalone PR to set the pattern. Then dashboard.html can be split into 4-5 PRs of ~100 handlers each.

---

## Summary

| Status | Items | Time |
|---|---|---|
| 🟢 Quick wins | Sentry Allowed Domains, verify Sentry, App Check enforce | ~20 min |
| 🟡 30-min tasks | Auto-release-tag patch, dev GCP project | ~30 min |
| 🔴 Focus session | Build pipeline (#8/#9/#10) | 3-4 hours |
| 🔴 Multi-PR refactor | CSP nonce / inline-handler extraction | days |

Everything in 🟢 should happen this week. The 🔴 items are post-Rock-4 Phase 5 work.
