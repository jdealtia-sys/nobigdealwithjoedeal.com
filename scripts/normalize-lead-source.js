/**
 * scripts/normalize-lead-source.js
 *
 * Collapses the `source` field on /leads onto one canonical vocabulary.
 *
 * WHY
 * ───
 * `source` had drifted to 16 distinct values for what the UI presents as a
 * short list, because three different surfaces wrote it with three different
 * vocabularies and one of them has a free-text box:
 *
 *   d2d-tracker-core-2026b.js  writes 'Door-to-Door'
 *   maps-overlays.js           writes 'Door Knock'
 *   an older import            wrote  'door_knock'
 *
 * Same act, three strings — so anything that counted one of them under-counted
 * the other two. Joe's call 2026-09-06: DOOR KNOCK IS CANONICAL.
 *
 * CANONICAL SET
 *   Door Knock · Storm Canvass · Storm Alert · Referral · Thumbtack · Yelp
 *   Angi · Website · Google · Online · Direct · Other
 *
 * TENANCY — READ THIS FIRST
 * ─────────────────────────
 * /leads IS A MULTI-TENANT COLLECTION. A `.collection('leads').get()` returns
 * every customer's leads, not one company's. At the time of writing it held
 * 227 docs across three companyIds, and the lowercase/underscore spellings
 * (door_knock, referral, google, storm_alert, website) belonged ENTIRELY to a
 * different tenant — 14 docs that a naive normalize would have silently
 * rewritten. Another company's vocabulary is not ours to canonicalise.
 *
 * So --company is REQUIRED. There is no "all tenants" mode and there should
 * not be one: a bulk write across tenants is never the right answer here.
 *
 * SAFETY
 *   • Dry-run by default. --apply requires --yes as well.
 *   • Refuses to run without an explicit --company.
 *   • Idempotent — a doc already canonical is skipped, so re-running is a no-op.
 *   • An UNRECOGNISED value is LEFT ALONE and printed under "not mapped". This
 *     script never guesses: a source it does not have an explicit rule for is
 *     reported for a human, not rewritten.
 *   • An EMPTY source is left empty. Blank and 'Other' mean different things
 *     ("nobody recorded it" vs "recorded, and it was none of these") and
 *     inventing a value would destroy that distinction.
 *   • Prints every before → after pair, so the change is reversible from the log.
 *
 * WHAT IS DELIBERATELY *NOT* NORMALIZED
 * ─────────────────────────────────────
 * 'Website — Contact form' and 'Website — Inspection / Storm tool' are LEFT
 * ALONE. They are not casing drift — they are written by two different public
 * ingests (doc id prefixes `contact_leads__` and `inspect_leads__`) and they
 * record WHICH funnel converted, which is real information the canonical word
 * 'Website' would destroy. Nothing miscounts because of them; they only ever
 * split a report. So the fix belongs in the REPORTING layer, and
 * lead-source-roi.js folds both under 'Website' there instead.
 *
 * The rule this follows: normalize spellings of the same thing, never collapse
 * two things that differ.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC)
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN  (NBD's own companyId is 1phDvAVXHSg82wDLegAbQFq14Ci1)
 *   node scripts/normalize-lead-source.js --company=<id>
 *   node scripts/normalize-lead-source.js --company=<id> --apply --yes
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

// Keyed by the value lowercased and trimmed. Separator variants are folded
// before lookup (see canonical()), so 'door_knock', 'door-to-door' and
// 'Door to Door' all arrive here as 'door to door'.
const CANON = {
  'door knock': 'Door Knock',
  'door to door': 'Door Knock',
  'd2d': 'Door Knock',
  'storm canvass': 'Storm Canvass',
  'storm chase': 'Storm Canvass',
  'storm alert': 'Storm Alert',
  'referral': 'Referral',
  'past customer': 'Referral',
  'thumbtack': 'Thumbtack',
  'yelp': 'Yelp',
  'angi': 'Angi',
  'angies list': 'Angi',
  'website': 'Website',
  'web lead': 'Website',
  // 'Website — Contact form' / 'Website — Inspection / Storm tool' are
  // deliberately absent — see the header. They fall through to "not mapped"
  // and are left exactly as the ingest wrote them.
  'google': 'Google',
  'online': 'Online',
  'direct': 'Direct',
  'phone call': 'Direct',
  'walk-in': 'Direct',
  'other': 'Other',
};

// Fold separators so one rule covers every spelling of the same words.
// Underscores and hyphens BETWEEN letters become spaces; runs of whitespace
// collapse. Hyphens inside a real word we want to keep ('walk-in') are handled
// by listing that key explicitly above, before folding would reach it.
function foldKey(raw) {
  const t = String(raw == null ? '' : raw).trim().toLowerCase();
  if (CANON[t]) return t;                       // exact hit wins, e.g. 'walk-in'
  return t.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

if (APPLY && !YES) {
  console.error('--apply also requires --yes. Refusing to write.');
  process.exit(2);
}

const COMPANY = (args.find((a) => a.startsWith('--company=')) || '').split('=')[1] || '';
if (!COMPANY) {
  console.error('');
  console.error('  --company=<companyId> is REQUIRED.');
  console.error('');
  console.error('  /leads holds every tenant\'s leads in one collection. Running this');
  console.error('  unscoped would rewrite other companies\' data — their source');
  console.error('  vocabulary is theirs, not ours. There is no all-tenants mode.');
  console.error('');
  console.error('  Run scripts/audit-lead-tenancy.js to list the companyIds.');
  console.error('');
  process.exit(2);
}

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  console.log('');
  console.log('═'.repeat(64));
  console.log('Normalize leads.source onto the canonical vocabulary');
  console.log(`  project   : ${PROJECT}`);
  console.log(`  mode      : ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'}`);
  console.log('  canonical : Door Knock (Joe, 2026-09-06)');
  console.log(`  company   : ${COMPANY}`);
  console.log('═'.repeat(64));
  console.log('');

  // Scoped read, not a filter after the fact — a doc belonging to another
  // tenant never enters this process at all.
  const snap = await db.collection('leads').where('companyId', '==', COMPANY).get();
  const todo = [];
  const notMapped = new Map();
  let alreadyOk = 0;
  let blank = 0;
  let wrongTenant = 0;

  snap.forEach((d) => {
    const data = d.data() || {};
    // Belt and braces: the query already scoped this, but a bulk write is the
    // wrong place to trust one guard.
    if (data.companyId !== COMPANY) { wrongTenant++; return; }
    const raw = data.source;
    const trimmed = String(raw == null ? '' : raw).trim();

    if (trimmed === '') { blank++; return; }        // leave blank as blank

    const want = CANON[foldKey(trimmed)];
    if (!want) {
      notMapped.set(trimmed, (notMapped.get(trimmed) || 0) + 1);
      return;                                        // never guess
    }
    if (want === trimmed) { alreadyOk++; return; }   // already canonical

    todo.push({
      ref: d.ref,
      was: trimmed,
      now: want,
      name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || '(no name)',
    });
  });

  // Group the plan by the change being made — 88 individual lines is a wall of
  // text; "Door-to-Door → Door Knock (71)" is the thing worth checking.
  const byChange = new Map();
  todo.forEach((t) => {
    const k = `${t.was} → ${t.now}`;
    if (!byChange.has(k)) byChange.set(k, []);
    byChange.get(k).push(t.name);
  });

  console.log('=== planned changes ===');
  [...byChange.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([change, names]) => {
      console.log(`  ${String(names.length).padStart(3)}  ${change}`);
      if (names.length <= 6) console.log(`       ${names.join(', ')}`);
    });
  if (!byChange.size) console.log('  (none)');

  console.log('');
  console.log(`  scanned (this company only) : ${snap.size}`);
  console.log(`  already canonical           : ${alreadyOk}`);
  console.log(`  left blank                  : ${blank}`);
  if (wrongTenant) console.log(`  REJECTED, wrong tenant      : ${wrongTenant}`);

  if (notMapped.size) {
    console.log('');
    console.log('=== NOT MAPPED — left exactly as they are, decide by hand ===');
    [...notMapped.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([v, n]) => console.log(`  ${String(n).padStart(3)}  ${JSON.stringify(v)}`));
  }

  if (!todo.length) {
    console.log('');
    console.log('  Nothing to do.');
    console.log('');
    process.exit(0);
  }

  if (APPLY) {
    // Chunked at 400 — under Firestore's 500-write batch ceiling with room to
    // spare, and each chunk is atomic.
    const CHUNK = 400;
    for (let i = 0; i < todo.length; i += CHUNK) {
      const batch = db.batch();
      todo.slice(i, i + CHUNK).forEach((t) => batch.update(t.ref, { source: t.now }));
      await batch.commit();
    }
    console.log('');
    console.log(`  WROTE ${todo.length} docs.`);
    console.log('');
    console.log('=== full before → after, for the record ===');
    todo.sort((a, b) => a.name.localeCompare(b.name))
      .forEach((t) => console.log(`  ${t.name.padEnd(30)} ${t.was}  →  ${t.now}`));
  } else {
    console.log('');
    console.log(`  ${todo.length} docs would change. Nothing was written.`);
    console.log('  Re-run with --apply --yes to write.');
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
