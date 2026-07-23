/**
 * tests/invoice-payment-webhook.test.js — money-path invariants for the
 * customer-invoice payment reconciliation in functions/stripe.js
 * (invoiceWebhook, the `payment_intent.succeeded` branch, ~L1296-1373).
 *
 * The Cloud Function can't be require()d standalone (onRequest / defineSecret
 * run at module load), so — per the house pattern used by
 * stripe-payment-link-tax.test.js — `creditPayment()` below is a FAITHFUL
 * MIRROR of the db.runTransaction() callback that credits a Stripe payment
 * onto an invoice. If you change that transaction block in stripe.js, mirror
 * it here.
 *
 * What it guards (all money-critical, none previously covered — this is the
 * "invoice-PAYMENT e2e" gap from the Stripe go-live checklist):
 *   • cumulative credit: newPaid = priorPaid + received (a rep's cash deposit
 *     plus a Stripe balance payoff must SUM, never overwrite);
 *   • status/paidAt flip to 'paid' ONLY when the balance reaches zero — a
 *     deposit-sized online payment leaves the invoice open;
 *   • IDEMPOTENCY: a replayed paymentIntent (Stripe retries after a lost ack,
 *     outer catch having deleted the stripe_events marker) must be a true
 *     no-op — no double-credit, no partial wrongly flipped 'paid';
 *   • owner-mismatch: metadata.userId that doesn't match inv.createdBy is
 *     refused (Stripe Dashboard metadata is editable by anyone with write
 *     access);
 *   • append-only payments[] ledger, penny rounding, and balanceDue clamp.
 *
 * Zero deps. Run: node tests/invoice-payment-webhook.test.js
 */
'use strict';

// ── Firestore sentinel models (the mirror resolves these itself) ───────────
const SERVER_TS = Symbol('serverTimestamp');
// arrayUnion(x) applied to a prior array = append-if-absent (dedup).
const arrayUnion = (prior, x) => {
  const a = Array.isArray(prior) ? prior.slice() : [];
  if (!a.includes(x)) a.push(x);
  return a;
};

/**
 * Faithful mirror of the runTransaction callback in stripe.js.
 * @param inv  the invoice doc data, or null to model a missing doc.
 * @param paymentIntent  Stripe PI: { id, amount_received, metadata }.
 * @param claimedUserId  paymentIntent.metadata.userId.
 * @returns { result, update } — result mirrors the txn return value; update is
 *   the field map written via tx.update (null when the credit is skipped).
 */
function creditPayment(inv, paymentIntent, claimedUserId) {
  if (!inv) return { result: { skipped: 'not_found' }, update: null };
  if (claimedUserId && inv.createdBy !== claimedUserId) {
    return { result: { skipped: 'owner_mismatch', actualCreatedBy: inv.createdBy }, update: null };
  }
  const applied = Array.isArray(inv.paidIntentIds) ? inv.paidIntentIds : [];
  if (applied.includes(paymentIntent.id)) return { result: { skipped: 'already_applied' }, update: null };

  const total = Number(inv.total) || 0;
  const receivedCents = Number(paymentIntent.amount_received);
  const received = Number.isFinite(receivedCents) && receivedCents > 0
    ? Math.round(receivedCents) / 100 : 0;
  const priorPaid = Number(inv.amountPaid) || 0;
  const newPaid = Math.round((priorPaid + received) * 100) / 100;
  const newBalanceDue = Math.max(0, Math.round((total - newPaid) * 100) / 100);
  const fullyPaid = newBalanceDue === 0;

  const priorPayments = Array.isArray(inv.payments) ? inv.payments.slice() : [];
  if (received > 0) {
    priorPayments.push({ amount: received, at: new Date(), method: 'stripe', paymentIntentId: paymentIntent.id });
  }
  const update = {
    status: fullyPaid ? 'paid' : (inv.status || 'sent'),
    paidAt: fullyPaid ? SERVER_TS : (inv.paidAt || null),
    lastPaymentAt: SERVER_TS,
    payments: priorPayments,
    stripePaymentIntentId: paymentIntent.id,
    paidIntentIds: arrayUnion(inv.paidIntentIds, paymentIntent.id),
    balanceDue: newBalanceDue,
    depositPaid: newPaid >= (Number(inv.depositAmount) || 0),
    amountPaid: newPaid,
    updatedAt: SERVER_TS,
  };
  return { result: { credited: true, fullyPaid, received, newPaid, newBalanceDue, leadId: inv.leadId }, update };
}

