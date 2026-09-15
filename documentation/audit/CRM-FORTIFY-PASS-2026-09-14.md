# CRM fortify pass — 2026-09-14

Jo asked for an open-scope sweep of the CRM — "improve/test/check/secure/
verify/fortify... every surface, function, tool, page... go big." This note
records what the sweep found, what shipped, and what's flagged for a human
decision. Six read-only investigations ran first (three explore + one
plan-design pass verifying the top candidates + three more explore passes on
bigger items), all re-grounded against live `origin/main` before any fix was
written — the working tree this session started from was ~25 commits behind
main, and several candidate findings from `NEXT_SESSION-2026-09-09.md`
turned out already closed once checked against current `main`. Dropped
rather than re-proposed as new work.

## What shipped (seven PRs, none merged by this session — Jo's call per his own stated preference)

| # | PR | What | Verified |
|---|----|------|----------|
| 0 | [#1533](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1533) | Rebased the already-open GBB-tier-followups PR onto current `main`, resolving a real `documentation/INDEX.md` conflict (a shared bullet had gone stale on `main` while this branch's own commits had already closed what it described) | `check-vault-index.js` and `check-site-integrity.js` clean; PR now shows `MERGEABLE` |
| 1 | [#1563](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1563) | **Security.** `stripeWebhook` (`functions/stripe.js:409`) accepted the `__unset__` deploy-stub as a valid signing secret — no guard, unlike every sibling webhook verifier in this codebase. A forged event signed with the public literal `'__unset__'` would have verified if this secret were ever left unbound in prod. `tests/secret-stub-guard.test.js`'s regex couldn't see a bare `.value()` read with no fallback operator, so this had no gate | Proven both directions: reverting the fix reproduces the gap (34/35), fix restores it (35/35); new behavioral forgery test in `tests/webhook-signatures.test.js`; full smoke suite 3817/0 |
| 2 | [#1565](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1565) | **Revenue.** Every non-admin rep's Auto-measure / e-sign / parcel-lookup buttons have been silently dead: `integrations-client.js`'s `status()` short-circuited for non-admins to stop 403 console spam, but returned a permanently-empty `configured:{}` without ever calling the server — so `requireConfigured()` was unconditionally false for every ordinary rep, regardless of real config state. Fixed with a new auth-only (not admin-gated) `integrationAvailability` callable exposing only the business-integration booleans reps need; the admin-only `integrationStatus` endpoint and the real recon-amplifier fix it protects (H-06) are untouched | `tests/smoke/auth.test.js` confirms H-06 unregressed; new `tests/smoke/functions.test.js` section; also caught and fixed a `FUNCTIONS_INDEX.md` completeness gate the new export tripped |
| 3 | [#1564](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1564) | **Correctness.** Two more repeats of the #1447/#1449 hydration race (a synchronous company-profile read outrunning `window._loadCompanyProfile()`, so a freshly-loaded tenant briefly gets NBD's own identity baked into a document): `document-generator.js`'s `generateBlank()`, and — the more serious one — `warranty-cert.js`'s `generateWarrantyCertPDF()`, where the cert-number prefix already awaited hydration for this exact reason but the name/phone/email/seal literals did not | New assertions in `tests/smoke/photo.test.js` proven to fail pre-fix, pass post-fix; the agent building this one caught that its own explanatory code comments would have satisfied a naive text-match test and stripped comments before asserting |
| 4 | [#1562](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1562) | **Rules gap.** `measurements/{jobId}` read was gated to uid-owner-or-*platform*-admin, not company-scoped — which is why the 90-day same-roof reuse feature copies the whole document into the calling rep's own uid instead of referencing the original (a teammate couldn't otherwise read it). Relaxed to `sameCompanyAsResource()`, mirroring the already-proven-safe `/pins`/`/zones` pattern; `companyId` on these docs is fully server-stamped, so this is a safe read-side-only change | `tests/firestore-rules.cross-tenant.test.js` proven 117/118 (gap) → 118/118 (fixed) against the real rules emulator. **Open call flagged in the PR, not silently decided:** should any teammate see a peer's measurement (what shipped), or only managers/admins (mirroring how `/leads` keeps peers invisible)? |
| 5 | [#1567](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1567) | **Data loss.** `photo-editor.js`'s drawn annotations (arrows/callouts/stamps/measurements) lived only in an in-memory array reset on every open/switch/close — no save path ever wrote them to Firestore, so a rep's markup vanished on reload unless they flattened it into a brand-new raster image (destroying the vector data permanently either way). Added `annotations` + `originalUrl`/`originalStoragePath` fields to the existing `/photos/{photoId}` doc — additive, no rules or report-pipeline change needed | New `tests/photo-editor-annotation-persistence.test.js`, a real fake-DOM/`vm` harness driving actual pointer events: 23/35 (pre-fix) → 35/35 (post-fix). Also found and separately flagged (not fixed here, spun off as its own task) that `switchPhoto()` never updates `S.photoId`, so a save after switching photos can target the wrong doc |
| 6 | [#1566](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1566) | **Mobile.** A fresh sweep of the CRM views the last mobile audit (`NEXT_SESSION-2026-09-09.md` §14) hadn't reached found the same "hidden-scrollbar, no affordance" bug already fixed 3x (PR #1531) in three more places — **Settings** (`#stab-bar`, 13 tabs, the widest bar in the app), **Rep OS** (Performance Snapshot row, same shape as the already-fixed Close Board stats row), plus a narrower grid-overflow variant in **Products**, a missing `flex-wrap` in **Drawing Tool** (its own sibling button groups already had it), and one bonus outside the original list in **Real Deal Academy**'s tabs | Confirmed **clean, no bug** on the other 6 views checked (Estimate Builder V2 — despite being flagged highest-risk, the most mobile-hardened view in the app; Prospects, Sales Training, Job Templates, Expenses, Money, Leaderboard) — recorded here so nobody re-audits them. Static-analysis-verified only; **live visual verification on a real mobile viewport was not performed this session** (see below) |

## Live mobile visual verification — done, and it caught a real bug

Done as a same-day follow-up: booted the Firebase emulator suite (Auth +
Firestore + Storage + Hosting, on isolated non-default ports so as not to
collide with the several *other* live sessions already running their own
emulators on the standard ports at the time — confirmed via `netstat`
before starting), seeded a real test tenant via the existing
`tests/e2e/fixtures/seed-emulator.js`, and logged in through the actual
`/pro/login.html` flow via the Browser-pane MCP tool. Checked all 5 fixed
views at both 320px and 375px.

**4 of 5 confirmed correct as shipped:** Settings `#stab-bar`, Rep OS
`.ros-perf-row`, Drawing Tool `.draw-mode-row`, Real Deal Academy
`.rda-tabs` — mask-image fades and flex-wrap all render and behave exactly
as intended.

**1 of 5 (Products) had a real bug the fix hadn't actually closed.** The
`@media (max-width:360px){.pl-product-grid{grid-template-columns:1fr;}}`
rule collapsed to a single column correctly, but a card's cost/unit badge
still rendered clipped with no scrollbar at 320px — confirmed visually,
then cross-checked with native Playwright/Chromium at true 320px device
metrics (not just the Browser-pane tool) to rule out a testing-tool
artifact before trusting the result; both gave byte-identical numbers.
**Root cause:** a bare `1fr` grid track has an *implicit* automatic minimum
of `auto` per the CSS Grid spec — the widest min-content contribution among
the grid's children, not 0. This card's own `white-space:nowrap` badges
have a ~307px min-content width, so the single-column track stayed 307px
wide inside a 232px container regardless of the media query. Proven
empirically that this had nothing to do with cascade/specificity — forcing
`grid-template-columns:1fr !important` directly via devtools did not change
the computed track size at all. The fix is `minmax(0,1fr)`, which explicitly
overrides the implicit floor; confirmed via computed style and a full
screenshot showing the badge fully visible again. Pushed as a follow-up
commit (`8e26b1d6`) to PR #1566 with a permanent regression-guard assertion
(proven to fail against the original bare-`1fr` code, pass against the fix)
and posted as a PR comment with full reasoning.

## Flagged, not acted on — surfaced for Jo, no code changes

- **Ready to merge now** (green CI, active — not touched by this session):
  [#1559](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1559)
  (dependabot, 31 updates),
  [#1548](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1548)
  (Turnstile 6s timeout),
  [#1547](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1547)
  (9 monitoring policies live),
  [#1546](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1546)
  (push-payload test hardening),
  [#1536](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1536)
  (homepage copy). **Merge #1547 before #1548** — both rewrite overlapping
  parts of `monitoring/README.md` (the same "Turnstile alert went live"
  narrative) and will conflict otherwise.
- **Stale (5-6 days as of 2026-09-14), worth a status check before anyone
  builds on them:**
  [#1532](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1532)
  (credential badges),
  [#1519](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1519)
  (2 failing checks — Unit suites, Rendered QC sweep — and by far the
  largest diff reviewed, explicitly a partial delivery per its own body),
  [#1508](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1508)
  (GDPR Storage-prefix sweep),
  [#1507](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1507)
  (docs correction),
  [#1499](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1499)
  (photo-report numbering, stacked on an unmerged base branch 56 commits
  stale).
- **Likely-redundant unopened branches**, worth checking with Jo before
  anyone opens a PR for them (both duplicate work already covered by an
  open PR above): `fix/turnstile-key-coverage` (overlaps #1548),
  `test/push-bridge-executing` (overlaps #1546).
- **Orphaned, safe to delete:** several `claude/*` branches duplicating
  already-merged PRs (#1530, #1535, #1545 each have 1-2 leftover siblings),
  `backup/turnstile-6s-pre-rebase` (self-declared backup), and
  `fix/favicon-normalization` (already merged as #1534).
- **A scheduled workflow, `Lead address audit`, failed on `main` on
  2026-09-14** — not part of the push/PR gate so it doesn't block merges,
  but it's a live failure worth a look.
- **Jo-only items, already tracked in `NEXT_SESSION-2026-09-14.md`'s §2,
  not re-derived here:** rotate the `nbd-ai-proxy` key + delete 4 Cloudflare
  workers; the Deepgram secret check; `renderPdf` production proof + one
  real paid invoice + Stripe price verification; the cost-rotation live
  session; seat-stepper activation.

## Method notes worth carrying forward

- **This checkout was 25 commits stale.** Every finding above was
  re-verified against `origin/main` via `git show`, not the working tree,
  specifically because several candidate findings sourced from
  `NEXT_SESSION-2026-09-09.md` turned out already closed by commits this
  checkout had never seen (a full Grok-audit cycle, #1535-#1557 and
  #1560/#1561, landed in the days between). Worth a standing reminder: check
  `git log <local-branch>..origin/main --oneline` before trusting a stale
  checkout's documentation.
- **All seven fixes shipped from isolated worktrees**, each branched fresh
  from `origin/main`, never touching the shared checkout directly — avoids
  the "shared checkout, parallel sessions" collision risk this vault has
  logged before, and sidesteps the Windows MAX_PATH worktree issue by
  letting the harness manage worktree paths rather than nesting them under
  a long scratchpad path.
- **Every fix has a test proven to fail against the pre-fix code and pass
  after** — reverting the fix and re-running was done explicitly for the
  security fix, the rules fix, the hydration-race fix, and the photo
  annotation fix; the mobile-sweep agent additionally discovered that PR
  #1531 (the precedent it was told to mirror) never actually shipped
  regression tests despite its commit message implying it had, and adapted
  by extending the closest real test file instead of inventing a fictional
  precedent.
