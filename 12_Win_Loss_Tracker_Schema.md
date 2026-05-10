# Win/Loss Tracker
## Firestore Schema + NBD Pro Feature Spec

**Purpose:** Capture per-claim outcomes, doctrines used, adjuster moves encountered, and dollar values. After 50-100 claims, this becomes statistical edge. After 500, it's a competitive moat.

**Why this is the third-most-leveraged artifact in this build** (after the Ask Joe system prompt and the Carrier Intelligence Sheet): It's the data layer that makes every future claim faster. It tells you which doctrines work on which carriers, which adjusters fight hardest, which scenarios are most common in your market.

---

## What gets tracked per claim

### Claim metadata
- Claim ID (NBD Pro internal)
- Carrier
- Adjuster name
- Property address
- Date filed
- Date resolved (or current status)
- Days to resolution

### Loss data
- Storm event date
- Damage type (hail, wind, etc.)
- Original carrier estimate ($)
- Final settlement amount ($)
- Variance % (final vs. original)
- Out-of-pocket from homeowner ($)

### Doctrine application
- Doctrines used (multi-select: goal-posting, opinion-vs-fact, burden-flip, indemnification, homeowner-advocate, right-contractor)
- Scenarios encountered (multi-select 1-8 from the doctrine)
- Specific adjuster moves logged (references to `11_Adjuster_Moves_Index.json` IDs)
- Goalposts locked (which conditional questions got "yes" in writing)
- Goalpost violations (where adjuster contradicted earlier written statements)

### Outcome classification
- **Won** — full replacement / full coverage as needed
- **Partial Win** — better than original offer but not full
- **Lost** — original offer stood / homeowner paid out of pocket
- **Walked Away** — homeowner abandoned mid-claim
- **Open** — still active

### Lessons learned
- What worked
- What didn't
- Adjuster patterns to remember
- Doctrine refinements (did anything new come up that should be added to v2 of the doctrine doc?)

---

## Firestore schema

```
/claims/{claim_id}/outcome
{
  // Metadata
  carrier: string,
  adjuster_name: string,
  adjuster_phone: string,
  adjuster_email: string,
  property_address: string,
  date_filed: timestamp,
  date_resolved: timestamp (nullable),
  days_to_resolution: number (computed),

  // Loss data
  storm_event_date: timestamp,
  damage_type: 'hail' | 'wind' | 'tree' | 'fallen_object' | 'other',
  original_carrier_estimate: number,
  final_settlement_amount: number,
  variance_percentage: number (computed),
  homeowner_out_of_pocket: number,

  // Doctrine application
  doctrines_used: array<string>, // 'goal_posting', 'opinion_vs_fact', etc.
  scenarios_encountered: array<number>, // 1-8
  moves_logged: array<{
    move_id: string, // ref to 11_Adjuster_Moves_Index.json
    date: timestamp,
    adjuster_phrase: string,
    counter_used: string,
    outcome: 'agreed' | 'pushed_back' | 'silent' | 'escalated'
  }>,
  goalposts_locked: array<{
    goalpost_text: string,
    date_locked: timestamp,
    in_writing: boolean,
    location: string // 'email', 'call_notes', etc.
  }>,
  goalpost_violations: array<{
    original_goalpost: string,
    violation_text: string,
    date: timestamp,
    addressed: boolean
  }>,

  // Outcome
  outcome: 'won' | 'partial_win' | 'lost' | 'walked_away' | 'open',
  outcome_notes: string,

  // Learning
  what_worked: string,
  what_didnt: string,
  adjuster_patterns: string,
  doctrine_refinements: string,

  // Audit
  created_at: timestamp,
  updated_at: timestamp,
  closed_by: string (user_id)
}
```

---

## NBD Pro UI

### Per-claim outcome page

Add a "Outcome" tab to each claim's detail page in NBD Pro. Filled in progressively as the claim moves:

```
┌──────────────────────────────────────────────────┐
│ Claim Outcome — Claim #[id]                       │
├──────────────────────────────────────────────────┤
│ STATUS                                            │
│ ⚪ Open / 🟢 Won / 🟡 Partial Win / 🔴 Lost / ⚫ Walked│
├──────────────────────────────────────────────────┤
│ FINANCIALS                                        │
│ Original carrier estimate: [$_____]               │
│ Final settlement: [$_____]                        │
│ Homeowner out-of-pocket: [$_____]                 │
│ Variance: 0.0%  (auto-calculated)                 │
├──────────────────────────────────────────────────┤
│ DOCTRINES USED (multi-select)                     │
│ ☐ Goal-Posting                                    │
│ ☐ Opinion vs. Fact                                │
│ ☐ Burden Flip                                     │
│ ☐ Indemnification Anchor                          │
│ ☐ Homeowner as Advocate                           │
│ ☐ Right-Contractor Trap                           │
├──────────────────────────────────────────────────┤
│ SCENARIOS ENCOUNTERED                             │
│ ☐ 1. DMI/ITEL  ☐ 2. NTS  ☐ 3. Code              │
│ ☐ 4. Valley   ☐ 5. Right ☐ 6. Indem.            │
│ ☐ 7. Refuses  ☐ 8. Below                        │
├──────────────────────────────────────────────────┤
│ MOVES LOGGED                                      │
│ [+ Add move from index]                           │
│ • [date] State Farm "those aren't industry std"   │
│   → Used burden-flip counter, agreed in writing   │
│ • [date] State Farm "code only new construction"  │
│   → Used code citation, eventually agreed         │
├──────────────────────────────────────────────────┤
│ GOALPOSTS LOCKED                                  │
│ [+ Add locked goalpost]                           │
│ • "If shingle confirmed Classic and DMI doesn't   │
│   carry it, full replacement applies." — agreed   │
│   in email 4/15/26                                │
├──────────────────────────────────────────────────┤
│ LEARNING (free-text fields)                       │
│ What worked: [_____]                              │
│ What didn't: [_____]                              │
│ Patterns to remember: [_____]                     │
│ Doctrine refinements: [_____]                     │
└──────────────────────────────────────────────────┘
```

