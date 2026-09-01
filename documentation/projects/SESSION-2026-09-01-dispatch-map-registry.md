# Session 2026-09-01 — Rock 4 / Tranche 3 slice T3-M (dispatch maps go registry-first)

> The unblock that [T3-A slice 1](SESSION-2026-08-31-t3-a-slice1.md) identified
> as the highest-leverage next move. Two name-string dispatch maps now resolve
> `__NBD_CALL_REGISTRY` before `window`, which turns **17 of 36** permanently
> stuck handlers into ordinary conversion candidates. Two of them converted here
> as proof the path works.

## The problem this removes

`_NBD_TOGGLE_FNS` and `_NBD_MODAL_CLOSE_FNS` (`dashboard-state.js`) map a
`data-target` key to a handler **name string**. `dashboard-ui.js` then did:

```js
const fnName = _NBD_MODAL_CLOSE_FNS[target];
const fn = window[fnName];
```

A string lookup on the global object cannot see a module-scoped function. So any
handler reachable only through one of these maps was **structurally** stuck on
`window` — no amount of per-name three-way proof could free it, because the
blocker was the dispatcher, not the name. Prior tranches recorded several of
these as MUST-STAY (`closeMobileInspection`, `closeMobileCreatePopover` in
2c-4b), which read like a property of the handlers. It was never that. It was a
property of the map.

## The change

A second resolver in `dashboard-ui.js`, alongside the existing
`_nbdResolveCall`:

```js
function _nbdResolveMapped(fnName) {
  if (!fnName) return null;
  const reg = window.__NBD_CALL_REGISTRY;
  if (reg && typeof reg[fnName] === 'function') return reg[fnName];
  const fn = window[fnName];
  return typeof fn === 'function' ? fn : null;
}
```

Both branches (`action === 'toggle'`, `action === 'closeModal'`) use it.

**The deliberate difference from `_nbdResolveCall`: no `_NBD_CALL_ALLOWLIST`
gate.** There, `fnName` arrives from page markup (`data-fn=`) and the allowlist
is the security boundary that stops arbitrary markup invoking an arbitrary
global. Here the name never came from the page — the delegate read a
`data-target` key and looked it up in a curated in-code map, so **the map is the
boundary**. This is not a shortcut: **35 of the 36** map names are absent from
`_NBD_CALL_ALLOWLIST` (only `closeQuickAddLead` appears in both, and that entry
serves its separate `data-fn` dispatch), so adding the gate would have killed
nearly every toggle and modal-close button at once. A smoke assertion pins the
absence of that gate, with the reason, so it does not get "fixed" later.

### Why it could ship as a no-op

Before touching anything: the intersection of {36 names in the two maps} and
{154 `__NBD_CALL_REGISTRY` keys} was **empty**. So `reg[fnName]` was undefined
for every pre-existing name and resolution fell straight through to
`window[fnName]`, byte-for-byte the old behaviour. Had even one name been in
both, flipping the order would have silently swapped which implementation runs —
a behaviour change disguised as a refactor. That check was the gate on the whole
slice.

## What converted

Two handlers in `dashboard-actions.js`, both previously MUST-STAY *only* because
of the map, now registry-only and off `window`:

| Name | Reached by | Was |
|---|---|---|
| `closeMobileInspection` | `_NBD_MODAL_CLOSE_FNS.mobileInspection` | `window.closeMobileInspection` |
| `closeMobileCreatePopover` | `_NBD_MODAL_CLOSE_FNS.mobileCreatePopover` | `window.closeMobileCreatePopover` |

`toggleMobileCreatePopover` and `openMobileInspection` keep their exports —
both are read cross-IIFE by 2c-4a/2c-4b wrappers, which the map change does not
help.

**Also deleted: three unguarded forward-reference re-exports** that slice 1's
sweep missed because its regex only matched the `if (typeof X …)` form:

