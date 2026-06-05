# NBD Pro CRM — Functional QA (Audit #4 / "operations audit") — Punch List

> Ranked findings from the hands-on functional QA sweep. Propose-and-approve: nothing here
> is fixed without Jo's go-ahead. Each fix branches off `main`; never deploy/push to main.
> Status legend: 🔴 open · 🟡 needs-scoping · 🟢 fix-proposed · ✅ fixed+verified

Last updated: 2026-06-05

## ✅ Resolved on branch `fix/qa-sweep-2026-06`
- **F1** — `template-suite.js` `db.batch()`→`window.writeBatch(db)` + modular `doc()`. Verified: dashboard loads with **zero console errors**; smoke guard added.
- **F4** — `nbd-auth.js` now falls back `_role` to the custom-claim `role` (`_claimRole`). Verified: company_admin → `NBDAuth.role==='company_admin'` (was `member`) → Integrations panel unblocked; smoke guard added.
- **F5** — operator scripts (`seed-access-codes`/`grant-admin-claim`/`grant-demo-claim`) resolve `firebase-admin` from `functions/`. Verified: `node --check` + smoke guard.

Still open: **F2** (perf), **F3** (billing plan source), **F6** (register post-create), **F8** (lead-modal state-bleed).

---

## P1 — real bugs (affect production)

### F1 🔴 `template-suite.js:61` — `db.batch is not a function`  (Phase 5)
- **What:** Dashboard init throws `TypeError: db.batch is not a function` on first load.
  Modular Firestore v10 has no `db.batch()`; it needs `writeBatch(db)`. Template → Firestore
  sync is broken. **This fails in prod too**, not just the emulator.
- **Evidence:** console error on `dashboard.html` load (demo user), captured in session `d0646509`.
- **Proposed fix (NOT applied):** `import { writeBatch } from 'firebase/firestore'` and replace
  `db.batch()` with `writeBatch(db)`; add a smoke/E2E test that loads the template suite without throwing.
- **Owner decision needed:** approve fix + which test proves it.

### F4 🟡 Client `NBDAuth.role` ignores team-role custom claims  (Phase 1)
- **What:** `nbd-auth.js:400-413` resolves `_role` **only** from the Firestore `users/{uid}` doc
  (`_role = userData.role || 'member'`). The custom claim's `role` is read **only** for the
  owner-email bypass (`:343→_role='admin'`) and the `demo:true` claim (`:389→_role='demo_viewer'`).
  A `company_admin` (claim `{role:company_admin, companyId:testco}`) whose user-doc has no `role`
  field therefore resolves to `'member'`.
- **Confirmed at cutoff:** signed in as `admin@testco.pro` → reached dashboard (not walled),
  plan professional, `AdminManager` loaded, but `NBDAuth.role === "member"`.
- **Scope — RESOLVED (traced every team-role gate):**
  - `admin-manager.js:81-82` → reads `claims.role` **directly** → ✓ admin panel unaffected.
  - `prospects.js:129` → reads `window._userClaims?.role` (**claim**) → ✓ `sales_rep` filtering works.
  - `d2d-tracker-core-2026b.js:971/1009` → `state.currentRep?.role` (rep object) → ✓ unaffected.
  - **`integrations-client.js:49` → reads `window._role` (= broken `NBDAuth.role`)** → 🔴 **the one real bite.**
    `_isAdminCaller()` returns false for a `company_admin` (who resolves to `member`), so the client
    short-circuits the admin-gated `integrationStatus` callable and the integrations panel renders
    "not set up" for a tenant owner who should see it. Server gating is correct (functions/index.js:704);
    this is a **client UX bug for company_admin tenants**, not a security hole.
- **Two fix options (NOT applied — pick one):**
  1. *Narrow:* change `integrations-client.js:49` to read `window._userClaims?.role` (consistent with
     prospects.js). Lowest risk; fixes the only observed bite.
  2. *Root:* have `nbd-auth.js` set `_role` from the **claim** team-role when present (after the
     owner/demo short-circuits), so `NBDAuth.role` reflects `company_admin`/`manager`/`sales_rep`.
     Correct long-term, but audit every `_role`/`window._role` consumer first — some assume `'member'`,
     and the H-02 hardening deliberately keeps demo→non-admin. Verify `window._userClaims` is actually
     populated by `_exposeGlobals()` before relying on it.
- **Closed (raises priority → P1):** `createTeamMember` (functions/handlers/admin.js:496-506) sets the
  claim + writes `companies/{companyId}/members/{email}` but does **NOT** write `users/{uid}.role`. So
  every real tenant owner created through the team flow hits this gap, not just the seed — confirmed prod
  bug. (Also confirmed live: `window._userClaims` IS populated, so the narrow fix option is viable.)

