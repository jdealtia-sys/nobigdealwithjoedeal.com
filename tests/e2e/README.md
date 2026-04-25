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
- Destructive journeys (Rock 3 PR 4) tag every Firestore doc they
  create with `e2eTestData: true` and prefix names with `[E2E]`.
  An `afterAll` hook calls the `cleanupE2ETestData` callable, which
  deletes ONLY docs tagged `e2eTestData: true` belonging to the
  test user — guarded both by Firestore query (`where('userId',
  '==', uid)`) and a function-level check that the caller's user
  doc has `e2eTestAccount: true`. A real human running cleanup on
  themselves would delete nothing.
- The cleanup callable also walks subcollections (activity, notes,
  documents) before deleting the parent so children never orphan.

### If a destructive test crashes mid-run

The `afterAll` runs even after a failed test. Worst case (CI killed
before afterAll fires): manually invoke the callable from DevTools:

```js
const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
const f = m['httpsCallable'](m['getFunctions'](),'cleanupE2ETestData');
console.log((await f()).data);
```

Or filter the kanban by `[E2E]` and delete by hand — the prefix
makes them visually obvious.

### Provisioning the test user (one-shot, owner-only)

Don't manually register + edit Firestore. There's a callable for that:

```js
const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
const f = m['httpsCallable'](m['getFunctions'](),'provisionE2ETestUser');
const r = await f();
alert(JSON.stringify(r));   // shows email + password ONCE
```

The callable creates the auth user, sets `e2eTestAccount: true`,
and rotates the password if the user already exists. Capture the
password, set it as the GitHub Secret, done.
