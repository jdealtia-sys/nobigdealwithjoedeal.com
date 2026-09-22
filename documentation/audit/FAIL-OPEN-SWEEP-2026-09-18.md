# Fail-open sweep — 2026-09-18

A read-only sweep of `docs/pro/` for **fail-open defaults on consequential
actions**: destructive actions (deletes, seat benching, session revocation),
money and message-sending actions (texts, emails, deal links, invoices), and
tenant-wide or permission-gated writes. The question put to every site was
the same: *when the thing this code depends on is missing, unloaded, or
answered "no", does the action refuse, or does it go ahead as if the answer
were "yes"?*

The sweep ran on `main` @ `4007bbbd`. Every `file:line` below is at that
commit; the fixes have moved the lines since. Five fix PRs came out of it and
all five merged the same day with CI 22/22 green, including the six required
authed-E2E shards. Two items are not fixed: one is deferred and one is waiting
on a decision from Jo. Both are recorded below with the fix that was proposed.

## Method

- **Two finder lenses, run independently:**
  - **A: registry sites.** Every non-assignment read of
    `__NBD_CALL_REGISTRY` in the 31 files that mention it. A `typeof`-guard
    inventory (~600 guarded names), filtered to gate, confirm, validate,
    send, delete, pay and permission helpers. All 25 client
    `deleteDoc`/`batch.delete`/`deleteObject` sites. Every `NBDComms`
    consumer. All five `companyProfile` read-modify-write save sites, checked
    against the `_companyProfileLoaded` gates. Lazy-stub consumers. The SW
    caching strategy and `firebase.json` Cache-Control, read only to judge
    how realistic a version-skew trigger is.
  - **B: confirm-gate defaults.** Permissive-default grep shapes
    (`let ok = true`, `catch → return true`, `|| true`, `?? true`,
    `.catch(() => true)`, `!== false` gates). All 118 confirm call sites and
    every `window.nbdModal &&` guard. The ~30 `window._userClaims || {}`
    sites. Plan, billing and owner gates (`getPlan().loaded`, `_seatCap`,
    `enforceGate`/`softGate`, `_isOwner`, `hasLiveSub`). Every
    `_saveCompanyProfile` caller. The brand-string "is this NBD?" gates. Plus
    consents, deletes, GDPR export/erasure and team seat/member actions.
- **One adversarial verifier per finding.** Each verifier was told to
  *refute* the finding against the cited source. It returned
  `{real, realisticTrigger, reasoning, correctedFix}`. `real` means the
  permissive branch exists and is reachable. `realisticTrigger` means it can
  fire in production today. Where the verifier's `correctedFix` differed
  from the finder's proposed fix, the fix PRs implemented the verifier's
  version, re-checked against current source. That happened often, for
  example:
  - The booking-link fix. The finder proposed "not hydrated → return `''`".
    That would have blanked NBD's own booking buttons on every customer-page
    load, because the check always runs before hydration.
  - The seat-picker finding. The claim that the `Infinity` catch was the
    bug was wrong.
  - The `crm-leads.js` fix. It referenced an undefined `reg`.
  - The NBDComms fix. It was incomplete without reordering the server first.
- **Server code and `firestore.rules`** were read only to judge whether the
  server backs up a client gate. Both are otherwise out of scope, as is
  anything outside `docs/pro`.

## Outcome at a glance

| | Count |
|---|---|
| Raw findings | **23** (lens A 13, lens B 10) |
| Cross-lens duplicates (both lenses found the same defect) | 4 pairs, leaving **19 distinct** |
| Verifier: real, realistic trigger today | **12** distinct |
| Verifier: real, but no realistic trigger today | **4** distinct |
| Verifier: refuted | **3** |
| Fixed (5 PRs, all merged 2026-09-18) | **14** distinct: all 12 realistic ones except the booking-link item, plus 3 of the 4 unrealistic ones as hygiene |
| Deferred | 1 (`close-board.js` `_dealBrand`) |
| Awaiting Jo | 1 (booking/review-link ownership) |

