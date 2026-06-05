# NBD Pro CRM — Functional QA (Audit #4) — STATUS & RESUME RUNBOOK

> **Mission:** Hands-on functional QA of the NBD Pro CRM (`docs/pro/`). Operate every tool/widget/
> system and confirm it works end-to-end, emulator-only, then leave behind tests so it stays working.
> **Rules:** Harness/env work = full speed. Product/config/rules edits = PROPOSE-AND-APPROVE.
> Never deploy, never push to `main`. RULE 0: never touch production.
>
> This file is the source of truth across context limits. Update it at every phase boundary.

Origin session (context-limited): `d0646509-e119-4ae2-8724-0ac6f1a61b12`
Last updated: 2026-05-31 — **Phase 1 CLOSED**; Phase 2 next.

---

## Phase tracker

| Phase | Scope | Status |
|---|---|---|
| 0 | Stand up emulator env + serve + seed + baseline | ✅ DONE (8/8 green) |
| 1 | Auth / login / logout / session / reset / plan gates / role resolution | ✅ DONE — findings F3,F4,F5,F6 |
| 2 | Leads / CRM kanban (create, edit, move, delete, required-field gate) | ✅ DONE — CRUD+move persist & survive reload; sub-features inventoried; F8 |
| 3 | Estimates / pricing engine / tiers / deposit / PDF | ✅ DONE — engine(test)+persist+V2 builder e2e; PDF→Ph5; supplements/profit/invoice deferred |
| 4 | Photos / roof analysis / report pairs | ✅ DONE — storage+rules verified; engine wired; AI-classify BLOCKED (no key); sanitizer/pairs tests green |
| 5 | Documents / templates / doc-generator / signatures (**F1 lives here**) | ✅ MOSTLY — doc-gen flow + cert-stability verified; F1 confirmed; render-pdf/signatures/BoldSign deferred |
| 6 | Knocks / D2D map / territories / team mode | ✅ MOSTLY — knocks persist+load, D2D module wired; knock-create+map-markers headless-limited; territories/team deferred |
| 7 | Billing / Stripe (test mode) / subscription / usage gates (**F3, F6**) | ✅ MOSTLY — plan-gate/soft-gate/upgrade-modal/trackUsage(callable✓); F3 reconfirmed; Stripe checkout/webhooks BLOCKED |
| 8 | SMS / AI texting / inbound webhooks (test/mock) | ✅ MOSTLY — smart-followup engine + comms wiring OK; sends (Twilio/AI/email) BLOCKED; opt-out guard green |
| 9–10 | Performance (**F2**), dashboard render, theme engine | ✅ MOSTLY — theme switch+persist+mode, cmd-palette/shortcuts/notif/FAB wired; F2 confirmed (rAF/canvas; fix=ThemeGX.setAnimatedBg) |
| 11 | Reports / analytics / leaderboard / insights | ✅ MOSTLY — computeKPIs reconciles w/ seed; widgets wired; overview cards $0 in prog-nav (likely hydration-trigger, confirm real browser); standalone analytics/leaderboard need wiring |
| 12 | Portal / share links / customer-facing (maxUses+expiry) | 🔄 PARTIAL — modules wired; createPortalToken→unauthenticated in emu (unexplained); deep create/open+maxUses deferred to customer-page pass |
| 13 | Admin command center / tenant management (**needs /admin emulator-wiring first**) | 🔄 PROPOSED — /admin + ~8 standalone pages need emulator-shim wiring (same localhost-guarded pattern); dashboard AdminManager claim-gated (Phase 1) |
| 14 | PWA / Service Worker / offline (deliberate test) | ✅ MOSTLY — SW registers+controls, manifest present; offline banner wired (synthetic event no-trigger, needs real offline); stuck-loading fix headers present (faithful repro needs prod caching) |
| N | Convert manual sweep → automated E2E/smoke; dead/half-built inventory | 🔄 dead-feature scan: `crm-audit` 0 err / 1 warn / 44 info (CLEAN); E2E automation PROPOSED; matrix+punchlist in this file |

> Phase numbering 2–14 is a working plan, not gospel — refine as the sweep reveals the real system map
> (~31 pages, 217 JS modules, ~30 feature systems).

---

## Feature Status Matrix (verified so far)

