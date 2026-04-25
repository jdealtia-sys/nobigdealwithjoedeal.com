# Next session — pickup notes

Branch: `claude/security-infrastructure-review-HwFAj`
Last commit: `0242f83` (GDPR registry drift check + appointments fix)
Tests: **697 passing, 0 failing**. Firestore + Storage emulator suites green.
**Not yet merged to main** — branch lives on origin awaiting your merge call.

This branch landed 16 commits across two sessions: 11 in the 72h-fix round (C-01..M-04), then 5 more in the cleanup round (B2, Stripe extraction, M1 pilot, drift sweep). `functions/index.js` is now 2444 lines, down from the 3550-line monolith. See `git log --oneline c4e6670..HEAD` for the full ledger.

---

## 1. Pre-merge ops actions on Joe

These can't be shipped in code. None block code review of the branch — they're the deployment runway.

- [ ] **Run `node scripts/grant-demo-claim.js demo@nobigdeal.pro`** (one-time). Without this, H-02 leaves the demo account with no bypass — professional-tier UI won't unlock until the `demo:true` claim is set. Idempotent.
- [ ] **Provision Upstash + flip `NBD_RATE_LIMIT_PROVIDER=upstash`** per `POST_DEPLOY_CHECKLIST.md` §18. Verify with `firebase.functions().httpsCallable('integrationStatus')()` — `rateLimitProvider` field must read `"upstash"` post-flip.
- [ ] **Delete the `nbd-ai-proxy` Cloudflare Worker** via the CF dashboard. Repo files are gone; the live endpoint still needs manual removal.
- [ ] **After 7 days of zero `imageProxy` calls in Cloud Logging**, delete the function from Cloud Run. The 410 stub is safe to remove once stale clients have purged.
- [ ] **First GCS backup-restore drill (F-12)** — runbook lives in `scripts/verify-backup.sh` + `POST_DEPLOY_CHECKLIST.md`. Quarterly cadence; first execution still owed.
- [ ] **Book the external pentest** (~$6–10k, 1-week engagement). Right time is now that the surface stabilized — recommend booking for ~30 days post-launch so live traffic informs scope.

---

## 2. Code items ready to ship next session

In priority order. All are pure-code, single-session-shippable. Each entry: scope, effort estimate, key files, proven playbook.

### 2a. M1 continuation — `/admin/login.html` + `/admin/analytics.html` style-src

**Scope:** Drop `'unsafe-inline'` from `style-src` on the two admin pages that have one inline `<style>` block each. Either extract to external `.css` files OR add a sha256 hash directive.

**Recipe** (from `POST_DEPLOY_CHECKLIST.md` §18b):
1. Extract the inline `<style>` block to e.g. `docs/admin/css/login.css` (or co-located).
2. Reference via `<link rel="stylesheet" href="...">`. `style-src 'self'` already covers it.
3. Edit `firebase.json` per-page CSP entry: remove `'unsafe-inline'` from `style-src`.
4. Add a smoke assertion mirroring the M1 pilot pattern at `tests/smoke.test.js` — parse the directive, assert no `'unsafe-inline'`, assert page has zero inline `<style>` / `style="..."`.

**Effort:** ~30 min/page including tests. Two pages = 1 commit.

**Files:** `docs/admin/login.html`, `docs/admin/analytics.html`, `firebase.json`, `tests/smoke.test.js`, two new `.css` files.

### 2b. Further `index.js` extractions

The Stripe + portal extractions proved the `sed`-pipeline pattern. Three more natural module boundaries:

| Target | Handlers | LOC est. | Notes |
|---|---|---|---|
| `functions/team.js` | `createTeamMember`, `updateUserRole`, `deactivateUser`, `listTeamMembers`, `activateInvitedRep` | ~400 | Pure callables; share auth pattern. |
| `functions/analytics.js` | `getAdminAnalytics`, `backfillAnalytics` | ~250 | `getAdminAnalytics` already at index.js; `backfillAnalytics` near it. |
| `functions/visualizer.js` | `publicVisualizerAI` (and maybe `validateAccessCode`, `rotateAccessCodes`) | ~200 | `publicVisualizerAI` is unauthenticated; access-code is auth-adjacent. |

