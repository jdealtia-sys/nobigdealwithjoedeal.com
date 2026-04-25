# E2E Smoke Tests (Playwright)

Fast, unauthenticated smoke tests that run against the live production site (default) or a local `firebase serve` target. Designed to catch whole-app regressions — a bad Pages deploy, a blank-page JS crash, a broken CTA — without needing test credentials.

## First-time setup

```bash
cd tests
npm install                  # adds @playwright/test
npm run test:e2e:install     # downloads chromium browser (~180MB, one time)
```

## Run

```bash
# Against live production
npm run test:e2e

# Against a local firebase serve on :5000
PLAYWRIGHT_BASE_URL=http://localhost:5000 npm run test:e2e

# Headed (watch a real browser)
npm run test:e2e:headed

# Just the pricing tests
npx playwright test --grep "pricing"
```

## Scope

**Public (no auth)** — runs in CI by default:
- `pro-public.spec.js` — /pro/login.html, /pro/pricing.html, /pro/instant-estimate.html
- `marketing.spec.js` — homepage, privacy, robots.txt

**Authed (test user)** — opt-in via env vars (BIG_ROCKS Rock 3 PR 1):
- `pro-authed.spec.js` — login → dashboard kanban renders, auth state survives reload

Run separately:
```bash
npm run test:e2e:public   # public-only, no creds needed
npm run test:e2e:authed   # authed-only, skips if creds missing
npm run test:e2e          # everything; authed suite skips cleanly w/o creds
```

## Authed suite — Path A test-user provisioning

We hit live production with a dedicated test user. Path B (Firebase
Auth Emulator) is the safer long-term option; this doc covers Path A
because it's what's wired today. Only read journeys land in PR 1
(login + auth-persistence). Destructive journeys (save lead, move
stage, send invoice) come in a later PR with proper cleanup.

### Joe's runbook — first-time setup

1. **Create the test user via the live registration flow:**
   - Go to <https://nobigdealwithjoedeal.com/pro/register.html>
   - Email: `playwright-e2e@nobigdealwithjoedeal.com` (or any address you control)
   - Password: a strong unique password (use a password manager)
   - Complete registration with the lowest-tier plan
2. **Tag the user in Firestore** so leaderboards/analytics can filter
   it out:
   - Firebase Console → Firestore → `users/{uid}`
   - Add field `e2eTestAccount: true`
   - (Optional) Set `companyId` to a sandbox value if you have one
3. **Set GitHub Actions secrets:**
   ```
   PLAYWRIGHT_TEST_USER_EMAIL     = playwright-e2e@nobigdealwithjoedeal.com
   PLAYWRIGHT_TEST_USER_PASSWORD  = (the password)
   ```
4. **Local run** (pull secrets into your shell first):
   ```bash
   export PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nobigdealwithjoedeal.com
   export PLAYWRIGHT_TEST_USER_PASSWORD=...
   cd tests && npm run test:e2e:authed
   ```

### Safety guarantees

- The auth fixture reads creds via env vars only — never committed
- `pro-authed.spec.js` skips silently when env vars are missing, so
  running `npm test` locally without secrets stays clean
- PR 1 contains only **read-only** journeys (no Firestore writes).
  When destructive journeys land, every test seeds with a unique
  prefix (`[E2E] ...`) and an `afterEach` deletes via the Firebase
  Admin SDK to keep the prod DB clean.
