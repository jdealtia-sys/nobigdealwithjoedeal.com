# EPA RRP / lead paint — a live operational constraint (2026-09-04)

**Jo, 2026-09-04: "I'm not yet RRP certified."**

That sentence landed at the end of the session that shipped a six-page wood
siding cluster ([WOOD-SIDING-GAP](WOOD-SIDING-GAP-2026-09-03.md)) — five city
pages plus a hub, all selling *cut out the rot, splice in new wood, sand it
flush, paint it to blend*, and the Batavia page selling it specifically to
century-old clapboard houses. So the pages are now built to generate exactly
the work the rule governs. This note exists so no future session writes
lead-safe language onto a page, or pushes the old-house angle harder, without
knowing where the firm actually stands.

**Nothing here is legal advice.** Every fact below is linked to its primary
source and was verified 2026-09-04. The EPA National Lead Information Center
(1-800-424-LEAD) settles anything ambiguous.

---

## 1. Where the site stands today — clean, and deliberately so

A word-boundary sweep of `docs/` for `RRP`, `lead paint`, `lead-safe`,
`lead safe`, `pre-1978` and `renovate right`:

```
$ grep -rIilE "\bRRP\b|lead paint|lead-safe|lead safe|pre-1978|renovate right" docs/
docs/pro/js/job-templates-data.js
```

**One hit, and it is not a public page** — it is CRM estimating guidance (§3).
Zero hits across every homeowner-facing page, the wood cluster included.

That is the correct posture for a firm that is not certified: **an uncertified
firm that advertises "lead-safe practices" has made a false claim**, and it is
the claim, not the carpentry, that is trivially provable. The site does not make
it. Keep it that way until §4 says otherwise.

⚠ **The exposure is not the claim — it is the demand.** The pages point at
pre-1978 housing on purpose. Raw occurrences in
`docs/services/wood-siding-repair-batavia-oh.html` (every page in the cluster
derives its visible FAQ from its own `FAQPage` JSON-LD, so most phrases are
counted twice by design — once in each): `clapboard` ×10, `old-growth` ×4,
`century` ×3, `hundred years` ×3.

And **"sanded flush"** is live in seven files:

```
$ grep -ril "sanded flush" docs/
docs/assets/data/projects.json          ← and therefore
docs/our-work.html                      ← the generated card copy
docs/services/siding-repair.html
docs/services/wood-siding-repair.html
docs/services/wood-siding-repair-batavia-oh.html
docs/services/wood-siding-repair-loveland-oh.html
docs/services/wood-siding-repair-mason-oh.html
```

See §2's prohibited-practice note before that phrase is reused anywhere new.
It is not a problem in itself — it is the phrase that decides whether a job
keeps its exemption.

## 2. The rule, verified

