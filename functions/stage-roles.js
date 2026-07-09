/**
 * stage-roles.js — SERVER mirror of the crm-stages.js semantic roles.
 *
 * The client stage config (docs/pro/js/crm-stages.js) is an ES module the
 * functions runtime can't require, so this is a small pure copy of the role
 * mapping. Freeform-pipeline design (Phase 3):
 *
 *   A lead's PERSISTED `stageRole` wins. The client stamps it on every stage
 *   change (crm-pipeline moveCard), so a lead sitting on a tenant's CUSTOM
 *   stage carries its role here even though the server has no idea what that
 *   stage means. The built-in key map is only the FALLBACK for legacy leads /
 *   leads that predate the stageRole denormalization.
 *
 * Keep the WON/JOB/LOST/NEW sets in sync with crm-stages.js (tests/crm-stages-
 * roles.test.js guards the client side; tests/stage-roles.test.js guards this).
 */
'use strict';

const ROLE = { NEW: 'new', ACTIVE: 'active', JOB: 'job', WON: 'won', LOST: 'lost' };

const WON  = new Set(['closed', 'install_complete', 'final_photos', 'final_payment', 'deductible_collected']);
const JOB  = new Set(['job_created', 'permit_pulled', 'materials_ordered', 'materials_delivered', 'crew_scheduled', 'install_in_progress']);
const LOST = new Set(['lost']);
const NEW  = new Set(['new']);

// Legacy raw display-name aliases that affect ROLE (subset of crm-stages
// LEGACY_MAP — only the won/lost ones matter for classification).
const ALIAS = {
  'Complete': 'closed', 'complete': 'closed',
  'Closed Won': 'closed', 'closed_won': 'closed', 'closed-won': 'closed', 'Won': 'closed',
  'Closed': 'closed', 'Closed Lost': 'lost', 'Lost': 'lost',
};

function normKey(stage) {
  const s = String(stage == null ? '' : stage).trim();
  if (!s) return 'new';
  if (WON.has(s) || JOB.has(s) || LOST.has(s) || NEW.has(s)) return s;
  if (ALIAS[s]) return ALIAS[s];
  return s.toLowerCase();
}

function roleFromKey(stage) {
  const k = normKey(stage);
  if (WON.has(k)) return ROLE.WON;
  if (LOST.has(k)) return ROLE.LOST;
  if (JOB.has(k)) return ROLE.JOB;
  if (NEW.has(k)) return ROLE.NEW;
  return ROLE.ACTIVE;
}

const _VALID = new Set(Object.keys(ROLE).map((k) => ROLE[k]));

// Prefer the persisted stageRole (custom-stage-safe); fall back to the key map.
function roleFor(lead) {
  if (lead && typeof lead.stageRole === 'string' && _VALID.has(lead.stageRole)) return lead.stageRole;
  return roleFromKey(lead && (lead._stageKey || lead.stage));
}

function isWon(lead)  { return roleFor(lead) === ROLE.WON; }
function isLost(lead) { return roleFor(lead) === ROLE.LOST; }
// "Decided" = the project is finished either way (won or lost).
function isDecided(lead) { const r = roleFor(lead); return r === ROLE.WON || r === ROLE.LOST; }

module.exports = { ROLE, normKey, roleFromKey, roleFor, isWon, isLost, isDecided };
