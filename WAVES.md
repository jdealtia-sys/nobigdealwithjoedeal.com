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

---

# Fourth push — Waves 61-70

The third push shipped the W56 portal preview iframe + W35 lead
snooze, but only on a couple of surfaces each. The fourth push
made both **universal**: every list-of-leads or alert surface in
the rep workflow now exposes the same five-button action row.

The big arcs:

1. **Direct actions in cmd+K + recent dropdown** (W61-W63, W67)
   — power-user keyboard surfaces get inline snooze + preview so
   a rep can search, peek, snooze, or send a portal link in two
   keystrokes without ever leaving the palette.
2. **Home widget trifecta** (W64-W66) — Hot Leads, Almost There,
   and Stale Shares all reach feature parity with cmd+K. The
   home dashboard reads as one consistent triage surface.
3. **Alert surfaces** (W68-W69) — Notification Bell + Activity
   Feed gain 🔍 + state-aware 💤/⏰. The rep can preview before
   responding to a customer-side event and snooze rep-side
   noise without leaving the alert list.

The unifying outcome: **9 surfaces × 5 buttons** in the same
order with the same colors and the same modal behaviors.

---

## Universal action row

After Waves 46-49 + 51 + 53 made the share trio (📞 💬 📧)
universal, the third push (W56) added portal preview but only
on customer.html + kanban context menu. The W35 snooze system
similarly covered only the kanban context menu + customer
detail page. Wave 61-69 finished both at once.

The rule: **every place a rep encounters a lead, the action row
reads `📞 💬 📧 🔍 💤/⏰`.** Same colors, same positions, same
modal stacking. Muscle memory transfers across all 9 surfaces.

