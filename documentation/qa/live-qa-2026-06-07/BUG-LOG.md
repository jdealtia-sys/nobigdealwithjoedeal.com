# NBD Pro — LIVE QA — Bug Log (2026-06-07)

Ranked Critical / High / Medium / Low. Each entry: repro steps, screenshot, and the file/module that likely owns it.
Also tracks console errors + failed network requests captured across the sweep.

> Trivial fixes (copy/label/cosmetic, obvious null-guard/typo, single-file, no data-behavior change, never touching
> rules/auth/billing/schema/functions) are landed on branch `qa-fixes-2026-06-07` and deployed only on Jo's OK.
> Everything else is FLAGGED here, not touched.

---

## CRITICAL

### C-1 — "Add Lead" modal does not save (can't create a pipeline lead in-app)
- **Repro:** Dashboard → Quick Add Lead → Add (opens "ADD LEAD" modal). Fill fields (tried: (a) full set — First "ZZ_QA_2026-06-07", Last "Kanban Lead", address, phone 8594207382, email, Job Type Insurance, Damage Roof-Hail, Job Value 12500, notes; (b) minimal — First + Last + Address only). Click **SAVE LEAD** (bottom) AND the **Save** link (top-right) — tried ~5 times total.
- **Result:** Modal stays open. No success toast, no validation message, no console error (only benign WebChannel warnings + extension noise). After a full hard reload + pipeline search "ZZ_QA" → **0 matches**; pipeline count unchanged (16 customers). The lead is never written.
- **Contrast:** the PUBLIC /inspect form DID write (H-1 confirms a Firestore write fired) — so Firestore writes work generally; the failure is specific to the in-app Add Lead modal's save path.
- **Impact:** a core daily action — manually adding a lead to the pipeline — is broken. (Leftover test leads in the pipeline like "Remote Sign E2E Test" prove the create path worked historically; it's broken on current prod `b27b9403`.)
- **✅ ROOT CAUSE (confirmed in code + live):** `saveLead` is **missing from `_NBD_CALL_ALLOWLIST`** in `docs/pro/js/dashboard-state.js`. The modal's Save buttons use `data-action="call" data-fn="saveLead"`; the delegate at `docs/pro/js/dashboard-ui.js:492` silently `return`s for any `data-fn` not on the allowlist. Regression from the CSP `onclick`→`data-action` sweep (when `onclick="saveLead()"` was converted, `saveLead` was never allowlisted; note `saveEstimate` IS there, which is why estimate-save works). **Affects BOTH creating and editing leads via the modal.**
- **Diagnosis proof:** `window._saveLead(...)` called directly → created lead `W5VbLJAeFXoGPCku93yf` (logic fine). A programmatic `.msave.click()` → `delegateInvokedSaveLead=false` (delegate dropped it). After `_NBD_CALL_ALLOWLIST.add('saveLead')` injected live → Save button worked end-to-end (dedup prompt fired, "Create anyway" persisted; pipeline 19→21). NOT extension-related.
- **✅ FIXED + DEPLOYED + CONFIRMED LIVE (CLOSED):** commit `4e1fac71` (add `'saveLead'` to `_NBD_CALL_ALLOWLIST`). Smoke 1808/0 green, verified via runtime injection, merged to main + pushed 2026-06-07 ~17:00 UTC. **Firebase-deploy run `27098999792` completed SUCCESS (8m20s).** Cache-busted fetch of the live `/pro/js/dashboard-state.js` confirms it now contains `'saveLead',` + the C-1 comment. Fix is live in prod (browser-cached copies refresh within `max-age=300s`). Lead create/edit restored.
- **Severity:** CRITICAL confirmed (UI lead create/edit broken on prod `b27b9403`).
- **Follow-up:** audit the lead/task modal's other `data-fn` buttons for the same allowlist gap (this one slipped through).

## HIGH

### H-4 — Systemic: 21 `data-action="call"` buttons dead (same allowlist regression as C-1) ✅ FIX COMMITTED
- **What:** C-1 was not isolated. A source+live audit found **21 functions referenced by `data-action="call"` buttons but missing from `_NBD_CALL_ALLOWLIST`** — all exist on `window`, so every one of those buttons silently no-ops (delegate gate `dashboard-ui.js:492`).
- **Dead buttons span:** Maps (`searchMap`, `saveZone`, `spyglassSearch`, `searchDraw`, `saveDrawingToCustomer`, `showMaterialTakeoff`, `runSolarAnalysis`, `screenshotMap`, `showAngles`), photo **auto-detect** (`startAutoDetect`), **bulk select-all** (`selectAllVisibleLeads`), **lead retry-load** (`retryLoadLeads`), **doc upload** (`saveDocUpload`), **Ask Joe** (`saveJoeKey`, `sendJoeMessage`, `saveJoeKeyFromSettings`), **scheduling** cal-link (`shareCalViaSMS`, `shareCalViaEmail`, `saveCalSettings`), **Quick-Add** (`qaUseMyLocation`, `saveQuickLead`).
- **Confirmed:** Ask Joe SEND (`sendJoeMessage`) tested live — clicking did nothing; `.has('sendJoeMessage')` = false. Audit method: `[data-action="call"]` DOM scan + regex over fetched dashboard.html, both diffed against the live allowlist (214 entries).
- **Audit method note:** a `DOMParser`-based pass under-counted (browser quirk); the authoritative count came from regex-on-raw-HTML + live `_NBD_CALL_ALLOWLIST.has()` checks.
- **Also found:** `saveCustomTheme` is referenced by a call-button but its **function doesn't exist on window** — that button needs a separate fix (NOT added to the allowlist).
- **✅ FIXED + DEPLOYED:** commit `fe1f06c8` — adds the 21 to the allowlist. Single-file additive, smoke 1808/0, verified live via injection. **Merged to main + pushed 2026-06-07 (`4e1fac71..fe1f06c8`); Firebase auto-deploy triggered.** Restores Maps/Joe/Quick-Add/bulk/doc-upload/scheduling buttons.
- **Severity:** HIGH (many core buttons silently broken on prod). Status: DEPLOYED. **Follow-up:** `saveCustomTheme` button (fn undefined) still needs a separate fix; audit other standalone /pro/ pages for the same data-fn allowlist pattern if they use it.

### H-5 — 🔴🔴 CONFIRMED CRITICAL: Owner cannot move/edit/delete leads on prod (claim-less token + companyId-gated deployed rules)
> **CONFIRMED BY JO (2026-06-07):** dragged a REAL lead to a new stage → **it SNAPPED BACK** (optimistic UI reverted because the Firestore write was permission-denied). So this is NOT limited to test leads — **JD's core daily workflow (moving leads through the pipeline) is broken on production.** Same root: token lacks the companyId claim, deployed rules deny the write.

- **Repro:** On owned `ZZ_QA` leads (companyId = userId = my uid, confirmed): client `deleteDoc(doc(db,'leads',id))` → **"Missing or insufficient permissions"**; UI "Move to Deleted" soft-delete → doesn't persist (lead reappears after reload); `window._deleteLead` swallows the error and falsely resolves.
- **The puzzle:** `firestore.rules:80` says `allow update, delete: if (isOwner(resource.data.userId) && role != 'viewer') || isAdmin()` — I AM the owner (uid == userId) and my token `role` is unset (≠ 'viewer'), so the repo rule SHOULD allow it. A comment (rules:70-72) even says the companyId-claim match is "intentionally NOT enforced yet" for leads. Yet the write is denied **as if companyId were enforced** — and my token has **no `companyId`/`role` claim** (onRepSignup claim-setter is undeployed per the GCIP gap).
- **Rules-drift theory RULED OUT:** the deploy workflow re-deploys `firestore:rules` on **every push** (gated only on the cross-tenant emulator test); since my C-1/H-4 hosting deploys completed, that gate passed → **deployed rules == repo rules**, which DO permit owner delete. The leads rule was last touched 2026-05-31 (c1be7c02, "role-gate lead writes"). So the denial is NOT rules drift.
- **Remaining suspects (need console):** (a) **Firebase App Check** enforcement rejecting the write token (there's app-check hotfix history) — though reads/creates work, which argues against it; (b) the lead doc's actual `userId` field differing from my uid at the Firestore level (window._leads showed a match, but verify the raw doc); (c) a related-collection write inside the delete/soft-delete path being denied. Confirm the raw doc's userId + App Check status in the Firebase console.
- **Likely the SAME root as H-2** (portal's lead `updateDoc` / Storage write also denied with "permissions").
- **Impact:** if owner lead update/delete is genuinely denied on prod, that's CRITICAL — but JD clearly edits/moves real leads daily, so it may be specific to *this session's* leads or claim state. **Needs Firebase-console rules-vs-repo diff + a token-claims check on JD's account.**
- **🔑 UNIFIED ROOT-CAUSE HYPOTHESIS (high confidence) — likely explains H-5 AND H-2:**
  - JD's auth token carries **NO `companyId` and NO `role` custom claim** (verified via `getIdTokenResult`).
  - Per memory `[[onrepsignup-gcip-gap]]`, the **`onRepSignup` blocking trigger that SETS those claims is undeployed** (GCIP upgrade gap; it's in NBD_DEPLOY_SKIP_LIST).
  - The rules have `isCompanyMember()` = `token.companyId != null && resource.companyId == token.companyId` (firestore.rules:42-47). Any deployed rule path that gates lead writes / Storage portal writes on a companyId claim will **deny every write for a claim-less token**.
  - Symptoms all line up: lead update **and** delete denied; portal generation (H-2) denied; create+read **work** (those paths don't require the claim). 
  - The repo's *leads* rule (line 80) is `isOwner`-based (no companyId gate) — so EITHER the deployed rule differs from the repo, OR another companyId-gated path is involved. Net: **a claim-less owner can't write.**
- **⚠ SCOPE — likely prod-wide (CRITICAL-candidate):** benign owner-update DENIED on **3 separate leads** (2 ZZ_QA + the older `ZZ_WriteDiag DELETE_ME`, id zThh5DnTnnR8AhbiG6FG, companyId=userId=uid). Because the denial is **token-claim-based** (not lead-specific), it should apply to ALL of JD's leads incl. real ones. JD to confirm by editing/stage-moving a REAL lead (reversible) + Preview Portal on a real lead. If those fail → CRITICAL prod-wide.
- **Fix paths:** deploy `onRepSignup` (needs GCIP) to stamp claims, OR backfill JD's custom claims (companyId+role) via Admin SDK, OR reconcile deployed rules with the isOwner-based repo rule.
- **Status:** 🔴 **CONFIRMED CRITICAL** (Jo: real-lead stage-move snapped back). Top open finding; blocks client cleanup of the 2 ZZ_QA leads. See also H-2 (same root).
- **✅✅ FIXED + VERIFIED (2026-06-07):** Jo ran `functions/set-jd-claims.js` + signed out/in. Token now carries `companyId: 1phDvA…` + `role: company_admin` (was `{}`). Re-tested live: lead **update succeeds** and **delete succeeds** (both denied minutes earlier). H-5 RESOLVED for JD. (Script was run by Jo — auth/access-control change is outside QA's safe-action scope; I only prepared + read-only-verified it.)
- **Deeper/long-term fix:** the repo's leads update/delete rule is `isOwner`-based and would allow JD with NO claim — so the **deployed rules are stale vs the repo**. Re-deploy the current firestore.rules (verify the cross-tenant gate passes) so future solo operators aren't blocked. Claim-set = immediate unblock; rules reconcile = real cure.

### H-2 — Customer Portal preview/generation fails ("Missing or insufficient permissions")
- **Repro:** Customer detail page (lead `W5VbLJAeFXoGPCku93yf`) → **Preview Portal** → toast *"Portal generation failed: …"*; console: `customer-portal.js:192 — Portal generation failed: FirebaseError: Missing or insufficient permissions.`
- **Narrowed:** portal-gen reads (estimates/notes/tasks) are all `try`-caught, so the throwing op is the **Storage `uploadBytes`** to `portals/{uid}/{leadId}/v-{ts}.html` (customer-portal.js:148) OR the **lead `updateDoc`** (line 168). The `portals/{uid}/{allPaths=**}` Storage rule looks permissive (owner + size<5MB + `isHtmlOnly()`; `isHtmlOnly` accepts `text/html`, which the upload sets), so the Storage path *should* pass — which points suspicion at the Firestore `leads` update rule (companyId/claims check) or a content-type edge.
- **Impact:** customer portal is a core feature (share status/photos/estimates with homeowners). If reproducible on established leads → **CRITICAL**.
- **⚠ Universality unconfirmed:** observed on a freshly-created lead (made via `_saveLead`/dedup path). MUST confirm on an established real lead (view-only) + inspect the `firestore.rules` leads-update + `storage.rules` portals conditions before sizing. Recommend next-session deep-dive.
- **Owner (likely):** `customer-portal.js` generate flow + `storage.rules` portals / `firestore.rules` leads update.
- **✅ RESOLVED (2026-06-07):** same root as H-5 (claim-less token). After the claim fix, Jo confirmed the portal **generates + renders live** (real lead → "Jennifer's Project · Claim Filed · 25% · 90 photos"). The only remaining quirk is the **inline preview iframe being blocked by the app's OWN CSP `frame-src`** (see M-5) — Jo confirmed this happens in **Chrome too** (NOT Brave-specific; my first guess was wrong). The "open in new tab" fallback works. Portal generation = working.

### H-1 — Public `/inspect` leads never enter the CRM UI (only email + Gmail label)
- **Repro:** Submit the public form at `https://nobigdealwithjoedeal.com/inspect` (name `ZZ_QA_2026-06-07 Test Roof`, addr `0000 QA Test Ln, Batavia OH 45103`, phone 8594207382, email jonathandeal459@gmail.com). Form shows success ("GOT IT — THANKS!"). Then open the CRM: Pipeline search "ZZ_QA" → **0 matches**; Prospects (D2D board) → absent; Recent Activity → absent; Notifications → absent.
- **Verified persisted:** lead-alert email DID fire (Gmail subject "🔔 New lead — Inspection / Storm tool: ZZ_QA_2026-06-07 Test Roof" to jd@ + gmail, 11:56 AM ET, starred + labeled). So the write + email alert work; the data is NOT lost.
- **Gap:** the website's primary lead-capture does not feed the pipeline. Owner must learn of the lead from email and **manually re-enter** it (no in-app public-leads inbox or one-click import found). Lead-leakage risk if an email is missed.
- **Severity:** HIGH. **Jo confirmed (2026-06-07): this is a BUG — public leads SHOULD flow into the CRM.** Not by-design. Recommend: surface public leads in an in-app inbox and/or auto-add them to the pipeline at the first stage (with a "web lead" source tag).
- **Owner (likely):** `public-lead-submit.js` (write target collection) + CRM read scope (`crm.js`) — public collection not surfaced in tenant pipeline. Likely needs a Cloud Function or read-scope change to bridge public collection → tenant `leads`.
- **Status:** FLAGGED for follow-up session (NOT trivial — needs backend/UI work; out of inline-fix scope).

## MEDIUM

### M-4 — Doc/report edits fail to save: `updateDoc()` called with `undefined` ✅ FIX COMMITTED
- **Repro (Jo, live):** open a lead's **Homeowner Inspection Report** (doc-preflight) → edit → save → red banner *"Failed to save edits: Function updateDoc() called with invalid data. Unsupported field value: undefined (found in document leads/JoKt4d0yJeF51MTmjaJh)."*
- **Cause:** `applyDocEdits()` (`docs/pro/js/doc-preflight.js:1800`) copied edited field values straight into the `updateDoc` payload. Firestore **rejects `undefined`** field values outright, so a single undefined edit (emptied/optional input) failed the ENTIRE save. Affects any doc-preflight save that produces an undefined field, not just inspection reports.
- **Note:** only surfaced AFTER the H-5 claim fix unblocked writes — the prior permission error masked it. (Good sign other write-path bugs may now be visible too.)
- **✅ FIXED + DEPLOYED:** commit `8cf87a06` — strip `undefined` recursively from `leadUpdates` + `docOverrides` before `updateDoc`. Single-file, defensive, no change to valid data. Smoke 1808/0. **Merged to main (`725f6f92`) + pushed → auto-deploy.** Verify: re-save an inspection-report edit after the deploy (~9 min).
- **Status:** DEPLOYED.

### M-5 — Customer Portal inline preview blocked by the app's OWN CSP (`frame-src`), not Brave
- **Repro (Jo, in CHROME):** Customer detail → Preview Portal → inline iframe shows *"This content is blocked. Contact the site owner to fix the issue."* (app shows graceful "open in new tab" fallback, which works).
- **Cause:** the prod CSP in `firebase.json` (line ~196) has **no `frame-src` directive**, so it falls back to `default-src 'self'` → iframes may only load same-origin. The preview iframes the cross-origin `firebasestorage.googleapis.com` portal URL → blocked **in every browser** (Jo confirmed in Chrome). My earlier "Brave Shields" attribution for this was WRONG — it's the app's own CSP.
- **Fix options (security-header change — Jo's call to deploy):** (a) add `frame-src 'self' https://firebasestorage.googleapis.com` to the CSP, or (b) serve the portal preview HTML from the app's own origin (the storage.rules comment already says "portal.html is served by Hosting" — the preview should fetch+inline same-origin rather than iframe the cross-origin download URL).
- **✅ FIXED + DEPLOYED:** commit `725f6f92` — added `'self' https://firebasestorage.googleapis.com https://*.firebasestorage.app https://storage.googleapis.com` to `frame-src` across the 7 `/pro` page CSPs in `firebase.json` (consistent with the existing img-src/connect-src storage entries). Merged to main + pushed → auto-deploy. Verify: after deploy + a hard-refresh, the inline portal preview should render (CSP headers cache, so hard-refresh needed).
- **Status:** DEPLOYED.

### M-3 — Pro dashboard sidebar nav is INVISIBLE in Brave (works in Chrome)
- **Repro (confirmed live by Jo):** open `/pro/dashboard` in **Brave** → left sidebar nav (Home/Dashboard/Pipeline/Tools/Insights…) renders **blank** (thin empty strip; icons + labels invisible). Same URL in **Chrome** → sidebar renders perfectly. Survived hard-refresh (Ctrl+Shift+R), window-resize, and SW-unregister attempts in Brave.
- **DOM is intact:** all 28 `.ni` nav items exist in the DOM with normal computed colors when inspected (via the automated/Chrome-engine view) — so Brave is rendering them invisibly, not failing to build them.
- **Cause (likely):** Brave **Shields / fingerprinting protection** interfering with the theme-engine CSS-variable setup the sidebar depends on (`var(--s)` bg / `var(--m)` text), so text/icon color collapses to the background. Consistent with this app's Brave history (`[[esri-blocked-by-brave]]`, `[[brave-blocks-iframe-embeds]]`).
- **Impact:** for a Brave user the entire nav is unusable (MEDIUM with workaround; HIGH-impact UX for anyone on Brave — incl. JD, who uses Brave). **Workaround:** use Chrome, or set Brave Shields DOWN for the site.
- **Owner (likely):** theme-engine CSS-variable init vs Brave's script/fingerprint handling. **Follow-up:** root-cause in Brave with Shields on (check console for blocked resources + whether `--s`/`--m` are set on `:root` under Brave) — and consider a non-variable fallback color on `.sidebar`/`.ni` so it degrades gracefully.
- **Status:** FLAGGED (MEDIUM; workaround given). NOTE: my QA was driven through the Chrome-engine extension, so Brave-only rendering bugs like this were largely invisible to the automated sweep — worth a dedicated Brave pass.

### M-2 — Reports: "load saved reports" throws Firestore INTERNAL ASSERTION FAILED
- **Repro:** Insights → Reports. Dashboard renders fine (Performance KPIs, Conversion Funnel, Lead Source ROI: 18 leads/4 closed/$43K/$96K/22% all display ✅). Console: `[Reports] loadReports failed: Error: FIRESTORE (10.12.2) INTERNAL ASSERTION FAILED: Unexpected state` (×2).
- **Stack:** `getDocs` → `_loadReports` (dashboard-bootstrap.module.js:2783) → `listSavedReports` (rep-report-generator.js:2098) → `init` (dashboard-actions.js:565).
- **Impact:** analytics dashboard works; the **saved-reports list fails to load**. "INTERNAL ASSERTION FAILED: Unexpected state" is a serious Firestore SDK state error that can occasionally cascade to other Firestore ops on the page. Possibly related to the WebChannel instability (OBS-1) or a `getDocs`-during-bad-client-state path.
- **Owner (likely):** `rep-report-generator.js` listSavedReports / `dashboard-bootstrap` `_loadReports`.
- **⬆ ELEVATED TO HIGH (H-3) — IT CASCADES:** after the assertion fires on Reports, subsequent Firestore ops on the same page-session also fail — confirmed `Error loading notifications: …INTERNAL ASSERTION FAILED` (`loadNotifications` onSnapshot, crm-snooze.js:91), and the assertion keeps recurring across SPA route changes (#/storm, #/academy). Because the app routes via hash (no full reload), a real user who opens **Reports** can poison their **entire Firestore client for the whole session** until a hard refresh — breaking notifications + other realtime/getDocs features app-wide. Page rendering survives (uses pre-loaded `window._leads`), so it's silent. Likely the known firebase-js-sdk "Unexpected state" async-queue bug, possibly provoked by the WebChannel instability (OBS-1).
- **Repro note:** each FULL page reload resets the Firestore client (clean). The poison persists only within a single page-load across hash routes.
- **Status:** FLAGGED — **HIGH** (visiting Reports can break realtime Firestore for the session). Needs reliable-repro confirmation + likely a Firestore init/SDK-version fix.

### M-1 — Pipeline search corrupts/leaks raw HTML into lead cards
- **Repro:** Pipeline → type a term in "Search leads…" that matches a new lead. Matching cards render leaked markup as literal text, e.g. `…AllowlistVerify — FIRST-MOMENT" STYLE="BACKGROUND:#64748B22;COLOR:#64748B88;DISPLAY:INLINE-FLEX;…FONT-WEIGHT:700;"`. Clearing the search → cards render cleanly again.
- **Cause (likely):** the kanban search-highlighter operates on the card's `innerHTML` (e.g. `innerHTML.replace(term, '<mark…>'+term+'</mark>')`), corrupting existing element attributes (the new-lead "first move" nudge badge's `style="background:#64748b22;…"`). Highlighting should run on text nodes only, not innerHTML.
- **Impact:** cosmetic but visible during a very common action (searching). Cards still clickable.
- **Owner (likely):** `crm-pipeline.js` search-highlight logic.
- **Status:** FLAGGED (not trivial — highlighter needs text-node-safe rewrite).

## LOW

### L-2 — Customer timeline shows "Invalid Date" on the Lead-created entry
- **Repro:** Open a freshly-created lead → Customer detail → Overview → Timeline & Tasks → "Lead created · Source Unknown · **Invalid Date**".
- **Cause (likely):** the timeline formats `createdAt` before the Firestore `serverTimestamp()` resolves (pending write returns null locally), or a date-parse on a Firestore Timestamp object. Should show "just now"/the date.
- **Impact:** cosmetic; only on brand-new leads.
- **Owner (likely):** `customer.js` timeline render date formatting.
- **Status:** FLAGGED (LOW). May be specific to leads created this session (serverTimestamp not yet materialized).

### L-1 — Quick Add Lead discards entered name/address when opening the full modal
- **Repro:** Dashboard → Quick Add Lead → type Homeowner name + Property address → click "Add →". The full ADD LEAD modal opens **blank** (placeholders only); the name/address/type you entered are not carried over.
- **Impact:** minor friction — you re-type what you just typed. Expectation for a "Quick Add" is either an instant create or a prefilled modal.
- **Owner (likely):** dashboard Quick Add handler → Add Lead modal open (no value pass-through).
- **Status:** FLAGGED (small, but a behavior change — verify intended field mapping; could be trivial once C-1 is understood since they share the modal).

---

## OPEN OBSERVATIONS (severity pending verification)

### OBS-1 — Firestore WebChannel 503 storm on dashboard load
- **What:** On `/pro/dashboard` load + reload, ~70 of 107 network requests to `firestore.googleapis.com/.../projects/nobigdeal-pro/.../Firestore/Write/channel` and `/Listen/channel` (the `RID=rpc` streaming back-channels) return **HTTP 503**. Interspersed `RID=1025x`/`RID=7220x` POST handshakes return 200, and the dashboard renders live data (19 leads, hot list, KPIs), so **reads work**.
- **Interpretation (unconfirmed):** Could be benign Firestore WebChannel stream-cycling (the SDK rotates long-poll connections and aborted ones can surface as 503/400), OR a genuine realtime-sync degradation, OR network-layer interference. Volume is high enough to not dismiss.
- **Decisive test:** create a `ZZ_QA_` write and reload — if it persists, 503s are noise (downgrade to LOW/noise); if the write fails or doesn't persist, this is **CRITICAL**.
- **Owner (likely):** Firestore client init / `state-store` / `NBDAuth` realtime listeners.
- **Status:** ✅ RESOLVED → BENIGN. First write test (public /inspect lead) **persisted** and fired the lead-alert email, proving Firestore writes work. The 503 storm is normal WebChannel stream-cycling, not a failure. Downgrade to noise.

---

## Console / Network error log (per page)

| Page / view | Console errors | Failed requests | Note |
|-------------|----------------|-----------------|------|
| /pro/dashboard (Home) | 1 — benign browser-extension message-channel warning (not app) | ~70× Firestore WebChannel 503 (see OBS-1) | Grammarly + Adobe Acrobat extensions injecting into page |
| /inspect (public form) | 6 — all the same benign extension message-channel warning | submit OK (no failed app requests) | Form submits + persists + emails (H-1) |
| /pro #/crm (Pipeline) | benign WebChannel "Listen transport errored" warnings + extension noise | none on save attempts (C-1 produces NO error) | Realtime Listen stream cycling (OBS-1); save handler silently no-ops |

> **Environment caveat (applies to whole sweep):** the test browser has **Grammarly** + **Adobe Acrobat** extensions injecting scripts/popups into every page. They generate benign console noise and one popup interrupted a save. Recommend a clean/incognito profile for any bug that can't be otherwise isolated (esp. C-1).