```js
window.mobileNav = mobileNav;
window.toggleMobileMore = toggleMobileMore;
window.closeMobileMore = closeMobileMore;
```

All three are defined in `dashboard-ui.js` (2231 / 2250 / 2259) as **top-level**
declarations — confirmed by brace depth, not indentation, since the house style
puts IIFE bodies at column 0 too. `dashboard-ui.js` loads first
(`dashboard.html:5457` before `:5458`), so each line was `window.X = window.X`.

Slice 1 also left a wrong header over them reading "OWN EXPORTS — names this
file actually defines". It doesn't define any of the three. Corrected.

## Verification

The static tests cannot prove a dispatch change, so the harness from slice 1 was
extended to **call the real shipped resolver**. `_nbdResolveMapped` is a
top-level declaration, so a browser-context `page.evaluate` can invoke it
directly for every entry in both maps and record what it resolves to.

Against the emulator-backed dashboard:

```
names=85 present=85 missing=0 | mapEntries=36 unresolved=0 resolver=present
resolution route: { "window": 34, "registry": 2 }
```

That is exactly the intended shape: 34 unchanged, the 2 conversions coming from
the registry, nothing unresolved. Spot checks:

- `__map_MODAL_mobileInspection -> resolved via registry`
- `__map_MODAL_mobileCreatePopover -> resolved via registry`
- `mobileNav`, `toggleMobileMore`, `closeMobileMore` → still `function` on
  window after their re-export lines were deleted

Other gates: `check-js-syntax` (471 clean), `run-test-manifest` (44/44 —
[the gate that bit slice 1](SESSION-2026-08-31-t3-a-slice1.md)),
`check-inline-html-scripts`, `check-site-integrity` (235 pages, 0 failures),
`check-vault-index`, **smoke 3485 passed / 0 failed**, E2E wiring audit
419 controls / 0 DEAD / `pageErrors: []`.

### Two test-side traps this change sets

Both were live before being caught, and both would have failed **silently**:

1. **`dashboard-actions-audit.spec.js`'s `toggle` / `closeModal` branches**
   checked `has(TOGGLES[target])`, i.e. window only. Any converted handler would
   audit as a false `DEAD`. Now checks registry-then-window, mirroring the
   delegate. This is the *third* branch of that spec to need the same fix — the
   `zoneColor` branch needed it in T3-0. **The remaining nine dedicated-action
   branches still carry it** (`kanbanView`, `filterByStage`, `mapSidebar`,
   `mapOverlay`, `tradeChip`, `crmToolsMenu`, `selLineType`, `settingsTab`,
   `navSection`) and each will need it the first time its target converts.
2. **The same spec's inter-tap cleanup** called
   `window.closeMobileCreatePopover()` behind a `typeof` guard to dismiss the
   m-create sheet between forced taps. With the name off window that becomes a
   silent no-op, the backdrop stays up at z-index 1900+, and **every later tap
   lands on the backdrop instead of its target — the whole sweep goes green
   while testing nothing.** Now resolves registry-first. Worth remembering as a
   class: a test's own helpers are consumers too, and a green suite is not
   evidence that the suite still exercises anything.

## A third dispatcher, found by auditing the change

An adversarial review of the diff turned up something the slice's own framing
had missed: `modalBackdropClose` is a **third** dispatcher over the same
`closeXxx` namespace, and the only one where the handler name comes **straight
out of the page**:

```js
const fnName = el.dataset.target;   // raw function name, from markup
const fn = window[fnName];          // no allowlist, no map, no gate
```

Two problems, both now fixed here. It was **ungated** — markup could name any
window global and the delegate would call it, which is precisely what
`_NBD_CALL_ALLOWLIST` exists to prevent on the `data-fn` path. And it was still
window-only, so it would have broken silently the moment its single caller
(`closeCardDetailModal`, on the card-detail backdrop) was converted. It is now
gated on `_NBD_MODAL_CLOSE_FNS`'s values — the same curated boundary
`action='closeModal'` already trusts — and resolved through `_nbdResolveMapped`.

