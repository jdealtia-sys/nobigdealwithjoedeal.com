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

**Included** (no auth required):
- `pro-public.spec.js` — /pro/login.html, /pro/pricing.html, /pro/instant-estimate.html
- `marketing.spec.js` — homepage, privacy, robots.txt

**Not yet included** (would require a test user + credentials):
- Authenticated pipeline flow (login → new lead → stage move → save)
- Estimate Builder end-to-end (login → measurements → tier pick → save)
- D2D knock submission

## Adding an authed suite

When ready, set a CI secret `PLAYWRIGHT_TEST_USER` / `PLAYWRIGHT_TEST_PASS` and create `pro-authed.spec.js` with a `test.beforeEach` that signs in via the UI or an auth token injection. Keep the test account scoped to a sandbox tenant so it can't corrupt real data.
