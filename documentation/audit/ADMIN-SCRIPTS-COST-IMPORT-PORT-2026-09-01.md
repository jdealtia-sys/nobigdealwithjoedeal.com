# The `scripts/_admin.js` migration is COMPLETE — the two cost importers (2026-09-01)

**Trigger:** the last two scripts in `scripts/` on firebase-admin's dead v14
namespace — `import-cost-rotation.js` and `import-job-template-costs.js`, named
as "next tranche" by
[ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01](ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01.md) §6.

**Outcome in one line:** both ported; **`scripts/` now holds zero legacy-namespace
calls, so the migration that started at nineteen scripts is finished**; the
Timestamp question was settled *affirmatively* this time (these two really do
write server timestamps) and cost nothing; a CI tripwire that had only ever
watched `functions/` now watches `scripts/` too; and the brief's own
verification recipe turned out not to work here — a dry run exercises **none**
of the ported code.

Companion notes:
[ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01](ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01.md)
(the method, tranche 4) ·
[JOB-TEMPLATE-COST-LEAK-2026-08-18](JOB-TEMPLATE-COST-LEAK-2026-08-18.md) and
[CATALOG-UNDER-COST-2026-08-19](CATALOG-UNDER-COST-2026-08-19.md) (why these
scripts exist at all).

---

## 1. Why these two outlived four migration tranches

Every earlier tranche hunted a `require`-time failure: a bare
`require('firebase-admin')` from a directory with no `node_modules`, dying with
`MODULE_NOT_FOUND` before reaching Firestore. **These two resolve fine.** Each
carried its own `createRequire(functions/package.json)` fallback — one of the
duplicated resolvers `_admin.js` was written to collapse — so they never threw
that error and never showed up in the sweep.

Their break is three v14-removed spellings apiece, all of them **runtime-only
and all of them past the dry-run exit**. Measured against the real `functions/`
install (firebase-admin **14.3.0**), each reintroduced on its own so the failure
is attributable rather than inferred:

| Old spelling | Line (cost-rotation / jt-costs) | What actually happens on 14.3.0 |
| --- | --- | --- |
| `admin.apps.length` | 198 / 172 | **exit 1** — `TypeError: Cannot read properties of undefined (reading 'length')` |
| `admin.firestore()` | 201 / 175 | **exit 2** — `FATAL: write failed — admin.firestore is not a function` |
| `admin.firestore.FieldValue.serverTimestamp()` | **227 / 201** | **exit 2** — `FATAL: write failed — Cannot read properties of undefined (reading 'FieldValue')` |

> The brief located the third row at lines 167/141. Those are `console` strings;
> the real call sites are 227 and 201. Worth stating because the whole point of
> this tranche is that the break is *further down the file than you expect*.

`admin` on v14 exports only `initializeApp, getApp, getApps, deleteApp,
applicationDefault, cert, refreshToken, FirebaseError, FirebaseAppError,
AppErrorCode, SDK_VERSION`. Everything else is `undefined`.

**The first failure impersonates a documented refusal.** `admin.apps.length`
throws at top level, so node exits **1** — and both docstrings define exit 1 as
"validation failed / refused". An operator running the real import would have
read a crash as the script deliberately declining.

## 2. The Timestamp question: opposite answer, same method

§1 of the tranche-4 note disproved the inherited "v14 breaks Timestamps"
warning **for scripts that read no timestamps**. That finding does not transfer:
these two genuinely **write** a server timestamp —
`<bookField>ImportedAt` and `jtImportedAt`. So it was re-asked from scratch, and
answered three ways.

**(a) v14 removed the accessor, not the class.** On a v12 install,
`admin.firestore.FieldValue` is `===` the `FieldValue` from
`firebase-admin/firestore` *and* `===` the one from `@google-cloud/firestore`.
Same on v14 for the two that survive. The old spelling and the new spelling were
always reaching the identical object:

| | `admin.firestore.FieldValue` | `firebase-admin/firestore` | `@google-cloud/firestore` |
| --- | --- | --- | --- |
| v12.7.0 | ✔ | `===` | `===` |
| v14.3.0 | *gone* | ✔ | `===` |

**(b) The wire form is byte-identical.** `ServerTimestampTransform.toProto()` in
both `@google-cloud/firestore` 7.11.6 (under v12) and 8.7.1 (under v14) returns
exactly `{ fieldPath, setToServerValue: 'REQUEST_TIME' }`, and the class carries
no other state — `Object.getOwnPropertyNames(sentinel)` is `[]` in both.

**(c) The stored value is identical.** Both spellings were written into one
Firestore emulator and read back through a single handle:

```
v12  → ctor=Timestamp | instanceof Timestamp=true | own props=["_nanoseconds","_seconds"]
v14  → ctor=Timestamp | instanceof Timestamp=true | own props=["_nanoseconds","_seconds"]
same stored TYPE : true      same property shape : true      both server-resolved : true
```

**And nothing reads either field.** A repo-wide grep for `ImportedAt` returns
exactly two hits: the two write sites. No consumer, no rules clause, no test.
`firestore.rules` governs `catalogCosts/{companyId}` at document level only
(`allow read` / `allow write`, no field validator, no `hasOnly`), so an extra
`*ImportedAt` key cannot lock a tenant out of their own cost book — which was
the failure mode the docstrings name.