## Findings: all 23, as the verifiers ruled

Lens A = registry sites, lens B = confirm-gate defaults.

| # | Lens | `file:line` @ `4007bbbd` | Action | Trigger → consequence | Realistic | Disposition |
|---|---|---|---|---|---|---|
| 1 | A | `d2d-tracker-core-2026b.js:4681` | D2D knock follow-up text (`sendFollowUpSMS`) | Any `NBDComms.sendSMS` result with `success:false` opened `sms:<phone>?body=…`. NBDComms returns that only when it **refuses** (403 opt-out, 401), so a number that had replied STOP was one tap from a text sent from the rep's own phone, with nothing written to `sms_log`. **TCPA bypass.** | yes | **#1660**. The consumer rule was tightened again in #1667. |
| 2 | A | `close-board.js:678` | Close Board "Email" deal to homeowner | `getDealAcceptLink()` returned null in every fresh session, because nothing loads the Functions SDK at dashboard boot. `sendViaEmail` sent anyway ("View your options here: [Link will be available shortly]") and stamped the deal `sent`, which counts toward close-rate. | yes | **#1663** (d) |
| 3 | A | `pipeline-builder.js:328` | Settings → Pipelines save (tenant-wide `companyProfile.pipelines`) | The profile was not hydrated, so `_cfg` was seeded as `{stages:{}, views:{}}` and the merge-write wiped view orders or custom stages. Leads orphaned into New for every rep, and the save still toasted "Pipelines saved". | yes | **#1665** (a) |
| 4 | A | `templates-library.js:511` | Portal-link SMS/email share (sends through NBDComms with no later review step) | A second share tap during the async token mint hit the `_modalOpen` branch, which resolved `apply(templates[0])`. That template was texted or emailed unseen while the first picker was still open. A double-tap on a starred default sent twice. | yes | **#1660** |
| 5 | A | `crm-leads.js:338` | Lead edit save | `trades: []` was written when the registry helper was missing (service-worker per-file version skew only). | no, as reported | **#1665** (c). The implementation found a realistic path the finder missed: `getSelectedTrades()` also returned `[]` whenever the chips had never been drawn (job type "Not Set"). |
| 6 | A | `dashboard-actions.js:773` | Delete territory zone (`deleteZone`) | `let ok = true` sat before the registry guard, so a missing `_deleteZone` entry removed the zone locally with no server delete. | no (unreachable in a clean load) | **#1663** (a), hygiene |
| 7 | A | `crm-pipeline.js:1872` | Kanban move of an unpromoted prospect | `promoteProspect` swallows its own errors, so a failed promote falls through to the stage write. | — | **REFUTED** (below) |
| 8 | A | `email_system.js:285` | Customer-page email modal send | After a 401/403 refusal it falls through to `mailto:` and writes an `emails` log entry with `sentAt`. | — | **REFUTED** (below) |
| 9 | A | `crm-portal-bridge.js:580` (and `:655`) | Soft-delete / permanent-delete a lead | `_deleteLead` and `_permanentDeleteLead` swallowed write errors and resolved `undefined`, and the callers toasted success. A viewer can see team leads, but the rules refuse the viewer's write. | yes | **#1663** (b) |
| 10 | A | `close-board.js:272` | Delete a deal room | The deal was removed from memory and localStorage first. The Firestore delete was skipped before auth or its error swallowed, so the doc rehydrated and the homeowner's `/deal/<token>` link stayed **acceptable**. | yes | **#1663** (c). The review fix also makes hydrate prune server-deleted deals. |
| 11 | A | `maps-customers.js:519` | Save/delete a team-shared map view | `_loadCustViews()` returns `[]` while the profile is unhydrated, so the whole `mapViews` array was replaced. | yes | **#1665** (b) |
| 12 | A | `close-board.js:373` | Auto-sent deal SMS/email naming the sender (`_dealBrand`) | An unhydrated brand is the NBD defaults, so a tenant's homeowner would get "your roof estimate from No Big Deal Home Solutions". | no (one tenant in prod) | **DEFERRED** (below) |
| 13 | A | `warranty-claim.js:256` | Warranty-claim status advance (required-field gate) | A missing validator yields `[]`, so the status write goes ahead. | — | **REFUTED** (below) |
| 14 | B | `d2d-tracker-core-2026b.js:4680` | = #1 | = #1 | yes | **#1660** (duplicate of #1) |
| 15 | B | `booking-events.js:101`, plus `crm-portal-bridge.js` `_repBookingUrl` (~749–754), the NBD sign-offs (`crm-portal-bridge.js` ~773/793, `customer-bootstrap.module.js` ~784) and `review-engine.js` ~84 | Booking link, booking SMS, review-request SMS/email | "Is this tenant NBD?" is decided from brand strings (`legalName`, `seal === 'NBD'`). Before hydration the brand **is** the NBD defaults, and the catch returns true. A tenant's homeowner would get `cal.com/nobigdeal/…`, Joe's sign-off and NBD's Google-review link, and the review link is cached for the page session. | yes: on customer.html every dashboard→customer handoff runs the check before hydration | **DECISION: awaiting Jo** (below) |
| 16 | B | `dashboard-actions.js:909` | Load Sample Data (13 demo leads + 6 tasks) | It confirmed only when `_leads.length > 0`. `_leads` is `[]` before the first load and after a failed one (common on iOS app-wake), and the diagnostic panel for that exact error puts the button next to Retry. Fictional homeowners landed in a live book with no confirm. | yes | **#1661** (a) |
| 17 | B | `dashboard-team-tab.js:147` | Settings → Team seat picker "Apply" (`assignSeats` disables Auth and revokes tokens for deselected reps) | The cap came from an unloaded plan (`'free'` → 0) or a failed reload (purchased seats zeroed). The owner was pushed to bench reps mid-shift. | yes | **#1661** (c) |
| 18 | B | `pipeline-builder.js:56` | = #3 | = #3 | yes | **#1665** (duplicate of #3) |
| 19 | B | `dashboard-actions.js:773` | = #6 | = #6 | no | **#1663** (duplicate of #6) |
| 20 | B | `nbd-comms.js:295` | Every platform SMS (portal link, Close Board, invoice, D2D) | Any failure other than 401/403 was handed to the device Messages app. That included the plain 500 the server returns when the opt-out-register read fails, and the 402/429 that the server ran **before** the opt-out check. The invoice was then marked sent. | yes | **#1667**. The offline (status 0) handoff is being replaced by the offline SMS outbox (below). |
| 21 | B | `maps-customers.js:158` | = #11 | = #11 | yes | **#1665** (duplicate of #11) |
| 22 | B | `data-import.js:417` | CSV lead import | Dedupe (and the LITE cap) ran against an empty, unloaded cache, so every row counted as new. The whole book was duplicated, each copy minting a fresh customer ID. | yes (low) | **#1661** (b) |
| 23 | B | `session-revoke.js:85` | Settings → Security "Sign Out Everywhere" | `var okToGo = true` had no fallback when `nbdModal` is missing, so there was no prompt. | no (nbd-modal.js is a blocking head script) | **#1663** (e), hygiene |