**Scope.** Applies to *anyone paid to perform work that disturbs painted
surfaces* in housing and child-occupied facilities **built before 1978**.
Homeowners doing their own work are out; anyone paid is in.
([EPA — RRP program](https://www.epa.gov/lead/lead-renovation-repair-and-painting-program))

**Who administers it in Ohio — correction to what this session first said.**
An earlier answer in this session said Ohio runs an EPA-authorized state
program through the Ohio Department of Health. **That is wrong.** Fifteen
states operate authorized programs (AL, DE, GA, IA, KS, MA, MS, NC, OK, OR, RI,
UT, VT, WA, WI) plus the Bois Forte Band — **Ohio is not among them, so US EPA
administers and enforces RRP directly in Ohio.** ODH's role is adjacent and
separate: it *accredits the training courses* held in-state, and it licenses
lead **abatement** professionals, which is a different program from RRP
renovation. Practical consequence: **the firm application goes to EPA, not to
ODH.**
([EPA — firm certification](https://www.epa.gov/lead/renovation-repair-and-painting-program-firm-certification),
[NCHH — how states manage RRP](https://nchh.org/information-and-evidence/healthy-housing-policy/national/keystone-federal-policy/rrp/how-states-territories-and-tribes-manage-rrp-and-abatement/))

**What certification costs and takes.**

| | |
|---|---|
| Firm certification | **$300**, applied for **online through EPA's CDX**, good for **5 years** |
| Certified renovator | **8-hour** initial course, **2 hours hands-on**, certification good for **5 years** |
| Refresher | **4-hour**, before expiry; hands-on refresher renews for 5 years, online-only for 3 |
| Lapse | Certification expired = **retake the full 8-hour initial course** |

([EPA — firm certification](https://www.epa.gov/lead/renovation-repair-and-painting-program-firm-certification),
[EPA — renovator training](https://www.epa.gov/lead/renovation-repair-and-painting-program-renovator-training))

**The minor repair and maintenance exemption — and the two things it never
covers.** A job disturbing **≤ 20 sq ft of exterior** painted surface (≤ 6 sq ft
per room interior) is *minor repair and maintenance* and falls outside the full
rule. Two carve-outs matter more than the number:

1. **Window replacement is never exempt.** Any size. It is explicitly excluded
   from the definition of minor repair and maintenance — an entire window under
   six square feet is still a renovation.
2. **Demolition of painted surfaces is never exempt**, and the exemption is
   forfeited outright if the job uses a **prohibited practice**.

([EPA — interpreting "minor repair and maintenance"](https://www.epa.gov/lead/how-will-epa-interpret-term-minor-repair-and-maintenance-activities),
[EPA — 20 sq ft per side, several sides](https://www.epa.gov/lead/if-renovator-disrupts-20-square-feet-or-less-painted-surface-side-several-sides-exterior-one))

**Prohibited practices — the sharp edge for this firm.** The rule prohibits
**open-flame burning or torching of painted surfaces**, and **machine removal
of paint by high-speed operation — sanding, grinding, power planing, needle
gun, abrasive blasting, sandblasting — unless the machine has a shroud or
containment system with a HEPA vacuum attachment collecting at the point of
generation.** (A heat-gun ceiling around 1100 °F / charring is widely cited as
the third; it was not confirmable from a primary source in this session —
confirm against 40 CFR 745.85(a)(3) before relying on it.)
([EPA — work practices](https://www.epa.gov/lead/renovation-repair-and-painting-program-work-practices))

> **This is why "sanded flush" is the phrase to watch.** Hand-sanding a small
> patch is not machine removal. A random-orbit sander on a pre-1978 clapboard
> without HEPA extraction is a prohibited practice — *and using one forfeits the
> under-20-sq-ft exemption that would otherwise have covered the whole job.*
> The published copy never specifies which, and it does not need to. The person
> on the ladder does.

## 3. Where the CRM already knew this — and where it didn't

`docs/pro/js/job-templates-data.js` carries 107 job templates. **Two** already
warned about pre-1978 work, both of them painting templates:

- `jt_sf_refresh_combo` — *"EXCLUDES … any lead-paint remediation on pre-1978 homes — test first."*
- `jt_ex_paint_touchup_pkg` — *"Excludes lead-paint abatement (pre-1978 homes need RRP assessment)."*

**The templates that actually disturb painted wood carried nothing.** The gap
was not random — it tracked whoever happened to be thinking about paint. As of
this note, nine templates carry a `PRE-1978 CHECK:` line:

| Template | Why it needed one |
|---|---|
| `jt_sf_rot_cutout_fascia_splice` | **The flagship for the whole new wood cluster.** Cut-out and splice on painted fascia |
| `jt_sf_fascia_board_repair` | 20 LF tear-off of painted board |
| `jt_sf_fascia_replacement_wrap` | 60 LF — well past the exterior threshold on its own |
| `jt_sf_rake_board_replacement` | 30 LF, same |
| `jt_sf_frieze_trim_repair` | Removal cracks adjacent painted siding by its own scope note |
| `jt_sf_soffit_panel_repair` | Its own note mentions *"bent/painted-shut trim"* |
| `jt_sf_soffit_replacement_vented` | ~80 SF run |
| `jt_ex_window_replace_1` | **Never exempt at any size** — the single most important one |
| `jt_ex_entry_door_replace` | Pulling the unit disturbs painted jamb and trim |

The added line names the check, not the firm's standing. That is deliberate:
**`docs/pro/` is served from the public hosting root** (auth is app-level, the
`.js` file itself is fetchable), the CRM is multi-tenant, and "we are not
certified" is neither the tenant's fact nor something to publish. The standing
lives here in the vault; the trigger lives in the tool.

## 4. The recommendation, and what changes when it lands

**Get certified rather than trim the pages.** The case:

- The cost is **$300 and one 8-hour day**, against a five-page cluster
  purpose-built to produce this exact work.
- Much of the small-job volume likely already sits under the 20 sq ft exterior
  exemption — but *likely* is doing real work in that sentence, and the
  exemption evaporates on any window replacement, any demolition, and any
  un-shrouded sander.
- On the old-house market Batavia targets it is a **differentiator**, not
  overhead. Homeowners of pre-1978 houses in Clermont County are the segment
  most likely to have heard of the rule.

**Until it lands: add nothing to the site.** No "lead-safe", no "EPA
certified", no RRP badge, nothing in JSON-LD. The pages are correct as shipped.

**When it lands, it is one pass, and it is already scoped:**

1. Wood cluster (6 pages) — hub + Mason + Loveland + West Chester + Batavia +
   Cincinnati. Batavia is the one where it belongs in the *lead*, not the FAQ.
2. `docs/services/siding-repair.html` and `siding-replacement.html`.
3. GBP: the "Wood siding repair" description in
   [gbp-services-2026-09-03](../marketing/gbp-services-2026-09-03.md) §1 has
   room — it is at 270 of 300 characters.
4. Swap the nine `PRE-1978 CHECK:` lines from *confirm standing* to *scope the
   containment*, and add the pamphlet/records step to the estimate flow.
5. Remember every page derives its visible FAQ from its own `FAQPage` JSON-LD —
   edit the JSON-LD, the HTML follows.

## 5. Open

- **Firm certification not held** (Jo, 2026-09-04). No date set.
- **Certified renovator not held.** Both are needed — the firm certificate and
  a certified renovator assigned to each job are separate requirements.
- The 1100 °F heat-gun figure in §2 is unconfirmed against the CFR.
- Nobody has checked whether any **already-published** `/our-work` card shows
  pre-1978 painted-wood work. Not urgent, not zero: the cards are the firm's
  own published record of what it did.

---

*Related: [WOOD-SIDING-GAP-2026-09-03](WOOD-SIDING-GAP-2026-09-03.md) ·
[SHED-OUTBUILDING-GAP-2026-09-03](SHED-OUTBUILDING-GAP-2026-09-03.md) ·
[gbp-services-2026-09-03](../marketing/gbp-services-2026-09-03.md) ·
[LEXINGTON-CONTRACTOR-SETUP](../runbooks/LEXINGTON-CONTRACTOR-SETUP.md) — the
other "check the licensing before the first job" note.*
