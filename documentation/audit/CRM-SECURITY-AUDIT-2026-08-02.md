# CRM security & defect audit — 2026-08-02

Six-lens audit of `docs/pro`, `docs/admin` and `functions/`, run as a 40-agent
workflow where **every finding was handed to a separate agent instructed to
refute it**. 33 raised, 12 refuted, **21 confirmed** (6 high, 11 medium, 4 low).
Static analysis plus emulator only — production was never probed, by design.

All findings are now fixed or explicitly parked (table below). This note exists
because the delivered report was a claude.ai artifact, which is not durable
handoff material; the findings, the reasoning and — most usefully — the
**refuted** list belong in the vault.

Related: [SITE-AUDIT-LOOSE-ENDS-2026-08-10](SITE-AUDIT-LOOSE-ENDS-2026-08-10.md) ·
[SHARED-PARTIALS-SYSTEM](../architecture/SHARED-PARTIALS-SYSTEM.md) ·
[../../SECURITY.md](../../SECURITY.md)

---

## Fix status

| # | Finding | PR | State |
|---|---|---|---|
| 1 | `enforceAppCheck` no-op on `onRequest` → 2 unauthenticated Anthropic relays | #1170 | merged 8/3 |
| 2–5 | four tenant-isolation holes in `firestore.rules` | #1171 | merged 8/3 |
| 4b | referral resolver unscoped global query | #1172 | merged 8/3 |
| 6 | signed-contract overwrite | #1173 | merged 8/5 |
| 7 | inbound-SMS cross-tenant misroute | #1176 | merged 8/5 |
| 8–9 | portal revoke + shared-estimate whitelist | #1177 | merged 8/5 |
| 10 | `requireTeamAdmin` refuses a second `company_admin` | #1178 | merged 8/5 |
| 11–13 | customer estimates scope/order + doc source | #1179 | merged 8/5 |
| 14–21 | 0%-overhead, toasts, photo drop, FUNCTIONS_INDEX drift | #1180 | merged 8/5 |

**Still open:** `replyToPortalMessage` owner-only (flagged; product call, not a
defect) · the live-console checks under "Questions files cannot answer".

---

## The three findings worth re-reading

### 1. `enforceAppCheck: true` is silently ignored on `onRequest`

firebase-functions honours it **only inside `onCall`** — `HttpsOptions` is
declared `Omit<GlobalOptions,'region'|'enforceAppCheck'>`, the `onRequest`
wrapper never reads the field, and it is not serialized into the deployed
endpoint, so there is no platform-side fallback either.

16 `onRequest` handlers carried it. Two — `publicVisualizerAI` and
`publicFunnelAI` — are completely unauthenticated relays to the Anthropic API
on the platform key, and **their own comments named the dead option as the
primary abuse control**. `cors` does not gate them either: the middleware calls
`next()` on non-OPTIONS requests regardless of Origin.

> This repo had already diagnosed the identical trap once. `handlers/integrations.js`
> contains a written post-mortem about removing it from `submitPublicLead`. It grew
> back in `ai.js`, which is why the fix ships with a tripwire
> (`tests/appcheck-onrequest-contract.test.js`) rather than being a one-time cleanup.