// Apply a returned update onto the invoice to get the persisted next state,
// so a follow-up creditPayment() call models a real Stripe retry.
const apply = (inv, update) => (update ? Object.assign({}, inv, update) : inv);
const PI = (id, cents, userId) => ({ id, amount_received: cents, metadata: { userId, invoiceId: 'INV1' } });

// ── tiny harness (matches the other zero-dep suites) ───────────────────────
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const stripeEntries = (p) => (p || []).filter((e) => e.method === 'stripe');

console.log('INVOICE PAYMENT WEBHOOK — reconciliation invariants');

// A1 — full payment in one shot.
{
  const inv = { createdBy: 'u1', total: 10750, amountPaid: 0, status: 'sent' };
  const { result, update } = creditPayment(inv, PI('pi_1', 1075000, 'u1'), 'u1');
  ok('A1 credited', result.credited === true);
  ok('A1 amountPaid = 10750', update.amountPaid === 10750);
  ok('A1 balanceDue = 0', update.balanceDue === 0);
  ok('A1 fullyPaid → status paid', result.fullyPaid === true && update.status === 'paid');
  ok('A1 paidAt stamped on full payment', update.paidAt === SERVER_TS);
  ok('A1 one stripe payment entry of 10750', stripeEntries(update.payments).length === 1 && update.payments[0].amount === 10750);
  ok('A1 paidIntentIds records the intent', update.paidIntentIds.join() === 'pi_1');
}

// A2 — deposit-sized online payment must NOT flip the invoice to paid.
{
  const inv = { createdBy: 'u1', total: 10000, amountPaid: 0, status: 'sent' };
  const { result, update } = creditPayment(inv, PI('pi_dep', 300000, 'u1'), 'u1');
  ok('A2 amountPaid = 3000', update.amountPaid === 3000);
  ok('A2 balanceDue = 7000', update.balanceDue === 7000);
  ok('A2 NOT fullyPaid', result.fullyPaid === false);
  ok('A2 status stays sent (open)', update.status === 'sent');
  ok('A2 paidAt NOT stamped on partial', update.paidAt === null);
}

// A3 — cash deposit already recorded, Stripe pays the balance: cumulative.
{
  const inv = {
    createdBy: 'u1', total: 10000, amountPaid: 3000, status: 'sent',
    payments: [{ amount: 3000, method: 'cash', at: new Date() }],
  };
  const { result, update } = creditPayment(inv, PI('pi_bal', 700000, 'u1'), 'u1');
  ok('A3 cumulative amountPaid = 10000 (3000 + 7000)', update.amountPaid === 10000);
  ok('A3 balanceDue = 0 → fullyPaid', update.balanceDue === 0 && result.fullyPaid === true);
  ok('A3 status flips to paid on payoff', update.status === 'paid');
  ok('A3 ledger keeps BOTH payments (cash + stripe)', update.payments.length === 2 && stripeEntries(update.payments).length === 1);
}

// B1 — replay of a FULL payment is an idempotent no-op (double-credit guard).
{
  const inv = { createdBy: 'u1', total: 10750, amountPaid: 0, status: 'sent' };
  const first = creditPayment(inv, PI('pi_1', 1075000, 'u1'), 'u1');
  const paid = apply(inv, first.update);
  const replay = creditPayment(paid, PI('pi_1', 1075000, 'u1'), 'u1');
  ok('B1 replay skipped already_applied', replay.result.skipped === 'already_applied');
  ok('B1 replay writes nothing', replay.update === null);
  ok('B1 amountPaid NOT doubled (still 10750)', paid.amountPaid === 10750);
  ok('B1 payments ledger not re-pushed (still 1)', stripeEntries(paid.payments).length === 1);
}

