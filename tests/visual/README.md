# Visual + brand-token regression tests

Isolated Playwright workspace that locks in the customer-facing brand contract for NBD Pro. If anyone edits `nbd-brand.css`, drops the `<link>` from a customer-facing page, or accidentally re-introduces a hardcoded color, these tests fail before the change merges.

Lives under `tests/visual/` to keep `@playwright/test` + `http-server` out of the main repo's deploy tooling.

## Run locally

```sh
cd tests/visual
npm install
npx playwright install chromium --with-deps   # first run only
npm test
```

The config (`playwright.config.js`) auto-spins an `http-server` on port 4321 pointed at `../../docs`, so the tests hit the real surfaces (`/pro/portal.html`, `/pro/estimate-view.html`, `/pro/photo-review.html`) — no Firebase, no auth.

## What's covered

| Surface | What we assert |
|---|---|
| `portal.html` | Loads `nbd-brand.css`, opts into the brand cascade (`data-nbd-brand` + `.nbd-brand`), tokens resolve to locked values, body renders with brand bg+ink |
| `estimate-view.html` | Same. (This page was the one customer-facing surface still hardcoded before Audit Batch 1; locking it in prevents the regression.) |
| `photo-review.html` | **Negative test** — must NOT be brand-locked. It's a rep-facing workspace; should carry `data-theme` for the rep's chosen dashboard theme. |

## What we DO NOT do
- **Pixel screenshots**: too noisy across CI runners (font rendering, anti-aliasing). Computed-style assertions are deterministic and catch the regressions we actually care about: brand drift.
- **Auth flows**: these are smoke covered in `tests/smoke.test.js` (Node) and in the firestore-rules test suite.
- **Photo upload / AI classification**: requires live backend; covered separately.

## Adding a new surface
Add a row to the `SURFACES` array in `brand-tokens.spec.js`. The four-test pattern (CSS loaded → cascade opted in → tokens resolve → body renders) runs automatically.

## CI integration (future work)
Not yet wired into the Firebase deploy workflow. To add:

```yaml
- name: Visual regression
  run: |
    cd tests/visual
    npm ci
    npx playwright install chromium --with-deps
    npm test
```

Caching `~/.cache/ms-playwright` between runs is recommended to avoid downloading Chromium every time.
