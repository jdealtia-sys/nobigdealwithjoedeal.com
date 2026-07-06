# Next Session — The Stranger Test

> Planning brief, 2026-07-06. Written after a full sweep of BIG_ROCKS.md, the
> pillar plans, the 2026-07 product audit, and the last 72 hours of merges
> (PRs #839–#858). Self-contained: a fresh agent can pick this up cold.
>
> **STATUS: EXECUTED same-day (this PR).** The rig now boots the Functions
> emulator, `tests/e2e/stranger.spec.js` runs the full journey in CI
> (`@stranger` matrix shard), and the findings are recorded in the
> **Punch list** section at the bottom of this doc.

## State of the board (why this pick)

Almost everything the planning docs list as "next" has already shipped:

| Project | Status |
|---|---|
| Rock 1 — Firebase hosting cutover | ✅ done (Audit #4). Small tail: no HSTS / nosniff headers |
| Rock 2 — estimate engines 3→1 | PRs 1–5 ✅ (audit, deprecation telemetry, shared config, add-ons+deposit in V2, entry point). **PR 6 (delete classic) gated on warning bake until ~Jul 18+** |
| Rock 3 — authed E2E suite | ✅ done (15 journeys, emulator CI). Flip to required ~Jul 19 after 2 weeks green |
| Rock 4 — dashboard decomposition | ✅ Phases 1–6 done. Tail: globals Tranche 2b+ (`docs/dev/dashboard-decomposition-plan.md:462`) |
| Pillar 1 — provisioning | ✅ createCompany, invites (de-GCIP'd), onboarding wizard — shipped 2026-07-03 |
| Pillar 4 — company billing | ✅ shipped. Tail: hardcoded `OWNER_EMAILS` bypass still live |
| Pillar 5 — tenant sites | ✅ Phase 1 universal microsite `/sites/t/<slug>` + Oaks cutover (2026-07-04). Custom domains **deferred by Jo 2026-07-04** — do not revisit |
| Funnel breaks (audit §1) | #1 free-guide dead-end ✅ fixed; #3 unverified-email 403 ✅ fixed (`functions/stripe.js:132`); #2 IAM grant = Jo console action, not code |
| CRM mobile | Phase 1 + Phase 2 *foundation* merged (#854–#858). Aggressive consolidation needs Jo device-in-the-loop — can't be done unattended |

The one thing that has **never been proven** is the product audit's central
verdict (`documentation/architecture/NBD-PRO-PRODUCT-AUDIT-2026-07.md`):

> "No stranger can self-provision a usable tenant today… Second contractor
> tomorrow, unbabysat? **No.**"

Every piece needed to flip that verdict shipped in the last 72 hours —
`createCompany` (Jul 3), team invites (Jul 3), onboarding wizard (Jul 3),
the tenant microsite (Jul 4), the funnel fixes (Jul 4–5). But **no test
exercises them together**, and structurally none *can*: the authed E2E rig
boots `--only auth,firestore,storage,hosting` (`tests/package.json:48`) —
**no Functions emulator** — so the existing signup journey deliberately
treats `createCompany` failing as non-fatal (`tests/e2e/pro-authed.spec.js:116`).
The newest, least-tested, most product-critical code in the repo has zero
end-to-end coverage.

## The session: prove the SaaS, end to end

**Goal:** add the Functions emulator to the authed E2E rig and write the
**Stranger Journey** — the full second-contractor lifecycle running in CI on
every PR, forever. This converts a month of shipped plumbing into a
permanently enforced guarantee, and will flush out every remaining seam in
the code that shipped this week.

### Plan of attack

1. **Functions emulator into the rig.** `firebase.json:355` already
   configures it (port 5001); the work is extending
   `test:e2e:authed:emu`'s `--only` list and making `functions/` boot clean
   in emulator mode. Expect friction here — this IS the session's value:
   - secrets/env the functions expect (Stripe, Resend, etc.) — provide
     emulator-safe defaults, never real keys;
   - `NBD_DEPLOY_SKIP_LIST` semantics under emulation (`onRepSignup` must
     stay skipped);
   - App Check: register/onboarding init it with enforcement — the rig
     needs the emulator debug-token path;
   - CI boot cost — if heavy, make it a 4th matrix entry (the tap-audit
     already proved the extra-shard pattern).

2. **Journey: provision.** Register (no access code) → `createCompany`
   *actually succeeds* → `companyId` claim + `company_admin` role → complete
   the onboarding wizard **for real** (brand name, color, contact — not the
   skip link the existing journey uses) → land on the dashboard unwalled at
   plan `free` → assert `companyProfile/{id}` is seeded NEUTRAL (the
   Pillar-2 "NBD bleed" rule: the tenant's own name, not Joe's defaults).

3. **Journey: operate.** Save a lead as the new tenant; assert it's scoped
   to their `companyId`.

4. **Journey: public face.** Load `/sites/t/<companyId>` → assert
   `getPublicSiteConfig` renders THEIR name/colors → submit the quote form →
   `submitPublicLead` routes the lead into THEIR pipeline (and the alert
   target resolves to them — never Joe; `resolveAlertTarget`). Assert the
   lead appears in their kanban and does NOT appear in the seeded NBD
   tenant's.

5. **Journey: team.** Owner invites a rep by email → member doc `invited` →
   second browser context signs up with that (verified) email →
   `claimInvite` merges `{companyId, role}` → rep sees the same pipeline;
   the rep's superseded solo tenant is marked `superseded-by-invite`, not
   deleted.

6. **Isolation.** UI-level cross-tenant probes (complementing the existing
   `firestore-rules.cross-tenant.test.js`): the stranger cannot read NBD
   leads, and vice versa.

7. **Punch list.** Every seam the journey flushes out gets recorded in a
   findings section appended to this doc (or a `documentation/qa/` log) —
   that list is the agenda for the session after this one.

### Explicitly out of scope

- **Stripe checkout in-emulator** — hosted checkout can't be emulated;
  assert up to the `createCheckoutSession` request shape at most. The free
  plan IS the provable product path (Jo's 2026-07-04 no-paywall decision).
- **Custom domains** — deferred by Jo 2026-07-04.
- **CRM Phase 2 consolidation** — device-in-the-loop with Jo only
  (`docs/dev/crm-responsive-map.md`).
- **Rock 2 PR 6** — deprecation warnings only started baking ~Jul 4; the
  plan requires 14–30 days of field logs first.

### Risks

- Functions emulator flake/boot-weight in CI — mitigate with a dedicated
  matrix shard and scoped seeds; keep the new journey `continue-on-error`
  alongside the rest until it's proven stable.
- The journey mutates auth users + multiple tenants — seeds must stay
  idempotent (`tests/e2e/fixtures/seed-emulator.js` is the pattern).

### Definition of done

- CI boots the emulator rig **with functions** and runs the Stranger
  Journey green.
- Coverage: register → createCompany → onboard (real, not skipped) → save
  lead → microsite renders tenant brand → public lead routes to tenant →
  invite → claimInvite → shared pipeline.
- Cross-tenant isolation assertions pass at the UI level.
- Findings punch list recorded.
- The audit's "second contractor tomorrow, unbabysat?" gets a dated,
  evidence-backed answer in this doc.

## The bench (if blocked, or the session finishes early)

1. **Globals Tranche 2b+** — widgets/tasks/email_system/crm-snooze
   remnants + the `_NBD_CALL_ALLOWLIST` cluster
   (`docs/dev/dashboard-decomposition-plan.md:462`).
2. **Retire `OWNER_EMAILS`** — `docs/pro/js/billing-gate.js:70` +
   `functions/billing.js` (Pillar 4 Phase 1 leftover); replace with a
   claim/config, keep the founder-never-gated invariant.
3. **HSTS + `X-Content-Type-Options: nosniff`** in `firebase.json`
   (Rock 1 tail).

## Calendar-gated queue

| When | What |
|---|---|
| ~Jul 18+ | Rock 2 PR 6 — read the deprecation field logs first, then delete/stub `estimates.js` classic paths |
| ~Jul 19 | Flip `e2e-authed-emulator` from `continue-on-error` to required (needs 2 weeks green from Jul 5) |
| With Jo on device | CRM Phase 2 aggressive breakpoint consolidation |
| Jo console action | IAM grant `roles/iam.serviceAccountTokenCreator` (access-code login, audit Break #2) |

---

## Punch list — findings from executing the Stranger Test (2026-07-06)

What the journey flushed out, in priority order. Each is a candidate for a
future session; none blocked the journey itself.

1. **Invited members cannot see the tenant's pipeline.** ✅ **EXECUTED
   2026-07-06 (the session after the Stranger Test).** Lead READS are now
   company-scoped for company_admin/manager/viewer via the /expenses rule
   shape (sales_rep stays own-only per the Wave-110 privacy decision;
   writes stay owner-only). Subcollection reads follow the parent
   (parentLeadInMyCompany). The kanban fetch is role-branched
   (dashboard-bootstrap loadLeads), moveCard blocks non-owner drags with
   a toast, and the Stranger Test's team journey now invites a MANAGER
   and asserts the shared kanban + rules-level read/write boundary.
   Remaining polish (deliberately deferred, from the adversarial review):
   a read-only affordance on the customer page when staff open a
   teammate's lead (writes correctly fail at rules today); Jo's product
   call on whether managers should EDIT team leads (would widen update
   rules — separate decision); teammate kanban cards render without photo
   thumbnails (the photo cache stays userId-scoped — cosmetic); and the
   estimate address-match can silently auto-link a staff member's
   estimate to a teammate's lead (estimates.js:774 — plausibly desired
   for teams, but silent; Jo to confirm or we add a confirm prompt).
   Two low-severity review notes accepted without code: the >500-doc
   pagination path is untested under the companyId scope (identical code
   to the battle-tested userId paging; a 501-doc seed isn't worth the rig
   cost yet), and loadLeads can race the claims read on exotic boot paths
   — the fallback is the pre-team userId fetch, self-healing on the next
   load. Review stats: 16 confirmed / 4 rejected across 23 agents; every
   confirmed finding is fixed or recorded here.

2. **`submitPublicLead`'s App Check claim is dead config.** The handler
   sets `enforceAppCheck: true` with the comment "required; App Check sits
   in front" (functions/handlers/integrations.js:240) — but firebase-functions
   v2 `onRequest` **ignores** `enforceAppCheck` (it is an `onCall`-only
   option; verified in the SDK source). The endpoint's real protections
   are Turnstile (when configured), per-IP rate limits, honeypot, and
   validation — which may well be the right posture for a public homeowner
   endpoint, but the code should say what's true: either implement manual
   App Check verification or fix the comment/option.

3. **App Check enforcement blocks the emulator rig by design** — enforced
   callables reject a MISSING token even in the Functions emulator, while
   the emulator's always-on `skipTokenVerification` accepts any decodable
   JWT. Fixed this session with a localhost-only CustomProvider shim in
   `nbd-emulator-connect.js` (+ the three boot files), keeping
   `enforceAppCheck: true` exercised server-side. If a future page adds
   its own App Check init, it must use the same
   `isLocalEmulatorEnv()`-first pattern or its callables die only in tests.

4. **The rig ran a trigger prod can never run.** `onRepSignup` (the
   GCIP-blocked `beforeUserCreated` blocking trigger, permanently in
   `NBD_DEPLOY_SKIP_LIST`) is still exported from functions/index.js, so
   the emulator loaded and EXECUTED it — it matched the pending invite at
   the rep's signup and stamped team claims before `claimInvite` ever got
   a chance, making the rig test a flow production cannot ship. Fixed: the
   handler itself no-ops when `NBD_DEPLOY_SKIP_LIST` names it, and the rig
   injects that via `functions/.env.local`
   (tests/e2e/fixtures/ensure-emulator-env.js) — dotenv is the only channel
   that reaches the call-time runtime, and the skip must live INSIDE the
   handler because trigger discovery runs with a scrubbed env, so gating
   the export half-registers the blocking trigger and 500s every signup
   (both failure modes were hit before landing here). Longer-term decision
   for Jo: `onRepSignup` demonstrably works — if GCIP is ever purchased,
   it can replace the claimInvite dance; until then, consider deleting the
   export outright instead of skip-listing it in two places.

5. **Alert delivery is unasserted.** `leadAlert*`/`onNewLead`/
   `teamInviteEmail` fire in the rig but Resend/Twilio secrets are absent,
   so delivery fails silently server-side. The tenant-routing HALF is
   covered (lead-bridge writes are asserted); the notification half needs
   either a Resend sandbox key in CI or an email-queue assertion seam.

6. **Functions emulator is scoped to the `@stranger` shard for now.** The
   first full-rig CI run showed the legacy shards' documented 301-hop
   "execution context destroyed" flake widening under the ~140-function
   runtime's boot load (rotating single victims: d2d, docgen — the exact
   pattern the shard-split comment predicts). `NBD_EMU_FUNCTIONS=1` gates
   the functions emulator; only the Stranger shard sets it, so the legacy
   shards keep the environment they were tuned against. Future work:
   widen functions to all shards once boot cost is addressed (scope the
   loaded codebase, or split the destructive shard further).

7. **Emulator seat-of-the-pants notes** for whoever extends the rig:
   the functions emulator needs `functions/node_modules` in CI (step
   added); secrets warnings are expected noise; scheduled functions don't
   fire; `admin.firestore.FieldValue` namespaced statics are broken
   in-emulator (modular imports are fine — all journey-path functions
   already use them). Sandboxed agent containers additionally need
   `PLAYWRIGHT_CHROMIUM_PATH`, `PLAYWRIGHT_PROXY_SERVER`, and — where the
   egress policy denies gstatic — `NBD_E2E_SDK_LOCAL_DIR` (see
   tests/e2e/fixtures/local-sdk.js); none of these apply in GitHub CI.
