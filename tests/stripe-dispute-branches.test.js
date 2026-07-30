/**
 * tests/stripe-dispute-branches.test.js — BEHAVIOURAL coverage of the two
 * dispute branches inside invoiceWebhook (functions/stripe.js).
 *
 * WHY THIS FILE EXISTS. ~757 lines of money-moving dispute code shipped with
 * only source-regex assertions — tests/stripe-connect.test.js pinned that
 * `createReversal(` appears at a later source index than `decideDisputeReversal(`
 * and nothing more. That pin passes against every defect the #1146 adversarial
 * audit confirmed: reversing an inquiry, telling a contractor in writing that
 * nothing was pulled from their balance while $9,659.70 was, repaying $0 on a
 * dispute we won. A regex cannot tell you who ended up holding the money.
 *
 * WHY IT IS NOT A MIRROR. The house pattern for un-require()able Cloud Functions
 * is a hand-written mirror (tests/invoice-payment-webhook.test.js's
 * creditPayment). A mirror rots SILENTLY — that suite's own header pointer drifted
 * ~200 lines out of date while every assertion stayed green. So this harness
 * EXTRACTS the real branch bodies out of functions/stripe.js by brace-matching
 * and runs them in a `vm` against a stateful fake Stripe and a fake Firestore.
 * The code under test is the code that ships. If the branch is restructured past
 * recognition the extraction fails LOUDLY at the top of this file rather than
 * quietly testing a stale copy of itself.
 *
 * The anchors are structural (a regex over the `else if (event.type === …)`
 * shape, asserted to match EXACTLY once), not literal source text, so
 * reformatting the branch does not break the harness and a comment mentioning
 * the event type cannot satisfy or inflate it. See MUTATION LOG at the bottom.
 *
 * WHAT IT GUARDS — scenarios keyed to the confirmed findings:
 *   S1/S2 an INQUIRY must not reverse, nor be called a platform charge (#2,#6,#8)
 *   S3    a full inquiry lifecycle moves no money in either direction   (#2, #6)
 *   S4    an escalated inquiry DOES reverse — exactly once              (#2)
 *   S5    a real chargeback reverses, clamped to the transfer           (baseline)
 *   S6    reversal-failed → WON repays nothing and says so truthfully   (#7)
 *   S7    a hand-made reversal → WON is never reported as "nothing taken" (#9,#12)
 *   S8    a won dispute repays exactly what this dispute took           (baseline)
 *   S9    closed with no created ever processed repays nothing, alerts  (#5)
 *   S10   DUPLICATE created must not relabel a completed reversal       (#4, #10)
 *   S11   DUPLICATE closed must not pay twice                           (#5)
 *   S12   a post-money context failure must still alert                 (#10)
 *   S13   lost-with-an-unreversed-transfer is not a "platform charge"   (#3)
 *   S14   the owner-actionable copy actually reaches postSlack          (#1, #11)
 *
 * Zero deps. Run: node tests/stripe-dispute-branches.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const STRIPE_SRC = fs.readFileSync(path.join(ROOT, 'functions', 'stripe.js'), 'utf8');
const connectLogic = require(path.join(ROOT, 'functions', 'stripe-connect-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── Extraction ────────────────────────────────────────────────────────────
// Match an opening delimiter to its partner, skipping string literals (all
// three quote styles — the alert copy is full of backticks inside single
// quotes) and comments. Returns -1 if unbalanced.
function matchPair(src, from, open, close) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e === -1) return -1; i = e + 1; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
const matchBrace = (src, from) => matchPair(src, from, '{', '}');

// Enumerate every `} else if ( <condition> ) {` head with its condition text
// paren-matched out. Anchoring this way rather than on a fixed
// `event.type === 'x'` literal is deliberate: the created branch legitimately
// grew a SECOND event type (funds_withdrawn) on 2026-07-30, which a literal
// anchor would have read as "the branch disappeared". Meaning, not punctuation.
function elseIfHeads() {
  const heads = [];
  const re = /\}\s*else\s+if\s*\(/g;
  let m;
  while ((m = re.exec(STRIPE_SRC)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchPair(STRIPE_SRC, openParen, '(', ')');
    if (closeParen === -1) continue;
    const brace = STRIPE_SRC.indexOf('{', closeParen);
    if (brace === -1) continue;
    heads.push({ cond: STRIPE_SRC.slice(openParen + 1, closeParen), brace });
  }
  return heads;
}
const HEADS = elseIfHeads();
// A head "handles" an event type only if its CONDITION compares event.type to
// it — so a comment naming the type can neither satisfy nor inflate the count.
function headsHandling(type) {
  const re = new RegExp('event\\.type\\s*===\\s*[\'"]' + type.replace(/\./g, '\\.') + '[\'"]');
  return HEADS.filter((h) => re.test(h.cond));
}
function bodyOf(head) {
  const close = matchBrace(STRIPE_SRC, head.brace);
  return close === -1 ? null : STRIPE_SRC.slice(head.brace + 1, close);
}
function fnRe(name) {
  return new RegExp('(?:^|\\n)\\s*async\\s+function\\s+' + name + '\\s*\\(', 'g');
}
function countMatches(re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(STRIPE_SRC) !== null) n++;
  return n;
}
function extractFn(name) {
  const re = fnRe(name);
  re.lastIndex = 0;
  const m = re.exec(STRIPE_SRC);
  if (!m) return null;
  const open = STRIPE_SRC.indexOf('{', m.index + m[0].length);
  if (open === -1) return null;
  const close = matchBrace(STRIPE_SRC, open);
  return close === -1 ? null : STRIPE_SRC.slice(m.index, close + 1);
}

console.log('STRIPE DISPUTE BRANCHES — behavioural (real source, vm-executed)');
console.log('\nExtraction (structural anchors — a rename fails HERE, loudly)');

const createdHeads = headsHandling('charge.dispute.created');
const withdrawnHeads = headsHandling('charge.dispute.funds_withdrawn');
const closedHeads = headsHandling('charge.dispute.closed');

ok('exactly one branch handles charge.dispute.created', createdHeads.length === 1,
  'two branches on one event type means one of them is dead — and the harness would test the wrong one');
ok('exactly one branch handles charge.dispute.closed', closedHeads.length === 1);
// STRUCTURAL, and it is the whole shape of the inquiry fix: recovery moved off
// "a dispute opened" onto "the funds were actually withdrawn", so the two
// events MUST share one branch. Registering created without funds_withdrawn is
// the dangerous half-state — an escalated inquiry would never be recovered.
ok('charge.dispute.funds_withdrawn is handled by the SAME branch as created',
  withdrawnHeads.length === 1 && createdHeads.length === 1
  && withdrawnHeads[0].brace === createdHeads[0].brace,
  'an escalated inquiry is otherwise never recovered and the platform eats the full charge');

const CREATED = createdHeads.length === 1 ? bodyOf(createdHeads[0]) : null;
const CLOSED = closedHeads.length === 1 ? bodyOf(closedHeads[0]) : null;
const RESOLVE_FN = extractFn('resolveInvoiceContext');
const ALERT_FN = extractFn('alertInvoicePaymentEvent');

ok('the created branch body extracted', !!CREATED && CREATED.length > 2000,
  'RE-ANCHOR THIS HARNESS: the else-if shape changed. Do not delete the suite.');
ok('the closed branch body extracted', !!CLOSED && CLOSED.length > 2000,
  'RE-ANCHOR THIS HARNESS: the else-if shape changed. Do not delete the suite.');
ok('resolveInvoiceContext + alertInvoicePaymentEvent extracted', !!RESOLVE_FN && !!ALERT_FN);
ok('exactly one alertInvoicePaymentEvent definition', countMatches(fnRe('alertInvoicePaymentEvent')) === 1);

// Compiling the extracted regions is itself a check: a mis-matched brace
// produces a SyntaxError here rather than a subtly wrong slice of the branch.
let SCRIPT = null;
let compileErr = '';
if (CREATED && CLOSED && RESOLVE_FN && ALERT_FN) {
  const BOOT = [
    RESOLVE_FN,
    ALERT_FN,
    // ONE runner for the created/funds_withdrawn pair — they are one branch,
    // and which behaviour you get is decided by event.type, exactly as in prod.
    'globalThis.__runOpen = async function () {' + CREATED + '\n};',
    'globalThis.__runClosed = async function () {' + CLOSED + '\n};',
  ].join('\n');
  try { SCRIPT = new vm.Script(BOOT, { filename: 'extracted-dispute-branches.js' }); }
  catch (e) { compileErr = e.message; }
}
ok('the extracted regions compile', !!SCRIPT, compileErr);

// ── Fake Stripe: STATEFUL, so a redelivery sees the state the first delivery
// left behind. That mutation is the whole mechanism behind findings #4 and #10.
function makeStripe(w) {
  const guard = (key, params, run) => {
    if (key && w.idem.has(key)) {
      const prior = w.idem.get(key);
      if (JSON.stringify(prior.params) !== JSON.stringify(params)) {
        const e = new Error('Keys for idempotent requests can only be used with the same parameters'
          + ' they were first used with.');
        e.code = 'idempotency_error';
        throw e;
      }
      return prior.result;
    }
    const result = run();
    if (key) w.idem.set(key, { params, result });
    return result;
  };
  return {
    charges: {
      retrieve: async (id) => {
        w.calls.push(['charges.retrieve', id]);
        const c = w.charges[id];
        if (!c) { const e = new Error('No such charge: ' + id); e.code = 'resource_missing'; throw e; }
        // expand:['transfer'] — hand back the LIVE transfer object so a second
        // delivery reads the amount_reversed the first one caused.
        return Object.assign({}, c, {
          transfer: c.transfer ? (w.expandTransfer ? w.transfers[c.transfer] : c.transfer) : null,
        });
      },
    },
    transfers: {
      createReversal: async (trId, params, opts) => {
        w.calls.push(['transfers.createReversal', trId, params && params.amount]);
        if (w.failReversal) {
          const e = new Error(w.failReversal.message || 'Insufficient funds in the account.');
          e.code = w.failReversal.code || 'balance_insufficient';
          throw e;
        }
        return guard(opts && opts.idempotencyKey, params, () => {
          const t = w.transfers[trId];
          if (!t) { const e = new Error('No such transfer'); e.code = 'resource_missing'; throw e; }
          const remaining = t.amount - t.amount_reversed;
          const amt = params.amount == null ? remaining : params.amount;
          if (amt > remaining) { const e = new Error('exceeds remaining reversible amount'); e.code = 'amount_too_large'; throw e; }
          t.amount_reversed += amt;
          const rev = {
            id: 'trr_' + (++w.seq), amount: amt, transfer: trId,
            metadata: (params && params.metadata) || {}, created: w.now,
          };
          (w.reversals[trId] = w.reversals[trId] || []).push(rev);
          return rev;
        });
      },
      listReversals: async (trId) => {
        w.calls.push(['transfers.listReversals', trId]);
        return { data: (w.reversals[trId] || []).slice() };
      },
      list: async (params) => {
        w.calls.push(['transfers.list', params && params.transfer_group]);
        const g = String((params && params.transfer_group) || '');
        return { data: Object.keys(w.transfers).map((k) => w.transfers[k])
          .filter((t) => String(t.transfer_group || '') === g) };
      },
      create: async (params, opts) => {
        w.calls.push(['transfers.create', params && params.destination, params && params.amount]);
        if (w.failRepay) {
          const e = new Error(w.failRepay.message || 'Insufficient funds.');
          e.code = w.failRepay.code || 'balance_insufficient';
          throw e;
        }
        return guard(opts && opts.idempotencyKey, params, () => {
          const t = Object.assign({ id: 'tr_repay_' + (++w.seq), amount_reversed: 0 }, params);
          w.transfers[t.id] = t;
          w.repays.push(t);
          return t;
        });
      },
    },
    paymentIntents: {
      retrieve: async (id) => {
        w.calls.push(['paymentIntents.retrieve', id]);
        if (w.failContext) {
          const e = new Error('Request rate limit exceeded');
          e.code = 'rate_limit';
          throw e;
        }
        const pi = w.paymentIntents[id];
        if (!pi) { const e = new Error('No such payment_intent'); e.code = 'resource_missing'; throw e; }
        return pi;
      },
    },
  };
}

// ── Fake Firestore: only the three shapes the branches touch.
function makeDb(w) {
  return {
    collection: (name) => ({
      add: async (doc) => {
        if (name === 'email_queue') w.emails.push(doc);
        else if (/\/activity$/.test(name)) w.activities.push(Object.assign({ _path: name }, doc));
        else w.otherWrites.push([name, doc]);
        return { id: 'doc_' + (++w.seq) };
      },
      doc: (id) => ({
        get: async () => {
          const d = (w.firestore[name] || {})[id];
          return { exists: !!d, data: () => d };
        },
      }),
    }),
  };
}

const SERVER_TS = Symbol('serverTimestamp');

// The canonical audit shape: a $10,000.00 destination charge. The platform fee
// comes from the SHIPPED function, so if the rate moves this stays honest.
const CHARGE_CENTS = 1000000;
const FEE_CENTS = connectLogic.platformFeeCents(CHARGE_CENTS);   // 34030
const TRANSFER_CENTS = CHARGE_CENTS - FEE_CENTS;                 // 965970

function world(over) {
  return Object.assign({
    seq: 0, now: 2000, idem: new Map(),
    calls: [], emails: [], activities: [], otherWrites: [], logs: [], slackPosts: [], repays: [],
    failReversal: null, failRepay: null, failContext: false, expandTransfer: true,
    transfers: {
      tr_X: {
        id: 'tr_X', amount: TRANSFER_CENTS, amount_reversed: 0,
        destination: 'acct_ROOFCO', currency: 'usd', transfer_group: 'group_Z',
      },
    },
    reversals: {},
    charges: {
      ch_X: {
        id: 'ch_X', amount: CHARGE_CENTS, amount_refunded: 0, currency: 'usd',
        transfer: 'tr_X', transfer_group: 'group_Z', payment_intent: 'pi_X',
      },
    },
    paymentIntents: {
      pi_X: { id: 'pi_X', metadata: { invoiceId: 'INV1', userId: 'u_contractor', companyId: 'C_ROOFCO' } },
    },
    firestore: { invoices: { INV1: { leadId: 'lead1', createdBy: 'u_contractor', companyId: 'C_ROOFCO' } } },
  }, over || {});
}

// A REAL chargeback as Stripe delivers it: the funds are already withdrawn, so
// balance_transactions carries the negative entry that proves the platform was
// debited. An INQUIRY carries an empty array — nothing was taken from anyone.
function dispute(over) {
  return Object.assign({
    id: 'dp_1', charge: 'ch_X', payment_intent: 'pi_X', amount: CHARGE_CENTS,
    reason: 'product_not_received', status: 'needs_response', created: 1000,
    evidence_details: { due_by: 1800000000 },
    balance_transactions: [{ id: 'txn_1', amount: -CHARGE_CENTS }],
  }, over || {});
}
const inquiry = (over) => dispute(Object.assign(
  { status: 'warning_needs_response', balance_transactions: [] }, over || {}));

// Run ONE delivery against a world. Called repeatedly on the same world so
// state persists across deliveries — that persistence is the mechanism behind
// findings #4 and #10. `which` is the Stripe event type suffix; created and
// funds_withdrawn share one branch and are told apart by event.type, so the
// harness feeds the real type rather than picking a runner.
async function run(which, w, disputeObj) {
  const ctx = vm.createContext({
    event: { id: 'evt_1', type: 'charge.dispute.' + which, data: { object: disputeObj } },
    stripe: makeStripe(w),
    db: makeDb(w),
    connectLogic,
    logger: {
      warn: (n, p) => w.logs.push(['warn', n, p]),
      error: (n, p) => w.logs.push(['error', n, p]),
      info: (n, p) => w.logs.push(['info', n, p]),
    },
    getAuth: () => ({ getUser: async () => ({ email: 'contractor@example.com' }) }),
    FieldValue: { serverTimestamp: () => SERVER_TS },
    require: (p) => {
      if (/slack$/.test(p)) {
        return { postSlack: async (payload) => { w.slackPosts.push(payload); return { posted: true }; } };
      }
      throw new Error('unexpected require in extracted branch: ' + p);
    },
    console,
  });
  SCRIPT.runInContext(ctx);
  const fn = which === 'closed' ? ctx.__runClosed : ctx.__runOpen;
  try { await fn(); return null; } catch (e) { return e; }
}

// ── Readers over the resulting artefacts (PROPERTIES, not source text) ─────
const reversalCalls = (w) => w.calls.filter((c) => c[0] === 'transfers.createReversal');
const repayCalls = (w) => w.calls.filter((c) => c[0] === 'transfers.create');
const lastEmail = (w) => w.emails[w.emails.length - 1] || { subject: '', bodyPlain: '' };
const lastActivity = (w) => w.activities[w.activities.length - 1] || {};
const lastSlack = (w) => JSON.stringify(w.slackPosts[w.slackPosts.length - 1] || {});
// Everything a human is told about the most recent event, in one string.
const told = (w) => [lastEmail(w).subject, lastEmail(w).bodyPlain, lastSlack(w)].join('\n');
// …and everything they were told across the WHOLE sequence. A duplicate
// delivery may legitimately suppress its own alert, so "the last alert is
// clean" is not the same claim as "we never said the false thing".
const toldEver = (w) => JSON.stringify([w.emails, w.slackPosts]);
const reversedOn = (w, tr) => (w.reversals[tr] || []).reduce((s, r) => s + r.amount, 0);
const money = (c) => (c / 100).toFixed(2);
const logNames = (w) => w.logs.map((l) => l[1]);
// The false claims the audit found. Each is a sentence the shipped code emits.
const CLAIMS_PLATFORM_CHARGE = /collected on the platform account|platform charge/i;
const CLAIMS_NOTHING_TAKEN = /nothing was pulled from a payout balance|Nothing had been pulled back|nothing to return to you|never reversed a transfer/i;
const CLAIMS_RECOVERED = /has been recovered from your Stripe payout balance/i;

async function main() {
  if (!SCRIPT) {
    console.log('\nEXTRACTION FAILED — cannot run behavioural scenarios. Re-anchor, do not delete.');
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // S1/S2 — an INQUIRY is not a chargeback. Stripe withdraws NOTHING from the
  // platform balance on warning_needs_response, so reversing the contractor's
  // transfer debits them for an event that cost the platform zero — and no code
  // path ever gives it back (findings #2, #6). The copy must not call it a
  // platform charge either (finding #8): a transfer EXISTS, we chose not to pull it.
  console.log('\nS1/S2 — an inquiry must not reverse, and must not be mis-described');
  {
    const w = world();
    await run('created', w, inquiry());
    ok('S1 an inquiry issues ZERO transfer reversals', reversalCalls(w).length === 0,
      'Stripe withdrew nothing; a reversal here debits the contractor $' + money(TRANSFER_CENTS)
        + ' for an event that cost the platform $0, and nothing repays it');
    ok('S1 the contractor is NOT told money was recovered from their balance',
      !CLAIMS_RECOVERED.test(told(w)), told(w).slice(0, 300));
    ok('S2 an inquiry is NOT described as a platform charge',
      !CLAIMS_PLATFORM_CHARGE.test(told(w)),
      'a transfer to acct_ROOFCO exists — "collected on the platform account" is false, and it is the'
        + ' sentence that stops anyone looking for the money');
    ok('S1 the alert still fires (silence is its own defect)',
      w.emails.length === 1 && w.slackPosts.length === 1);
    ok('S1 the activity row does not record a recovery',
      lastActivity(w).recovery !== 'reversed' && !lastActivity(w).reversalId,
      JSON.stringify(lastActivity(w)));
    // POSITIVE, and it is what couples the pure module's reason STRING to the
    // copy that reads it. stripe.js selects the recovery paragraph by
    // `decision.reason === 'inquiry_no_funds_withdrawn'`; rename that constant
    // and the paragraph silently degrades to the generic needs-review alarm
    // while the intro still says "inquiry" (that sentence is driven by a
    // different flag). Every negative assertion above survives the rename —
    // these two do not, which is the point of pinning the reassurance itself.
    ok('S1 the copy states plainly that no money was taken from anyone',
      /no money from anyone|nothing has been pulled/i.test(told(w))
      && /second notice|escalat/i.test(told(w)),
      told(w).slice(0, 500));
    ok('S1 an inquiry is NOT escalated as a recovery failure or a needs-review incident',
      !/RECOVERY WAS NOT POSSIBLE|RECOVERY FAILED|NEEDS REVIEW|settling this by hand/i.test(told(w)),
      'every Amex retrieval would page the owner and alarm the contractor — ' + told(w).slice(0, 400));
    ok('S1 the inquiry is not billed a dispute fee it never incurred',
      !/per-dispute fee/i.test(told(w)),
      'Stripe charges no fee unless an inquiry escalates — saying otherwise is a false statement about'
        + ' the contractor\'s statement');

    // The deliberate asymmetry: a warning_* status wins even if a payload
    // somehow arrives carrying a debit entry. An inquiry never debits us, and
    // guessing the other way costs the contractor $' + money(TRANSFER_CENTS).
    const odd = world();
    await run('created', odd, dispute({ status: 'warning_under_review' }));
    ok('S1 warning_under_review refuses to reverse even with a debit entry present',
      reversalCalls(odd).length === 0, JSON.stringify(odd.calls));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S3 — the FULL inquiry lifecycle. An inquiry that closes without escalating
  // arrives as warning_closed, and an inquiry can never close 'won' (the card
  // networks send no win message for one), so a reversal taken at open is never
  // repaid by any path. Across the whole lifecycle: no money in either direction.
  console.log('\nS3 — a complete inquiry lifecycle moves no money at all');
  {
    const w = world();
    await run('created', w, inquiry());
    await run('closed', w, inquiry({ status: 'warning_closed' }));
    ok('S3 zero reversals across created→closed', reversalCalls(w).length === 0);
    ok('S3 zero repayment transfers across created→closed', repayCalls(w).length === 0);
    ok('S3 the contractor is never told money is being held back',
      !/still held back|has NOT been returned|reviewing whether it is owed/i.test(told(w)),
      'that copy is only honest if we actually took something — here we must not have');
    ok('S3 both events alerted', w.emails.length === 2 && w.slackPosts.length === 2);
  }

  // ════════════════════════════════════════════════════════════════════════
  // S4 — an inquiry that ESCALATES. This is why "just skip warning_*" is unsafe
  // on its own: once the issuer escalates, Stripe DOES withdraw the funds, and
  // with no branch for that the platform eats the full charge.
  console.log('\nS4 — an escalated inquiry reverses exactly once, and a win repays it');
  {
    const w = world();
    await run('created', w, inquiry());
    await run('funds_withdrawn', w, dispute({ status: 'needs_response' }));
    await run('closed', w, dispute({ status: 'won' }));
    ok('S4 exactly ONE reversal lands across inquiry→escalation→win',
      reversedOn(w, 'tr_X') === TRANSFER_CENTS,
      'reversed ' + reversedOn(w, 'tr_X') + ' of ' + TRANSFER_CENTS);
    ok('S4 the escalation alerts (it is a real state change that moved money)',
      w.emails.length === 3, 'inquiry + escalation + close = ' + w.emails.length);
    ok('S4 the win repays exactly what was reversed',
      w.repays.length === 1 && w.repays[0].amount === TRANSFER_CENTS
      && w.repays[0].destination === 'acct_ROOFCO', JSON.stringify(w.repays));

    // S4b — a NON-inquiry whose withdrawal has not landed yet. Distinct from an
    // inquiry: this one will debit us, so the copy must say "not yet" rather
    // than "an inquiry takes nothing", and the recovery must still wait.
    const b = world();
    await run('created', b, dispute({ balance_transactions: [] }));
    ok('S4b a dispute with no debit yet does not reverse',
      reversalCalls(b).length === 0, JSON.stringify(b.calls));
    ok('S4b …and is not described as an inquiry',
      !/an inquiry is a request for information/i.test(told(b)), told(b).slice(0, 300));
    // Same reason-string coupling as S1: `funds_not_yet_withdrawn` selects a
    // "not yet, you will get a second notice" paragraph. Renamed, it degrades
    // into a needs-review alarm for a dispute that is proceeding normally.
    ok('S4b …and says the money has not been taken YET, not that recovery failed',
      /yet/i.test(told(b))
      && !/RECOVERY WAS NOT POSSIBLE|RECOVERY FAILED|NEEDS REVIEW/i.test(told(b)),
      told(b).slice(0, 400));
    await run('funds_withdrawn', b, dispute());
    ok('S4b the withdrawal event performs the recovery',
      reversedOn(b, 'tr_X') === TRANSFER_CENTS);

    // S4c — the ORDINARY chargeback: created and funds_withdrawn arrive seconds
    // apart carrying the same debit. One reversal, and the twin must not
    // double-email every contractor who is ever charged back.
    const c = world();
    await run('created', c, dispute());
    await run('funds_withdrawn', c, dispute());
    ok('S4c the created/funds_withdrawn twins reverse exactly once',
      reversedOn(c, 'tr_X') === TRANSFER_CENTS && reversalCalls(c).length === 1,
      JSON.stringify(c.calls));
    ok('S4c the twin does not send a second contractor email',
      c.emails.length === 1, c.emails.length + ' emails');
  }

  // ════════════════════════════════════════════════════════════════════════
  // S5 — the ordinary chargeback. dispute.amount is the GROSS charge while the
  // transfer is charge-minus-fee, so the clamp is the normal path, not an edge.
  console.log('\nS5 — a real chargeback reverses, clamped to the transfer');
  {
    const w = world();
    await run('created', w, dispute({ status: 'needs_response' }));
    ok('S5 exactly one reversal', reversalCalls(w).length === 1);
    ok('S5 reversed the transfer remainder, never the gross charge',
      reversedOn(w, 'tr_X') === TRANSFER_CENTS,
      'reversing dispute.amount (' + CHARGE_CENTS + ') would be an API error, not a rounding difference');
    ok('S5 the contractor is told the money was recovered', CLAIMS_RECOVERED.test(told(w)));
    ok('S5 the activity row records the reversal',
      lastActivity(w).recovery === 'reversed' && !!lastActivity(w).reversalId,
      JSON.stringify(lastActivity(w)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S6 — reversal FAILED, then WON. balance_insufficient against a daily-payout
  // Express account is the branch's own documented NORMAL failure. Nothing was
  // taken from the contractor, so a win must repay nothing — and must say that
  // truthfully rather than implying a repayment happened (finding #7).
  console.log('\nS6 — reversal failed → won: repay nothing, and say so truthfully');
  {
    const w = world({ failReversal: { code: 'balance_insufficient' } });
    await run('created', w, dispute({ status: 'needs_response' }));
    w.failReversal = null;
    await run('closed', w, dispute({ status: 'won' }));
    ok('S6 nothing was actually reversed', reversedOn(w, 'tr_X') === 0);
    ok('S6 the win issues NO repayment transfer', repayCalls(w).length === 0,
      'repaying a contractor who was never debited gifts them the money out of the platform balance');
    ok('S6 the win does not claim a repayment was sent',
      !/has been sent back to you|Repayment: sent/i.test(told(w)), told(w).slice(0, 300));
    ok('S6 the created alert named the failure to the owner',
      /RECOVERY FAILED/i.test((w.emails[0] || {}).subject + ((w.emails[0] || {}).bodyPlain || '')
        + JSON.stringify(w.slackPosts[0] || {})),
      'the platform is out $' + money(CHARGE_CENTS) + ' and only this alert says so');
  }

  // ════════════════════════════════════════════════════════════════════════
  // S7 — the remediation the code's OWN alert instructs. The auto-reversal
  // fails, ops reverses by hand in the Stripe Dashboard (which writes no
  // metadata), the dispute is later WON. Attribution by metadata alone then
  // sees $0 and every surface asserts "nothing had been pulled back" while the
  // contractor is out $9,659.70 (findings #9, #12). Auto-repaying is NOT
  // required — an unattributed reversal could be refund-driven — but asserting
  // the zero is the defect.
  console.log('\nS7 — a hand-made reversal must never be reported as "nothing taken"');
  {
    const w = world({ failReversal: { code: 'balance_insufficient' } });
    await run('created', w, dispute({ status: 'needs_response' }));
    // The human acts: a Dashboard reversal, after the dispute opened, no metadata.
    w.failReversal = null;
    w.transfers.tr_X.amount_reversed = TRANSFER_CENTS;
    w.reversals.tr_X = [{ id: 'trr_manual', amount: TRANSFER_CENTS, metadata: {}, created: 1500 }];
    await run('closed', w, dispute({ status: 'won' }));
    ok('S7 the contractor is NOT told nothing was pulled back',
      !CLAIMS_NOTHING_TAKEN.test(told(w)),
      'the platform holds $' + money(TRANSFER_CENTS) + ' of theirs and every surface says otherwise');
    ok('S7 the amount actually pulled back is named in what we tell them',
      told(w).indexOf(money(TRANSFER_CENTS)) !== -1,
      'a needs-review line that omits the number is not actionable — got: ' + told(w).slice(0, 400));
    ok('S7 no OVER-repayment: if it repays at all it repays exactly the unattributed amount',
      w.repays.length === 0 || (w.repays.length === 1 && w.repays[0].amount === TRANSFER_CENTS),
      JSON.stringify(w.repays));
    ok('S7 the discrepancy is greppable in the logs',
      logNames(w).some((n) => /unattributed|unrecovered|review/i.test(n)),
      JSON.stringify(logNames(w)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S8 — the happy path this whole branch exists for.
  console.log('\nS8 — a won dispute repays exactly what this dispute took');
  {
    const w = world();
    await run('created', w, dispute({ status: 'needs_response' }));
    await run('closed', w, dispute({ status: 'won' }));
    ok('S8 exactly one repayment transfer', w.repays.length === 1, JSON.stringify(w.repays));
    ok('S8 repaid the reversed amount to the connected account',
      w.repays.length === 1 && w.repays[0].amount === TRANSFER_CENTS
      && w.repays[0].destination === 'acct_ROOFCO');
    ok('S8 the repayment is stamped so a retry can find it',
      w.repays.length === 1 && !!w.repays[0].metadata
      && w.repays[0].metadata.source === 'nbd_dispute_won_repay'
      && w.repays[0].metadata.disputeId === 'dp_1');
    ok('S8 the activity row records the repayment', lastActivity(w).repaidCents === TRANSFER_CENTS,
      JSON.stringify(lastActivity(w)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S9 — closed arrives having never seen a created. A hard stop (the 30s Cloud
  // Run deadline, an OOM, an eviction) leaves the idempotency marker behind with
  // no work done, so the created delivery is consumed permanently; or the
  // endpoint simply never had charge.dispute.created enabled. Nothing was taken,
  // so nothing may be repaid — and it must still alert.
  console.log('\nS9 — closed with no created ever processed: no repayment, still alerts');
  {
    const w = world();
    await run('closed', w, dispute({ status: 'won' }));
    ok('S9 no repayment transfer (nothing was ever taken)', repayCalls(w).length === 0,
      'the metadata attribution is what keeps this from paying out of the platform balance');
    ok('S9 the win still produces an alert', w.emails.length === 1 && w.slackPosts.length === 1);
    ok('S9 the activity row records zero reversed and zero repaid',
      lastActivity(w).reversedCents === 0 && lastActivity(w).repaidCents === 0,
      JSON.stringify(lastActivity(w)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S10 — DUPLICATE created. Delivery 1 reverses successfully, then a post-money
  // read throws; the outer catch deletes the marker and Stripe redelivers. On
  // delivery 2 the transfer it already emptied reads amount_reversed === amount,
  // so the decision is "nothing_to_reverse" and all three renderers report a
  // platform charge — the contractor holds our written statement that they were
  // not debited while $9,659.70 is gone (findings #4, #10). Because the platform
  // fee makes the transfer strictly smaller than the charge, EVERY full
  // chargeback that redelivers lands here.
  console.log('\nS10 — a redelivered created must not relabel a completed reversal');
  {
    const w = world();
    await run('created', w, dispute({ status: 'needs_response' }));
    await run('created', w, dispute({ status: 'needs_response' }));
    ok('S10 the money moved exactly once across two deliveries',
      reversedOn(w, 'tr_X') === TRANSFER_CENTS, 'reversed ' + reversedOn(w, 'tr_X'));
    ok('S10 nothing we ever said called it a platform charge',
      !CLAIMS_PLATFORM_CHARGE.test(toldEver(w)),
      'when delivery 1 threw before alerting, delivery 2 is the ONLY notice the contractor gets');
    ok('S10 nothing we ever said claimed no money was pulled',
      !CLAIMS_NOTHING_TAKEN.test(toldEver(w)), told(w).slice(0, 300));
    ok('S10 the second delivery names the reversal it found',
      lastActivity(w).recovery === 'reversed' && !!lastActivity(w).reversalId,
      'a reconciliation reading a "not_applicable" row invoices the contractor for money already'
        + ' clawed back — ' + JSON.stringify(lastActivity(w)));

    // PARTIAL shape, same trigger: delivery 2 computes a DIFFERENT amount under
    // the SAME idempotency key, so Stripe rejects it and the alert instructs a
    // manual reversal for a reversal that already succeeded. The money invariant
    // must hold regardless.
    const p = world();
    const half = Math.round(CHARGE_CENTS / 2);
    await run('created', p, dispute({ status: 'needs_response', amount: half }));
    await run('created', p, dispute({ status: 'needs_response', amount: half }));
    ok('S10p a redelivered PARTIAL dispute never double-debits the contractor',
      reversedOn(p, 'tr_X') === half, 'reversed ' + reversedOn(p, 'tr_X') + ' on a ' + half + ' dispute');
    ok('S10p the redelivery does not report RECOVERY FAILED for a reversal that succeeded',
      !/RECOVERY FAILED/i.test(toldEver(p)),
      'delivery 2 re-derives a SMALLER amount off the already-mutated transfer — same idempotency key,'
        + ' different params, Stripe answers 400. A compliant operator acting on that alert'
        + ' double-debits the contractor by up to $' + money(TRANSFER_CENTS - half));
    ok('S10p …and does not tell them nothing was pulled',
      !CLAIMS_NOTHING_TAKEN.test(toldEver(p)) && !CLAIMS_PLATFORM_CHARGE.test(toldEver(p)),
      told(p).slice(0, 300));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S11 — DUPLICATE closed. Stripe retries for ~3 days while an idempotency key
  // is retained only ~24h, so the durable guard is the transfer_group scan.
  console.log('\nS11 — a redelivered closed must not pay twice');
  {
    const w = world();
    await run('created', w, dispute({ status: 'needs_response' }));
    await run('closed', w, dispute({ status: 'won' }));
    await run('closed', w, dispute({ status: 'won' }));
    ok('S11 exactly one repayment transfer after two closed deliveries',
      w.repays.length === 1, JSON.stringify(w.repays.map((r) => [r.id, r.amount])));
    ok('S11 the second delivery recognised the prior repayment',
      logNames(w).indexOf('dispute_won_repay_already_done') !== -1, JSON.stringify(logNames(w)));
    ok('S11 the second delivery does not report a repayment failure',
      !/repayment FAILED/i.test(told(w)), told(w).slice(0, 300));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S12 — a post-money context failure. resolveInvoiceContext runs AFTER the
  // reversal and its errors propagate by design; a 429 on the PI retrieve then
  // throws the whole branch, the outer catch deletes the marker, and the alert —
  // the next statement after the failing call — never fires. The money already
  // moved. The alert must survive the context being unavailable (finding #10).
  console.log('\nS12 — a post-money context failure must not swallow the alert');
  {
    const w = world({ failContext: true });
    const threw = await run('created', w, dispute({ status: 'needs_response' }));
    ok('S12 the money still moved', reversedOn(w, 'tr_X') === TRANSFER_CENTS);
    ok('S12 the branch does not throw away the whole delivery', !threw,
      threw ? String(threw.message) : '');
    ok('S12 the owner is still alerted about the chargeback', w.slackPosts.length === 1,
      'without lead/invoice context the alert degrades — it must not disappear');
  }

  // ════════════════════════════════════════════════════════════════════════
  // S13 — LOST with a transfer that was never clawed back. reversedCents === 0
  // collapses two different states: a genuine platform charge, and a reversal
  // that threw. In the second the contractor still holds $9,659.70 recoverable by
  // hand, and the last alert tells the owner there is no counterparty (finding #3).
  console.log('\nS13 — lost + unreversed transfer is not a "platform charge"');
  {
    const w = world({ failReversal: { code: 'balance_insufficient' } });
    await run('created', w, dispute({ status: 'needs_response' }));
    w.failReversal = null;
    await run('closed', w, dispute({ status: 'lost' }));
    ok('S13 the loss is not reported as a platform charge',
      !CLAIMS_PLATFORM_CHARGE.test(told(w)),
      'acct_ROOFCO still holds $' + money(TRANSFER_CENTS) + ' that is recoverable — saying there is no'
        + ' counterparty closes the ticket on a live receivable');
    ok('S13 the transfer and destination survive into the audit trail',
      JSON.stringify(lastActivity(w)).indexOf('acct_ROOFCO') !== -1
      || JSON.stringify(w.logs).indexOf('acct_ROOFCO') !== -1,
      'the discriminator must outlive the alert — ' + JSON.stringify(lastActivity(w)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // S14 — the owner-actionable copy exists only in the Slack block. It has to
  // actually reach postSlack, on both failure paths (findings #1, #11 cover the
  // unbound-secret half; this covers the call half).
  console.log('\nS14 — the act-by-hand copy actually reaches postSlack');
  {
    const w = world({ failReversal: { code: 'balance_insufficient' } });
    await run('created', w, dispute({ status: 'needs_response' }));
    ok('S14 a failed reversal posts to Slack', w.slackPosts.length === 1);
    ok('S14 …carrying an actionable remediation', /➜|invoice the contractor/i.test(lastSlack(w)),
      lastSlack(w).slice(0, 300));
    // Finding #7: the remediation the alert asks for must be ATTRIBUTABLE. A
    // dashboard-button reversal writes no metadata, so the win path cannot see
    // it and the contractor is never repaid — the instruction has to carry the
    // metadata keys the closed branch reads, and name the real transfer.
    ok('S14 …that stamps the metadata the win-repay path reads',
      /metadata\[disputeId\]/.test(lastSlack(w)) && /metadata\[source\]/.test(lastSlack(w)),
      'an unattributable remediation is why a won dispute repays $0 — ' + lastSlack(w).slice(0, 400));
    ok('S14 …naming this dispute and this transfer, not a placeholder',
      lastSlack(w).indexOf('dp_1') !== -1 && lastSlack(w).indexOf('tr_X') !== -1,
      lastSlack(w).slice(0, 400));

    const r = world({ failRepay: { code: 'balance_insufficient' } });
    await run('created', r, dispute({ status: 'needs_response' }));
    await run('closed', r, dispute({ status: 'won' }));
    ok('S14 a failed repayment posts to Slack', r.slackPosts.length === 2);
    ok('S14 …naming the contractor as still short', /still out|by hand/i.test(lastSlack(r)),
      lastSlack(r).slice(0, 300));
    ok('S14 a failed repayment does not record a repaid amount',
      lastActivity(r).repaidCents === 0 && !!lastActivity(r).repayError,
      JSON.stringify(lastActivity(r)));
  }
}

main().then(() => {
  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
}, (e) => {
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});

/* MUTATION LOG — 2026-07-30, all shapes run and verified.
 *
 * A: the SOURCE-LEVEL anchors (the only ones in this file; every other
 *    assertion is a property of what the code DID).
 *   A1 ORIGINAL  rename the branch to 'charge.dispute.opened'  → RED at
 *                extraction ("RE-ANCHOR THIS HARNESS"), never a silent pass.
 *   A2 REFORMAT  split the else-if head across six lines with extra spaces
 *                → GREEN. The anchor is \s*-tolerant and paren-matched on
 *                purpose: a formatter must not be able to redden a money suite,
 *                and the head legitimately grew a second event type today.
 *   A3 BENIGN    add two comment lines naming charge.dispute.created and
 *                `event.type === 'charge.dispute.funds_withdrawn'` → GREEN.
 *                Prose can neither satisfy nor inflate the count, because the
 *                anchor only inspects paren-matched else-if CONDITIONS.
 *   A4 CONTROL   add a SECOND real else-if on charge.dispute.created → RED.
 *                One of the two would be dead and the harness would silently
 *                test the wrong half.
 *   A5/A6 same three shapes for the alertInvoicePaymentEvent anchor: a second
 *                definition under the same name → RED; reformatting the
 *                signature across lines → GREEN.
 *
 * B: BEHAVIOURAL non-vacuity — each audit fix reverted in the source, proving
 *    the scenario that covers it reddens, and for the right reason.
 *   B1 drop the debit gate in decideDisputeReversal (#2/#6) → S1, S3, S4 red.
 *   B2 collapse recoveryState back to `!decision.reverse` (#3/#4/#8) → S2, S10 red.
 *   B3 drop the prior-reversal lookup (#4/#10)                → S10, S10p red.
 *   B4 drop the unattributed-reversal accounting (#9/#12)     → S7 red.
 *   B5 let the post-money context read propagate (#10)        → S12 red.
 *   B6 collapse the lost-with-unreversed-transfer copy (#3)   → S13 red.
 *   B8 rename the 'inquiry_no_funds_withdrawn' reason string  → S1 red (the
 *      reason is a cross-file API — stripe.js picks the contractor's paragraph
 *      off it, and the "this is an inquiry" intro is driven by a DIFFERENT flag,
 *      so only the reassurance copy itself pins the coupling).
 *   B7 CONTROL: a cosmetic no-op change no assertion claims → GREEN.
 */