**Not fixed by #1170, still true:** those two endpoints remain unauthenticated.
A real App Check gate needs the client half, and `__NBD_RECAPTCHA_KEY__` is
assigned nowhere under `docs/`, so `initializeAppCheck` never runs and no token
is ever attached. Needs a reCAPTCHA site key from the Firebase console.
*(2026-09-02 scoping correction: that is true only for the MARKETING site —
`__NBD_RECAPTCHA_KEY__` is read at `docs/assets/js/inline/b9b56a8331.module.js:17`
(visualizer.html) and assigned nowhere. The CRM uses a different name,
`window.__NBD_APP_CHECK_KEY`, assigned in `docs/pro/js/dashboard-appcheck-config.js`
and consumed by `dashboard-bootstrap.module.js`, `customer-bootstrap.module.js`
and `nbd-auth.js` — App Check DOES run on the CRM pages. Console-side
enforcement is still Jo's flip.)*

### 2. The rules tests only ever exercised CREATE

Four collections (`/photos`, `/knocks`, `/territories`, `/training_sessions`)
pinned `companyId` at create but left `allow update` as bare `isOwner(...)`. The
attack never needed a forged create: **make a document legitimately in your own
tenant, then `updateDoc({companyId: victim})`.** You still own it, `isOwner`
passes, and nothing inspects the field you just changed.

The matrix looked complete because it proved the create-time pin. Any
tenant-pinned collection needs UPDATE and field-freeze cases, not just CREATE.

### 3. `customerId` had to be write-once, NOT frozen

The obvious fix — add it to `didNotChange` — **would have broken lead creation
in production.** The client mints the id in a counter transaction and stamps it
onto the lead it just created (`customer-bootstrap.module.js:433`,
`dashboard-bootstrap.module.js:3270`, `:3347`). Verified before writing the rule.

```
function writeOnce(field) {
  return resource.data.get(field, '') == ''
    || request.resource.data.get(field, '') == resource.data.get(field, '');
}
```

`.get(field,'')` on **both** sides is load-bearing: comparing an absent map key
throws in rules rather than returning null, which would deny every update on a
lead that never had the field.

---

## Verified clean — do not re-audit

- **XSS on customer surfaces.** Every interpolation in `portal.js`,
  `estimate-view.js`, `refer.js`, `share-ssr.js`, `deal-acceptance.js`,
  `report-sharing.js` and `close-board.js` goes through a local escaper, with
  URL sinks guarded separately.
- **Share-token entropy and read scoping.** 24 random bytes over a 32-char
  alphabet, charset-validated path segments, all four collections admin-SDK-only.
- **Storage rules** — every path uid-keyed, content-type allowlist, default deny.
- **Firestore index coverage** — every companyId-scoped query has a matching
  composite or needs none.
- **Money-path authorization** — all ten undocumented Connect/seat exports
  gate-audited; the Connect webhook verifies its signature, fails closed when
  unset, pins tolerance to 300s, dedupes atomically, drops livemode mismatches.
- **Admin auth gating** — all six admin pages use forced-refresh custom-claim
  checks; no email whitelists, no Firestore role fields.

## Refuted — considered and dismissed, do not resurrect

Invoice Mark-Paid rules/server asymmetry (the render surface is a dead export
with no callers) · `claimInvite` seat-cap re-check (a claim is seat-neutral; the
over-cap state comes from the downgrade and has a deliberate owner-mediated
remedy) · `assignSeats` invite counting (coherent add-vs-reenable split;
`deactivateUser` reactivate is the genuinely uncapped path) · admin-gate drift
blast radius (already pinned by `stripe-connect.test.js` +
`gauntlet-regressions.test.js`) · `docPrefixes`/`counters` world-read (companyId
is a published public routing key) · `buying-intent-strike.js` `openCardDetail`
(knowingly accepted, test-pinned; the "fix" would introduce a silent no-op) ·
four bootstrap-contract divergences · report-share revocability (deleting the
report kills every link instantly) · `onEstimateViewedStrike` unbound estimateId.

## Questions files cannot answer — still open for Jo

1. `curl -sI` a live `/deal/` and `/report/` URL — does firebase.json's
   `max-age=300` on `**` override the handlers' `no-store` on pages carrying
   homeowner PII? Header precedence for function-backed rewrites is only
   observable on a live response.
2. **Does a real multi-member tenant exist?** Sets the true severity of three
   findings. Console: any company with >1 active member; any `company_admin`
   whose uid differs from that company's `ownerId`.
3. Group leads by `customerId` and by `phoneDigits` — any value under more than
   one `companyId` means the weakness was exercised, not merely possible.
4. Compare `photos`/`knocks`/`territories` `companyId` against the claim
   companyId of their `userId` — mismatches are docs re-tenanted after create.
5. `customer.html` may hit PROD functions during emulator QA:
   `connectEmulatorsIfLocal` receives only auth/db/storage, while
   `createPortalToken` and `analyzePhotoVision` call a bare `getFunctions()`.

A read-only script answering 2–4 was written to `~/nbd-audit-exposure-check.js`
(hard-blocks writes in-process; prints counts and ids, never PII). Run with
`NODE_PATH` pointed at a **v12/v13** firebase-admin worktree — v14 drops the
namespaced surface it uses.

## Method note

Scope every audit agent to static analysis + emulator explicitly. An earlier
audit prompted with "find what's readable without auth" was read by two agents
as licence to scrape a live Firebase key and probe production.
