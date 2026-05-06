# NBD Pro — First 30 Waves

A wave is a single small, ship-shaped improvement: one PR, one merge,
one thing the rep notices the next time they log in. The first 30
waves landed across roughly two days of focused work in early May
2026. This file groups them by what they affected so you can scan
the work without reading 30 separate PR descriptions.

---

## iOS / PWA reliability

The biggest source of "the app is broken" reports in the field was
iOS Safari quirks — the SW update story didn't actually deliver new
code, the customer detail page silently hung, and PWA installs were
undiscoverable. These waves close those loops.

| Wave | What | PR |
|---|---|---|
| **(bundled in PR #137)** | Made the "Update available — tap to refresh" toast actually tappable; rewrote the SW reload guard to use a per-page-load in-memory flag (was a sessionStorage flag keyed by an SW version string that rarely changed, so reps got pinned to old code forever after one reload); added 8s slow-load watchdog overlay on customer.html so iOS Safari connection hangs surface a "Refresh now" button instead of a blank screen | [#137](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/137) |
| **11** | Customer detail handoff — dashboard stashes the lead in sessionStorage on click, customer.html renders instantly from it, skipping the cold Firestore round-trip that hung on iOS | [#138](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/138) |
| **14** | Background revalidate after Wave 11 handoff — fires 1.5s after instant paint, swaps in fresh data + shows a "↻ Refreshed" pill if the server doc is newer; silent noop if the network's flaky | [#141](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/141) |
| **20** | PWA install nudge — bottom banner from session 3 onward with platform-aware action ("How?" with Share-button walkthrough on iOS, native install dialog on Android Chrome with `beforeinstallprompt`, fallback instructions otherwise), snooze + dismiss controls | [#147](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/147) |

---

## Multi-tenant security

A focused security audit found two real cross-tenant gaps in the
email Cloud Functions.

| Wave | What | PR |
|---|---|---|
| **9** | `sendEstimateEmail` was a cross-tenant relay (any authed user could supply any leadId and email that customer with NBD-branded templates) — now requires owner-or-same-company-manager. `sendTeamInviteEmail` had no role check, no `companyId` stamp, and allowed role escalation (a rep could mint admin invites) — now requires admin/manager/owner with companyId stamping + escalation guard | [#137](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/137) |

---

## Photo & AI

| Wave | What | PR |
|---|---|---|
| **10** | AI roof damage analysis MVP — new `analyzeRoofPhoto` Cloud Function (Claude Sonnet vision, server-owned system prompt, structured JSON output, ownership check, SSRF guard, 100/day per-uid cap), client `photo-ai.js` with severity-coded analysis card injected in the photo lightbox | [#137](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/137) |
| **12** | Bulk AI photo analysis — "Analyze All with AI" button in the gallery toolbar with live progress + severity summary banner; AI assessments now render as captions in inspection report PDFs | [#139](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/139) |
| **30** | Drag-drop file upload on customer detail page — drop photos/PDFs anywhere on the page, images go through `PhotoEngine.uploadFromFile` and docs go to the signed-document path; multi-file with per-file toast + summary | [#157](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/157) |

---

## Dashboard home — the "command center"

The dashboard home went from passive stat cards to a live command
center that answers four questions at a glance.

| Question | Surface | Wave |
|---|---|---|
| Where do I start? | 🔥 Hot Leads | **29** |
| Where am I stuck? | Pipeline Bottlenecks | **19** |
| What needs follow-up? | Needs Attention filter | **25** |
| What just happened? | Notification bell + Activity feed | **13**, **24** |

| Wave | What | PR |
|---|---|---|
| **13** | Notification bell — wired the dead-UI dropdown that had been shipped unfunctional; aggregates overdue tasks + tasks due today + stale estimates + cold leads from already-loaded caches; severity-sorted, dismissible, per-item read state in localStorage | [#140](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/140) |
| **19** | Pipeline Bottleneck widget — per-stage avg/median/max days-in-stage with the slowest 1-2 stages flagged red as bottlenecks; click row to jump into kanban filtered to that stage | [#146](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/146) |
| **24** | Recent Activity timeline — last 20 events from leads/estimates/tasks (created, stage moved, sent, viewed, signed, completed); click row navigates via Wave 11 handoff | [#151](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/151) |
| **29** | Hot Leads widget — top 5 highest-scoring leads in prospecting stages that haven't been touched in 3 days, click to open instantly via handoff | [#156](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/156) |

---

## Kanban UX

| Wave | What | PR |
|---|---|---|
| **17** | Kanban stage-aging cues — yellow/orange/red left border on cards based on `stageStartedAt`; 14+ days gets a 4px border with 2.4s pulse; pill badge "Nd in stage" on each card | [#144](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/144) |
| **22** | Keyboard shortcuts cheat sheet — wired the unwired `#shortcutsPanel` (`?` toggles); also wired the missing keybindings the panel was advertising: C/N (new lead), E (new estimate), 1-7 (scroll to kanban column with orange flash) | [#149](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/149) |
| **25** | Needs Attention filter — single header button with red count badge that filters the kanban to leads with stale-stage / overdue task / stale estimate; composes Waves 13/17/19 into one click | [#152](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/152) |
| **26** | Right-click + long-press context menu — eight actions (View / Edit / Add task / Call / Copy phone / Copy address / Maps / Delete), viewport-clamped, dismissible four ways; light haptic on long-press for mobile | [#153](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/153) |

---

## Search + data ergonomics

| Wave | What | PR |
|---|---|---|
| **15** | Lead deduplication on create — modal with confidence-tagged matches before save, "open existing" / "create anyway" / "cancel"; `duplicateOf` audit stamping on the proceeding doc | [#142](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/142) |
| **18** | Cmd+K / "/" global search — searches leads (name/address/phone/customerId/email) + estimates (number/lead/total) with substring highlighting, keyboard nav, instant render via Wave 11 handoff | [#145](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/145) |
| **21** | CSV export for leads + estimates from Settings — RFC-4180 quoting, Excel-safe BOM, ISO timestamps, honors Show Prospects toggle | [#148](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/148) |
| **23** | CSV lead import — three-step modal (drop / mapping with smart aliases / progress), RFC-4180 parser, per-row dedup via Wave 15, server-stamped userId+companyId+stageStartedAt | [#150](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/150) |

---

## Scheduled emails

Two cadences now run dry-run behind env vars (`WEEKLY_DIGEST_ENABLED`,
`DORMANT_NUDGE_ENABLED`); flip on the Cloud Run revision after one
or two cycles of observation.

| Wave | What | PR |
|---|---|---|
| **6** | Stripe webhook auto-advances kanban stage to `final_payment` when an invoice is paid — protects already-final stages, stamps `autoAdvancedFromInvoiceId` for audit | [#135](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/135) |
| **16** | Weekly digest cron — Monday 7am ET. New leads + won deals + revenue + active pipeline + top 5 new leads per rep. Skips zero-activity users | [#143](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/143) |
| **27** | Dormant-lead Wednesday cron — finds leads stuck >30 days at non-terminal stages, emails the rep a focused list with click-through links; 8am ET to give two business days to act before the weekend | [#154](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/154) |
| **28** | Settings UI opt-out for the dormant nudge (mirrors the Wave 16 weekly digest toggle) — separate fields because the two emails serve different intents | [#155](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/155) |

---

## Customer-facing polish

| Wave | What | PR |
|---|---|---|
| **7** | Homeowner portal project progress timeline — five friendly milestones (Inspection / Estimate / Contract / Installation / Complete) mapped from 28 internal stage keys; visual track with checkmarks + "Next up" callout | [#136](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/136) |
| **8** | Mobile responsive fixes — ROI table column-prune at <600px, card detail info-grid stacks at <540px | [#137](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/137) |

---

## Onboarding + earlier waves

These shipped before the formal wave numbering kicked in (Waves 1-5)
across PRs #133, #134, but they're part of the same push.

| Wave | What | PRs |
|---|---|---|
| **1, 2, 3** | Theme persistence (unlock state synced to Firestore + localStorage), photo-editor unsaved-annotation confirmation, Lead Source ROI panel, Pipeline Forecast panel | [#133](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/133) |
| **4, 5** | 5-step DOM-based onboarding tour (Welcome → Pipeline → Add Lead → D2D → Settings), empty-state CTAs across views | [#134](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/134) |

---

## Architecture notes

A few patterns that recur:

- **Dead-UI wiring** — the v5 dashboard refactor left several modals
  (cmd palette, notification bell, shortcuts panel) sitting in the
  HTML with `onclick` handlers that referenced functions that
  didn't exist. Waves 13, 18, 22, 28 wired each one up. New work
  should never ship UI without checking that its handlers exist.

- **In-memory cache as source of truth** — `window._leads`,
  `window._estimates`, `window._taskCache`, `window._photoCache`
  are loaded once by the dashboard's loaders and reused by
  every widget. Widgets re-render on a custom `nbd:data-refreshed`
  event that the loaders emit, plus a 60s/5min interval as backstop.
  Avoids per-widget Firestore reads.

- **Per-page-load reload guards over sessionStorage version flags**
  — sessionStorage tied to a slowly-changing version string is a
  trap (Wave reload bug). Use in-memory `let _flag = false` for
  "once per page load" semantics.

- **Default-ON opt-outs** — opt-out flags use `=== false` checks
  (e.g. `weeklyDigestEnabled !== false`) so users without the
  field set get the feature; only an explicit `false` skips.
  Settings UIs prime checkboxes with this same semantic.

- **Cron functions ship DRY-RUN** — `WEEKLY_DIGEST_ENABLED` /
  `DORMANT_NUDGE_ENABLED` env vars gate live sends. Logs eligible
  recipients in dry-run mode so we can observe a cycle before
  flipping on. Same shape for both the Wave 16 and Wave 27 crons.

- **Wave 11 handoff** is reused by Waves 18, 24, 29 — anywhere a
  rep clicks a lead, they get the customer page rendered
  instantly from sessionStorage + a background revalidate for
  fresh data.

---

# Second push — Waves 31-50

The first 30 waves built the foundation: the dashboard home command
center, multi-tenant security, AI photo analysis, scheduled emails,
kanban UX, search and ergonomics. The second 20 went deeper — three
focused initiatives plus a handful of daily-friction polish ships.

The big arcs:

1. **The share trio** (W40-W43) — Copy / Text / Email portal link
   helpers, all built on a shared `PortalLinkHelpers` module.
2. **The snooze system** (W35-W37, W39) — defer leads to a date,
   filter everywhere, bulk-snooze via toolbar, snooze-aware feed.
3. **The "see + act" pattern** (W46-W49) — inline reshare buttons
   on every priority surface so the rep can glance + tap from the
   four dashboard-home widgets without ever leaving the page.

---

## The share trio (Copy / Text / Email portal link)

| Wave | What | PR |
|---|---|---|
| **40** | One-click copy portal link from customer detail. Three-tier clipboard fallback (modern API → execCommand → share-panel fallback) so reps never hit a dead end | [#167](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/167) |
| **41** | One-tap SMS portal link — `sms:<phone>?body=...` with friendly prefilled greeting | [#168](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/168) |
| **42** | Extracted `PortalLinkHelpers` shared module + added Copy/Text items to the kanban context menu | [#169](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/169) |
| **43** | Email portal link variant — `mailto:` with subject + multi-line body. Completes the trio | [#170](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/170) |
| **44** | Tracks `lastSharedAt` + `lastSharedVia` on every share. Kanban cards show "📤 SMS 3d ago" pill | [#171](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/171) |

---

## The snooze system

| Wave | What | PR |
|---|---|---|
| **35** | Snooze a lead to a future date (preset modal: tomorrow / next Monday / 1w / 2w / 1mo + custom). Filter integration across kanban, Hot Leads, Needs Attention, bell. Per-page reload guard via `nbd_crm_show_snoozed` localStorage flag | [#162](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/162) |
| **36** | Snoozed-lead banner on customer detail with one-tap wake/reschedule | [#163](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/163) |
| **37** | Bulk-snooze via the existing bulk action toolbar — chunked writeBatch | [#164](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/164) |
| **39** | Snooze-aware activity feed — suppresses rep-side events on snoozed leads, keeps customer-side ones (estimate viewed, signed) | [#166](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/166) |

---

## "See + act" pattern — inline reshare buttons

After Wave 45 introduced Almost There as the fourth dashboard-home
priority widget, the next four waves locked in the inline-action
pattern across every priority surface. Same color palette, same
`stopPropagation` handling, same `PortalLinkHelpers` delegation —
the rep doesn't have to learn three different patterns.

| Wave | Surface | PR |
|---|---|---|
| **45** | New "Almost There" widget — viewed-but-uncommitted leads (W44 lastSharedAt + estimate.viewedAt without respondedAt) | [#172](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/172) |
| **46** | Inline 📞/💬/📧 buttons on Almost There rows | [#173](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/173) |
| **47** | Same buttons on Hot Leads (W29) | [#174](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/174) |
| **48** | Same buttons on bell rows (W13) | [#175](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/175) |
| **49** | Same buttons on activity-feed rows (W24) | [#176](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/176) |

The dashboard home now answers four questions, each with one-tap
follow-up:

| Question | Surface | Action |
|---|---|---|
| Where do I start? | Hot Leads | 📞 💬 📧 |
| Who almost said yes? | Almost There | 📞 💬 📧 |
| What's urgent? | Bell | 📞 💬 📧 |
| What just happened? | Activity feed | 📞 💬 📧 |

---

## Polish + cross-device

| Wave | What | PR |
|---|---|---|
| **31** | First milestone changelog (this file's first 30-wave bookend) | [#158](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/158) |
| **32** | Bulk-edit lead source + jobType via existing toolbar — common post-import cleanup ops | [#159](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/159) |
| **33** | Lead notes inline quick-add — replaces the modal flow with a textarea + Send button on customer detail. Optimistic prepend, Cmd/Ctrl+Enter shortcut | [#160](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/160) |
| **34** | Mobile quick-action bar on customer detail (≤640px) — sticky bottom Call/Text/Email/Task with iOS safe-area handling | [#161](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/161) |
| **38** | Cross-device prefs sync — kanban view, Show Prospects, Show Snoozed mirror to `users/{uid}.uiPrefs`. 10s polling diff, debounced writes, conflict resolution favors local | [#165](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/165) |

---

## Architecture notes for the second push

A few patterns that recurred:

- **Shared helper modules over duplication** — `PortalLinkHelpers`
  (W42) is the cleanest example. Three customer-detail buttons
  (W40/W41/W43), four dashboard-widget action sets (W46/W47/W48/W49),
  and the kanban context-menu items (W42) all delegate to the same
  `resolveUrl` / `copyForLead` / `smsForLead` / `emailForLead`
  surface. Single source of truth for clipboard fallbacks, SMS
  body template, mailto: encoding, and the W44 share-tracking
  side effect.

- **`stopPropagation` discipline on inline action buttons** — every
  dashboard-home row has a primary click (open the lead/customer)
  and one or more secondary actions (call/text/email). Without
  `stopPropagation`, a button click would fire BOTH the action AND
  the row navigation. The four widgets all follow the same
  pattern: `addEventListener('click', (ev) => { ev.stopPropagation();
  ... })` for SMS/Email; native `<a href="tel:...">` for Call so
  the browser's tel: handoff is the default.

- **Filter-on-read for snooze** (W35) — no cron, no scheduler.
  `snoozedUntil < now` means every filter (Hot Leads, Almost
  There, Needs Attention, bell, kanban, activity feed) just passes
  the lead through. Auto-unsnooze is implicit; the only writes are
  the user-initiated snooze/unsnooze actions.

- **Default-ON opt-outs continue** — W28's `dormantNudgeEnabled`
  check pattern (`=== false` to skip) extended to W38's
  `uiPrefs` reads where missing fields fall through to local
  defaults, not zeros.

- **Per-page-load reload guards over sessionStorage version flags**
  — pattern from the first push held up. Show-snoozed toggle (W35),
  prefs-sync (W38), and the snooze banner (W36) all use in-memory
  flags or live data instead of versioned sessionStorage.

- **Path-gated modules** — customer-page-only behaviors
  (snooze banner W36, mobile quick-action bar W34, drag-drop
  upload W30) check `window.location.pathname` and bail out
  silently on unrelated pages. Lets the same script tags ship
  everywhere without affecting non-customer surfaces.

- **W44 share tracking is a side effect** — not a separate API.
  Every share path through `PortalLinkHelpers` calls `_recordShare`
  on success, which patches `window._leads` + `window._currentLead`
  in memory and fires a fire-and-forget Firestore `updateDoc`. No
  caller has to remember to track; it just happens.

---

# Third push — Waves 51-60

The first 30 waves built the foundation. The second 20 went deeper
through three arcs (share trio, snooze system, see-+-act pattern).
The third 10 finished what the second push started + opened a new
front on customer engagement signals.

The big arcs:

1. **Share-trio universality completion** (W51, W53) — every
   priority-ish surface in the app now offers inline 📞/💬/📧.
2. **Recovery sibling for Almost There** (W54, W55) — Stale
   Shares as both a kanban filter and a dashboard widget,
   covering the no-engagement-yet recovery posture.
3. **Engagement signal pattern** (W56-W59) — portal preview
   iframe, fresh-share + fresh-view pulses, viewed-chip mirroring
   on both kanban + customer page.

---

## Share-trio universality completion

After Waves 46-49 introduced inline reshare buttons on the four
dashboard-home priority surfaces (Hot Leads, Almost There, Bell,
Activity feed), two more priority-ish surfaces remained without
the share trio. This push closed both gaps. The 📞/💬/📧
vocabulary is now everywhere a rep encounters a lead in the app.

| Wave | Surface | PR |
|---|---|---|
| **51** | Cmd+K search results — fifth and final priority surface | [#178](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/178) |
| **53** | Recent-customers dropdown (header 🕒 button) — last priority-ish surface | [#180](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/180) |

The full surface map after W53:

| Surface | Wave introduced |
|---|---|
| Customer detail buttons | W40, W41, W43 |
| Kanban context menu | W42, W43, W56 |
| Hot Leads widget | W47 |
| Almost There widget | W46 |
| Notification bell | W48 |
| Activity feed | W49 |
| Cmd+K search | W51 |
| Recent dropdown | W53 |
| Stale Shares widget | W55 |

---

## Recovery sibling for Almost There

The dashboard home now has matching recovery widgets covering
both ends of the customer-engagement spectrum:

| Surface | Wave | Signal | Posture |
|---|---|---|---|
| Almost There | W45 | Customer VIEWED, didn't respond | Close-call |
| **Stale Shares** | **W54-W55** | Customer SENT 5+ days ago, never responded | Re-nudge |

Same `compute()` logic backs both the kanban filter and the home
widget so they stay in lockstep on match criteria.

| Wave | What | PR |
|---|---|---|
| **54** | Stale Shares kanban filter button — header toggle with count badge, mirrors W25 Needs Attention pattern | [#181](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/181) |
| **55** | Stale Shares dashboard widget — mirrors W45 Almost There shape, top 5 oldest stale shares with inline reshare buttons | [#182](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/182) |

---

## Engagement signal pattern

The W44 share badge says "I sent it." This push added the
matching customer-side signal — "they OPENED it" — across both
kanban + customer page, plus a 4th shape to PortalLinkHelpers
(preview) and pulse animations for fresh activity in the last
24 hours.

| Wave | What | PR |
|---|---|---|
| **56** | Portal preview iframe modal — 4th `PortalLinkHelpers` shape (copy / sms / email / preview), surfaceable from customer page + kanban context menu | [#183](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/183) |
| **57** | Kanban fresh-share pulse animation — purple `box-shadow` halo on share badges <24h old, respects `prefers-reduced-motion` | [#184](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/184) |
| **58** | Kanban "👁 viewed today" indicator — green pill on cards when any non-responded estimate has `viewedAt`, with matching fresh-view pulse | [#185](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/185) |
| **59** | Viewed chip on customer detail header — mirrors W58 → customer page, completes the visual symmetry W52 set up for shares | [#186](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/186) |

Visual symmetry across both surfaces:

| Signal | Kanban card | Customer header |
|---|---|---|
| Share | W44 (purple) | W52 (purple) |
| View | W58 (green) | W59 (green) |

The kanban now tells a complete activity story per lead at a
glance:

| Combo | Meaning |
|---|---|
| No badges | Stagnant |
| 📤 share only | Waiting on customer |
| 📤 + 👁 | Engaged, closeable |
| 📤 old + 👁 fresh | Customer came back |

---

## Architecture notes for the third push

- **Mirroring as a feature design pattern** — kanban surfaces and
  customer-detail surfaces should show the same signals with the
  same colors and the same time bucketing. W52 + W59 are the
  customer-detail counterparts to W44 + W58. Reps switching
  between surfaces never see different shapes for the same data.

- **Same `compute()` powering multiple surfaces** — W54 + W55
  share `StaleShares.compute()` so the kanban filter and the
  dashboard widget can never drift on match criteria. Future
  recovery filters should follow this pattern rather than
  re-implementing the predicate per surface.

- **Pulse animations as fading signals, pills as lasting records**
  — W57 + W58 introduced 24h pulse animations. The pulse decays
  on its own as time passes; the underlying pill persists. Pulses
  surface fresh activity passively without requiring the rep to
  scan timestamps.

- **`prefers-reduced-motion` respected on every animation** —
  every pulse keyframe in the W57/W58 batch has a corresponding
  `@media (prefers-reduced-motion: reduce) { animation: none }`
  override. Animation is signal but never essential.

- **Iframe preview at phone-width (500px max-width)** — W56's
  modal is intentionally narrow. Most homeowners view the portal
  on mobile, so the preview should match the actual customer
  view. Reps catch missing photos / wrong status more reliably
  in the same proportions the customer sees them.

- **Dashboard-home visual rhythm holds** — six dashboard-home
  panels (Hot Leads, Almost There, Stale Shares, Bottlenecks,
  Activity feed, Today's Tasks) each follow the same 3-column
  row pattern + same panel header style. Adding new widgets
  (W55) doesn't break the visual cadence.

- **All four `PortalLinkHelpers` shapes share `resolveUrl`** —
  copy / sms / email / preview each call the same Firestore-
  first / generate-on-demand resolution path. A change to URL
  resolution semantics propagates to all four with no separate
  patches per shape.