---

## Aggregation views (the actual ROI)

Once you have 20+ claims tracked, build dashboards that aggregate:

### Carrier performance dashboard

```
       │ Claims │ Won % │ Avg Days │ Avg Variance │ Common Moves
───────┼────────┼───────┼──────────┼──────────────┼─────────────────
S Farm │   12   │  75%  │   18d    │   +43%       │ Code, Right Contractor
Allstate│   8   │  50%  │   31d    │   +28%       │ Refuses, NTS reject
USAA   │   3   │  67%  │   45d    │   +52%       │ Refuses (escalation works)
NJM    │   2   │ 100%  │   12d    │   +61%       │ DOI threat works
Hartford│  4   │  50%  │   28d    │   +35%       │ DMI, Indemnification
```

This view alone changes how you negotiate. When State Farm calls, you know your odds and your average timeline.

### Doctrine effectiveness dashboard

```
                  │ Used in │ Win Rate │ Avg Variance Delta
──────────────────┼─────────┼──────────┼───────────────────
Goal-posting      │   89%   │   72%    │ +12% (vs not using)
Indemnification   │   75%   │   80%    │ +18%
Burden Flip       │   60%   │   65%    │  +9%
Homeowner Advocate│   30%   │   85%    │ +25% (huge!)
Right Contractor  │   25%   │   70%    │  +5%
Opinion vs Fact   │   40%   │   60%    │  +3%
```

This view tells you which doctrines to lean into. If "Homeowner Advocate" has the highest win rate, you start activating it earlier in claims, not later.

### Scenario frequency dashboard

```
Scenario              │ Count │ % of all claims
──────────────────────┼───────┼────────────────
1. DMI/ITEL           │  23   │  64%
2. NTS Rejection      │  15   │  42%
3. Code New Constr.   │   9   │  25%
4. Valley Metal       │  12   │  33%
5. Right Contractor   │  18   │  50%
6. Indemnification    │  21   │  58%
7. Refuses Comm.      │   6   │  17%
8. Below Deductible   │   3   │   8%
```

Tells you what to optimize for. Most-common scenarios deserve the most-polished email templates and the most-rehearsed live counters.

### Adjuster intel

```
Adjuster Name      │ Carrier  │ Claims │ Win % │ Notes
───────────────────┼──────────┼────────┼───────┼─────────────────────────────
Eric Kaplan        │ Hartford │   2    │  ?    │ Difficult; said "I've never
                                                  had a contractor be difficult
                                                  like this"; route through HO
[USAA Loveland guy]│ USAA     │   1    │ 100%  │ Refused all comm; 1-800 esc
                                                  worked, internal rep paid out
[State Farm rep]   │ S Farm   │   3    │  67%  │ Repair-first; 30-50% damage
                                                  threshold language responsive
```

This is the rarest and most valuable data layer. After 100 claims, you're walking into adjuster calls with files on the human you're talking to.

---

## How to populate the tracker over time

### As you go (low-friction):
- After every adjuster interaction, take 60 seconds to add a "move logged" entry. Voice memo if easier.
- When you draft an adjuster email using the Adjuster Email Generator (`09_Adjuster_Email_Generator_Spec.md`), the generator can auto-suggest adding the triggering adjuster phrase to the moves log.
- When a goalpost is locked (adjuster agrees in writing), capture it immediately.

### At claim resolution:
- Fill in the financials.
- Set outcome status.
- Spend 5 minutes on the learning fields. This is where the compounding happens.

### Quarterly review:
- Look at the dashboards.
- Update the doctrine doc if you've found new scenarios or refinements.
- Update the Carrier Intelligence Sheet with carrier-level patterns.
- Update the Adjuster Email Template Library if your live language has refined.

---

## What this unlocks at scale

**After 25 claims:** You have personal patterns. "I never lose to NJM. I struggle with State Farm's repair-first language."

**After 50 claims:** You have local market intelligence. "In Cincinnati, adjuster X always opens with the right-contractor trap. Adjuster Y is fair to work with."

**After 100 claims:** You can quote stats to homeowners. "Of my 47 State Farm claims, 38 got full replacement after we activated [doctrine]. Average resolution time was 22 days."

**After 250 claims:** You can productize this for other roofers in NBD Pro. "Use NBD Pro and these are the playbooks that work in Cincinnati." That's a wedge.

**After 500 claims:** It's a moat. No competitor can match the data unless they spend 5 years building it. And by then you'll have 1000.
