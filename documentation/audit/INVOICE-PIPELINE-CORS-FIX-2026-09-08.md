# Invoice-pipeline CORS fix — 2026-09-08

Follow-up to [STRIPE-INVOICING-STATUS-2026-09-08](STRIPE-INVOICING-STATUS-2026-09-08.md) (landed on `main` via #1520 while this session was already underway — that note's round-2 correction flagged this exact defect as "worth a matching fix, not done here," and its Resend-error follow-up half was closed same-day by [RESEND-ERROR-SURFACING-SWEEP-2026-09-08](RESEND-ERROR-SURFACING-SWEEP-2026-09-08.md)/#1521; this note closes the other half). The named defect: `docs/pro/js/invoice-pipeline.js`'s `CLOUD_FUNCTION_BASE` was hardcoded to
production unconditionally, so any local/emulator test of
`createStripePaymentLink` CORS-failed against prod before ever reaching a
local Stripe secret. This session fixed it, swept for the same pattern
elsewhere, and verified against a real local emulator run rather than
reasoning about it.

## The fix

`invoice-pipeline.js:11` now uses the same `location.hostname` regex switch
`nbd-comms.js:32-36` already used for `sendEmail`/`sendSMS`:
`/^(localhost|127\.0\.0\.1|\[::1\])$/` → local emulator base
(`http://127.0.0.1:5001/nobigdeal-pro/us-central1`), else prod.

**Swept `docs/pro/js/` for the same hardcoded-prod pattern** (task's own
instruction — this was not the only file). Already-correct (unchanged):
`nbd-comms.js`, `esign-sign.js`, `estimate-view.js`, `portal.js`,
`sign-page.js`. Hardcoded-prod, no detection (fixed here):

- `claude-proxy.js` — module-top `const`, IIFE-free but only one call site;
  changed the constant's value in place, no new identifier.
- `refer.js` — already IIFE-wrapped; same in-place value swap.
- `vault-page.js` — `NBD_ADMIN_AI_URL`; same in-place value swap (2 call
  sites, single definition).
- `dashboard-billing-tab.js` (2 call sites: `createCustomerPortalSession`,
  `createCheckoutSession`) and `property-intel.js` (`claudeProxy` call) —
  these three, plus `claude-proxy.js`, are classic (non-module, non-IIFE)
  `<script src>` files all loaded together on `dashboard.html`. A **module-top
  `const`/`let` in a classic script lives in the page's shared global lexical
  scope across every `<script>` tag** — two files independently declaring the
  same new top-level name would throw `SyntaxError: already declared` and
  break every script after it on the page. `claude-proxy.js`/`vault-page.js`
  were safe because they only changed an *existing* constant's value, adding
  no new identifier. `dashboard-billing-tab.js` and `property-intel.js` had no
  existing constant to reuse, so the switch is declared **function-scoped**
  inside each call site instead of at module top level — zero global
  footprint, no collision risk to audit across the ~100 other classic scripts
  `dashboard.html` loads.
- `pricing-page.module.js` — a `type="module"` script (module scope is
  isolated per-file regardless), and it already imports
  `connectEmulatorsIfLocal` from `nbd-emulator-connect.js` for the same
  Audit #3 purpose. Added `getFunctionsBase()` there as the shared helper for
  module scripts that do a raw `fetch()` to an HTTP Cloud Function endpoint
  (as opposed to an SDK-callable, which `connectFunctionsEmulator` already
  covers) — the obvious existing seam, so no new file.

Not touched: `photo-ai.js` / `signed-image-url.js` already read
`window.__NBD_FUNCTIONS_BASE`, but nothing on `dashboard.html`/`customer.html`
ever sets that global (only `docs/sites/t/site.js`, the tenant-microsite
page, does) — so on the real dashboard they still silently fall through to
the hardcoded prod default today. Same bug class, left alone here since it's
a different fix shape (needs a bootstrap set on the dashboard pages, not a
local ternary) and out of this session's scope.

## Verification — real local emulator run, not reasoning

Ran the full suite (`firebase-full` / `emulators:start`), seeded `demo-co`
via the existing `scripts/seed-emulator.js`, added a `connectAccounts/demo-co`
doc (`acct_`-prefixed, `chargesEnabled`/`detailsSubmitted` true) so the tenant
passes `invoice-pipeline.js`'s existing QA/test-mode escape hatch
(`window.__NBD_CONNECT_ALLOW_TEST_MODE`, `_canCollectOnline()` at
`invoice-pipeline.js:640-646`) without impersonating the platform-owner uid.
Drove the real UI with Playwright (not the interactive browser-automation
pane — see **Reliability note** below): log in as `companyadmin@demo.test` →
open a seeded lead's card detail → **Invoice** button → **Create Invoice** →
the pipeline auto-attempts `generateStripePaymentLink` right after invoice
creation, same as production.

**Before the fix** (temporarily reverted via a tagged `git stash push -u -m`,
restored after — this repo's shared stash stack spans worktrees, so a bare
`git stash`/`stash pop` can grab another session's entry; tag + SHA + `apply`
avoids that): request went to
`https://us-central1-nobigdeal-pro.cloudfunctions.net/createStripePaymentLink`
from `http://localhost:5000` and the browser logged, verbatim, the same
CORS error the referenced audit note's console evidence quotes:
> Access to fetch at '.../createStripePaymentLink' from origin
> 'http://localhost:5000' has been blocked by CORS policy: Response to
> preflight request doesn't pass access control check: No
> 'Access-Control-Allow-Origin' header is present on the requested resource.

`generateStripePaymentLink` threw `TypeError: Failed to fetch` and the invoice
save flow degraded exactly as documented (real Stripe secret never reached).

**After the fix**: same click, request goes to
`http://127.0.0.1:5001/nobigdeal-pro/us-central1/createStripePaymentLink` and
gets a real HTTP response — `403 {"error":"ONLINE_PAYMENTS_UNAVAILABLE", ...}`
— a genuine server-side business-logic refusal (this emulator run's
`STRIPE_SECRET_KEY` is the `emulator-dummy` stub, and/or the seeded
`connectAccounts` doc didn't satisfy the server's own `mayCollectOnline()`,
which is stricter than the client mirror), not a network/CORS failure. That
is the correct proof shape: the fix's job is only to get the request to the
local function at all, which it now does.

## Why CORS "worked" locally despite `CORS_ORIGINS` never listing localhost

Worth recording so nobody "fixes" `functions/stripe.js`'s `CORS_ORIGINS`
allowlist next, thinking it's still blocking local testing — it isn't.
`onRequest({cors: CORS_ORIGINS, ...})` resolves through
`resolveCorsOrigin()` in `firebase-functions`
(`functions/node_modules/firebase-functions/lib/common/providers/https.js:398`):
`if (isDebugFeatureEnabled("enableCors")) { origin = origin === false ? false : true; }`
— the Functions Emulator sets that debug feature, which forces `origin: true`
(any origin allowed) for every `cors: [...]` function regardless of the
configured allowlist. Only `cors: false` (the two Stripe webhooks — those
must stay closed to browser CORS entirely) is unaffected. So the emulator is
permissive by design here; the ONLY thing gating local testing was the
client never routing to the emulator in the first place. Confirmed by
watching the exact same endpoint fail differently before the functions had
even finished loading (see next section) — that failure was a genuine 404
from the emulator's own router with no ACAO header, a different signature
than a resolved-but-disallowed origin.

## Two reusable local-testing gotchas found along the way

1. **A fresh worktree has no `functions/node_modules` or `tests/node_modules`
   at all** — `firebase emulators:start` fails every function load with
   `Cannot find module 'firebase-functions'`, and `npx playwright` has
   nothing to require. Junctioned both from the main checkout
   (`New-Item -ItemType Junction`) rather than a fresh `npm install` — faster,
   and a fresh install has separately been seen to strip `sharp`'s glibc
   version pins from `functions/package.json` when adding/touching a dep.
2. **The default Functions-emulator discovery timeout (10s,
   `FUNCTIONS_DISCOVERY_TIMEOUT` in firebase-tools) is too short for this
   repo's `functions/` codebase even with deps present** — first boot after
   fixing (1) still failed with `Cannot determine backend specification.
   Timeout after 10000` (0 functions registered — every rewrite hit a 404).
   Fixed locally by wrapping the `firebase-full` launch config's command with
   `set FUNCTIONS_DISCOVERY_TIMEOUT=60&&npx firebase emulators:start`
   (`.claude/launch.json`) — 60s discovers all ~180 functions reliably.
   Kept as a durable fix; anyone running the full local suite hits this.
3. Regenerated `functions/.secret.local` via the exact `ci.yml` recipe
   (`grep -rhoE "defineSecret\(...\)" ... | sort -u`, `emulator-dummy` per
   name) **before** the first boot, given ADC is present on this machine —
   see the referenced note's own "unplanned finding" (a real Resend send)
   for why skipping this is not a theoretical risk.

## Reliability note — Browser-pane automation, not the fix, was the hard part

The interactive Browser-pane tools (`mcp__Claude_Browser__*`) reliably
hard-hung — page and JS engine both unresponsive to any further call,
requiring a fresh tab — on a full top-level `navigate` to `/pro/login.html`
specifically, even though a same-origin `fetch()` of the identical URL from
an already-loaded page returned instantly with correct content. Root cause
not chased down (a same-origin `fetch()` bypasses whatever `login.js`'s own
module-script execution does once the browser actually renders the page).
Switched to the repo's own Playwright (already present in `tests/`, junctioned
in the same way) with a throwaway script and every step — login, card-detail
modal, invoice creation, network capture — worked first try. Worth
remembering before sinking time into interactive browser automation for any
future authed `/pro/` flow: prefer this repo's Playwright + a real screenshot
file over a live automation pane for anything past a static page load.