**The @audit e2e spec is structurally blind to this branch**: `modalBackdropClose`
is in its `UI_ACTIONS` set but has no `case` in its switch, so it falls to
`default` and always reports `ok`. The snapshot harness now checks the real
markup against the real gate instead.

### Corrections the audit forced on this session's own work

Recorded because they are the kind of error that survives into the next session:

- The `_nbdResolveMapped` header comment claimed the map ∩ registry intersection
  "is EMPTY". True *before* the change; this same commit registers two map
  names, so it is 2 of 36 after. The comment described the pre-state as the
  post-state and **contradicted the smoke assertion added beside it**. Rewritten
  to say both, and to spell out that the two files are now hard-coupled: ship
  `dashboard-actions.js` without the resolver and two modals become impossible
  to close.
- A code comment cited "the live before/after snapshot" as proof the three
  unguarded re-exports were inert. The only pair on disk belongs to slice T3-A
  part 1, which never touched those lines — it proves the *part-1* sweep was
  inert and nothing about this one. Reworded to cite the after-state check that
  was actually run.
- The two converted names were pinned only in a `dashboard-actions.js`-scoped
  assertion, not in the `T1_NAMES` docs/-wide walker, so a re-export added in
  any other file would have passed unnoticed. Added, and the walker's comment —
  which still listed both as MUST-STAY — corrected.
- `dashboard-actions-audit.spec.js`'s header said "opt-in; not part of the
  pinned CI e2e job". **False**: `@audit` is one of six required shards in the
  Authed E2E matrix. Corrected in place.

## What this unblocks — measured, not estimated

Of the 36 names in the two maps, **17 are now reachable only through their map**
and are convertible immediately; 19 still have another blocker.

**Convertible now (17)** — 2 done here, the other 15 grouped by owning file, one
slice each:

| File | Names |
|---|---|
| `dashboard-ui.js` (8) | `toggleHdrMobileMenu`, `toggleKanbanFullscreen`, `toggleSidebarCollapse`, `closePhotoModal`, `closeDocViewer`, `closeTips`, `closePropertyIntelModal`, `closePropertyIntelConfirmModal` |
| `maps-routing.js` (6) | `toggleDraw`, `toggleHistoricalImagery`, `toggleMapLayer`, `toggleVoiceControl`, `closeComparisonMode`, `closeHistoricalImagery` |
| `crm-portal-bridge.js` (1) | `closeDeletedDrawer` |
| `dashboard-actions.js` (2) | ✅ both done in this slice |

Note these are auto-globals declared at file top level, so converting them means
IIFE-wrapping regions of large files — real work, not a one-line move.

**Still blocked (19)** — each has a bare cross-file call or a `window.X` read
that the map change does not touch. The heaviest:
`closeCardDetailModal` (8 bare calls), `closeMobileJobDetail` (3 + a window
read), `closeTaskModal` (3 + 1), `closeLeadModal` (1 + 4).
`closeMobileMore` / `toggleMobileMore` are here too — the map was necessary but
not sufficient for them.

## Follow-up found in passing, not done

A sweep for unguarded `window.X = X;` self-exports where `X` is defined in
another file turned up **11 more in `crm.js:49–110`** (re-exporting
`crm-pipeline.js` and `crm-leads.js` globals; all REDUNDANT — those files load
first). Same class as the 86 deleted in slice 1 and the 3 deleted here, but a
different module, so a different slice.

The same sweep flags 19 lines in `customer-bootstrap.module.js:50–68` as "no
declaration found anywhere". **Those are a false alarm — do not act on them.**
They re-export ES-module `import` bindings to `window`, which is the deliberate
Firebase compat surface the plan lists under keep-as-API. The sweep only looks
for `function`/`const` declarations and cannot see imports.