> One incidental v12/v14 difference, unrelated to the port: v12
> `initializeApp()` parses the ADC private key **eagerly** and throws on a
> malformed one; v14's `applicationDefault()` is lazy. It only surfaced because
> the emulator harness below mints a fake service account.

## 3. The dry run verifies nothing — measured

The brief prescribed "dry-run, read back, then apply", the sequence that worked
in tranche 4. **It does not work on these two.** Both scripts exit at
`if (!WRITE)` — `import-cost-rotation.js:189`, `import-job-template-costs.js:161`
— which is *above* the firebase-admin require. Proved with a `Module._load`
spy rather than by reading:

```
DRY RUN — no write. Re-run with --yes to import.
SPY: ./_admin was NEVER loaded
```

A green dry run on these scripts says the seed parsed and validated. It says
nothing about whether the script can reach Firestore, authenticate, or write.
Both docstrings now carry that warning.

That is a **property worth keeping**, not a defect: the require sits below the
exit deliberately, so a dry run needs nothing installed at all. The port
preserves the position rather than hoisting the import to the top of the file.

## 4. How it was actually verified: the emulator, with prod made unreachable

The only path that exercises the ported lines is `--yes`, which writes. So the
write was pointed at the Firestore emulator, with the credential deliberately
incapable of reaching prod:

- `GOOGLE_APPLICATION_CREDENTIALS` → a **locally generated** RSA service account
  pinned to project `demo-nbd-costport`, plus `GCLOUD_PROJECT` /
  `GOOGLE_CLOUD_PROJECT` set to the same demo id. The emulator short-circuits
  auth, so the key is never exchanged — and no real ADC is in scope for the run.
- Fixtures are **synthetic and index-derived**, generated into gitignored
  `.local/`: a 66-row labor worksheet run through `scripts/cost-rotation.js`,
  and an 84-entry `jtCosts` overlay built from the live template library through
  the real `validateJtCostOverlay`. No real cost figure was involved.

Both scripts completed and were read back with an **independent** admin handle,
not their own summary line:

```
READBACK  fields   : laborOps, laborOpsImportedAt, version
READBACK  laborOps           : map, 66 keys
READBACK  laborOpsImportedAt : Timestamp 2026-09-01T12:43:57.361Z (seconds=…, nanos=…)

READBACK  fields   : jtCosts, jtImportedAt, version
READBACK  jtCosts            : map, 84 keys
READBACK  jtImportedAt       : Timestamp 2026-09-01T12:43:58.708Z (seconds=…, nanos=…)
```

The 84 matches the docstring's "84 figures that used to live in
`docs/pro/js/job-templates-data.js`" — the fixture reproduces the real cutover's
shape.

**Nothing was written to `nobigdeal-pro`.** These scripts write tenant-owned
cost data and their docstrings say Jo runs them; the emulator gives the same
proof without that.

### Negative control

The E2E above passes vacuously if it does not really exercise the ported lines,
so each was reverted **alone** and re-run — the table in §1 is that experiment's
output. All three are load-bearing.

> A first attempt at this control patched the source with `python`, which is not
> installed here. Every patch silently no-opped and all five cases printed
> `exit=0` — a negative control that "passed" by testing nothing. Rewritten in
> node with a patcher that exits 9 when its anchor text is missing.

## 5. No loader-stub trap here — and how that was established

Tranche 4's blocking find was `tests/legacy-documents-audit.test.js` stubbing
the module loader on the literal string `'firebase-admin'` at two sites, which
the port would have silently unhooked. The same search was run for these two:

| Probe | Result |
| --- | --- |
| `Module._load` / `_resolveFilename` stubs anywhere in `tests/` | **two files only** — `address-audit-script.test.js`, `legacy-documents-audit.test.js`, both already on `'./_admin'` and both still green (11/11, 14/14) |
| Anything in `tests/` requiring or spawning these two scripts | **none** |
| References to them anywhere in `tests/` | 4 hits in `catalog-cost-privacy.test.js`, `cost-basis-registry.test.js`, `cost-basis-ledger.js` — all comments and `console.log` guidance strings |

So there was no stub to port. There was also **no test at all** for either
script, which is what §6 addresses.

## 6. The guard that should have caught this, and now does

`tests/smoke/functions.test.js` has carried a "firebase-admin v14: legacy
namespace is dead" section since the port began — and it **walked `functions/`
only**. That is the structural reason `scripts/` drifted for nineteen files and
why these two survived four sweeps.

`scripts/` is clean as of this PR (verified: zero matches for
`admin.<service>` / `admin.apps` across `scripts/*.js` after comment-stripping —
every remaining mention is prose explaining the dead pattern), so it can be
pinned. Two assertions, with a real division of labour:

| Assertion | Catches | Proved by negative control |
| --- | --- | --- |
| sweep of `scripts/*.js` for the legacy namespace | a bad **spelling** returning | reintroduce `admin.firestore.FieldValue` → `✗ … — import-cost-rotation.js (admin.firestore)` |
| by-name: the two importers require `./_admin` and carry no `createRequire` | the duplicated **resolver** returning | swap `_admin` for a local `createRequire` while keeping modular calls → sweep still passes, by-name fails |

Neither assertion alone covers both regressions, which is why there are two.

Deliberately **not** extended to `scripts/`: the bare-`require('firebase-admin')`
allowlist. `scripts/` has no `node_modules`, so resolving out of `functions/` is
correct there — `import-catalog-costs.js` legitimately does exactly that.

## 7. Corrections to the tranche-4 note

- §6 recorded the stale `NODE_PATH` / Timestamp boilerplate as surviving in
  `scripts/backfill-pins-to-knocks.js` and the workflow. It is in **six**
  scripts: `backfill-calcom-dropped-leads.js`, `backfill-lead-stageRole.js`,
  `backfill-leads-phoneDigits.js`, `backfill-photos-variants.js`,
  `backfill-pins-companyId.js`, `backfill-pins-to-knocks.js` — all still
  carrying `export NODE_PATH=/path/to/fa12/node_modules`, the instruction §2
  showed *defeats* `_admin`'s single resolver.
  (`audit-legacy-documents.js` and `backfill-legacy-addresses.js` also match a
  grep for the phrase, but those are the corrected docstrings quoting it in
  order to refute it.)
- Neither script in **this** tranche carried that boilerplate, so the
  docstring-correction step was a no-op here — checked, not assumed.
- `scripts/bootstrap.sh:71` also exports `NODE_PATH`, but at
  `functions/node_modules` — the correct install, so harmless.

## 8. Open items this session did not close

| Item | Where | Why it is left |
| --- | --- | --- |
| ~~`firebase-admin@12` pinned via `NODE_PATH` for the scheduled audit~~ | `.github/workflows/address-audit.yml` | **CLOSED in a follow-up PR — see §10.** |
| Stale `export NODE_PATH=<v12>` docstrings | the six scripts in §7 | Doc-only, no runtime effect, and touching six files would bury this port's diff. |
| Neither cost importer has a unit test | `tests/` | §6 pins their *wiring*; nothing exercises their refusal logic (`--force`, `--correction`, the unrotated-seed gate). `tests/address-audit-script.test.js` is the template if it is ever wanted. |
| Neither importer echoes the target **project** | both scripts | They print `catalogCosts/{companyId}` but not which Firestore. The project comes silently from ADC, and `_admin` exports `projectId()` for exactly this. Left out to keep the port pure. |

## 9. Gates run

`check-js-syntax.js` (471 files clean) · `tests/smoke.test.js` (**3497 passed,
0 failed**, including the new tripwire) · `tests/catalog-cost-privacy.test.js`
(126/126) · `tests/address-audit-script.test.js` (11/11) ·
`tests/legacy-documents-audit.test.js` (14/14) · live emulator E2E of both
scripts' `--yes` write path with independent read-back.

## 10. Follow-up: the scheduled audit is off the v12 pin (separate PR)

`.github/workflows/address-audit.yml` installed `firebase-admin@12` into a
scratch dir and exported `NODE_PATH` at it, on the two claims the tranche-4 note
disproved. By 2026-09 the pin was the thing most likely to break the job, so it
is gone.

**The fix is not "delete the `NODE_PATH` line."** The workflow never installed
`functions/` deps at all — it relied entirely on the scratch tree. Remove only
the pin and `_admin`'s fallback resolver has nothing to resolve *to*, and the
audit dies with `MODULE_NOT_FOUND` on the next scheduled run. So the scratch
install was replaced with the repo's canonical `cd functions && npm ci` step
(the one `ci.yml` already uses, with the same `npm install` fallback and npm
caching keyed on `functions/package-lock.json`, which pins **14.3.0**).

Both halves demonstrated on a tree in the runner's exact post-install state
(`functions/node_modules` present, none at the root or in `scripts/`):

| Condition | `require.resolve('firebase-admin')` from `scripts/` | Which install decides |
| --- | --- | --- |
| No `NODE_PATH` (new) | throws `MODULE_NOT_FOUND` | falls back to `functions/` → **14.3.0** ✅ |
| `NODE_PATH` at the v12 scratch (old) | resolves to `…/nbd-fa12/node_modules/firebase-admin` | **12.7.0 — `functions/` never consulted** ❌ |

Then the workflow's final step was rehearsed end to end against the emulator on
the unpinned path, seeding leads to drive the gate **both ways** — because a
scheduled gate that can only go green is the failure mode this workflow's own
header warns about:

| Fixture | Verdict | Exit |
| --- | --- | --- |
| one `legacyMangled` address present | `FAIL — 1 address(es) are broken, not merely thin.`, offending record named in the output | **1** |
| addresses clean | `PASS — no mangled or blank addresses remain.` | **0** |

---

**The `scripts/_admin.js` migration is finished.** Nineteen scripts had the dead
pattern; `scripts/` now has none, `tests/smoke/functions.test.js` fails if one
comes back, and the last `NODE_PATH` override that could have re-split the
resolver in CI is gone.