**Per-extraction playbook** (proven by L-03 portal + 82c198a Stripe):
1. `grep -n "^exports\.\(NAMES\)" functions/index.js` → record line ranges.
2. Build `functions/<module>.js` via the `cat <<'HEADER' ... | sed -n 'A,Bp'` shell pipeline. Module imports `{ requireAuth, callableRateLimit, requirePaidSubscription } from './shared'` as needed; redeclares any secrets it touches via `defineSecret`.
3. `node --check` and round-trip exports verification.
4. `sed -i -e 'A,Bd'` (one invocation, multiple `-e`) to gut `index.js`.
5. Splice `Object.assign(exports, require('./<module>'));` near the existing `portalFunctions` loader (line ~1324 today).
6. Update pre-existing smoke assertions that read handler shapes from `index.js` to read from the new module. Same `// L-03 cont.` comment pattern.
7. Add L-03-style regression assertions: handlers exist in new module, no inline copy in `index.js`, module is self-contained.

**Effort:** ~1 hour/module. Each ships independently.

### 2c. Storage prefix registry drift sweep (companion to GDPR drift sweep)

**Scope:** Mirror the `firestore.rules` → `FLAT_USER_COLLECTIONS` cross-check at `tests/smoke.test.js:2230+` for `storage.rules` → `STORAGE_PREFIXES`. Parse every `match /<prefix>/{uid}/{allPaths=**}` block, cross-reference the registry's `STORAGE_PREFIXES` array, fail CI if drift.

**Effort:** ~20 min. One-file edit (`tests/smoke.test.js`), no source changes expected (`STORAGE_PREFIXES` already covers all 8 known prefixes — but the sweep will catch the next added prefix immediately).

### 2d. claudeProxy adopts shared `requirePaidSubscription`

**Scope:** `functions/index.js` `claudeProxy` (~lines 152-159) inlines the same subscription check that `shared.js` exports. Migrate to the shared helper. Status-code change: 403 → 402 for the no-sub case (the helper uses semantically-correct 402 Payment Required).

**Effort:** ~15 min, 1-line code change + 1-line test update if any pin the 403.

---

## 3. Operational playbook (lessons from the timeouts)

Two timeouts hit this session — both on a single 550-line file write. Mitigations now proven:

1. **Never use `Write` for files > ~300 lines.** Use the `cat <<HEADER … | sed -n 'A,Bp'` shell-pipeline pattern. The full 835-line `stripe.js` was authored in one Bash call this way; the previous Write attempts both timed out.

2. **Don't re-Read code already in context.** Each Read of `functions/index.js` adds ~10k tokens to subsequent turns. Trust earlier reads.

3. **Smoke-only on most turns, emulator only when touching rules.** `node tests/smoke.test.js` runs in 2s. `npm run test:rules` + `test:storage` together run ~60s with emulator startup. Run them only on commits that touch `firestore.rules` / `storage.rules` / data-access surface.

4. **For module splits: announce the multi-turn plan up front.** "Turn 1 writes `X.js`. Turn 2 guts `index.js`. Turn 3 fixes assertion drift." Each turn fits within budget.

5. **Subagent for fresh-context heavy lifts.** Doesn't always work (the `stripe.js` authoring agent also timed out at 121s), but useful when the task is genuinely independent of the main conversation context.

6. **The L-03 assertion-redirect pattern.** Every module extraction breaks pre-existing smoke assertions that read handler shapes from `index.js`. Standard fix: `grep` the failure list, change `read(path.join(FUNCTIONS, 'index.js'))` to `read(path.join(FUNCTIONS, '<new-module>.js'))` in each affected section. Add a `// L-03 cont.` comment to mark the migration. ~5 min per extraction.

---

## 4. Suggested first-30-min sequence next session

1. `git status` + `git log --oneline -5` → confirm branch state matches this doc.
2. Pull this doc, pick 2a (M1 admin-pages) — smallest, real security win, tight scope.
3. While in `firebase.json`, also tighten `/admin/mfa-enroll.html` (no per-page CSP today → falls back to global laxer CSP). Add a per-page entry mirroring `/admin/login.html`'s strict shape.
4. One commit, one push. Verify CI green.
5. Then pick a module extraction from 2b based on appetite — `functions/team.js` is the cleanest next target.