| Wave | Surface | What landed | PR |
|---|---|---|---|
| **61** | Cmd+K palette | State-aware 💤/⏰ snooze button | [#188](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/188) |
| **62** | Recent-customers dropdown | Mirrors W61 — same snooze button | [#189](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/189) |
| **63** | Cmd+K palette | 🔍 preview button — chain previews while keeping search context | [#190](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/190) |
| **64** | Hot Leads widget | 🔍 + 💤 added to W47 share trio — first home widget at parity | [#191](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/191) |
| **65** | Almost There widget | 🔍 + 💤 — direct mirror of W64 | [#192](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/192) |
| **66** | Stale Shares widget | 🔍 + 💤 — completes the home dashboard trifecta | [#193](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/193) |
| **67** | Recent-customers dropdown | 🔍 preview to mirror W63 like W62 mirrored W61 | [#194](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/194) |
| **68** | Notification Bell | 🔍 + state-aware 💤/⏰ on W48 share rows | [#195](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/195) |
| **69** | Activity Feed | 🔍 + state-aware 💤/⏰ on W49 share rows | [#196](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/196) |
| **70** | (this milestone bookend) | WAVES.md update documenting the W61-70 arc | this PR |

Final cross-surface action-row coverage:

| Surface | Action row |
|---|---|
| Customer detail buttons | 📞 💬 📧 🔍 (full action bar) |
| Kanban context menu | 📞 💬 📧 🔍 💤/⏰ |
| Cmd+K palette | 📞 💬 📧 🔍 💤/⏰ |
| Recent-customers dropdown | 📞 💬 📧 🔍 💤/⏰ |
| Hot Leads widget | 📞 💬 📧 🔍 💤 |
| Almost There widget | 📞 💬 📧 🔍 💤 |
| Stale Shares widget | 📞 💬 📧 🔍 💤 |
| Notification Bell | 📞 💬 📧 🔍 💤/⏰ |
| Activity Feed | 📞 💬 📧 🔍 💤/⏰ |

---

## State-aware vs render-only snooze

The fourth push used two different snooze button policies
depending on the surface's filtering behavior:

| Surface | Snooze policy | Why |
|---|---|---|
| Cmd+K, recent dropdown, kanban context, customer detail | **State-aware** (💤 fresh, ⏰ snoozed) | Always shows lead regardless of snooze state |
| Hot Leads, Almost There, Stale Shares | **Render-only** (💤 only) | `compute()` filters snoozed leads — the lead never appears in the widget if snoozed |
| Notification Bell, Activity Feed | **State-aware** | Customer-side alerts/events fire even on snoozed leads (rep-side noise gets suppressed by W39, but customer-side stays) |

This split keeps the policy honest: state-aware where the
surface might genuinely show a snoozed lead, render-only where
the snooze itself causes the lead to drop off.

---

## Surface coverage scoreboard at W70

The first ten waves of the fourth push produced these
counts. Each entry below is a unique surface where the
corresponding action is reachable inline (button or menu item).

| Action | Surface count | Surfaces |
|---|---|---|
| 📞 Call | 9 | All except customer detail (which uses the action bar) |
| 💬 SMS portal link | 9 | All same as Call |
| 📧 Email portal link | 9 | All same as Call |
| 🔍 Portal preview | 9 | customer.html · kanban context · cmd+K · hot-leads · almost-there · stale-shares · recent-dropdown · notif-bell · activity-feed |
| 💤/⏰ Snooze | 9 | kanban-context · customer-detail · cmd+K · recent-dropdown · hot-leads · almost-there · stale-shares · notif-bell · activity-feed |

---

## Architecture notes for the fourth push

- **Mirroring continues to scale** — W62 mirrored W61 and W67
  mirrored W63 the way W52 mirrored W44 and W59 mirrored W58.
  The "every cmd+K change should also land on the recent
  dropdown" rule held cleanly. Future cmd+K-shaped surfaces
  should plan for the recent dropdown to follow.

- **Inline onclick vs delegated `addEventListener`** — the
  fourth push used both depending on what the existing surface
  already did. Bell rows (W68) used inline `onclick` calling
  `window.NotifBell._actionPreview('${id}')` because the
  surrounding W48 code was already inline. Cmd+K (W63) used
  delegated handlers because W51 already delegated. The lesson:
  match the surrounding pattern rather than imposing a uniform
  one — consistency *within* a file is more readable than
  consistency *across* files.

- **Modal z-index stacking holds at 99997 vs 9999/10000** — the
  W56 preview modal at z-index 99997 cleanly overlays every
  surface (cmd+K palette at 10000, dropdowns at 9999, kanban
  itself at base). The pattern: any new modal sits above 99996;
  any new dropdown sits at 9999. Don't introduce a third tier.

- **`closeDropdown` flag pattern** — the recent-customers
  dropdown click handler (W62, W67) added a `closeDropdown`
  flag that defaults to true but flips to false for snooze /
  unsnooze / preview. Share actions still close the dropdown
  (rep wants the SMS composer unobstructed); modal-opening
  actions keep it open (rep wants context underneath). New
  inline-action surfaces should adopt this pattern.

- **`render()` after unsnooze for in-place flip** — every
  state-aware snooze surface (W61, W62, W68, W69) calls a
  surface-local `render()` (or `renderRecentCustomers()`) after
  `LeadSnooze.promptUnsnooze()` resolves so the ⏰ → 💤 button
  flip happens immediately. Waiting for `nbd:data-refreshed`
  works but feels laggy on touch.

- **Color register held across all surfaces** — share trio uses
  green/blue/violet (#10b981 / #3b82f6 / #8b5cf6); preview uses
  amber (#f59e0b); snooze uses purple (#a890e8 fresh, #cab8ff
  active). These five colors map 1:1 to the five action verbs
  everywhere they appear. New action verbs should claim a sixth
  color rather than reusing one of the five.

- **Snooze policy stayed deliberate** — the "state-aware vs
  render-only" split (table above) made the policy explicit per
  surface rather than uniform. Future widgets that filter
  snoozed leads in `compute()` should render the 💤 variant
  only; future surfaces that always show all leads should go
  state-aware.

---

# Fifth push — Waves 71-80

The fourth push made snooze + preview universal across 9 list-of-
leads and alert surfaces. The fifth push went deeper into
**snoozed-lead lifecycle management**: surface the snooze
backlog, categorize each one, detect indecision, alert on
return, filter, and customize the rep's default preset. The
snooze system that started as a tiny "snoozedUntil" field in
W35 became a full lifecycle workflow.

The big arcs:

1. **Surface coverage** (W71-W72) — cmd+K now shows the snooze
   backlog when query is empty, customer page surfaces a
   "Snooze N other leads" chip for siblings on the same
   customer.
2. **Categorization + tracking** (W73-W76) — optional reasons
   tag (Insurance / Materials / etc.), `snoozeCount` field
   tracks indecision, kanban cards display reason + stale
   pills, bell fires "lead came back from snooze" alerts.
3. **Polish** (W77-W79) — reason filter chip row in cmd+K
   Snoozed section, ⭐ pin a preset as the rep's default.

The unifying outcome: a snoozed lead now has rich metadata
(when it returns, why it's deferred, how many times it's been
bumped) and the rep has dedicated tools for triaging the
backlog (cmd+K filter, ⭐ pin, expiry alerts).

---

## Surface coverage

The first two waves of the fifth push extended the snooze
backlog into surfaces that previously had no view of it.

| Wave | Surface | What landed | PR |
|---|---|---|---|
| **71** | Cmd+K palette | "Snoozed (N)" section when query is empty, sorted by returning-soonest first, top 10 | [#198](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/198) |
| **72** | Customer detail header | "💤 Snooze N other leads" chip when current customer has multiple open leads — uses W35 LeadSnooze.bulkPrompt | [#199](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/199) |

Together they close the "where's my snooze backlog?" question
from two angles: cmd+K when the rep is searching anyway, and
the customer page when the rep is mid-customer triage.

---

## Categorization + tracking

The next four waves added metadata to each snooze and surfaced
it across the existing snooze view surfaces.

| Wave | What | PR |
|---|---|---|
| **73** | Optional reason tag (Insurance / Not ready / Out of town / Materials / Other) — chip row in both modals, persists as `snoozedReason` field, surfaces in W36 banner + W71 cmd+K + W74 toast | [#200](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/200) |
| **74** | `snoozeCount` field bumped on each snooze (cumulative — not reset on unsnooze). When ≥3, surface as amber `⚠️ Snoozed 3×` indicator. New API `LeadSnooze.isStaleSnooze(lead)` | [#201](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/201) |
| **75** | Kanban card snoozed pills — purple "💤 Sep 9 · Insurance" + amber "⚠️ Snoozed 3×" pills in the kc-tags row when show-snoozed toggle is on | [#202](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/202) |
| **76** | Snooze-expired alert in notification bell. Fires when `snoozedUntil` is in the past, within 3-day SNOOZE_EXPIRY_WINDOW. Subtitle shows reason: "Was: Insurance · 2d ago" | [#203](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/203) |

Three-surface coverage of snooze metadata after W75:

| Surface | Snooze pill | Stale pill |
|---|---|---|
| Customer-snooze-banner (W36) | Title row | Title row |
| Cmd+K Snoozed section (W71) | Subtitle | Subtitle prefix |
| Kanban card (W75) | Tag row | Tag row |

W76 closes the lifecycle loop — the snooze system is now
proactive end-to-end: snooze → park → expiry alert → rep
acts (or re-snoozes, which W74 counts toward indecision).

---

## Polish

The last three waves of the fifth push focused on power-user
controls.

| Wave | What | PR |
|---|---|---|
| **77** | Reason filter chip row in W71 cmd+K Snoozed section. "All / ⚠️ Stale / Insurance / Materials / etc." Per-session state (clears on palette close), counts reflect full backlog (built before top-10 slice) | [#204](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/204) |
| **78** | ⭐ pin a default preset in the per-lead snooze modal. Pinned preset reorders to top + gets purple-tinted border. localStorage-backed | [#205](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/205) |
| **79** | ⭐ pin in bulk snooze modal — coverage parity with W78. Shared `DEFAULT_PRESET_KEY` so pinning in either modal reflects in the other | [#206](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/206) |
| **80** | (this milestone bookend) | this PR |

---

## Architecture notes for the fifth push

- **localStorage for per-device preferences, Firestore for
  per-lead state** — W37's show-snoozed toggle, W77's per-session
  reason filter, and W78/W79's pinned preset are all per-device
  preferences that don't need to sync across devices. They live
  in localStorage. By contrast `snoozedReason`, `snoozeCount`,
  and `snoozedUntil` are per-lead state that everyone touching
  the lead needs to see → Firestore. The split kept the schema
  changes minimal and the latency low.

- **Cumulative counts that resist gaming** — W74's `snoozeCount`
  does NOT reset on unsnooze. Resetting would let a rep "wash"
  the indecision signal by toggling the snooze. Keeping it
  cumulative made the signal honest.

- **Read-modify-write vs Firestore `increment` sentinel** —
  W74's snooze() bumps `snoozeCount` from the in-memory cache
  (`(existing.snoozeCount || 0) + 1`) rather than importing
  Firestore's `increment` sentinel. Reps don't snooze
  concurrently from multiple devices on the same lead, so
  non-atomic is safe. Avoiding the sentinel kept the import
  surface unchanged.

- **Self-clearing alerts** — W76's snooze-expired signal has a
  3-day window after which it self-clears. Without that, the
  bell would accumulate every expired snooze the rep hadn't
  acted on, drowning the actually-fresh alerts. After the
  window, the existing W48 stale-lead signal takes over.

- **Modal-reopen as the simplest re-render** — W78's pin click
  closes + reopens the modal rather than partial-DOM patching.
  Three reasons: (1) the modal HTML is the single source of
  truth so re-rendering removes the chance of state drift, (2)
  the implementation is shorter, (3) the visual flicker is
  imperceptible because both close + open run synchronously.
  The same pattern landed in W79.

- **Filter state local to a session, not persisted** — W77's
  reason filter clears on palette close. The reason filter is
  a triage tool for one-time backlog cleanup, not a saved
  preference. Persisting it would mean the rep opens cmd+K
  next morning and sees only "Insurance" with no obvious why.

- **Coverage waves carry the polish theme** — W79 shipped right
  after W78 to keep the "⭐ default pin" feature consistent
  across both modals. Single-modal features that ship
  partially erode trust ("does this work everywhere?"). When
  a feature lands in one modal, the polish wave to extend it
  to the other should follow within 1-2 waves.

- **Stale-snooze threshold = 3** — W74's `STALE_SNOOZE_THRESHOLD`
  is intentionally lenient. Two snoozes is "I deferred and
  re-deferred" — could be legitimate. Three is the inflection:
  the rep keeps not acting. Raising the threshold to 5 would
  make the signal too rare; lowering to 2 would fire on
  legitimate two-step deferrals. 3 feels right for this domain.

---

# Sixth push — Waves 81-90

The first five pushes were feature-driven: build the share trio,
build the snooze system, make actions universal, etc. The sixth
push pivoted to **quality**. Two parallel code reviews surfaced
real bugs hiding in the codebase — including a CRITICAL XSS in
the homeowner-facing portal generator and a HIGH regression
that had silently broken every notification bell action button
since W48.

The trigger: a single message from the user — "do anything and
everything necessary to get everything working as well as
possible across every access platform and system." The waves
that followed weren't feature work, they were the kind of fixes
real users notice but no one had filed because the failure
modes were silent.

The big arcs:

1. **Mobile + a11y polish** (W81, W84, W85) — touch targets,
   escapeHtml consistency, ARIA + Esc + initial focus on snooze
   modals.
2. **HIGH/CRITICAL bug fixes from internal review** (W82, W83) —
   bell action buttons restored after silent regression,
   snooze-system edge cases (unsnooze guard, Sunday off-by-one
   in nextMonday, lowercase terminal-stage matching).
3. **Portal hardening** (W86, W87, W88, W89) — CRITICAL XSS in
   buildPortalHTML, CORS lockdown, BoldSign URL validation,
   iframe sandbox, photo lightbox rebuild for mobile, user-
   scoped notes/tasks queries.

The unifying outcome: the system that already worked on paper
now works **for real**, on mobile, behind iOS notches, with
screen readers, with hostile data, and across every customer-
facing surface.

---

## Mobile + a11y polish

Quality work that compounds the W61-W70 universal-action-row arc.

| Wave | What | PR |
|---|---|---|
| **81** | Touch target audit — bumps W46-W79 inline action buttons (📞 💬 📧 🔍 💤 ⏰) to 36×36 minimum on touch devices via `@media (hover: none)` override. Desktop sizing unchanged. CSS-only — no JS source edits across 7+ surfaces | [#208](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/208) |
| **84** | Preserve `selectedReason` across W78/W79 ⭐ pin-click reopens — UX friction fix from review. + defensive `escapeHtml(String(c.count))` on the W77 filter chip count for consistency | [#211](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/211) |
| **85** | ARIA + Esc + initial focus on the W35/W37/W73/W78/W79 snooze modals. `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-pressed` on pin buttons, `aria-hidden` on decorative emoji, Esc closes, first preset auto-focuses | [#212](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/212) |

---

## HIGH + CRITICAL bug fixes from internal review

A code-reviewer agent run on the W71-W79 snooze-lifecycle
changes surfaced 3 HIGH issues plus a CRITICAL regression in
the notification bell.

| Wave | What | PR |
|---|---|---|
| **82** | 🚨 CRITICAL: bell action buttons (W48 share trio + W68 preview/snooze + W76 expiry) had been silently invisible since W48. `renderItem` gated the action row on `n.leadId`, but `buildNotifications` never set leadId on any push. Every rep had been seeing bell rows without inline action affordances since W48 shipped | [#209](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/209) |
| **83** | HIGH bundle: (1) `unsnooze()` dead Firestore guard would TypeError instead of throwing a clean message, (2) `_nextMonday()` returned tomorrow on Sundays — Sunday-working reps lost a week of intended deferral on every "Next Monday" click, (3) `customer-sibling-snooze` TERMINAL set missed lowercase `complete` so done deals could appear in the sibling-snooze count | [#210](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/210) |

The bell regression is the kind of bug that would never show
up in smoke tests — the buttons just don't appear. There's no
error, no warning, no broken state. Reps and managers had been
seeing partial-functionality bell rows for dozens of waves and
no one knew. This is exactly why structured code review on data
flow shape (not just style) matters.

---

## Portal hardening

A second code-reviewer pass on the customer-facing portal
flows surfaced TWO CRITICAL XSS vulnerabilities plus a stack
of HIGH issues. The portal is what end customers (homeowners)
see — every bug there is a real customer experience bug.

| Wave | What | PR |
|---|---|---|
| **86** | 🚨 CRITICAL: XSS in `buildPortalHTML`. Every interpolated rep-controlled lead field (name, address, damageType, insCarrier, scheduledDate, crew, photo URLs/names, task titles) was unescaped. Sister function `generatePhotoPortal` correctly used `esc()` — `buildPortalHTML` was the asymmetric oversight. A malicious or compromised rep, or injection from data-import / OCR / direct Firestore write, could ship arbitrary `<script>`/`<img onerror=...>` to homeowners. Fixed by lifting `esc()` to the top of `buildPortalHTML` and wrapping every interpolation site | [#213](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/213) |
| **87** | Portal hardening: (1) `getHomeownerPortalView` CORS lockdown — was `cors: true`, now uses the same allowlist as rep endpoints, (2) BoldSign `signEmbedUrl` regex-validated to start with `https://app.boldsign.com/` before iframe embed, (3) preview iframe sandbox attribute prevents `window.parent` access from the embedded portal HTML | [#214](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/214) |
| **88** | Photo lightbox rebuild. Old lightbox used per-img inline-style toggles — three real mobile bugs: no dismiss without re-tapping (homeowners got stuck), image clipped under iOS notch, state drift across multiple photos. New shared overlay with × close button + safe-area padding + Esc + backdrop dismiss | [#215](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/215) |
| **89** | `generatePortal` notes/tasks subcollection queries now scope to current user via `where('userId', '==', window._user.uid)` — matches the pattern already used for photos + estimates. Defense-in-depth: in a multi-rep company a single lead can have notes/tasks from manager handoffs / adjuster strategy / cross-rep collaboration. Tasks already render to homeowners; narrow the fetch | [#216](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/216) |
| **90** | (this milestone bookend) | this PR |

---

## Architecture notes for the sixth push

- **Code review on data flow shape catches what tests don't** —
  the W82 bell regression had been live for ~30 waves without
  detection. Smoke tests verify per-function behavior; the bug
  was at the integration shape (push without leadId → render
  gate fails). A code-reviewer pass focused on "does the data
  reach the renderer in the form the renderer expects?" found
  it in 30 seconds.

- **Asymmetric escape is the most common XSS pattern** — W86's
  `buildPortalHTML` had a sister function (`generatePhotoPortal`)
  that DID escape correctly. The bug wasn't "didn't know to
  escape" — it was "missed the escape on this branch but not
  the other." Patterns that exist in only one of two parallel
  surfaces are the highest-risk audit targets.

- **Mobile-first means safe-area-inset-first** — W88's lightbox
  rebuild explicitly used `env(safe-area-inset-*)` for the
  close-button position and overlay padding. iOS notches and
  home indicators silently break "just works on a phone"
  layouts unless the CSS opts in. The pattern: any
  `position:fixed` overlay should use safe-area padding by
  default.

- **Defense-in-depth queries even when rules cover you** —
  W89's `userId` scope on notes/tasks doesn't add security
  beyond what Firestore subcollection rules already enforce,
  but it does reduce the fetched data to only what the current
  rep wrote. If a future render path surfaces aggregated notes,
  the data has already been narrowed at the fetch layer.

- **Modal a11y is a first-class concern, not a polish item** —
  W85 added ARIA + Esc + initial focus to the snooze modals
  AFTER they shipped (W35, W73, W78). New modals from now on
  should land with `role="dialog"`, `aria-modal`, `aria-labelledby`,
  Esc handler, and initial focus from day one. The deferred
  add was the easy path; baseline a11y on first ship is the
  right path.

- **CSS overrides via `@media (hover: none)` scale to all
  surfaces at once** — W81 fixed touch targets across 7+ JS
  source files without editing any of them. The override
  approach + class-attribute selectors meant one change,
  zero risk of regressions in desktop sizing. New action-row
  classes added in future waves automatically inherit the
  touch-target floor as long as they match the established
  selector pattern.

- **`cors: true` is almost never the right default** — W87's
  CORS lockdown was a one-character fix (`cors: true` →
  `cors: CORS_ORIGINS`) that closed an information-disclosure
  vector. The "intentionally open — homeowner-facing" comment
  in the original code was the rationalization, not the
  requirement. Audit every Cloud Function with `cors: true`
  and ask whether the actual call site needs the openness.

- **External URLs in iframes need allowlist validation** —
  W87's `signEmbedUrl` validation prevents a future BoldSign
  API change from accidentally giving us an attacker-controlled
  iframe origin. Pattern: any URL that comes back from a
  third-party API and gets embedded in an iframe should be
  regex-validated against the expected domain before it
  reaches the client.

---

# Seventh push — Waves 91-100

The sixth push was quality-driven: bug fixes and security
hardening triggered by code-reviewer audits. The seventh push
returned to feature work but kept the rigor — small, focused
waves with strong cross-surface coverage, single sources of
truth, and graceful upgrade paths from the existing UX.

Two parallel arcs:

1. **Engagement scoring** (W91-W96) — productize the existing
   W44/W57/W58 share + view + respondedAt signals into a single
   tier (✅ → 🔥 → 👀 → 📨 → 🌱) and surface it on every
   list-of-leads + alert + filter surface.
2. **Message templates library** (W97-W99) — saved canned
   SMS / email messages with placeholder tokens, picker flow
   in the send path, and ⭐ default-pin to skip the picker for
   power users.

Both arcs share a single-source pattern: one compute function
(`CustomerEngagementScore.computeTier`, `TemplatesLibrary.apply`)
backs every consumer surface. The waves themselves are mostly
about wiring — the hard work is making the data flow deterministic
across N surfaces, not the per-surface UX.

---

## Engagement scoring

The CRM already collected three signals (W44 share, W57/W58
freshness, W58 viewed, respondedAt) but didn't aggregate them.
Reps had to mentally combine three separate badges. This arc
reduces that to a single tier the rep glances at to know whether
to call THIS lead right now.

The tier ladder (highest signal wins):

| Tier | Label | Trigger | Color |
|---|---|---|---|
| 4 | ✅ Responded | Any estimate has `respondedAt` | Gold |
| 3 | 🔥 Hot | Viewed + (fresh share <24h OR multi-view) | Orange |
| 2 | 👀 Viewed | Any estimate viewed | Green |
| 1 | 📨 Sent | Share sent, not yet viewed | Violet |
| 0 | 🌱 New | No signals | (hidden) |

| Wave | Surface | What landed | PR |
|---|---|---|---|
| **91** | Customer detail header | `CustomerEngagementScore.computeTier()` + chip in meta-row next to W52/W59 chips | [#218](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/218) |
| **92** | Kanban card | Tier badge as kc-tag pill alongside W44 share + W58 viewed pills | [#219](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/219) |
| **93** | Kanban header | "🔥 Hot first" sort toggle. Each column reorders descending by tier; stable secondary sort by original index | [#220](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/220) |
| **94** | Dashboard home | Cohort widget — five horizontal bars proportional to tier counts. Excludes terminal stages | [#221](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/221) |
| **95** | Notification bell | Fresh-view alert (6h window) when a customer opens an estimate. Self-clearing, severity high | [#222](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/222) |
| **96** | Needs Attention filter | "hot-but-cold" reason — tier ≥ 3 + no rep activity 24h+. Highest-priority signal | [#223](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/223) |

Final cross-surface coverage at W96:

| Surface | What the rep sees |
|---|---|
| Customer page | 🔥 Hot chip in header meta-row |
| Kanban card | 🔥 Hot pill in tag row |
| Kanban (sort on) | Hot leads at top of every column |
| Dashboard cohort | Tier distribution at a glance |
| Notification bell | "🔥 Customer viewing your estimate" within 6h |
| Needs Attention | Hot-but-cold leads counted in the badge |

---

## Message templates library

Reps were retyping the same follow-up text dozens of times per
week. The W41/W43 PortalLinkHelpers prefilled bodies were
fixed strings — no per-rep customization, no variants for
different stages, no follow-up text patterns. This arc adds
a per-device template library with a picker flow.

| Wave | What | PR |
|---|---|---|
| **97** | `TemplatesLibrary` data layer + management modal — list/get/save/remove/apply/openManager. Seeds 3 defaults (mirrors W41/W43 bodies) so reps get a no-change baseline. Token substitution: `{firstName}`, `{portalUrl}`, `{repName}`, etc. | [#224](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/224) |
| **98** | `pickAndRender(channel, ctx)` picker integrated into `smsForLead` + `emailForLead`. 0 templates → fallback. 1 template → apply directly (zero friction). 2+ → picker. Cancel aborts send, "Use default" falls through to W41/W43 | [#225](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/225) |
| **99** | ⭐ default-template pin per channel. Pinned templates skip the picker even with 2+ saved. Single-default-per-channel invariant enforced by `setDefault`. Mirrors the W78 snooze preset pin shape | [#226](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/226) |
| **100** | (this milestone bookend) | this PR |

The seeded templates reproduce the W41/W43 prefilled bodies
exactly. Reps with the seeds-only baseline see no behavioral
change — same text, same composer. Reps who add 2+ templates
trigger the picker; reps who pin a default skip the picker
again. **The UX scales with rep usage**: zero waves of
breaking change for non-adopters, three levels of
sophistication for power users.

---

## Architecture notes for the seventh push

- **Single compute function = single source of truth across N
  surfaces** — `CustomerEngagementScore.computeTier` is called
  from 6 surfaces in the W91-W96 arc and `TemplatesLibrary.apply`
  is called from 2 entry points in W97-W99. When tier-scoring
  rules change (e.g., the Hot threshold becomes "viewed within
  48h" instead of 24h), one edit propagates to every surface.
  Avoid duplicating compute logic at the consumer layer.

- **Path-gated UI render, ungated compute** — `customer-engagement-score.js`
  uses `IS_CUSTOMER_PAGE` to gate the chip rendering, but the
  `computeTier` function is exported regardless of path so other
  surfaces (kanban, cohort widget, bell, Needs Attention) can
  call it. Pattern: gate the side effects (DOM render, event
  listeners) at module init, not the pure functions.

- **Stable secondary sort by original index** — W93's "Hot first"
  toggle uses decorate-sort-undecorate where the secondary sort
  key is the lead's pre-sort index. Same-tier leads preserve
  their input order. The result reads as "Hot leads bubble up;
  everything else stays put" — much less jarring than a full
  re-shuffle that disturbs same-tier ordering.

- **Self-clearing time-windowed alerts** — W76 (snooze-expired)
  and W95 (fresh-view) both use a fixed-duration window (3 days
  / 6 hours) after which the signal disappears even if the rep
  doesn't dismiss it. Without the window, the bell would
  accumulate every alert in history. After the window, longer-
  lived signals (stale-lead, stale-share) take over so the rep
  still sees the lead — just at lower priority.

- **Highest-priority "needs attention" reason wins** — W96's
  `hot-but-cold` check runs BEFORE the existing stale-stage /
  overdue-task / stale-estimate reasons. A hot-but-cold lead
  would eventually fire stale-stage too, but the more actionable
  reason ("this customer just engaged") supersedes the symptomatic
  one ("this stage is dragging"). Pattern: when a filter has
  multiple match reasons, name the root cause, not the downstream
  symptom.

- **Seed defaults that match existing behavior preserve trust** —
  W97's three seeded templates reproduce the W41/W43 prefilled
  bodies exactly. Reps who never touch the management UI see
  zero behavioral change — same SMS body, same email subject.
  The library is opt-in for variety. New features that add a
  layer between the user and a familiar flow should default to
  "no observable difference" until the user explicitly invests.

- **Picker friction scales with collection size** — W98 picks
  the right behavior based on count: 0 → fallback, 1 → direct,
  2+ → picker. W99 adds a fourth axis: pinned default → direct
  even with 2+. Reps with 1 template per channel never see the
  picker; reps with 5 templates see the picker every time
  unless they pin a default. The friction grows linearly with
  the rep's investment in the feature.

- **Single-invariant CRUD methods** — `TemplatesLibrary.setDefault`
  enforces the single-default-per-channel rule by clearing the
  flag on every other template of the same channel during the
  same write. Callers can't accidentally end up with two
  defaults. Pattern: invariants belong in the API method that
  could violate them, not in the UI that calls the method.

- **Seven milestones, one consistent shape** — W30, W50, W60,
  W70, W80, W90, W100. Each milestone has a 3-arc summary, per-
  wave PR-linked tables, and ~6-8 architecture notes. The shape
  is now the codebase's standard documentation rhythm — every
  10 waves of focused work get the same treatment. Repeatable
  format makes it easier to write and easier to scan later.
