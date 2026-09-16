# GDPR Storage prefix registry — four prefixes missing, and the gate that said eight

**Date:** 2026-09-08
**Scope:** `functions/integrations/user-owned.js`, `functions/integrations/compliance.js`,
`tests/smoke/auth.test.js`, new `scripts/check-storage-prefix-registry.js`
**Related:** [ORPHANED-STORAGE-ARTIFACTS-2026-08-18](ORPHANED-STORAGE-ARTIFACTS-2026-08-18.md)

---

## The defect

`STORAGE_PREFIXES` drives **both** halves of GDPR compliance:

| Half | Call site |
| --- | --- |
| Art. 15 export | `compliance.js` — `for (const prefix of STORAGE_PREFIXES)` |
| Art. 17 erasure | `compliance.js` — `bucket.deleteFiles({ prefix: prefix + '/' + uid + '/' })` |

A prefix absent from that list is absent from **both**: the user cannot obtain
those objects, and a right-to-be-forgotten request does not delete them.

Four were absent.

| Prefix | Written by | Rules block | Was it swept? |
| --- | --- | --- | --- |
| `documents/` | `document-generator.js` (client) | `storage.rules:96` | Partly — see below |
| `esign/` | `esign-envelope.js`, `esign-setup.js` | `storage.rules:119` | **Never, by anything** |
| `homeowner-uploads/` | `portal.js:940` (**admin SDK**) | **none** | **Never, by anything** |
| `pdf-renders/` | `render-pdf.js:588` (**admin SDK**) | **none** | **Never, by anything** |

The registry's own header comment said it held *"Every Storage bucket path of
the shape `<prefix>/{uid}/...` per storage.rules."* It held nine of thirteen.

## Why the existing guard never saw it

`tests/smoke/auth.test.js` asserted:

```js
assert('M-01/M-02: STORAGE_PREFIXES covers all 8 storage.rules prefixes',
  ['audio','photos','docs','portals','galleries','reports','shared_docs','deal_rooms']
    .every(p => reg.STORAGE_PREFIXES.includes(p)));
```

Two independent failure modes, both silently green:

1. **The label was wrong and nothing checked labels.** It said "all 8
   storage.rules prefixes"; `storage.rules` defined **eleven**.
2. **A subset check cannot find what nobody typed.** It only asserted the
   registry was a *superset* of that hand-maintained array. A prefix missing
   from **both** the array and the registry is structurally invisible to it —
   which is exactly what happened to all four.

This is the [silently-green-gate](SUITE-COUNT-FLOORS-2026-09-08.md) shape again:
a green streak that never had the power to redden.

## `homeowner-uploads/` — the one nobody had noticed

Not in the brief that opened this session, not in the 08-18 orphan audit, not in
any prefix list anywhere. `uploadHomeownerPhoto` writes:

- **Firestore row** → the `photos` collection, which **is** erased
  (`FLAT_USER_COLLECTIONS`)
- **Bytes** → `homeowner-uploads/{ownerUid}/{leadId}/{ts}.{ext}`, which **was
  not** in `STORAGE_PREFIXES`, and is **not** a `photos/` object so
  `LEAD_KEYED_PREFIXES` never reached it either

So an erasure request **deleted the pointer and left the image in the bucket** —
a homeowner's property photo, orphaned with nothing left pointing at it.

## `documents/` was *mostly* swept, by accident

Worth stating precisely, because it changes how urgent this one was.
`documents` is in `LEAD_KEYED_PREFIXES` (`lead-artifact-cleanup.js`), and
erasure deletes `leads/{leadId}` rows (`{ name: 'leads', recursive: true }`),
which fires `onLeadDeleted`. So most `documents/` objects *were* being cleaned —
indirectly, best-effort, through a trigger with `retry: false` and a 540 s cap,
and **blind to any object whose lead row was already gone**. Listing the prefix
makes the sweep deterministic and catches those orphans.

## The decisions (Jo, 2026-09-08)

These were put to Jo rather than patched, because widening what an irreversible
erasure destroys is a legal call, not a code cleanup.

| Prefix | Export | Erase | Reasoning |
| --- | --- | --- | --- |
| `documents/` | yes | **yes** | Same class as `docs/`; already swept per-lead, now deterministic. Historically carried permanent download tokens, where deletion is the only revocation. |
| `homeowner-uploads/` | yes | **yes** | Functionally indistinguishable from `photos/`, which is already erased — often the same roof, just submitted by the homeowner. |
| `pdf-renders/` | yes | **yes** | Server-rendered customer documents; same class. |
| `esign/` | yes | **NO — retention hold** | Executed, counter-signed contracts. GDPR Art. 17(3)(e) permits retention for the establishment/exercise/defence of legal claims. The other party's interest in a signed agreement does not end because one party asks to be forgotten. |

### The hold is disclosed, not silent

A retention hold nobody is told about is worse than no hold. Three things
changed so the carve-out is visible:

- `ERASURE_RETAINED_PREFIXES` is a named constant with the reasoning beside it,
  and `ERASURE_STORAGE_PREFIXES` is **derived** (`STORAGE_PREFIXES` minus the
  holds), never hand-maintained.
