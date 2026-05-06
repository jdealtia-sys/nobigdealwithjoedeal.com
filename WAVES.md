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
