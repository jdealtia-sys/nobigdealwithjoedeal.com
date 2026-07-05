# CSP × generated-document audit — open questions (2026-07-05)

Follow-up to the merged CSP-dead fixes (PR #850: kanban DnD, theme fonts,
quick-add crash, deal-room rewrite). This documents the REMAINING generated-
document surfaces, what is known vs inferred, and the decisive tests. Do not
ship fixes for the SUSPECT class below without running the verification —
the inference chain (CSP inheritance into sandboxed srcdoc) is plausible but
unconfirmed, and if it were fully true, report charts would already be
visibly broken in prod.

## Verified-fixed today (PR #850)
- Dashboard inline handler attrs (kanban ondrop, fonts onload) — CSP-dead, fixed.
- /deal/<token> customer page — inline script + handlers + token inject were
  hosting-CSP-blocked; rewritten to external /pro/deal-room.js + JSON island
  + meta-tag inject.

## Serving contexts and what applies
| Context | CSP that applies | Inline `<script>` runs? |
|---|---|---|
| Hosting page (dashboard, /deal rewrite) | firebase.json `**` policy | NO (script-src-elem 'self') |
| firebasestorage.googleapis.com download | none (no CSP header) | YES |
| `window.open('') + document.write` from dashboard | INHERITED from opener | NO (if inheritance holds) |
| `<iframe srcdoc>` in dashboard | INHERITED from embedder | NO (if inheritance holds) — incl. sandboxed/opaque-origin frames per spec |
| innerHTML injection | n/a | NEVER (HTML5 spec, CSP-independent) |

## Classification of the 12 flagged generators
- **OK — storage-served standalone pages** (no hosting CSP): customer-portal.js
  portal + photo portal, share-gallery.js gallery. Their inline scripts run.
- **OK — comments only / already hardened**: rep-report-generator.js (prior
  pass externalized), signature-widget.js, dashboard-ui.js, dashboard-state.js,
  customer-bootstrap.module.js (island/comment matches).
- **FIXED**: close-board.js (deal page, PR #850).
- **SUSPECT — inherited-CSP contexts, NEEDS the verification below**:
  - nbd-doc-viewer.js: PRINT_LISTENER_SCRIPT injected into srcdoc payloads.
    Sandbox deliberately lacks allow-same-origin (H-2 anti-token-theft), so
    parent-side binding is IMPOSSIBLE — if the listener is blocked, the only
    fixes are (a) an external listener script (script-src 'self' URL works in
    srcdoc IF inherited policy allows 'self' — it does) or (b) print via the
    new-window fallback path only.
  - photo-report.js: top-bar Print/Close wiring is an inline <script>
    (deliberately avoids onclick= but is still an inline ELEMENT) — same
    srcdoc/popup contexts.
  - warranty-cert.js: popup fallback injects <script>window.print()</script>;
    degraded-not-dead (page opens, user can print manually).
  - estimate-v2-ui.js:~2633 esign overlay bootstrap — confirm its render
    context (innerHTML → script never ran anyway → dead code, not a bug).
  - ALSO: if inheritance holds, ApexCharts/report scripts inside srcdoc are
    equally blocked — checkable at a glance (do charts render in the viewer?).

## Decisive verification (60 seconds, any prod dashboard)
1. Open any generated report in the doc viewer. Do charts render? Does the
   viewer's Print button open the dialog?
2. DevTools console while doing (1): CSP violation messages name the blocked
   directive + source — that is the ground truth list.
3. Better: the CSP ships `report-uri /cspReport` — the cspReport function has
   been RECEIVING every real-world violation since the policy went strict.
   Reading its logs (Cloud Logging, filter cspReport) enumerates every broken
   surface with zero guesswork. THIS IS STEP 0 for the next session.

## Fix designs (pre-agreed, pending verification)
- srcdoc payloads: swap injected inline scripts for
  `<script src="https://nobigdealwithjoedeal.com/pro/doc-frame.js"></script>`
  (one shared external file: print listener + top-bar delegation), pattern
  proven by deal-room.js in PR #850.
- Popup-write fallbacks: opener-side wiring (same-origin window) — bind
  buttons / call w.print() from the opener, no injected script.
