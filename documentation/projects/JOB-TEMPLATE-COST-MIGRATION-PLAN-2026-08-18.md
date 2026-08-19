# Job-template cost migration — implementation plan (2026-08-18)

Verbatim output of the `job-template-cost-migration` design workflow (8 agents:
1 mapping pass, 3 independent designs, 3 adversarial attacks, 1 synthesis).

**All three initial designs were killed by the attack phase**, both times on
money-math data loss. The synthesis below is the corrected plan — read the two
fatal findings in §1 before touching anything, because they are counter-intuitive:
omitting a cost key is WORSE than emitting an explicit zero, and reopening a saved
estimate already re-prices it today.

Context and the leak measurements: [JOB-TEMPLATE-COST-LEAK-2026-08-18](../audit/JOB-TEMPLATE-COST-LEAK-2026-08-18.md)

Designs considered: Job-template costs join the tenant cost book (catalogCosts/{companyId}.jobItemCosts) (L) · Adopt-Then-Strip: jtCosts on the existing tenant cost book (L) · priceKey + tenant-owned jobTemplateCosts, with a blocking "Needs price" state (L)

Attack verdicts: survives=false, survives=false, survives=false — i.e. none survived as written.

---
## The plan

I re-ran every load-bearing claim against the real files before writing this. The measurements below are mine, not transcribed.

---

## 1. Which design, and why

**Take Design 2's storage choice, Design 1's test discipline, and neither design's cost-emission semantics — because all three designs get the emission wrong, and two of them get saved-estimate reopen wrong.**

Design 2's blast-radius argument is the only one that holds up under measurement: `catalogCosts/{companyId}` already exists, `firestore.rules:1061-1066` already governs *every field* of that document, `catalog-costs.js` already loads at `script-loader.js:146` — fourteen entries ahead of `job-templates-data.js` at `:170` — and `'job-templates': ['estimates']` at `:248` is the only bundle entry point, so there is no page where job templates load without the cost book. That buys the whole runtime model (warm parse-time cache, cold hydrate, `nbdRetryOffline`, tenant-keyed `nbd_`-prefixed cache that `purgeAccountStorage` already drops, dotted-path REPLACE writes) for free and requires **zero rules changes** — and a rules typo is the failure mode that locks live tenants out of their own money data.

But **all three designs are fatal as written on the same two points, and the attacks are correct on both.** I verified by executing the real bundle:

**(a) "Omit the keys, never emit 0" fabricates prices on 14 of 84 items.** `estimate-logic-engine.js:803` computes `const laborId = item.laborId || inferLaborId(item)` *before* the `item.laborCost != null` test, and `inferLaborId` (:561-573) falls through to `LABOR_BY_SUB[item.category]`. `customLineItem` passes `category: custom.category || 'custom'` straight through. Measured category census of the 84 custom items: `gutters` 6, `ventilation` 5, `downspout` 1, `trim` 1, `soffit` 1 — **14 items** land on live keys in `LABOR_BY_SUB` (`estimate-logic-engine.js:448-457`). Executed on the real stack:

> **Cost figures redacted 2026-08-18.** The original table paired each item's
> real `materialCost`/`laborCost` with its retail. `documentation/` sits in the
> same public repo as `docs/`, so a plan for un-publishing those numbers must not
> publish them itself — in a *more* legible form than the minified source, no
> less. The template ids below are enough to re-derive the table locally from
> `docs/pro/js/job-templates-data.js` while the values are still there; the
> retail deltas are kept because retail is publishable by design.

| item | retail today | retail with keys omitted | inferred via |
|---|---|---|---|
| Attic insulation baffles (`jt_vt_soffit_intake_retrofit`) | **142.50** | **500.00** | `NBD_LABOR:LAB INST-BV` |
| Gutter seam & end-cap reseal (`jt_mt_gutter_plan_visit`) | **87.50** | **3.65** | `LAB INST-GTR5` |
| Downspout elbows & straps (`jt_gi_downspout_only`) | **155.25** | **38.70** | `LAB INST-DSP` |
| Exterior trim paint (`jt_sf_refresh_combo`) | **289.50** | **390.00** | `LAB INST-FSC` |
| Bath exhaust roof cap (`jt_vt_bath_fan_termination`) | **117.50** | **25.00** | `LAB INST-BV` |

That is a confidently wrong number wearing a "Cost not set" badge — strictly worse than the `$0.00` the omission was designed to avoid, and it re-derives the cost basis from `estimate-labor-catalog.js`, a file that is *still public*. **Emit explicit `materialCost: 0, laborCost: 0`.** Measured: with explicit zeros every JT custom line resolves `labSource: 'explicit'`, `retail 0`, no inference. Carry the "unknown" signal in a separate `costUnset: true` field that presentation reads and the engine ignores.

