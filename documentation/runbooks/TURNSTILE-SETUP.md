# Cloudflare Turnstile — the CAPTCHA the public forms never had (2026-09-06)

*Companion: [SECRET_ROTATION](SECRET_ROTATION.md), [ALERT_RESPONSE](ALERT_RESPONSE.md).
Contract pinned by `tests/turnstile-contract.test.js`.*

## What was actually wrong

Not "the secret was unset". **Nothing was wired at all.** The server verifier
(`functions/integrations/turnstile.js`) and the client auto-wiring
(`docs/assets/js/public-lead-submit.js`) have both existed since the C-3 audit,
but `window.__NBD_TURNSTILE_SITEKEY` was `""`, no `docs/` page contained a
`.cf-turnstile` element, so the Cloudflare script was never fetched,
`nbdTurnstileExecute()` returned `''`, and `public-lead-submit.js` omitted the
field entirely. `verifyTurnstile` then hit its unconfigured branch and returned
`{ok: true, configured: false}` — **every public submission waved through**, on
a honeypot and an IP rate limit alone.

## The rollout order — get this wrong and you lose every lead

`verifyTurnstile` rejects any tokenless submission the moment `TURNSTILE_SECRET`
is set. So:

1. **Populate the site key** in `docs/assets/js/inline/7cd8e505ab.js`.
2. **Deploy it** (a hosting deploy is enough — it is a static file).
3. **Verify real traffic is producing tokens** (below). This step is the whole
   point of the ordering and is easy to skip.
4. **Only then** `firebase functions:secrets:set TURNSTILE_SECRET`, and
   redeploy functions so the new version binds.

Setting the secret before a deployed site key 403s **100% of public leads**,
silently. Steps 1–3 are done; step 4 is deliberately not.

## Verifying step 3

`submitPublicLead` logs `turnstileTokenPresent` on every successful submission
(a boolean — a token is a credential and is never logged). Before setting the
secret, confirm it is `true` on real traffic:

```bash
gcloud logging read \
  'jsonPayload.message="submitPublicLead" AND jsonPayload.turnstileTokenPresent=true' \
  --project nobigdeal-pro --limit 5 --freshness=7d
```

If that comes back empty while leads are still arriving, the client is not
producing tokens — **do not set the secret**. Look at
`window.__NBD_TURNSTILE_SITEKEY` on the live page first.

## The widget

Created 2026-09-06 in the Cloudflare dashboard (Turnstile → Add widget
manually):

| Setting | Value | Why |
|---|---|---|
| Name | `NBD public lead forms` | — |
| Hostnames | `nobigdealwithjoedeal.com`, `www.nobigdealwithjoedeal.com` | the four pages that load the stub |
| Mode | **Invisible** | `public-lead-submit.js` renders `size:'invisible'` into a container it appends to `document.body`. A **Managed** widget that decided to show an interactive challenge would be invisible and unusable — the visitor gets no token and, once the secret is set, loses their lead. Invisible is marginally weaker against a determined bot and cannot ever block a human, which is the right trade for a lead form. |
| Pre-clearance | off | needs the site proxied through Cloudflare |

Site key `0x4AAAAAAEqcVVOXW3xyusXQ` is **public by design** and lives in the
repo. The secret key is viewable again in the dashboard (Turnstile → the widget
→ Settings) if it is ever needed.

**Legal condition of invisible mode:** Cloudflare requires the [Turnstile
Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-addendum/) to be
referenced in our own privacy policy. `docs/privacy.html` §"Security &
Monitoring" does that. If the mode is ever switched away from invisible that
sentence can go; if a new public surface adopts Turnstile, it stays.

## Which pages are covered

The four that load the stub, pinned by `tests/turnstile-contract.test.js`:
`docs/index.html`, `docs/estimate.html`, `docs/storm-alerts.html`,
`docs/sites/free-guide/index.html`. The stub must load **before**
`public-lead-submit.js` on each (the executor reads the key at submit time) —
also pinned.

No per-page markup is needed: with a non-empty key the client creates its own
`.cf-turnstile-auto` container. Adding a static `.cf-turnstile` div is the
wrong move and the contract test fails a widget on a page while the key is
empty.

## Verified before shipping

The client path was proved against Cloudflare's official test keys on a local
probe, both directions:

| Test site key | Result |
|---|---|
| `1x00000000000000000000AA` (always passes) | token in ~2.8 s, container created, API script loaded |
| `2x00000000000000000000AB` (always blocks) | resolves to `''` in ~1.9 s — **does not hang, does not throw** |

That second row is the one that matters: a failing widget degrades to "no
token", `public-lead-submit.js` omits the field, and while the secret is unset
the lead still lands. So step 1–3 carry no risk of losing leads; only step 4
makes the token load-bearing.

### The live-page probe returns no token — and that is expected

Running `window.nbdTurnstileExecute()` on the real site from an **automated**
browser returns `''` with `[Cloudflare Turnstile] Error: 600010` in the
console. That is a *challenge* failure, not `110200` ("domain not allowed") and
not a sitekey error — the script loads, the widget renders, the hostname is
accepted. The most likely cause is Turnstile correctly refusing a CDP-driven
browser, which is the product working.

The consequence for operations: **an automated probe cannot verify this
integration.** Cloudflare's test keys pass unconditionally and prove only the
wiring; the real key applies real bot detection and will fail any automation.
The only trustworthy signal is `turnstileTokenPresent` on genuine human
traffic. Plan the rollout around that, not around a synthetic check.

### A known cosmetic defect

The client calls `turnstile.render()` — which auto-executes an invisible
widget — and then `turnstile.execute(id)` again, logging `Call to execute() on
a widget that is already executing`. Harmless today; the correct shape is
`reset()` before a re-execute. Tidy it when next in that file.

## Emergency

`TURNSTILE_REQUIRED=true` (env, not secret) makes an *unset* secret fail
closed — the opposite of what you want in an incident. To disable Turnstile
enforcement quickly, destroy or blank `TURNSTILE_SECRET` and redeploy; the
verifier returns to its unconfigured passthrough.

## Related

- [SECRET_ROTATION](SECRET_ROTATION.md) — add `TURNSTILE_SECRET` to any future rotation sweep
- Session note: [SESSION-2026-09-06-instantroofer-adapter](../projects/SESSION-2026-09-06-instantroofer-adapter.md) — where the gap was found
