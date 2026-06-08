'use strict';
// Behavioral unit test for functions/seat-overage.js (D-3 seat-overage flag +
// notify). Mocks Firestore + admin.auth — no emulator. Verifies: over → flag +
// owner email; within → flag cleared; duplicate event → no second email;
// unlimited/solo → no-op (NBD byte-identical). Run: node tests/seat-overage.test.js

const assert = require('assert');
const { applySeatOverage } = require('../functions/seat-overage');

let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name); } }

// ── Mock factory ──────────────────────────────────────────────
// state = { companies:{cid:{ownerId}}, subs:{key:{plan,seatOverage?}}, members:{cid:[{uid,active}]}, email:'x@y' }
function mocks(state) {
  const writes = [], emails = [];
  const db = {
    doc(p) {
      const parts = p.split('/');
      return {
        async get() {
          if (parts[0] === 'companies' && parts.length === 2) { const c = state.companies[parts[1]]; return { exists: !!c, data: () => c }; }
          if (parts[0] === 'subscriptions') { const s = state.subs[parts[1]]; return { exists: !!s, data: () => s }; }
          return { exists: false, data: () => undefined };
        },
        async set(obj, opts) {
          writes.push({ path: p, obj, opts });
          if (parts[0] === 'subscriptions') state.subs[parts[1]] = Object.assign({}, state.subs[parts[1]], obj);
        }
      };
    },
    collection(p) {
      const parts = p.split('/');
      return {
        where(field, op, val) {
          return { async get() {
            const cid = parts[1];
            const mem = (state.members[cid] || []).filter((m) => m[field] === val);
            return { size: mem.length, forEach: (fn) => mem.forEach((m) => fn({ data: () => m })) };
          } };
        },
        async add(obj) { emails.push(obj); }
      };
    }
  };
  const admin = { auth: () => ({ async getUser() { return { email: state.email || 'owner@x.com' }; } }) };
  return { deps: { db, admin, logger: { warn() {} } }, writes, emails };
}

(async () => {
  // 1. Crew (growth, 3 seats) with owner + 3 active reps (= 4 seats) → over → flag + email.
  {
    const state = { companies: { oaks: { ownerId: 'own1' } }, subs: { oaks: { plan: 'growth' } },
      members: { oaks: [{ uid: 'r1', active: true }, { uid: 'r2', active: true }, { uid: 'r3', active: true }] } };
    const { deps, writes, emails } = mocks(state);
    const r = await applySeatOverage(deps, 'oaks', { plan: 'growth', ownerId: 'own1', notify: true });
    ok('Crew + 3 reps (4 seats) is OVER the 3-seat limit', r.over === true && r.activeSeats === 4 && r.seatLimit === 3);
    ok('writes the seatOverage flag', writes.some((w) => w.obj.seatOverage && w.obj.seatOverage.over === true));
    ok('emails the owner once', emails.length === 1 && emails[0].source === 'stripe_seat_overage' && emails[0].to === 'owner@x.com');
  }

  // 2. Crew with owner + 2 reps (= 3 seats) → exactly at limit → NOT over → clears prior flag.
  {
    const state = { companies: { oaks: { ownerId: 'own1' } }, subs: { oaks: { plan: 'growth', seatOverage: { over: true, plan: 'growth' } } },
      members: { oaks: [{ uid: 'r1', active: true }, { uid: 'r2', active: true }] } };
    const { deps, writes, emails } = mocks(state);
    const r = await applySeatOverage(deps, 'oaks', { plan: 'growth', ownerId: 'own1', notify: true });
    ok('Crew + 2 reps (3 seats) is NOT over (3 == 3)', r.over === false);
    ok('clears the stale flag', writes.some((w) => w.obj.seatOverage !== undefined && !(w.obj.seatOverage && w.obj.seatOverage.over)));
    ok('does not email when within limit', emails.length === 0);
  }

  // 3. Downgrade to Free (1 seat) with owner + 1 rep (= 2 seats) → over → flag + email.
  {
    const state = { companies: { oaks: { ownerId: 'own1' } }, subs: { oaks: { plan: 'free' } },
      members: { oaks: [{ uid: 'r1', active: true }] } };
    const { deps, emails } = mocks(state);
    const r = await applySeatOverage(deps, 'oaks', { plan: 'free', ownerId: 'own1', notify: true });
    ok('Free + 1 rep (2 seats) is OVER the 1-seat limit', r.over === true && r.seatLimit === 1);
    ok('emails the owner on the downgrade', emails.length === 1);
  }

  // 4. Already flagged over for the same plan → no DUPLICATE email (repeat webhook event).
  {
    const state = { companies: { oaks: { ownerId: 'own1' } },
      subs: { oaks: { plan: 'free', seatOverage: { over: true, plan: 'free' } } },
      members: { oaks: [{ uid: 'r1', active: true }] } };
    const { deps, emails } = mocks(state);
    await applySeatOverage(deps, 'oaks', { plan: 'free', ownerId: 'own1', notify: true });
    ok('no duplicate email when already flagged for the same plan', emails.length === 0);
  }

  // 5. Enterprise (unlimited seats) → never over, no email even with many members.
  {
    const state = { companies: { big: { ownerId: 'own1' } }, subs: { big: { plan: 'enterprise', seatOverage: { over: true, plan: 'growth' } } },
      members: { big: [{ uid: 'r1', active: true }, { uid: 'r2', active: true }, { uid: 'r3', active: true }, { uid: 'r4', active: true }] } };
    const { deps, emails } = mocks(state);
    const r = await applySeatOverage(deps, 'big', { plan: 'enterprise', ownerId: 'own1', notify: true });
    ok('Enterprise is never over (unlimited seats)', r.over === false && r.seatLimit === Infinity);
    ok('Enterprise sends no email', emails.length === 0);
  }

  // 6. Solo / NBD (companyId == uid, no team members) on free → 1 seat, not over → byte-identical no-op.
  {
    const state = { companies: {}, subs: { uidNBD: { plan: 'professional' } }, members: {} };
    const { deps, writes, emails } = mocks(state);
    const r = await applySeatOverage(deps, 'uidNBD', { plan: 'free', ownerId: 'uidNBD', notify: true });
    ok('Solo/NBD with no members is NOT over (just the owner seat)', r.over === false && r.activeSeats === 1);
    ok('Solo/NBD writes no flag + sends no email (byte-identical)',
      !writes.some((w) => w.obj.seatOverage && w.obj.seatOverage.over) && emails.length === 0);
  }

  console.log('\n' + '─'.repeat(50));
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