// B2 — replay of a PARTIAL must not wrongly flip it to paid or re-credit.
{
  const inv = { createdBy: 'u1', total: 10000, amountPaid: 0, status: 'sent' };
  const first = creditPayment(inv, PI('pi_dep', 300000, 'u1'), 'u1');
  const partial = apply(inv, first.update);
  const replay = creditPayment(partial, PI('pi_dep', 300000, 'u1'), 'u1');
  ok('B2 partial replay skipped', replay.result.skipped === 'already_applied');
  ok('B2 amountPaid still 3000', partial.amountPaid === 3000);
  ok('B2 balanceDue still 7000', partial.balanceDue === 7000);
  ok('B2 status still sent (not flipped)', partial.status === 'sent');
}

// C — owner-mismatch defense (editable Stripe metadata).
{
  const inv = { createdBy: 'owner_real', total: 5000, amountPaid: 0, status: 'sent' };
  const tamper = creditPayment(inv, PI('pi_x', 500000, 'attacker'), 'attacker');
  ok('C1 owner mismatch refused', tamper.result.skipped === 'owner_mismatch');
  ok('C1 no credit written', tamper.update === null);
  // No claimed userId at all → the `claimedUserId &&` short-circuit lets it through.
  const noClaim = creditPayment(inv, PI('pi_y', 500000, undefined), undefined);
  ok('C2 absent userId does not trip the guard', noClaim.result.credited === true);
}

// D — not-found, malformed amounts, rounding, overpay clamp.
{
  ok('D1 missing invoice → not_found', creditPayment(null, PI('pi_z', 100, 'u1'), 'u1').result.skipped === 'not_found');

  const inv = { createdBy: 'u1', total: 500, amountPaid: 100, status: 'sent', payments: [{ amount: 100, method: 'cash' }] };
  const nan = creditPayment(inv, PI('pi_nan', undefined, 'u1'), 'u1');
  ok('D2 non-finite amount_received → received 0', nan.result.received === 0);
  ok('D2 no phantom payments entry pushed', stripeEntries(nan.update.payments).length === 0);
  ok('D2 amountPaid unchanged (100)', nan.update.amountPaid === 100);

  const neg = creditPayment(inv, PI('pi_neg', -5000, 'u1'), 'u1');
  ok('D3 negative amount_received → received 0, no push', neg.result.received === 0 && stripeEntries(neg.update.payments).length === 0);

  // Float drift: $0.10 prior + $0.20 stripe must be exactly $0.30, balance 0.
  const cents = { createdBy: 'u1', total: 0.30, amountPaid: 0.10, status: 'sent' };
  const drift = creditPayment(cents, PI('pi_c', 20, 'u1'), 'u1');
  ok('D4 penny rounding: 0.10 + 0.20 === 0.30 (no float drift)', drift.update.amountPaid === 0.30);
  ok('D4 exact payoff → balanceDue 0, fullyPaid', drift.update.balanceDue === 0 && drift.result.fullyPaid === true);

  // Overpayment: balanceDue clamps at 0, amountPaid recorded honestly.
  const over = { createdBy: 'u1', total: 100, amountPaid: 0, status: 'sent' };
  const o = creditPayment(over, PI('pi_o', 15000, 'u1'), 'u1');
  ok('D5 overpay: balanceDue clamped to 0 (never negative)', o.update.balanceDue === 0);
  ok('D5 overpay: amountPaid recorded as collected (150)', o.update.amountPaid === 150 && o.result.fullyPaid === true);
}

// E — depositPaid flag drives the "deposit received" UI independent of payoff.
{
  const inv = { createdBy: 'u1', total: 10000, amountPaid: 0, status: 'sent', depositAmount: 3000 };
  const meets = creditPayment(inv, PI('pi_d1', 300000, 'u1'), 'u1');
  ok('E1 payment >= depositAmount → depositPaid true', meets.update.depositPaid === true && meets.result.fullyPaid === false);
  const under = creditPayment(inv, PI('pi_d2', 100000, 'u1'), 'u1');
  ok('E2 payment < depositAmount → depositPaid false', under.update.depositPaid === false);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