## What shipped

| PR | Lane | Findings | Tests added | Mutation evidence |
|---|---|---|---|---|
| [#1660](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1660) | FO-1 comms | #1/#14, #4 | `d2d-followup-sms-optout.test.js` (19), `portal-share-no-double-send.test.js` (32). Both vm-load the real files. | 18/18 RED |
| [#1661](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1661) | FO-4 unloaded-cache gates | #16, #22, #17 | `unloaded-cache-gates.test.js` (71). Every refusal is paired with a loaded-state control. | 19 mutants plus a full revert, all RED on named assertions |
| [#1663](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1663) | FO-2 destructive false-success | #6/#19, #9, #10, #2, #23 | `failopen-destructive-false-success-2026-09-18.test.js` (82) | 33 RED, plus 2 equivalent mutants recorded as such |
| [#1665](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1665) | FO-3 unhydrated tenant writes | #3/#18, #11/#21, #5 | `pipeline-builder-hydration.test.js` (39), `map-views-hydration.test.js` (20), `lead-trades-unknown.test.js` (12) | all RED. One layered mutant survives by design (b1b; b6 proves the layering). |
| [#1667](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1667) | FO-5 SMS opt-out server order | #20 (and the #1 consumer) | `sms-send-optout-order.test.js` (39, drives the real handlers). `nbd-comms-platform.test.js` gained 26 assertions. | 27/27 RED |

What each PR changed:

- **#1660.** D2D never opens `sms:` after an NBDComms answer, and "Text sent" shows only
  when `mode === 'platform'`. It gained a fail-closed `.catch`, and the bare `sms:` path
  is kept only for when NBDComms is absent. The `pickAndRender` re-entry now resolves
  `undefined` with "Finish the open template picker first". A per-`channel:leadId`
  in-flight guard, released in `finally`, stops double sends. The per-lead guard alone
  would not have caught two *different* leads, so the picker fix carries weight
  independently.
- **#1661.**
  - `loadSampleData` and `runImport` refuse unless `window._leadsLoaded === true`. The
    import check sits in `runImport`, not `openImport`, so a load that lands mid-flow
    still imports.
  - The Tools-menu sample button shows only for a *confirmed*-empty book.
  - `_seatCap()` returns `null` ("cap unknown") when the plan isn't loaded or when
    `NBDBilling` is absent or throws. The old catch returned `Infinity`, which skipped
    the cap check. The picker hides and Apply refuses on `null`.
  - The Team tab now refreshes the plan before rendering, with an 8 s fallback.
  - Founder sessions are unaffected: the owner path sets `_loaded` before any I/O.
- **#1663.**
  - (a) `let ok = !zone.id || String(zone.id).startsWith('d-')`.
  - (b) The lead-delete callees resolve `true`/`false`, and the callers proceed only on
    `=== true`.
  - (c) The deal-room delete is server-gated. A deal counts as "on the server" once it
    has a `userId` stamp or a minted `acceptUrl`. Only never-synced drafts drop locally.
    An in-flight Set prevents a double-tap second delete. The **review fix** makes
    `hydrateFromFirestore` treat the server as authoritative: confirmed deals the server
    stopped returning are pruned. Without it, a deal deleted on device A could never be
    deleted on device B.
  - (d) `sendViaEmail` refuses without a link. `getDealAcceptLink` lazy-loads
    `firebase-functions.js` 10.12.2 plus the emulator connect.
  - (e) `okToGo` defaults to `false`, with a fallback to `nbdConfirm || confirm`.
- **#1665.**
  - `pipeline-builder.js` records `_cfgHydrated` **at snapshot time**. `openBuilder()`
    awaits `_loadCompanyProfile()` and then requires the flag. It shows no editor on an
    unhydrated snapshot, only a "Couldn't load" message with a Retry button. `save()`
    checks `writeReady()`, and Reset only clears memory when the write landed.
  - `maps-customers.js` does await-then-require. It re-reads the list after the await
    and pins the delete target by name from the rendered list.
  - `getSelectedTrades()` returns `null` when no chip was ever drawn, and `saveLead`
    omits `trades` unless it gets a real array, the same way it already omitted `stage`.
- **#1667.**
  - **Server** (`functions/sms-functions.js`). The order is now auth → `to` validation →
    **opt-out** → per-IP limit → paid gate (402) → per-uid/per-recipient limits (429) →
    Twilio. A register read that fails answers **503 `optout_unverified`**. The **review
    fix** bounds that read at 10 s, well under the client's 25 s abort; a hung read would
    otherwise have come back as a status-0 handoff. Twilio **21610** records the opt-out
    (`source:'twilio_21610'`) and answers 403. Other provider errors answer 502
    `provider_error`.
  - **Client.** NBDComms refuses on 403 and on any 5xx other than `provider_error`. It
    still hands off 402, 429, `provider_error` and status 0.
  - **Consumers.** D2D, the smart-follow-up panel (its SMS refusal is now final) and
    the invoice message text were updated.
  - **Deploy.** The Firebase deploy run for `5f337415` completed green.

## Refuted (3), and why

- **#7 `crm-pipeline.js:1872` (prospect promote → stage move).** The code shape is as
  described: `promoteProspect` returns `undefined` on failure and the catch in
  `moveCard` can never fire. But reaching the branch takes an `updateDoc` that rejects
  while the very next transactional stage write succeeds, and `crm-portal-bridge.js`
  loads eagerly. It is also not a guard bypass. Kept as **hygiene, not scheduled**:
  make `promoteProspect` return a boolean and have `moveCard` cancel on `false`, the
  same way the lost-reason and warranty-claim guards do.
- **#8 `email_system.js:285` (mailto after a refusal).** Nothing in the shipped UI
  opens that email modal, so this is a latent contract mismatch, not a live fail-open.
  If the modal is ever wired to a control, first add the
  `success === false && mode === 'platform'` stop that `portal-link-helpers.js` already
  has, and drop the client `emails` audit write (rules deny it, and it lies).
- **#13 `warranty-claim.js:256` (`advanceClaimStatus` validator).**
  `advanceClaimStatus` has **no caller in `docs/`**. It is only exported on
  `window.WarrantyClaim` and exercised by tests. Hardening for a future caller: fail
  closed like the `_ready()` throw one line above it, and keep the exact call text the
  smoke suite pins.

## Deferred / awaiting a decision

### Booking and review-link ownership: **DECISION, awaiting Jo** (finding #15)

**The defect.** Four places decide "this tenant is NBD" from brand strings, and
all four default to *yes* when the brand is unknown:

- `booking-events.js` ~101 `isNbdTenant()`. Its catch returns `true`.
- `crm-portal-bridge.js` `_repBookingUrl` (~749–754). Its catch falls through to the
  house URL.
- The NBD sign-offs (`crm-portal-bridge.js` ~773/793, `customer-bootstrap.module.js`
  ~784).
- `review-engine.js` ~84, which treats the default seal `'NBD'` as ownership and
  caches the result for the page session.

Before `_loadCompanyProfile` lands, `window._brand()` *is* the NBD defaults.

On `customer.html` this is not timing-dependent. The booking block runs
synchronously before hydration on every dashboard→customer handoff. For NBD it
gives the right answer by coincidence. For any other tenant, the homeowner gets a
`cal.com/nobigdeal/<slug>` link (booking on the platform owner's calendar hands
their name, phone and address to NBD), Joe's sign-off, and NBD's Google-review link.
Prod has one tenant (per the 2026-08-05 verification), so there is no live harm
yet. Signup is open, though, and the first second tenant hits it on their first
customer open.

**The proposed fix.** An **identity check, not a brand check**: `uid` or
`claims.companyId` equals the owner, which is the check `invoice-pipeline.js`
already uses, with a catch that fails closed. Apply it everywhere a `legalName`
or seal string decides ownership:

- `booking-events.js` `isNbdTenant()`.
- `_repBookingUrl`: return `''` for a non-owner. `sendBookingSMS` already declines on
  `''`.
- The sign-offs: the owner keeps NBD's. Anyone else gets the tenant's `smsSignOff`
  only when `_companyProfileLoaded === true`, and otherwise the clause is dropped.
- `review-engine.js`: await hydration, use the owner check, don't cache a failed load,
  and decline to send (with a toast pointing to the Settings review-link field) when
  there is no link.

The identity check is correct synchronously on `customer.html`, because `_user` and
`_userClaims` are set before the booking block. Do **not** add a "not hydrated →
`''`" gate; that would blank NBD's own buttons on every handoff load.

Tests: `tests/booking-events-tenancy.test.js` uses `brand:null` as its NBD fixture,
so switch it to owner claims. Add the inverse case: brand = NBD defaults and
claims = another tenant. Mutation-check it in three shapes.

**Why it needs Jo.** Jo's two non-owner logins, **jdeal.tia@gmail.com** and
**demo@nobigdeal.pro**, would lose the house Cal.com and review links. They would
show nothing instead of a wrong link. Each would need its own Cal.com username and
review link set in Settings. This is the same class as the NBD-leak rule the repo
already applies elsewhere (`company-profile.js` `_tenantFilePrefix`,
`document-generator.js` ~358–380, and the customerId mint in
`customer-bootstrap.module.js` ~497–514): gate on identity or hydration, and skip
rather than guess.

### `close-board.js` `_dealBrand` pre-hydration NBD brand: **DEFERRED** (finding #12)

The fail-open is real, but it can't trigger today: prod has one tenant. If it is
picked up, follow the verifier's fix: an async gate modelled on
`_tenantFilePrefix` (`company-profile.js` ~604–646: await the load, require the
flag, skip rather than guess). Do **not** model it on `_awaitBrandHydration`,
which itself fails open. It naturally travels with the ownership decision above.

### NBDComms offline (status 0) handoff: **being replaced by the offline SMS outbox**

#1667 deliberately left status 0 (offline, a network error, or the 25 s client
abort) handing off to Messages, because opt-out status is unknown when the
request never reached the server. That was Jo's decision to make. **Jo approved
replacing the handoff with an outbox:**

- Offline texts are queued instead of opening Messages.
- At flush, the server re-checks opt-out and checks for competing activity.
- Quiet hours are 08:00–21:00 ET.
- Queued texts have a 15-minute auto-send window.

## Checked and deliberately not reported

Recorded so a later sweep doesn't re-flag them. These are fail-closed,
deliberate, or backed by the server.

- **`nbdConfirm || confirm` fallbacks.** They fail closed since
  `standalone-compat.js` stopped patching `confirm`. The comments at
  `dashboard-actions.js` ~2384–2386 and `crm-pipeline.js` ~1856–1861 are stale.
- **`typeof confirm === 'function' ? confirm(m) : true`** in `pipeline-builder.js`
  (266, 296) and `referral-rewards-ui.js` (151). The `true` branch is unreachable in a
  browser.
- **Documented, intentional fail-opens:**
  - billing `enforceGate`/`softGate` before the plan loads (a product decision)
  - `saveZone`'s local `'d-'` fallback
  - the DocPreflight → NBDDocGen fall-through
  - public-intake App Check
  - `_saveLead` dedupe "degrades gracefully"
  - `nbd-auth` `_initPromise.catch` un-hides the page
  - the doc-viewer signature-finalize 3 s timeout
  - the lead read-only banner when the role is unknown
- **The NBDComms 429 handoff.** Documented, and after #1667 it only happens once the
  opt-out check has passed. Lens B still thought it worth a product look.
- **Server-gated or harmless:**
  - `invoice-pipeline.js` ~740–748 proceeds if the send lock fails. Only a rules
    denial triggers that, and the server blocks viewers first.
  - `crm-snooze.js` ~259 `pushAllowed` controls a local notification only.
  - Missing claims read as "solo owner" in edit gates (`pipeline-builder.js` `canEdit`,
    `maps-customers.js` `_custCanEditViews`, `admin-manager.js`). That is a UI
    affordance only; the rules and callables are the backstop. #1665 still tightened
    `canEdit` to read-only on absent claims.
- **Not action gates:** estimate tax/deposit defaults are calculation defaults, and
  the localStorage `catch → true` sites are cosmetic.

## Follow-ups surfaced by the reviews

- **`_leadsLoaded` is never reset on a same-tab account switch** (#1661 review). If
  account B's first load fails, B keeps A's `_leadsLoaded = true` and A's stale cache.
  Both new guards then pass against **A's** book, so B's CSV dedupes against A's leads.
  **Task spawned.** At the time of writing it is open as **#1676**, not merged. That PR
  also stops `_optimisticInsertLead` from arming the flag after a failed first load,
  which #1661 had deferred.
- **Close Board `nbd_deal_rooms` localStorage is not per-user** (#1663 review). On a
  shared device, user B cannot clear user A's rows, and pruning other accounts' rows
  would throw away their unsynced edits. **Task spawned.** At the time of writing it
  is open as **#1677**, not merged.
- **A confirm-less `loadSampleData` twin** remains in `dashboard-bootstrap.module.js`
  (~2950–3045). It is shadowed today, because `dashboard-actions.js` loads later and
  redefines it. Deleting it touches MUST-STAY pins: the comments at bootstrap ~5771
  and `dashboard-state.js` ~316, `tests/smoke/dashboard.test.js` ~3083/3788, and
  `tests/smoke/phone-digits.test.js` ~142–143.
- **The `?v=` cache-bust sweep is still pending.** Every fail-open and T3 PR this
  session deferred its bumps to session end. That covers `invoice-pipeline.js` and the
  other touched files. These pairs must bump together:
  - `crm-leads.js` with `dashboard-bootstrap.module.js`. An old cached `crm-leads.js`
    still writes `trades: []`, and no source change can reach it.
  - `dashboard-ui-prefs-boot.js` with `ui.js`.
  - `dashboard-insurance-overlay-toggle.js` with `dashboard-state.js` and
    `dashboard-widgets.js`.
- **Smaller residuals recorded in the PR bodies, not scheduled:**
  - #1660: `d2d-tracker-ui` `smsArgs` omits `id`, so `knockId` reaches the server as
    null. Harmless.
  - #1661:
    - A `sales_rep` with no leads of their own, in a populated tenant, gets no
      sample-data confirm.
    - A mid-import `_leads` array swap is low risk.
  - #1663:
    - `_restoreLead`/`restoreDeletedLead` has the same swallow-then-"Lead restored"
      shape. **Fixed 2026-09-22** (branch `fix/restore-deal-resurrection`): true/false
      callee, the drawer proceeds only on `=== true`.
    - An in-flight `updateDeal` sync that lands after a delete can recreate the doc
      through `setDoc(merge)`. **Fixed 2026-09-22** (same branch): the sync skips ids
      being or already deleted in this tab, and writes a server-confirmed deal with
      `updateDoc`, which cannot create a doc.
  - #1665:
    - Trade chips aren't reset when the modal closes.
    - Concurrent admins overwrite each other's `mapViews`/`pipelines` (last write
      wins).
    - After a late hydration the board keeps default columns until a save or reload
      (review nit).
    - A deleted custom stage leaves `stages.<key>` on the server.
  - #1667:
    - `onAiDraftApproved` doesn't record Twilio 21610 into the register.
    - The smart-follow-up panel's **email** fallback after a platform refusal is the
      email twin of the SMS issue fixed here.
    - `sendD2DSMS` keeps its paid gate and per-uid limit ahead of the opt-out check
      (no client consumer today).

## Rules learned

1. **Not loaded ≠ empty.** `_leads` is `[]` before and after a failed load.
   `getPlan()` says `'free'` when unloaded. `getSelectedTrades()` said `[]` when the
   chips were never drawn. `_loadCustViews()` says `[]` on an unhydrated profile. An
   unhydrated `_companyProfile` *is* the NBD defaults. Gate on the explicit loaded flag
   (`_leadsLoaded === true`, `getPlan().loaded`, `_companyProfileLoaded === true`).
   Return `null` ("unknown") rather than an empty value, and **omit a key rather than
   write an empty one**, as `stage` already did.
2. **Gate tenant-wide writes on `_companyProfileLoaded === true`, using
   await-then-require.** If the profile isn't loaded, `await _loadCompanyProfile()`,
   then require the flag. Record hydration **at snapshot time**: a check made only at
   save time approves a defaults-seeded snapshot once the profile finishes loading
   underneath it (the `_countyInputsResolved` trap). Re-read the list after the await.
   Skip rather than guess.
3. **NBDComms owns the whole outcome.** `success:false` from NBDComms means it
   *refused* and has already shown the toast. Every soft failure it can recover from,
   it has already handed off and returned as `success:true, mode:'sms'`. So a caller
   never opens `sms:`/`mailto:` itself after **any** NBDComms answer, never falls back
   to a *different* send path after a refusal, and claims "sent" only on
   `mode === 'platform'`.
4. **A handoff counts as sending.** The opt-out check must run before every response
   the client hands off (402, 429 including the per-IP limiter, provider errors). An
   unverified register read is a refusal (503), and that read must be bounded below
   the client's fetch timeout, or a hung read turns into a status-0 handoff.
5. **Destructive UI removal only after the server confirms.** The callee returns
   `true`/`false` and never swallows errors into `undefined`. The caller proceeds only
   on `=== true`. The only local-only exception is a never-synced draft. On hydrate,
   make the server authoritative (prune what it stopped returning) so a delete made
   elsewhere can't leave an undeletable ghost.
6. **A gate variable defaults to closed.** `let ok = true` or `var okToGo = true`
   ahead of an optional guard is the fail-open shape. Initialise to the refusal; only
   an explicit `=== true` proceeds, and a throw counts as no.
7. **A caller's dead error branch is a symptom.** `confirmDeleteLead`'s `catch` could
   never run because the callee swallowed the error. When a caller's error handling is
   unreachable, the contract broke in the callee.
8. **Brand strings are not identity** (pending Jo's decision above). Ownership is
   `uid`/`companyId` against the owner, with a catch that fails closed. Brand strings
   are for rendering only. `_resolveBrand`'s "never null, so a consumer can always
   render" is a promise about rendering, not an answer about ownership.
9. **Tests for fail-closed code:**
   - A behavioural suite must fail if it exits before its summary line. A
     never-settled stub promise lets Node exit 0, which #1663 guards with
     `process.on('exit')`.
   - Pair every refusal case with a loaded-state control, so a green refusal can't
     come from a harness that never reached the action.
   - Mutation-verify in three shapes (revert, weaken, reformat or extra occurrence),
     and record equivalent mutants as such rather than bending the test to kill them.

## Process note: parallel fix lanes

The five fix lanes were cut from the same base, and every one that registered a
new suite collided on `tests/ci-manifest.json` and on the `FLOORS` literal in
`scripts/run-test-manifest.js`. The resolution that worked every time was to take
the union of both sides' suite entries, then **re-measure FLOORS with `--check`
on the merged tree**. Never hand-add the numbers. The same collision class hit the
parallel Globals Tranche 3 PRs in `tests/smoke/dashboard.test.js`; see the
2026-09-18 (part 5) update in
[globals-tranche3-plan.md](../../docs/dev/globals-tranche3-plan.md).

*Related: [WEEKLY_CADENCE](../projects/WEEKLY_CADENCE.md) (the booking decision
is in Jo's queue) · [SESSION-REVOCATION-2026-09-08](SESSION-REVOCATION-2026-09-08.md)
(where "Sign Out Everywhere" came from) ·
[CALCOM-INTEGRATION-2026-08-25](CALCOM-INTEGRATION-2026-08-25.md) (the booking
links) · [NEXT_SESSION-2026-09-18-part4](../projects/NEXT_SESSION-2026-09-18-part4.md)
(the brief this session started from).*
