# NEXT SESSION — 2026-09-14

Supersedes [NEXT_SESSION-2026-09-13](NEXT_SESSION-2026-09-13.md) as the live
brief. That note's own inherited queue (from
[NEXT_SESSION-2026-09-09](NEXT_SESSION-2026-09-09.md) §0 and its §1
Turnstile warning) still stands — nothing below contradicts it, and this
note doesn't re-derive it. Lane D of the 09-13 brief closed the same day
(#1545, corrected in place there); the rest of that brief's execution order
is either done (see below) or still open exactly as it described.

**How this was built.** The 09-13 evaluation plan
([full write-up](../audit/GROK-CRM-AUDIT-EVALUATION-2026-09-13.md)) was
executed end to end this session: nine PRs opened, each with tests proven
able to fail against the pre-fix tree before being trusted, all CLAUDE.md
gates run and green. Full verdict table, decisions, findings, and Jo's ops
queue are in that evaluation note — this handoff is the pointer + what's
still open, not a re-derivation.

## §0 — What shipped (2026-09-14)

| PR | What |
|---|---|
| [#1549](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1549) | Pro copy honesty (pricing/trial/demo/register/login/how-to/sandbox + ESX-export removal) |
| [#1550](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1550) | Team plan billing coherence + cap-blocked convert + access-code-over-live-sub guard |
| [#1551](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1551) | Money-path honesty (invoice balance line, min-job hydration, deal-acceptance atomicity) |
| [#1552](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1552) | Customer-page photo uploads through the durable queue |
| [#1553](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1553) | `homeowner-uploads/` storage rule + `signImageUrl` allowlist |
| [#1554](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1554) | Nav/footer logo crop + resize (Jo's separate mid-session ask) |
| [#1555](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1555) | Security-docs accuracy (hosts, webhooks, worker status, `/pro/privacy` route, killswitch URL, CORS typo) |
| [#1556](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1556) | Sentry release stamped with git SHA on every deploy |
| [#1557](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1557) | Boot-weight containment (`maps-routing.js` + `talk-tank.js` made lazy) |

**None of these are merged yet as of this handoff** — all nine are open
PRs on `origin`, each independently mergeable, each based on
`main@665dd408`. Check for merge conflicts before merging more than one:
#1549/#1550/#1551/#1552/#1553 touch mostly-disjoint `/pro` files; #1555
and #1557 both bump the node test-count floor from the same baseline —
whichever merges second needs a rebase + re-measured `FLOORS` (the
manifest runner prints the exact fix line, don't add +1 blindly).

## §1 — What this session found but did NOT build (read before starting)

1. **Voice-memo button / `DEEPGRAM_API_KEY`** — genuinely unresolved.
   Secret Manager shows one un-rotated version from 2026-04-14 (same day
   the code first referenced it); 90 days of Cloud Logging show zero real
   `transcribeVoiceMemo` invocations. Both consistent with "still the
   deploy stub," neither conclusive without reading the actual value,
   which this session correctly did not do (blocked by the auto-mode
   classifier, and the check was Jo's ops-queue item to begin with — see
   the evaluation note's Part 3, item 10). **Next session: ask Jo, or have
   Jo run the one `gcloud secrets versions access` check himself and
   report back "set" or "stub" — do not guess.** If stub: gate the button
   behind the integration gate. If set: trace the real call path instead.
2. ~~**Installed-PWA `blob:` download interceptor** — found (customer-page
   CSV/backup exports fail silently in the home-screen app), not fixed.~~
   **Stale — already fixed same day**, as a drive-by in PR
   [#1552](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1552)
   / commit `adc6a48` (merged to `main`), item 4 of that PR's own commit
   message: `docs/pro/js/standalone-compat.js`'s `isStandalone` link
   interceptor skip-list now excludes `blob:`, `data:`, and any anchor
   carrying `download`, with the root-cause comment in place
   (`new URL('blob:...', location.origin).origin === location.origin`
   was routing export anchors into the same-origin `preventDefault()` +
   `location.href` branch instead of letting them download). Covered by
   `tests/photo-queue-customer-page-2026-09-14.test.js`'s section 4. The
   `documentation/audit/GROK-CRM-AUDIT-EVALUATION-2026-09-13.md:287`
   "not fixed this pass" line is correspondingly stale too — this
   session's fix postdates that write-up. Also: the actual export UI is
   `dashboard.html`'s "Export & Backup" panel (`data-export.js`), not a
   literal button on `customer.html` — "customer-page" in the original
   finding meant "customer-data export," not the homeowner portal page.
3. ~~**`onAudioUploaded` / `onPortalMessageDraft`** have no
   `feature_flags/global` kill switch~~ — **wired same day, MERGED**, PR
   [#1560](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1560)
   (`dc3ee9f`): `voiceIntelDisabled` and
   `aiDraftDisabled`, mirroring `webLeadMeasureDisabled`.
   `SPEND_KILLSWITCH.md` updated in place. New suite
   `tests/voice-portal-draft-killswitch.test.js`, `FLOORS` re-measured
   (121→122 node, 207→208 disk). **Same-PR correction:** the first cut
   gated only `onPortalMessageDraft` at its own call site; re-reading
   the shared `generateAIDraft()` (not just the one call site the audit
   named) found `incomingSMS` calls the identical function with no gate
   of its own — a real, broader miss (`incomingSMS` fires on every
   inbound SMS, unattended, same risk class). Fixed by moving the check
   inside `generateAIDraft` itself (`handlers/ai-texting.js`) so all
   three callers — `incomingSMS`, `onPortalMessageDraft`, and the
   admin-only `convertUnmatchedSms` — share one flag, renamed
   `aiDraftDisabled` to match its real scope.
3b. **Follow-on finding, same session, not in the original audit at
   all**: `SPEND_KILLSWITCH.md`'s `aiDisabled` "ONE-BUTTON: halt all
   billable AI" claim was itself stale — it named only `claudeProxy`,
   `analyzePhotoVision`, `visualizerImageGen`. Auditing every literal
   Anthropic/Groq `fetch()` call site in `functions/` (not trusting that
   list, nor a file-level "does `isAiDisabled` appear anywhere in this
   file" check) found six more live, wired, ungated endpoints —
   `dictate`, `previewAiPersona`, `analyzeRoofPhoto`, `adminAI`, and,
   worst, two **unauthenticated public** ones: `publicVisualizerAI` and
   `publicFunnelAI` (the `/estimate` funnel's own AI call), gated only
   by per-IP rate limits, no operator stop short of pulling the shared
   key. All six fixed, PR
   [#1561](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1561)
   (open). New suite `tests/ai-disabled-coverage.test.js` closes the
   deeper gap: no suite pinned `isAiDisabled` coverage for *any* of the
   ten endpoints before this, not even the original three — so this
   class of drift had no gate to catch it recurring. `FLOORS`
   re-measured 122→123 node, 208→209 disk.
4. **Seat stepper visible-but-broken** (`dashboard-team-tab.js`) — every
   card-billed owner sees the "Extra seats" control and it fails with a
   server toast if `STRIPE_PRICE_SEAT` isn't a real price. Documented
   accurately in `SEAT_BILLING_ACTIVATION.md`, not code-fixed — the
   failure is safe (visible, no data loss), and activating the feature for
   real is Jo's Stripe/config task per that doc.

## §2 — Jo's ops queue (carried from the evaluation note, not re-derived)

Full list with evidence-of-done brackets is in the evaluation note's
Part 3. Headline items:

1. Delete all four Cloudflare workers, rotate the `nbd-ai-proxy`
   Anthropic key.
2. Cost-rotation live session — worksheets + runbook are ready
   (`documentation/runbooks/COST-ROTATION.md`, `.local/rotation-*.json`
   generated this session, gitignored).
3. `renderPdf` production proof; one real paid invoice; Stripe price
   verification; the Grok §20 ten-job dogfood pass.
4. The Deepgram check above (§1 item 1) — small, but blocks a real
   product decision.

## §3 — Do NOT touch (standing, unchanged)

Brand-lane items ("500+ contractors" on free-guide — Lane C territory);
ROCK 2 wizard deletion (blocked until ~2026-09-30 zero-Sentry-warn clock
**and** Jo naming it — see `BIG_ROCKS.md`'s 2026-09-14 correction for the
accurate PR status: only PR 6 part 2 remains, not PRs 3-5); seat add-on
activation; FLUX / `VISUALIZER_IMAGEGEN_ENABLED`; `TURNSTILE_SECRET`;
reviving the June Pro privacy policy draft; metering reports/AI usage.

## §4 — Vault housekeeping done this session

Stale-doc corrections (all dated, in-place, per `CLAUDE.md`'s convention —
none rewritten wholesale): `ARCHITECTURE.md` (function count, E2E
continue-on-error, CSP Phase 6, firebase-admin version), `BIG_ROCKS.md`
(suite-count claim, ROCK 2 PR status, the never-built `NBD_ENGINE_V2`
flag), `functions/SEAT_BILLING_ACTIVATION.md` (self-hides claim),
`documentation/architecture/NBD-PRO-PRODUCT-AUDIT-2026-07.md` (trial-tier
scope), `documentation/runbooks/SPEND_KILLSWITCH.md` (added the roof-
measurement lever + documented the two ungated triggers),
`NEXT_SESSION-2026-09-13.md` (Lane D — done same day),
`REMOTE-BRANCH-CLEANUP-2026-09-05.md` + `INDEX.md` (two Cloudflare workers
called "deleted" — actually route-disabled, still exist).