**(b) Saved estimates re-price themselves on reopen and then overwrite the customer doc.** `estimate-v2-ui.js:3013-3018` rebuilds `state.scope` from **codes only** — the persisted `materialCostPerUnit`/`laborCostPerUnit` are discarded. `getCurrentEstimate()` (:1679-1693) then does `cat.find(s.code)` against the live `NBD_XACT_CATALOG.byCode`, which for `JT *` codes is whatever `job-templates.js:400-402` just registered. The saved-numbers replay (`_reconstructEstimateFromSaved`, :2877) returns `null` for any pre-3A doc (`doc.materialMarkupPct == null`), and `state._reopenedClean` is flipped false at **17 sites** (`:1122, 1145, 1153, 1188, 1208, 1220, 1261, 1285, 1291, 1608, 1638, 1877, 1887, 3598, 3625, 3675`) — county, mode, any measurement edit, any scope edit, any tier click. `window._editingEstimateId` is set at :3029 so the next save **updates the same doc**. So: open an old estimate containing JT rows on a device with no book, nudge one measurement, save → the persisted cost basis is overwritten with zeros in Firestore. This is a pre-existing hole (a rep editing a forked template's costs already does this today); the strip turns it from rare into universal.

So the plan is: **jtCosts on the existing `catalogCosts/{companyId}` doc, keyed `jt-<slug(templateId)>-<index>` (the key `job-templates.js:384` already computes), explicit-zero emission, and a mandatory prerequisite PR that makes reopen carry the saved cost basis.** I rejected Design 3's `priceKey` — it is a genuinely better key, but it adds a frozen-slug-list failure class and turns a pure-deletion data diff into an add-and-delete diff across 49 minified lines. Deduping is a follow-up, not a leak fix.

---

## 2. Implementation checklist, in order

### PR-A — reopen preserves the saved cost basis (prerequisite, ships and deploys FIRST)

This PR contains **no leak change**. It is independently correct and it is what makes PR-B safe.

**A1. `docs/pro/js/estimate-v2-ui.js` — `rehydrateFromSaved`, replace the `state.scope` map at :3015-3018:**

```js
      .map((r) => ({
        code: r.code,
        // Carry the SAVED cost basis onto the scope entry. Without this, the
        // first post-reopen edit re-resolves the line from the LIVE catalog
        // (getCurrentEstimate → cat.find(code)) and the next save overwrites
        // the customer doc at the new number. Matters most for 'JT *' codes,
        // whose catalog entry is rebuilt from a tenant cost book at boot.
        savedCost: (Number.isFinite(Number(r.materialCostPerUnit)) &&
                    Number.isFinite(Number(r.laborCostPerUnit)))
          ? { materialCost: Number(r.materialCostPerUnit),
              laborCost:    Number(r.laborCostPerUnit) }
          : null,
        overrides: Object.assign(
          (r.qtyOverride != null ? { qty: Number(r.qtyOverride) } : {}),
          (r.note ? { note: String(r.note) } : {})
        )
      }));
```

**A2. `docs/pro/js/estimate-v2-ui.js` — `getCurrentEstimate()`, replace the `items` map body at :1683-1691:**

```js
    const items = state.scope.map(s => {
      const base = cat.find(s.code);
      if (!base) return null;
      let item = base;
      // A reopened line keeps the cost basis it was SAVED at — the catalog is
      // a source of defaults for NEW lines, not a re-pricer of signed work.
      if (s.savedCost) item = Object.assign({}, item, s.savedCost);
      const ov = s.overrides && s.overrides.qty;
      if (ov !== undefined && ov !== null && ov !== '') {
        item = Object.assign({}, item, { _qtyOverride: Number(ov) });
      }
      return item === base ? base : item;
    }).filter(Boolean);
```

**A3.** Apply the same `savedCost` overlay to the `triTierTotals` path (`:1912-1933`) and the fallback tier calc at `:3120-3121` — both call `cat.find(s.code)` bare and will show the non-selected tier cards re-priced otherwise.

**A4. New test `tests/estimate-reopen-cost-basis.test.js`:** in the existing vm sandbox, build a saved-doc fixture with a `JT *` row at mat 5 / lab 15, mutate `NBD_XACT_CATALOG.byCode['JT …']` to 0/0 (simulating an unpriced boot), run `rehydrateFromSaved` → flip `_reopenedClean = false` → `getCurrentEstimate()` → assert the line still resolves at 5/15. Second case: a pre-3A doc (`materialMarkupPct` absent) does the same. Register in `tests/ci-manifest.json` `wired-individually`.

---

### PR-B — the leak fix

**B1. `functions/job-template-cost-logic.js` (NEW).** Pure CommonJS, no Firebase imports, structural mirror of `functions/catalog-cost-logic.js`. Exports:
- `JT_PRIVATE_KEYS = ['materialCost', 'laborCost']`
- `SEED_VERSION = 1`
- `jtKey(templateId, index)` — **the one definition** of `'jt-' + slugify(templateId) + '-' + index`; client, both scripts and all tests import it. `slugify` is copied verbatim from `job-templates.js` and pinned by a test.
- `extractJtCosts(tpl)` → `{[key]: {materialCost, laborCost}}` or **`null` when the template carries no cost data** (the no-invented-zeroes rule from `extractProductCosts`)
- `stripJtCosts(tpl)` → the shape the published file must have
- `hasJtPrivateFields(tpl)`
- `buildJtCostOverlay(templates)` → `{version, jtCosts}`
- `validateJtCostOverlay(overlay, publicTemplates, opts)` — two-mode (shape-only when `publicTemplates == null`; full mode asserts every value finite and `>= 0` and **at least one > 0 per key**). This is where the "at least one cost > 0" invariant lands after it leaves the public data file.
- Header states explicitly: **no `defaults` block** — JT items are `tier: 'any'` and carry no labor policy, so there is no company-wide mode to derive; the absence is a decision.

**B2. `scripts/extract-job-template-costs.js` (NEW).** Transcribe `scripts/extract-catalog-costs.js`: `--from <git-ref>|worktree`, `--out` default `.local/jt-cost-seed.json` (`.gitignore:60` already excludes `.local/`, and `catalog-cost-privacy.test.js` §3 already asserts that). `execFileSync('git', ['show', ref + ':docs/pro/js/job-templates-data.js'])` → vm-load into a `window` sandbox → `buildJtCostOverlay` → validate against the **current working-tree** template set → print `84 entries / 146 non-zero values` → exit 1 on validation failure.

**B3. `scripts/import-job-template-costs.js` (NEW).** Transcribe `scripts/import-catalog-costs.js` including its `arg()` flag-is-not-a-value guard and companyId regex. `--company <id>` **required**, **dry run is the default**, `--yes` to write, **refuses over a doc that already holds `jtCosts` unless `--force`** (Firestore `{merge:true}` deep-merges nested maps, so a re-import would silently revert tenant edits — same reasoning as `catalog-costs.js:289-331`). Writes dotted paths `jtCosts.<key>` via `updateDoc`, falling back to `setDoc(..., {merge:true})` for a first write. `firebase-admin` resolved from `functions/` + `GOOGLE_APPLICATION_CREDENTIALS`. Header carries the precedent's sentence: **every other tenant gets nothing, on purpose.** Jo runs it; Claude does not.

**B4. `scripts/strip-job-template-costs.js` (NEW).** Textual codemod producing the B5 diff, plus `--check` (asserts zero `materialCost`/`laborCost` occurrences in the working-tree file) for the pre-push gate.

**B5. `docs/pro/js/job-templates-data.js`.** Delete `materialCost` and `laborCost` from all 84 `custom` blocks. **Measured: 49 of 179 lines change** (one line per template; 84 items; 146 non-zero values). Remaining custom key set is exactly `{name, desc, unit, qty, category}` — the exactly-one-of `{code}`/`{custom}` contract at `tests/job-templates.test.js:291-294` is untouched. Rewrite the header comment to point at `catalogCosts/{companyId}.jtCosts` and `functions/job-template-cost-logic.js`.

**B6. `docs/pro/js/catalog-costs.js` — four surgical edits, no fork.**
- `:101` — `return (parsed && (parsed.costs || parsed.jtCosts)) ? parsed : null;`
- `:262` — `return (data && typeof data === 'object' && ((data.costs && typeof data.costs === 'object') || (data.jtCosts && typeof data.jtCosts === 'object'))) ? data : null;`
- **`:397-404` — move `await adoptLocal()` OUT of the `else` branch.** This is not cosmetic. With the widened `readBook`, a tenant holding `jtCosts` but no product `costs` would take the `if (remote)` branch and **permanently skip `adoptLocal()`** — the one-time upgrade that lifts a tenant's product costs out of per-device localStorage. `adoptLocal`'s own guard at `:344` (`book.costs` non-empty) already handles the already-adopted case, so calling it unconditionally after the branch is strictly correct and closes the hazard.
- Add: `jtCosts` read/write alongside `costs` in `writeEntries` (prefix `'jtCosts.'`), a `jobItem(key)` accessor, `recordJobItem(key, entry)`, and `pushToJobTemplates(book)` called beside `pushToLibrary` at `:385` and `:401` → `JobTemplates.applyJtCostSeed()`. Bump `__sentinel` to `'nbd-catalog-costs-v2'` (and the guard at `:63`).
- Header gains a dated JOB TEMPLATE COSTS section in the existing voice.

**B7. `docs/pro/js/job-templates.js` — `customLineItem` (:363-375) becomes:**

```js
  function customLineItem(custom, templateId, itemIndex) {
    const key = 'jt-' + slugify(templateId) + '-' + itemIndex;
    let mat = null, lab = null, costSource = null;
    const cc = window.NBDCatalogCosts;
    const entry = (cc && typeof cc.jobItem === 'function') ? cc.jobItem(key) : null;
    if (entry) {
      mat = Number(entry.materialCost); lab = Number(entry.laborCost);
      costSource = 'book';
    } else if (custom.materialCost != null || custom.laborCost != null) {
      // Legacy: a template forked BEFORE the strip still carries embedded
      // costs in users/{uid}/jobTemplates. Read them; adoption lifts them
      // into the company book on next hydrate. DELETE THIS BRANCH once
      // telemetry shows no tenant hits it. (2026-08-18)
      mat = Number(custom.materialCost) || 0; lab = Number(custom.laborCost) || 0;
      costSource = 'legacy-template';
    }
    const unset = (costSource === null);
    return {
      code:         customCode(templateId, itemIndex),
      name:         custom.name || 'Custom item',
      description:  custom.desc || '',
      category:     custom.category || 'custom',
      unit:         custom.unit || 'EA',
      // EXPLICIT ZERO, NEVER OMITTED. resolveLineItem computes
      // `laborId = item.laborId || inferLaborId(item)` BEFORE testing
      // `item.laborCost != null` (estimate-logic-engine.js:803), and
      // inferLaborId falls through to LABOR_BY_SUB[item.category]. Omitting
      // the key routes 14 of these 84 items (gutters/ventilation/downspout/
      // trim/soffit) to a PUBLIC labor rate — measured: "Attic insulation
      // baffles" prices at $500 instead of $142.50. An explicit 0 keeps
      // labSource 'explicit' and prices at 0, which is what "unknown" must
      // look like to the engine. `costUnset` is what the UI reads.
      materialCost: Number.isFinite(mat) ? mat : 0,
      laborCost:    Number.isFinite(lab) ? lab : 0,
      costUnset:    unset,
      costSource:   costSource,
      tier:         'any',
      source:       'job-template'
    };
  }
```

Also in this file:
- `registerCustomItems` (:377-407): carry `costUnset` onto both the `EstimateBuilderV2.CATALOG[key]` entry and the `NBD_XACT_CATALOG.byCode[line.code]` entry.
- **NEW export `applyJtCostSeed()`** — re-runs `registerAllCustomItems()` (already exported at `:1009`, already documented LAST-WRITE-WINS at `:383-386`, already called from four sites) and calls `JobTemplatesUI.clearBandCache()` if present.
- `saveCustom` (:268-296): strip `custom.materialCost`/`laborCost` from the `clean` clone at `:271` **before** `persistCustoms`, and forward them to `NBDCatalogCosts.recordJobItem()`. This stops forking re-embedding cost data into `users/{uid}/jobTemplates`.
- `duplicate()` (:298-306): `copy.id = genId(...)` mints a NEW id → new keys → the duplicate would silently lose its costs. Copy the source's book entries onto the new keys via `recordJobItem`. If the write is refused (a `sales_rep`), the duplicate shows "Cost not set" — never a silent 0.
- `resolveSelection` (:638-648): push `'N item(s) need a cost — set your cost book or price them manually'` into the existing `warnings[]` array (already surfaced at `job-templates-ui.js:1633`). The `unitPriceOverride` branch at `:642-648` is **untouched** — it already sets `materialCost = 0` explicitly, so it neither leaks nor trips inference.

**B8. `docs/pro/js/job-templates-ui.js` — read-only surfacing only.**
- `priceBand(tpl)` (:505-526): return `''` when any resolved line has `costUnset`.
- Proposal table (:1286-1296): render `—` for `costUnset` lines regardless of the numeric 0.
- Per-item editor row (:1479-1498): a `Cost not set` badge.
- Footer/insert banner: `N of M items have no cost set — type a $/unit per line`.
- Export `clearBandCache` on `window.JobTemplatesUI`.
- **No cost input in this PR.** See §4.

**B9. `docs/pro/js/estimate-logic-engine.js` — one pass-through field only.** Add `costUnset: !!item.costUnset` to `resolveLineItem`'s return object (`:826-851`) and a `costUnsetCount` tally on the rollup. **No math change** — the markup/OH&P block and the explicit-cost branches at `:786-799`/`:803-818` stay exactly as they are, so `Σ retailTotal == retailBeforeOHP` still holds and no downstream reader (`estimate-finalization`, `estimate-supplement`, `invoice-pipeline`, `profit-tracker`) sees a shape change.

**B10. `docs/pro/js/script-loader.js` — no file-list change.** `catalog-costs.js` is already at `estimates` position 3 (`:146`), fourteen ahead of `job-templates-data.js` (`:170`), and `'job-templates': ['estimates']` (`:248`) is the only entry point. Cache-bust bumps only: `catalog-costs.js?v=1→v=2`, `job-templates-data.js?v=1→v=2`, `job-templates.js?v=2→v=3`, `job-templates-ui.js?v=3→v=4`. Extend the load-order comment at `:137-142` to note that `catalog-costs` also feeds the JT custom-item bridge.

**B11. `firestore.rules` — COMMENT ONLY.** `match /catalogCosts/{companyId}` at `:1061-1066` already governs every field of the document including the new `jtCosts` map. Add to the comment block at `:1043-1060`: `jtCosts` is named, and the scoping split is stated — template **definitions** stay uid-scoped (`users/{uid}/jobTemplates`, `:854-856`) because a fork is personal; template **costs** go company-scoped because money-bearing pricing policy is tenant-wide config a `sales_rep` must not rewrite for everyone.

---

### The exact test changes

**`tests/job-templates.test.js` — five edits.**

**(1) LOAD_ORDER + fixture book (`:130-140`).** The harness has no `window.db` and no `_resolveCompanyKey`, so it **is** "a tenant with no cost book". Run the suite in two passes over the same file, driven by a module-level flag:

```js
// A TENANT COST BOOK FIXTURE. Values are INVENTED (flat 1/2) and live in
// tests/ only — never under docs/. It exists because §4's cost-leak trap and
// §8's scale floor are both cost-DEPENDENT and go vacuous or fail outright
// once the public data file carries no costs. Measured: flat {1,2} clears
// every scale floor; without it jt_ex_siding_replace_elevation resolves 2525
// against a 3750 floor and §8 goes red.
const JT_FIXTURE_BOOK = {};   // populated after JT_DATA loads: jtKey(t.id,i) -> {materialCost:1, laborCost:2}
```
Install it as `win.NBDCatalogCosts = { jobItem: (k) => JT_FIXTURE_BOOK[k] || null }` **before** `job-templates.js` is evaluated for the priced pass, and as `undefined` for the bare pass.

**(2) §1 shape validation — replace the `custom` branch at `:315-328` with:**

```js
    } else { // custom
      const c = it.custom;
      const qty = Number(c.qty);
      if (typeof c.name !== 'string' || !c.name.trim()) eCustom.push(label + ' custom name empty');
      if (typeof c.unit !== 'string' || !c.unit.trim()) eCustom.push(label + ' custom unit empty');
      if (!Number.isFinite(qty) || qty <= 0) eCustom.push(label + ' custom qty must be > 0 (got ' + c.qty + ')');
      // 2026-08-18: cost data is TENANT-OWNED (catalogCosts/{companyId}.jtCosts).
      // A cost key in this PUBLISHED file is the leak this migration closed —
      // see documentation/audit/JT-COST-LEAK-2026-08-18.md. The old assertion
      // here ("costs >= 0, at least one > 0") REQUIRED the leak to be present;
      // the "at least one > 0" invariant now lives in validateJtCostOverlay(),
      // enforced at extract time AND again at import time.
      if ('materialCost' in c) eCustom.push(label + ' custom carries materialCost — cost data is tenant-owned');
      if ('laborCost' in c)    eCustom.push(label + ' custom carries laborCost — cost data is tenant-owned');
      nCustomScanned++;
    }
```

and replace the report line at `:364` with:

```js
ok('custom items: name/unit non-empty, qty > 0, NO cost keys (tenant-owned)', eCustom.length === 0); listOffenders(eCustom);
ok('custom-item guard is non-vacuous (' + nCustomScanned + ' custom items scanned)', nCustomScanned >= 80);
```

The non-vacuity counter is mandatory — without it the inverted assertion passes trivially if the custom items ever vanish. Measured today: `nCustomScanned === 84`.

**(3) §4 cost-leak trap (`:488-498`).** Run `checkPayload` under the **priced** pass so `materialTotal > 0` and the `r.total > r.materialTotal + r.laborTotal + 0.005` guard keeps biting, plus a new non-vacuity assertion:

```js
ok(label + ': cost-leak trap was non-vacuous (' + nMaterialRows + ' material-bearing rows checked)', nMaterialRows > 0);
```

Without this the trap goes silently vacuous under a zero-cost design — which is exactly how it would rot.

**(4) §8 scale floor (`:766-779`) — NOT mentioned in any of the three designs, and it breaks.** Measured: with costs stripped, `jt_ex_siding_replace_elevation` resolves `total 2525 <= floor 3750` under **both** the omit and explicit-zero designs. Split it: the `qsum > 0` half is cost-independent and runs in **both** passes; the `sTotal > scaleFloor` half runs in the **priced** pass only, with a comment naming why.

**(5) §9 registration (`:815-819`).** The current assertion compares the registered `NBD_XACT_CATALOG` entry against the data file's `custom.materialCost` — a comparison with no operands after the strip. Replace with two assertions covering both directions:

```js
// bare pass — the harness IS a tenant with no cost book
ok(rLabel + ': no book ⇒ registered entry prices at explicit ZERO and is flagged unset',
  !!rFound && rFound.materialCost === 0 && rFound.laborCost === 0 && rFound.costUnset === true,
  rFound && ('got m=' + rFound.materialCost + '/l=' + rFound.laborCost + ' unset=' + rFound.costUnset));

// THE INFERENCE TRAP. estimate-logic-engine.js:803 resolves laborId BEFORE
// testing laborCost != null, so an ABSENT laborCost routes 14 of these 84
// items to LABOR_BY_SUB → a public NBD_LABOR rate (measured: baffles price
// at $500 instead of $142.50, wearing a "Cost not set" badge). An explicit
// 0 is what keeps labSource 'explicit'. This assertion is the lock.
const rResolved = JT.resolveSelection([{ templateId: rt.id }], { tier: 'better' })
  .lines.find(l => l.code === rLine.code);
ok(rLabel + ': no book ⇒ engine does NOT infer a labor rate (labSource stays explicit)',
  !!rResolved && rResolved.laborCostPerUnit === 0 &&
  !/^NBD_LABOR:/.test(String(rResolved.laborSource || rResolved.labSource || '')));

// priced pass — the tenant's own numbers reach the bridge end to end
ok(rLabel + ': book ⇒ registered entry carries the TENANT cost, unset cleared',
  !!rFoundPriced && nearly(rFoundPriced.materialCost, 1) &&
  nearly(rFoundPriced.laborCost, 2) && rFoundPriced.costUnset === false);
```

Untouched: `:291-294` (exactly-one-of `{code}`/`{custom}` — the custom blocks survive, minus two keys), `:824-852` (name-collision, name-only), `§5(c)` override at `:650-676` (`unitPriceOverride` is cost-independent and already zeroes `materialCost`; it now doubles as the regression test for the primary no-book escape hatch — add a comment saying so).

**`tests/catalog-cost-privacy.test.js` — three edits.**

**(1) `STRICT_FILES` (`:144-149`) — exact replacement:**

```js
const STRICT_FILES = [
  'pro/js/product-data.js',
  'pro/js/roofivent-catalog.js',
  'pro/js/catalog-costs.js',
  'pro/js/product-library.js',
  // 2026-08-18: job-templates-data.js shipped 84 custom line items carrying
  // materialCost/laborCost (146 non-zero values, 49 of 179 lines) on a public
  // URL and on raw.githubusercontent.com. Adding it to this list ALONE catches
  // NOTHING — measured: STRICT_RES[0] is /(?<![.\w])["']?cost["']?\s*:\s*-?\d/,
  // lowercase `cost` behind a lookbehind that rejects a preceding word char, so
  // "materialCost":40 scores ZERO hits. The named-cost pattern added to
  // STRICT_RES below is what actually bites; this entry keeps it in scope.
  'pro/js/job-templates-data.js',
];
```

**(2) `STRICT_RES` (`:78-85`) — append:**

```js
  [/(?<![.\w])["']?(?:material|labor)Cost["']?\s*:\s*-?\d/, 'named cost literal (materialCost/laborCost)'],
```

**(3) Layer-4 tree-wide sweep — add a THIRD cost-basis regex beside `COST_BASIS_RE` and `COST_BASIS_ABBREV_RE` (`:165-170`) and OR it into `scanCostBasis` (`:176`):**

```js
// Third spelling of the same shape (2026-08-18). cost/labor → mat/lab →
// materialCost/laborCost. Each recurrence is the argument for sweeping on
// SHAPE rather than maintaining a list of spellings.
const COST_BASIS_NAMED_RE = /(?<![.\w])["']?materialCost["']?\s*:\s*-?\d[\d.]*\s*,\s*["']?laborCost["']?\s*:\s*-?\d/;
```

**Measured against the live tree:** 49 line hits in `job-templates-data.js` today, **0 after the strip**. The only other published file it touches is `estimate-builder-v2.js`, which is **already** in `KNOWN_UNMIGRATED` — so no new unexpected-file failure. Add `'pro/js/job-templates-data.js'` to the migrated-catalogs assertion at `:305`. Add **no** `KNOWN_UNMIGRATED` entry: that list carries a still-leaking non-vacuity assertion at `:301-305`, and a fully-migrated file would fail it immediately.

**Do NOT add `estimate-labor-catalog.js` to `KNOWN_UNMIGRATED` in this PR.** I measured all three regexes against it: **zero matches** (its shape is `rate:` + `crewSize`/`hoursPerUnit`, a fourth unswept spelling). Adding it would fail the `:301-305` non-vacuity assertion on merge. It goes in the audit note as follow-up debt.

**`tests/job-template-cost-seed.test.js` (NEW)** — mirrors `tests/catalog-cost-seed.test.js`'s four sections: (1) lossless split, `JSON.stringify`-equal both ways on an inline 3-template fixture, plus `hasJtPrivateFields() === false` across all 107 real templates; (2) `validateJtCostOverlay` mutants (non-finite, negative, both-zero, unknown key, version mismatch, orphan key → **warning**, not error, matching `validateCostOverlay:233`); (3) client hydration in a vm sandbox — warm path, cold path (`applyJtCostSeed` re-registers after JT already booted unset), `recordJobItem` dotted-path write, `adoptLocal` still fires for a `jtCosts`-only doc (the B6 fix), rep write refused by rules resolves `false` and never throws; (4) `jtKey()` output for all 84 items hashes to a frozen list.

**`tests/ci-manifest.json`** — register `"job-template-cost-seed.test.js"` and `"estimate-reopen-cost-basis.test.js"` in `wired-individually`, alphabetically adjacent to `"job-templates.test.js"` (`:84`).

**`documentation/audit/JT-COST-LEAK-2026-08-18.md` (NEW)** and **`documentation/INDEX.md`** — dated audit note per the standing vault rule, linked in the same PR with a plain relative markdown link. It must record: the measured leak (187,993 bytes, 84 items, 146 values, 49 lines, two public surfaces); the guard-bypass mechanism including the measured finding that `STRICT_FILES` alone catches zero; the labor-inference trap with the five measured before/after prices; the reopen re-pricing hole and its fix; and a **"what this does NOT close"** section naming `estimate-builder-v2.js` (28 cost/labor), `estimate-catalog-xactimate.js` (276 mat/lab), `estimate-labor-catalog.js` (67 `rate:` — a fourth spelling, on no list, invisible to all four regexes), and the git-history residue.

---

## 3. Tenant migration — what Jo runs, and who loses pricing

**Yes. Every tenant except the one Jo explicitly imports loses JT pricing.** I am not going to soften that.

These 84 figures are NBD's own Cincinnati numbers that leaked into a platform artifact. `catalog-costs.js:12-22` and `import-catalog-costs.js` both state the precedent's rule: costs are tenant-owned, there is no platform-wide copy, **every other tenant gets nothing on purpose.** Seeding all tenants would close the public-URL surface and leave the second leak — one company's supplier terms becoming everyone's starting pricing — fully intact, just relocated into private docs. So no automatic seeding. The consequence is real and it is a live-user regression.

**Order of operations. Jo runs all of it; Claude runs none of it.**

**Step 0 — BEFORE PR-B merges, while the costs are still in the working tree:**
```bash
node scripts/extract-job-template-costs.js --from worktree --out .local/jt-cost-seed.json
```
Expect `84 entries / 146 non-zero values`, validation OK. `.local/` is gitignored (`.gitignore:60`). This artefact is the rollback insurance. After merge the same extract works from history via `--from <pre-strip-sha>`.

**Step 1 — deploy PR-A (the reopen fix) and let it settle.** No data change, no visible behaviour change except that reopened estimates stop re-pricing.

**Step 2 — write NBD's book to production BEFORE PR-B deploys.** `jtCosts` is inert to the currently-deployed client, so this is safe and it means NBD never sees a "Cost not set" state at all:
```bash
node scripts/import-job-template-costs.js --company <NBD companyId>          # dry run, prints the diff
node scripts/import-job-template-costs.js --company <NBD companyId> --yes    # writes
```
One document: `catalogCosts/<NBD companyId>.jtCosts`. Zero other tenants touched.

**Step 3 — merge and deploy PR-B.**

**Step 4 — read back as that tenant.** Open Estimates → Job Templates, insert a template with a known custom item ("Siding patch at kickout"), confirm it prices at material 40 / labor 120 and shows no "Cost not set" badge. Then reopen a saved estimate containing a `JT *` row, nudge one measurement, and confirm the grand total does not move.

**Step 5 — legacy forks migrate themselves, with one caveat.** Any tenant who forked a default template has the costs sitting in their own `users/{uid}/jobTemplates` doc (`saveCustom`'s deep clone at `:271` has been persisting them all along). `customLineItem`'s `legacy-template` branch keeps reading them, and `catalog-costs.js` lifts them into the company book on next hydrate. **Caveat Jo must know:** that write hits `catalogCosts/{companyId}`, which `firestore.rules:1061-1066` restricts to owner/`company_admin`. A tenant whose forks live on a `sales_rep`'s device never migrates. Their templates still price correctly from the embedded legacy costs — they just stay per-device. This is not "automatic for everyone."

**What a tenant with no book sees, before → after.** Before: every template shows a price band; inserting one produces priced lines. After: **49 of 107 templates show no price band**; inserting one gives a complete scope of work — name, qty, unit, description — with `—` in the price columns and a visible "N items have no cost set" banner. Never `$0.00`, never a fabricated margin. The rep types a customer price in the existing `$ / unit` field and `unitPriceOverride` (`job-templates.js:642-648`, asserted at test `:650-676`) prices the line exactly on it.

**Behaviour change to name in the release note:** costs become **company**-scoped while templates stay **uid**-scoped. Two reps in one company who each forked the same default template now share one cost entry keyed `jt-<slug>-<index>`. That is correct — a company has one buy price for "Masonry water repellent" — but today their forks drift independently.

**Rollback:** `.local/jt-cost-seed.json` plus the pre-strip git ref reconstruct the full set; `--force` re-imports over an existing book. Nothing is ever destroyed — the migration only adds fields.

---

## 4. One session vs follow-up

**Land in one session, in this order:**
1. **PR-A** (reopen cost basis, A1-A4). Small, independently correct, and a hard prerequisite.
2. **PR-B** (B1-B11 + all test changes + audit note + INDEX link).

Both are `docs/`-and-`tests/` changes plus two Node scripts and one pure `functions/` module. No emulator suite is required. This is a long session but not an unrealistic one, and PR-B's pieces are tightly coupled — splitting the strip from the reader across deploys is the one sequencing mistake that produces a wrong price rather than a missing one.

**Explicitly follow-up, do not attempt now:**
- **The in-app JT cost editor.** `job-templates-ui.js` has **zero** cost references today (verified) — no UI has ever exposed these fields, so nothing is being removed. But adding one means a new UI write path with role gating and rules-refusal handling, and PR-B is already the largest safe unit. **Consequence, stated plainly: until this ships, "enter your own costs" is not an action a non-NBD tenant can take in-product.** They price per-line via `unitPriceOverride`. If Jo has a second live tenant who actually uses job templates, promote this to PR-C immediately after PR-B and before any comms.
- **Phase 2:** `estimate-builder-v2.js` (28 cost/labor), `estimate-catalog-xactimate.js` (276 mat/lab), `estimate-labor-catalog.js` (67 `rate:` + `crewSize`/`hoursPerUnit`). These three share the `NBD_XACT_CATALOG.byCode` object with JT custom items, so after PR-B that one object holds tenant-owned costs and still-public costs side by side. Migrate them **together**, onto the same `jtCosts`-style tenant book, and add the `rate:`-shaped regex in that PR so the fourth spelling gets a guard and a non-vacuity partner at the same time.
- **Cents.** This path is float dollars end to end (24 of 84 items carry sub-dollar decimals, min 0.12), diverging from the CLAUDE.md invariant the same way `estimate-logic-engine.js` already does. Converting it inside a leak fix would multiply the blast radius against live pricing. Record it; do not do it here.
- **Deduping identical scope items across templates** (Design 3's `priceKey`). Real value, wrong PR.

---

## 5. Verification checklist

Run in this order. Every one of these already exists.

```bash
node scripts/check-js-syntax.js
node scripts/check-inline-html-scripts.js          # CSP: new client JS is external + defer
node scripts/check-site-integrity.js --quiet
node scripts/strip-job-template-costs.js --check   # NEW: zero cost keys in the data file
node tests/catalog-cost-privacy.test.js            # 48 → ~52; MUST fail on the un-stripped file first
node tests/job-templates.test.js                   # 127 → ~131, both passes
node tests/job-template-cost-seed.test.js          # NEW
node tests/estimate-reopen-cost-basis.test.js      # NEW
node tests/smoke.test.js                           # CRM change (needs functions/ deps)
node tests/marketing-polish-contract.test.js
```

**The proof-of-work checks, in priority order:**

1. **`catalog-cost-privacy.test.js` must go RED on the un-stripped file before it goes green.** Stash the B5 strip, run it, confirm `COST_BASIS_NAMED_RE` reports 49 line hits in `job-templates-data.js`. If it is green before the strip, the regex is broken and the guard is theatre. Then unstash → green, and the `basisByFile` sweep must report **zero** entries for that file.
2. **`job-templates.test.js` §9 no-book inference lock** — the `labSource` assertion. This is the single assertion standing between the design and a $500 line labelled "Cost not set". It must fail if anyone changes `materialCost: 0` back to an omitted key.
3. **`job-templates.test.js` §8 scale floor** passes in the priced pass and does not silently skip. Confirm the fixture book covers every custom item in the 16 formula/partial templates.
4. **§4 non-vacuity counter** reports `nMaterialRows > 0`.
5. **§1 non-vacuity counter** reports 84.
6. **`estimate-reopen-cost-basis.test.js`** — a saved `JT *` row survives reopen + one measurement edit + save with its cost intact, for both a post-3A and a pre-3A doc.
7. **Manual, in the real app** (tests do not catch this): as a tenant with no book, open Job Templates and confirm the affected cards show **no price band** rather than `$0`, and the insert modal shows `—` plus the banner. Then as NBD post-import, confirm the bands are back at the correct numbers.
8. **Post-deploy, on the live URL:** `curl -s https://<host>/pro/js/job-templates-data.js | grep -c materialCost` → `0`.

---

## 6. The git-history question

**Honest assessment: the leak is not fully closed by this PR, and a history rewrite is not warranted anyway.**

Every pre-strip commit remains readable forever at `raw.githubusercontent.com`, in every clone, and in every fork. Anyone who has already cloned this public repo has all 146 values regardless of what you do to the remote. What the strip actually buys you is: no *new* exposure, no scrapeable live URL at `HEAD`, and — importantly — the values stop being served to every visitor of the CRM's own JS bundle. The sharper half of the exposure is that `estimate-logic-engine.js` is *also* public and carries the markup constants (`materialMarkupPct` 0.25, `overheadPct` 0.10, `profitPct` 0.10), so history plus the current tree still yields a full margin derivation — and will continue to until Phase 2 lands.

**What a rewrite would cost.** `git filter-repo`/BFG on a public repo rewrites every commit SHA from the first touch of `job-templates-data.js` forward. That breaks: every existing clone (contributors must re-clone or hard-reset; a `git pull` produces a divergent-history mess), every open PR (they rebase onto SHAs that no longer exist and generally have to be re-opened), every fork (which keeps the old objects and can re-push them back, undoing the rewrite), every permalink and every commit SHA referenced in your `documentation/` vault, and any CI cache or deploy pinned to a SHA. GitHub also retains unreferenced objects in the fork network until you file a support request to garbage-collect them — so the rewrite is not even self-serving without that step. And it would need to cover not just `job-templates-data.js` but the three Phase-2 files too, or you rewrite history once and still leak.

**Recommendation, and I am not going to execute any of this without your explicit go-ahead:** do **not** rewrite. The values are routine trade material/labor dollars for a regional roofing contractor — moderately sensitive, not credentials, not customer PII, not reconstructable into anything that can be used against a specific homeowner. The cost of the rewrite is high, its effectiveness is partial (forks, existing clones), and it would have to be repeated or scoped to cover the still-public Phase-2 files. The proportionate response is: land this fix, land Phase 2 on a real deadline (that is the change that actually stops the margin derivation), and record in the audit note that history was deliberately left intact and why. If you disagree — if these numbers represent supplier terms you consider genuinely competitive — the decision point is *before* Phase 2, so that one rewrite covers all four files at once. Tell me and I will scope it properly, including the fork-network GC request.

**Residual risk, stated plainly:** after PR-A and PR-B, three published files still carry a full cost basis, the `NBD_XACT_CATALOG.byCode` object straddles tenant-owned and public costs, the fourth spelling (`rate:`) has no guard at all, and any tenant other than NBD who was quoting off these numbers will see "Cost not set" on 49 templates the first time they open the modal — with no in-product way to fix it until the editor ships. Every one of those is a decision, not an oversight, and every one is in the audit note.