---

## P2 — divergences / smells

### F3 🟡 `NBDBilling.getPlan()` returns `free` for a professional-sub user  (Phase 1/7)
- **What:** For the demo user (resolved plan `professional`), `NBDBilling.getPlan()` reported `free`
  — an nbd-auth ↔ billing-gate divergence. Billing gate is *soft* (warn-only, never locks out
  mid-cycle), so impact is likely cosmetic, but the two plan sources disagree.
- **Add'l evidence:** owner (should resolve enterprise) also reported `getPlan().plan==='free'` → confirms `loadSubscription()` is never called on dashboard, so `_plan` stays at its `free` default for everyone.
- **Next action:** reconcile where billing-gate reads plan vs where nbd-auth sets `_userPlan`.

### F6 🟡 Register: account created but post-create flow unverified; paid/Stripe path blocked  (Phase 7)
- **What:** Submitting `register.html` with a valid access code (`NBD-TXKW4XVGJB`) created `newrep@testco.pro`
  in the auth emulator (verified via REST sign-in) and exercised the `validateAccessCode` callable through
  the Functions emulator — but the page stayed on `register.html` with no visible redirect, success, or
  error. Unclear if provisioning (subscription/claims write) + redirect to dashboard/stripe-success completed.
- **Blocked:** the paid subscribe path (pricing → Stripe Checkout → stripe-success) needs Stripe **test** keys
  in the Functions emulator (secrets unset) — can't exercise without provisioning test keys.
- **Next action (Phase 7):** trace register.js post-create flow; check `subscriptions/{newrep}` + claims;
  decide whether the missing redirect/confirmation is a bug or eval-timing.

---

## P3 — performance / observations

### F2 🔴 Dashboard never reaches an idle frame  (Phase 9/10)
- **What:** `dashboard.html` is `readyState:complete` / `visible` with data loaded, but a continuous
  `requestAnimationFrame` loop (animated theme background, `ThemeGX animBg:true`) keeps the renderer
  from ever idling → `preview_screenshot` times out even with animations frozen. Not a functional
  blocker; a real perf cost (battery/CPU on an always-on tab).
- **Next action (Phase 9/10):** measure the rAF loop; consider pausing animBg when tab hidden / on
  low-power, or gating it behind a setting.

### F5 🟡 Operator provisioning scripts can't run locally (MODULE_NOT_FOUND)  (harness / ops UX)
- **What:** `scripts/seed-access-codes.js`, `grant-admin-claim.js`, `grant-demo-claim.js` do
  `require('firebase-admin')`, but there's no `node_modules` in `scripts/` or the repo root → a bare
  `node scripts/seed-access-codes.js` throws `Cannot find module 'firebase-admin'`. Jo would hit this
  running the documented provisioning steps. Worked around here with `NODE_PATH=functions\node_modules`.
- **Proposed fix (NOT applied):** resolve firebase-admin from `functions/` via
  `require(require.resolve('firebase-admin',{paths:[__dirname+'/../functions']}))` (as
  `scripts/seed-emulator.js` already does), or document the `NODE_PATH` requirement in each script header.

### F8 🟡 Lead modal may save against a stale editing-id (state bleed)  (Phase 2)
- **What:** All app call sites use `openLeadModal()` (no-arg = create) and `editLead(id)` for edit (which
  populates correctly — verified live on Sarah Chen). But in a create-then-reopen sequence, a `saveLead()`
  wrote the (blank) form back to the *previously created* lead (`H4Del…` got its name blanked, lead count
  unchanged) instead of creating a new one — suggesting `openLeadModal()` doesn't fully reset the
  "current editing id" left from the prior save.
- **Risk:** low (normal flow closes the modal between ops; no app code calls `openLeadModal(id)`), but it
  echoes the documented Estimates "leftover-DOM-bleed corrupts saved totals" pattern.
- **Next action:** confirm `openLeadModal()` clears lead/editing context on open; add a guard + a test
  (create → reopen create → save → must create new, not overwrite the prior lead).

---

## Notes / guardrails (NOT bugs — Audit #2 hardening working as intended)
- `companyId` is a hard required tenant key; permission failures are seeding/claims issues first.
- Role change forces re-auth; logout clears cached state.
- Portal/share tokens enforce maxUses + expiry.
- Rate limits on renderPdf / stormReport / inbound-SMS AI drafts — hitting a 429 during testing is expected.
- Route any genuine *security* finding to the Audit #2 punch list, not here.