- The `audit_log` erasure receipt records `retained: [...]` — **even when
  empty**. An undocumented hold is otherwise indistinguishable from a sweep that
  silently missed the prefix, which is exactly the state this cascade was in
  before today.
- **The consent page was lying.** It promised this "removes *all* your leads,
  estimates, photos, pins, tasks, documents…". That stopped being true the
  moment a hold existed. The page now carries a derived "One exception"
  paragraph *before* the button, and the success message repeats it. Art. 17(3)
  licenses the retention; it does not license being quiet about it.

## The structural fix: derive, don't restate

`scripts/check-storage-prefix-registry.js` derives the true prefix set from
**two** sources and fails if either names one the registry omits.

**Why two.** The obvious design — parse `match /<prefix>/{uid}/` out of
`storage.rules` — would have caught `documents/` and `esign/` and **missed
`pdf-renders/` and `homeowner-uploads/` entirely**, because both are written
with the **admin SDK, which bypasses Security Rules**. Neither ever needed a
rules block; neither had one. `storage.rules` is a registry of what is *ruled*,
not of what *exists*, and treating it as the latter is the same category error
that produced the original comment.

Source B alone is no better: `galleries/`, `reports/` and `shared_docs/` have
rules blocks but no matching template write site, so a code-only derivation
would call them dead and invite their deletion. **The union is the answer.**

Measured on this branch: rules → 11, code → 10, union → **13**, registry → 13.

**Stated limit:** source B models `` `foo/${uid}/` `` and `'foo/' + uid`,
skipping concat lines that are plainly Firestore (`db.doc(`, `db.collection(`,
…). A prefix assembled some third way — `path.join(a, b)` — evades it and would
only be caught by a rules block. That is a narrower gap than the one it
replaces, not the absence of one.

### Break-tested — and against the right assertion

All five reddened the *expected* error, with the clean tree green as a control:

| Break | Assertion that fired |
| --- | --- |
| New Storage write site in code, unregistered | `brand-new-bucket/ exists but is NOT in STORAGE_PREFIXES` |
| Registry entry removed (`documents`) | `documents/ exists but is NOT in STORAGE_PREFIXES` |
| Dead registry entry added | `ghost_prefix/ … has no storage.rules block and no write site` |
| Retained prefix absent from export scope | `not_exported/ is in ERASURE_RETAINED_PREFIXES but not STORAGE_PREFIXES` |
| `ERASURE_STORAGE_PREFIXES` hand-edited | `… is not STORAGE_PREFIXES minus ERASURE_RETAINED_PREFIXES` |

Two of those five initially reported green — **the harness was at fault, not the
gate**: its mutation patterns used bare `\n` against CRLF working-tree files, so
the mutations never applied and a no-op tree passed. Recorded because a
break-test that silently fails to break is indistinguishable from a gate that
cannot fail, and this repo has shipped the latter before.

### A weak assertion found while doing it

`F-01: confirmAccountErasure GET does not trigger deletion` was
`/GET[\s\S]{0,2000}res\.status\(200\)\.send/` — a **character-distance** window.
Adding a paragraph to the consent page pushed the distance 1.9k → 2.2k and
reddened it, with no behaviour change at all. It also never tested its own
name: distance says nothing about mutation, so it would have stayed green if
someone had added a `deleteFiles` inside the branch and trimmed a comment to
stay under budget. Rewritten to slice the GET branch and assert it contains no
write calls (`.set(`, `.update(`, `.delete(`, `.add(`, `deleteFiles`,
`updateUser`, `revokeRefreshTokens`, `recursiveDelete`).

## Overlap to resolve at merge

`pdf-renders` is **also** added to `STORAGE_PREFIXES` by unpushed commit
`599d2cf8` on `claude/jolly-cannon-fb794d` (worktree `gifted-cohen-f29954`,
no open PR), which additionally ships the `pdf-renders/` rules block, a
retention reaper and the download-token fix. It is a genuine defect on `main`
today and the derived gate cannot go green without it, so it is fixed here too.
**Whichever branch lands second should drop the duplicate list entry** — the
conflict is one hunk.

Note that once that branch lands, `pdf-renders` gains a rules block and appears
in *both* derivation sources. That does not retire source B: `homeowner-uploads`
still has no block, and is still only visible because code is scanned.

## Still open

1. **`homeowner-uploads/` has no `storage.rules` block.** Its posture is
   default-deny by omission rather than by statement — the exact condition that
   hid `pdf-renders/`. Deliberately not added here to keep this change to the
   registry; the admin SDK bypasses rules either way, so this is documentation
   of intent, not a live hole.
2. **No reaper for `esign/`.** The retention hold is now deliberate, but
   "retained forever" and "retained for as long as a claim could be brought" are
   different policies. If a retention *period* is ever chosen, it belongs in a
   scheduled job, not in the erasure path.
3. **Nothing verifies the sweep against the live bucket.** Every gate here is
   static analysis of the code. A prod-side check — enumerate top-level bucket
   prefixes, diff against `STORAGE_PREFIXES` — would catch a prefix written by
   something outside the scanned tree.
