/**
 * plan-limits.js — single server-side source of truth for plan caps.
 *
 * Mirrors PLANS in docs/pro/js/billing-gate.js (client display). Imported by
 * billing.js (usage meter) AND handlers/admin.js (invite-time seat gate) so the
 * meter and the gate read the SAME seat numbers. Dependency-free on purpose:
 * admin.js can require it without pulling billing.js's onCall registration into
 * its cold-start path.
 *
 * `seats` = included-seat count for the per-seat model. `reps` is retained
 * because billing-gate.js canUse('team') still reads `limits.reps > 1`.
 * Keep starter/foundation and growth/professional alias rows identical.
 * Update this + billing-gate.js PLANS + nbd-auth.js PLAN_LEVELS together.
 */
'use strict';

const PLAN_LIMITS = {
  free:         { leads: 10,        reports: 0,        aiCalls: 0,        reps: 1,        seats: 1 },
  starter:      { leads: 50,        reports: 2,        aiCalls: 20,       reps: 1,        seats: 1 },
  foundation:   { leads: 50,        reports: 2,        aiCalls: 20,       reps: 1,        seats: 1 },
  growth:       { leads: 500,       reports: Infinity, aiCalls: Infinity, reps: 5,        seats: 3 },
  professional: { leads: 500,       reports: Infinity, aiCalls: Infinity, reps: 5,        seats: 3 },
  enterprise:   { leads: Infinity,  reports: Infinity, aiCalls: Infinity, reps: Infinity, seats: Infinity },
};

module.exports = { PLAN_LIMITS };