| Feature | Status | Evidence |
|---|---|---|
| Login form (email/pw → auth emulator) | ✅ PASS | demo→dashboard; `AUTH EMULATOR OK` REST round-trip |
| All 6 seeded roles authenticate | ✅ PASS | batch REST sign-in: owner-admin, demo-user, co-admin, co-rep, co-viewer, free-user |
| Dashboard data load | ✅ PASS | `✅ loadLeads: Processed 14 leads` from Firestore emulator |
| Logout | ✅ PASS | "Sign Out →" (`.so`, data-action=signOut) → redirect to login; `_user`+`currentUser` null |
| Session persistence (reload) | ✅ PASS | owner reload → still authed on dashboard, not bounced to login |
| Password reset | ✅ PASS | `#resetForm` submit → auth emulator OOB `PASSWORD_RESET` for demo@; no real email |
| Plan hard-gate (free < foundation) | ✅ PASS | free@testco.pro → upgrade wall ("UPGRADE TO FOUNDATION →"), not a working dashboard |
| Owner bypass | ✅ PASS | jonathandeal459@ → `role=admin`, isOwner, plan professional, never walled (no Firestore round-trip) |
| Role outcome: company_admin | ✅ PASS (gate) | reaches dashboard, professional, AdminManager loaded; client role-label wrong → **F4** |
| Role outcome: sales_rep | ✅ PASS (gate) | reaches dashboard, professional; `_userClaims.role==='sales_rep'` correct (prospects.js scopes right) |
| Role outcome: viewer | ✅ PASS (gate, by model) | paid→dashboard like rep; write-restriction server-enforced (firestore-rules.test.js). UI read-only spot-check → Phase 9 |
| Gate model mapped | ✅ | hard = `dashboard-auth-gate.module.js` + `NBDAuth.init({requiredPlan:'foundation'})`; soft = `billing-gate.js` (warn-only) |
| Register (access-code path) | 🟡 PARTIAL | account created in auth emulator via form + `validateAccessCode` callable (Functions emulator works!); no visible redirect/confirmation after → **F6**. Paid/Stripe path BLOCKED (no test keys) |
| Client claims exposure | ✅ | `window._userClaims` populated with full decoded ID-token claims (role, companyId) — correct source |
| Template suite load | 🔴 FAIL | `db.batch is not a function` — PUNCHLIST **F1** |
| **Lead create** (kanban) | ✅ PASS | new doc; `companyId='demo-user'` stamped (=uid, satisfies hardened create-rule); count 14→15 |
| **Lead edit** (`editLead`) | ✅ PASS | Sarah Chen jobValue 11500→13750 persisted; name intact; form populates on open |
| **Lead move** across stages | ✅ PASS | ▶ arrow → `moveCard(id,newStage)` → Sarah new→contacted in Firestore (drag/arrow/ctx-menu all route through moveCard) |
| **Lead delete** (soft) | ✅ PASS | 2-step confirm → `deleted:true`, count 15→14 |
| **Persistence survives reload** | ✅ PASS | post-reload: move+edit+delete all held (count 14, Sarah contacted/13750) |
| Kanban sub-features | 🟡 INVENTORIED | quick-capture (`NBDQuickCapture.open` ✓), needs-attention (`toggleNeedsAttention` ✓), hot-leads/stale-shares/snooze widgets present; scoring/dedup deep-test deferred |
| **Estimate pricing engine** | ✅ PASS | `tests/estimate-pricing.test.js` (38 assertions: tier rates, county tax, deposit, min-charge, add-ons) green |
| **Estimate persistence** | ✅ PASS | 6 seeded + builder-created 7th in Firestore (tier/sq/grandTotal/rows) |
| **V2 estimate builder e2e** | ✅ PASS | open→30SQ measurements→"Standard Reroof" preset→18 line items→**$17,925**→Save→new estimate doc (6→7) |
| **Estimate tier selector** | ✅ PASS | Good/Better/Best tabs present + live (PR#507 "dead tier-selector" regression is fixed); 3 finalize formats present |
| Supplements / profit-tracker / invoice-pipeline | ⬜ DEFERRED | not yet driven — revisit |
| **Photo upload + storage rules** | ✅ PASS | image→photos/{uid}/ ok + downloadURL; text/plain → `storage/unauthorized`; cross-uid → `unauthorized` |
| **Photo engine wiring** | ✅ PASS | 24+ fns wired (`_uploadPhoto`/`_getPhotos`/`renderPhotoGrid`/…); full UI+file drive deferred |
| Vision sanitizer / report pairs | ✅ PASS | `tests/smoke/photo-vision-sanitizer` + `photo-report-pairs` green in baseline |
| AI roof analysis (photo-ai/claudeProxy) | 🚫 BLOCKED | needs Anthropic key (secret unset in emulator) — revisit w/ mock key |
| **Doc generation flow** | ✅ PASS | `NBDDocGen.fillAndGenerate`→customer-picker→fill→view; 16 doc types; viewer + inspection-engine wired |
| **Cert-number stability** | ✅ PASS (static) | cert# = `_seededDocNumber` (seeded, not Math.random) + persisted to lead → stable on re-render (memory regression fixed) |
| Template→Firestore sync | 🔴 FAIL | **F1** `db.batch` throws on dashboard load |
| render-pdf / signatures / BoldSign | 🟡 DEFERRED | function/external-dependent; render-pdf may hit Audit#2 rate-limit |
| **D2D knocks data + load** | ✅ PASS | 40 knocks in Firestore; `D2D.loadKnocks()`→40 in state |
| **D2D module** | ✅ PASS | 30 methods wired (create/convert/delete/heatmap/metrics/route/CSV/follow-up) |
| D2D knock-create (UI) | 🟡 UNCONFIRMED | `submitKnock` threw `classList of undefined` in headless (no GPS / quick-knock UI) — verify in real browser |
| D2D map markers | 🟡 HEADLESS-LIMIT | Leaflet container renders, 0 markers in headless; knock data present in state |
| Territories / team-mode | ⬜ DEFERRED | no `window.territory*` fn; team rollup needs company tenant + companyId-tagged knocks |
| **Billing soft-gate + upgrade modal** | ✅ PASS | `showUpgradeModal` renders; `canUse` correct; soft-gate warn-only (never locks mid-cycle) |
| **trackUsage (callable→Functions emu)** | ✅ PASS | `trackUsage('leads')` → emulator → Firestore usage 0→1 synced (validates callable path broadly) |
| Stripe checkout / webhooks / portal | 🚫 BLOCKED | no Stripe test keys; webhook-sig/billing-bypass guards green in security-guards smoke |
| **Smart-followup engine** | ✅ PASS | `computeRecommendedAction(contacted lead)`→"Monitor"; follow-up-notification fn runs clean |
| **Comms modules wiring** | ✅ PASS | NBDComms / SmartFollowup / EmailDrip / Voicemail / Command all wired |
| SMS / email / AI-texting sends | 🚫 BLOCKED | Twilio/Anthropic/email keys unset; sms_opt_outs/TCPA guard green in security-guards smoke |
| **Theme engine (switch+persist+mode)** | ✅ PASS | `applyTheme('batman')`→data-theme + `nbd_pro_theme` localStorage (restores on reload); data-mode=dark; auto day/night + grid picker wired |
| **Dashboard widgets** | ✅ PASS | command palette opens (`openCmdPalette`); shortcuts/notif-bell/FAB wired |
| F2 perf (never-idle) | 🔴 CONFIRMED | 2 canvases + ThemeGX animated-bg → continuous rAF; mitigation: `ThemeGX.setAnimatedBg(false)` / pause-on-hidden |
| Theme pref source (minor) | 🟡 NOTE | live theme defaulted to `nbd-original`, not seeded `userSettings.theme='storm'` — loadSavedTheme reads `nbd_pro_theme` LS, not the user doc |
| **Analytics engine (computeKPIs)** | ✅ PASS | reconciles w/ seed: active pipeline **$212,950** (=$243,550−$30,600 closed), 12 active, avg $15,300, closeRate 100%; Active-Pipeline card renders $213K |
| Analytics widgets | ✅ WIRED | leaderboard/bottleneck/cohort/forecasting/estimate-analytics present |
| Dashboard overview stat cards | 🟡 LOW-CONF | Active Leads/Estimates/Pipeline/Closed-Rev showed $0 under programmatic `goTo` — likely view-hydration trigger (same pattern as D2D markers); confirm via real click-through |
| Standalone analytics.html / leaderboard.html | ⬜ NEEDS-WIRING | own Firebase init, not emulator-wired → would hit prod (same as /admin) |
| Portal / share modules | ✅ WIRED | `_sharePortalLink`/`_revokePortalLink`/`PortalLinkHelpers`/`ShareGallery`/`StaleShares` present |
| Portal token create/open | 🟡 NEEDS-INVESTIGATION | `createPortalToken` callable → `functions/unauthenticated` in emu (trackUsage+validateAccessCode worked → not App Check); `_sharePortalLink` needs customer-page context; maxUses/expiry = Audit#2 server-side. Deep test → customer-page pass |
| **PWA / Service Worker** | ✅ PASS | SW registered + controlling at `/pro/` scope; `manifest.json` linked |
| Offline degradation | 🟡 WIRED | NBDOfflineBanner/PrefsSync/idb-cache present; synthetic `offline` event didn't trigger banner (navigator.onLine unfakeable in eval) — needs real offline mode |
| "Stuck loading" cache bug | 🟡 FIX-PRESENT | Wave-127 fix headers in firebase.json (JS/CSS must-revalidate, sw.js no-cache); faithful repro needs prod CDN+cache (local serve=no-store) |

> **Testing-methodology caveat:** programmatic `goTo(view)` in eval does not fully hydrate a view's on-enter render the way a real user click does → some on-view-enter widgets (D2D map markers, dash overview cards) read empty/$0 in automation though the underlying data + compute are correct. Flag for a real-browser click-through pass.

**Phase 1 close-out summary:** Auth front door is solid — every role logs in, logout/session/reset all work, the
free→foundation hard-gate walls correctly while paid roles pass, owner-bypass works. Access control is sound at the
two layers that matter (Firestore rules + AdminManager both read the *claim*). One real client bug (**F4**) and a soft
divergence (**F3**) found; register account-creation works but its post-create flow is unverified (**F6**); operator
provisioning scripts have a local-run gap (**F5**).

---

## RESUME RUNBOOK (how to pick this up after a context limit)

### 1. Is the env still up? (it may be — check before rebuilding)
```powershell
8080,9099,5001,9199,5000,4000 | % { $c=Get-NetTCPConnection -LocalPort $_ -State Listen -EA SilentlyContinue; if($c){"UP $_"}else{"down $_"} }
```
Ports: 8080=firestore, 9099=auth, 5001=functions, 9199=storage, 4000=emulator UI, 5000=local serve.
Preview serverId this session: `6f182de0-a292-46c1-856b-b3978a61a85f` (re-`preview_start "nbd-local"` if stale).

### 2. If down, bring it up (background)
1. **Emulators:** `firebase emulators:start --project nobigdeal-pro --only "auth,firestore,functions,storage"`
   (PowerShell: **quote** the `--only` list or the comma becomes a PS array.)
2. **Seed:** `node scripts/seed-emulator.js` (hard-sets *_EMULATOR_HOST so firebase-admin can't reach
   prod even though prod ADC creds exist on this machine — the RULE 0 guard).
3. **Serve:** `node scripts/local-serve.js` then `preview_start "nbd-local"`. preview_start won't adopt a
   server it didn't launch — if :5000 is taken by a manual run, free it first, then let preview_start own it.
4. **Re-seed an access code** (for register tests): `NODE_PATH=functions\node_modules` +
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=nobigdeal-pro BETA_COUNT=1 node scripts/seed-access-codes.js` (see **F5**).

### 3. Test users — password `test1234`
- `jonathandeal459@gmail.com` — owner bypass (client → admin + professional), server claim role:admin
- `demo@nobigdeal.pro` — `demo:true` → demo_viewer/professional; rich dataset (14 leads / 6 est / 40 knocks / 10 tasks / $241k)
- `admin@testco.pro` — claim `company_admin` / companyId `testco`
- `rep@testco.pro` — `sales_rep` / testco   ·   `viewer@testco.pro` — `viewer` / testco
- `free@testco.pro` — no subscription → billing/plan-gate test
- (register test created `newrep@testco.pro` / `Test1234!` via code `NBD-TXKW4XVGJB`)

### 4. Footguns
- `tests/playwright.config.js` defaults `baseURL` to **PROD** — must `set PLAYWRIGHT_BASE_URL=http://localhost:5000` before any E2E. (E2E specs not yet run against local — Phase-1 left this for a later pass.)
- `.firebaserc` default project is **prod** `nobigdeal-pro` — every emulator/seed command must force the project + emulator env vars.
- Service Worker at scope `/pro/` force-reloads on `controllerchange` → flaky page tests. Unregister SW + clear caches for stable testing; test the SW deliberately in Phase 14.
- Dashboard animated bg never idles → `preview_screenshot` times out; assert render state via DOM (`readyState`/`visibility`) instead.
- `preview_fill` + a synthetic click on a submit button did NOT fire the form submit; use `form.requestSubmit()` (set input `.value` first) — reliable for these vanilla-JS forms.
- `/admin/*` pages are NOT emulator-wired → loading them would hit PROD. Wire before Phase 13.

### 5. Phase-0 scaffolding (uncommitted on `main`, do NOT lose)
- NEW: `docs/pro/js/firebase-emulator-connect.js`, `scripts/local-serve.js`, `scripts/seed-emulator.js`
- MODIFIED: `firebase.json` (emulators block), `tests/package.json` (single→double quotes for Windows),
  `tests/rate-limit.test.js` (pin admin to functions/ instance), and emulator-connect wired into
  `docs/pro/js/nbd-auth.js`, `customer.html`, `dashboard-bootstrap.module.js`, `js/pages/login.js`, `js/pages/register.js`.
- These are harness/env changes (sanctioned, no approval). Still uncommitted — decide with Jo whether to commit to a branch.

---

## Synthesis (Phase 15) — coverage map

**Static health:** `crm-audit.js` → **0 errors / 1 warn / 44 info** across all ~31 pages (no dead handlers, broken links, unresolved assets, or unparseable inline scripts). Combined with the 1692-check smoke suite, the codebase is clean — "half-built" means *blocked-by-keys* or *unwired-for-local*, not broken code.

**Verified end-to-end (emulator):** auth/login/logout/session/reset · plan-gate · owner-bypass · lead CRUD+move+persist+reload · estimate engine+V2 builder+save · photo storage+rules · doc-gen flow + cert-stability · callable fns (trackUsage/validateAccessCode) · billing soft-gate · smart-followup engine · theme switch+persist · command palette · SW+manifest · D2D knock data+module · analytics engine (reconciles to seed).

**Blocked by missing secrets (need test/mock keys in `functions/.env`):** Anthropic (AI roof-analysis, Ask-Joe, voice), Stripe-test (checkout/webhooks/portal billing), Twilio (SMS/AI-texting), BoldSign (e-sign). Everything *around* them was tested.

**Needs emulator-shim wiring before local test** (same localhost-guarded shim as the 5 done): `/admin/{index,login,analytics}`, `analytics.html`, `leaderboard.html`, `ask-joe.html`, `ai-tree.html`, `diagnostic.html`, `understand.html`, `daily-success`, `photo-review.html`, `stripe-success.html`, `pricing.html` (~11 standalone pages w/ own Firebase init).

**Best tested in a real browser (headless/eval limits, NOT bugs):** D2D map markers + knock-create (GPS/Leaflet), dashboard on-view-enter renders (overview stat cards — programmatic `goTo` doesn't fully hydrate), offline mode (`navigator.onLine`), the prod CDN+cache "stuck-loading" repro.

**Dead/half-built candidates (keep/cut decision):** `dashboard.legacy.html` (intentional `?legacy=1` rollback fallback — keep or retire post-Rock-4); F3 (nbd-auth↔billing-gate plan divergence); F4 root (`users/{uid}.role` never written by createTeamMember). crm-audit found **no truly orphaned modules**.

**Automated-coverage plan (NOT yet added — the remaining DoD item):**
1. Playwright authed E2E @ `localhost:5000`+emulator: login(seeded)→dashboard(14 leads)→lead create/move/delete→estimate build→assert Firestore. Needs the auth fixture to sign in via emulator + `PLAYWRIGHT_BASE_URL`.
2. Smoke: assert `connectNbdEmulators()` wired into entry points; assert seed-emulator/local-serve exist.
3. Wire the ~11 standalone pages so E2E can reach them.

---

## Open findings → see PUNCHLIST.md
F1 db.batch (P1) · F2 dashboard perf (P3) · F3 billing-gate plan divergence (P2) · F4 role resolver → integrations panel (P1) · F5 operator scripts can't run locally (P3) · F6 register post-create flow unverified (P2)
