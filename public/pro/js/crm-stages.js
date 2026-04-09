/**
 * crm-stages.js — NBD PRO Unified Stage Configuration
 * Single source of truth for all CRM pipeline stages.
 *
 * Supports:
 *  - Insurance, Cash, Finance lead tracks
 *  - Post-contract Job pipeline
 *  - Backward compatibility with legacy 7-stage names
 *  - Kanban column generation (Simple vs Full Pipeline view)
 *  - Stage colors, labels, icons
 */

// ─────────────────────────────────────────────
// STAGE KEYS (internal identifiers — snake_case)
// ─────────────────────────────────────────────

export const S = {
  // ── Shared lead stages ──
  NEW:                'new',
  CONTACTED:          'contacted',
  INSPECTED:          'inspected',

  // ── Insurance track ──
  CLAIM_FILED:        'claim_filed',
  ADJUSTER_SCHEDULED: 'adjuster_meeting_scheduled',
  ADJUSTER_DONE:      'adjuster_inspection_done',
  SCOPE_RECEIVED:     'scope_received',
  ESTIMATE_SUBMITTED: 'estimate_submitted',
  SUPPLEMENT_REQ:     'supplement_requested',
  SUPPLEMENT_APPROVED:'supplement_approved',

  // ── Cash track ──
  ESTIMATE_SENT_CASH: 'estimate_sent_cash',
  NEGOTIATING:        'negotiating',

  // ── Finance track ──
  PREQUAL_SENT:       'prequal_sent',
  LOAN_APPROVED:      'loan_approved',

  // ── Convergence ──
  CONTRACT_SIGNED:    'contract_signed',

  // ── Job stages (post-contract) ──
  JOB_CREATED:        'job_created',
  PERMIT_PULLED:      'permit_pulled',
  MATERIALS_ORDERED:  'materials_ordered',
  MATERIALS_DELIVERED: 'materials_delivered',
  CREW_SCHEDULED:     'crew_scheduled',
  INSTALL_IN_PROGRESS:'install_in_progress',
  INSTALL_COMPLETE:   'install_complete',
  FINAL_PHOTOS:       'final_photos',
  DEDUCTIBLE_COLLECTED:'deductible_collected',
  FINAL_PAYMENT:      'final_payment',
  CLOSED:             'closed',

  // ── Exit ──
  LOST:               'lost',
};

// ─────────────────────────────────────────────
// STAGE METADATA
// Each stage has: label, color, headerClass, track, type
// ─────────────────────────────────────────────

export const STAGE_META = {
  // ── Lead stages ──────────────────────────
  [S.NEW]:                { label: 'New Lead',           color: '#374151', headerClass: 'kh-new',       track: 'shared',    type: 'lead', icon: '🆕' },
  [S.CONTACTED]:          { label: 'Contacted',          color: '#2563eb', headerClass: 'kh-contacted', track: 'shared',    type: 'lead', icon: '📞' },
  [S.INSPECTED]:          { label: 'Inspected',          color: '#2d5a8e', headerClass: 'kh-insp',      track: 'shared',    type: 'lead', icon: '🔍' },

  [S.CLAIM_FILED]:        { label: 'Claim Filed',        color: '#7c3aed', headerClass: 'kh-claim',     track: 'insurance', type: 'lead', icon: '📋' },
  [S.ADJUSTER_SCHEDULED]: { label: 'Adjuster Mtg',       color: '#a855f7', headerClass: 'kh-adj',       track: 'insurance', type: 'lead', icon: '📅' },
  [S.ADJUSTER_DONE]:      { label: 'Adjuster Done',      color: '#8b5cf6', headerClass: 'kh-adjdone',   track: 'insurance', type: 'lead', icon: '✅' },
  [S.SCOPE_RECEIVED]:     { label: 'Scope Received',     color: '#d97706', headerClass: 'kh-scope',     track: 'insurance', type: 'lead', icon: '📄' },
  [S.ESTIMATE_SUBMITTED]: { label: 'Estimate Sent',      color: '#D4A017', headerClass: 'kh-est',       track: 'insurance', type: 'lead', icon: '💰' },
  [S.SUPPLEMENT_REQ]:     { label: 'Supplement',          color: '#ea580c', headerClass: 'kh-supp',      track: 'insurance', type: 'lead', icon: '📝' },
  [S.SUPPLEMENT_APPROVED]:{ label: 'Supp. Approved',      color: '#16a34a', headerClass: 'kh-suppok',    track: 'insurance', type: 'lead', icon: '✅' },

  [S.ESTIMATE_SENT_CASH]: { label: 'Est. Sent',          color: '#D4A017', headerClass: 'kh-est',       track: 'cash',      type: 'lead', icon: '💰' },
  [S.NEGOTIATING]:        { label: 'Negotiating',        color: '#ea580c', headerClass: 'kh-neg',       track: 'cash',      type: 'lead', icon: '🤝' },

  [S.PREQUAL_SENT]:       { label: 'Pre-Qual Sent',      color: '#0891b2', headerClass: 'kh-prequal',   track: 'finance',   type: 'lead', icon: '🏦' },
  [S.LOAN_APPROVED]:      { label: 'Loan Approved',      color: '#16a34a', headerClass: 'kh-loanok',    track: 'finance',   type: 'lead', icon: '✅' },

  [S.CONTRACT_SIGNED]:    { label: 'Contract Signed',    color: '#16a34a', headerClass: 'kh-contract',  track: 'shared',    type: 'lead', icon: '✍️' },

  // ── Job stages ───────────────────────────
  [S.JOB_CREATED]:        { label: 'Job Created',        color: '#0369a1', headerClass: 'kh-jobcr',     track: 'shared',    type: 'job',  icon: '🏗️' },
  [S.PERMIT_PULLED]:      { label: 'Permit',             color: '#4338ca', headerClass: 'kh-permit',    track: 'shared',    type: 'job',  icon: '📜' },
  [S.MATERIALS_ORDERED]:  { label: 'Materials Ordered',  color: '#b45309', headerClass: 'kh-matord',    track: 'shared',    type: 'job',  icon: '📦' },
  [S.MATERIALS_DELIVERED]:{ label: 'Materials Here',     color: '#a16207', headerClass: 'kh-matdel',    track: 'shared',    type: 'job',  icon: '🚚' },
  [S.CREW_SCHEDULED]:     { label: 'Crew Scheduled',     color: '#0d9488', headerClass: 'kh-crew',      track: 'shared',    type: 'job',  icon: '👷' },
  [S.INSTALL_IN_PROGRESS]:{ label: 'Installing',         color: '#059669', headerClass: 'kh-install',   track: 'shared',    type: 'job',  icon: '🔨' },
  [S.INSTALL_COMPLETE]:   { label: 'Install Done',       color: '#22c55e', headerClass: 'kh-instdone',  track: 'shared',    type: 'job',  icon: '✅' },
  [S.FINAL_PHOTOS]:       { label: 'Final Photos',       color: '#10b981', headerClass: 'kh-photos',    track: 'shared',    type: 'job',  icon: '📸' },
  [S.DEDUCTIBLE_COLLECTED]:{ label: 'Deductible',        color: '#14b8a6', headerClass: 'kh-deduct',    track: 'shared',    type: 'job',  icon: '💵' },
  [S.FINAL_PAYMENT]:      { label: 'Final Payment',      color: '#0d9488', headerClass: 'kh-finpay',    track: 'shared',    type: 'job',  icon: '🏦' },
  [S.CLOSED]:             { label: 'Closed',             color: '#22C55E', headerClass: 'kh-closed',    track: 'shared',    type: 'job',  icon: '🏆' },

  // ── Exit ──
  [S.LOST]:               { label: 'Lost',               color: '#6b7280', headerClass: 'kh-lost',      track: 'shared',    type: 'lead', icon: '❌' },
};

// ─────────────────────────────────────────────
// LEGACY STAGE MAPPING
// Maps old 7-stage display names → new stage keys
// ─────────────────────────────────────────────

export const LEGACY_MAP = {
  'New':            S.NEW,
  'New Lead':       S.NEW,
  'Inspected':      S.INSPECTED,
  'Estimate Sent':  S.ESTIMATE_SUBMITTED,    // insurance default
  'Approved':       S.CONTRACT_SIGNED,
  'In Progress':    S.INSTALL_IN_PROGRESS,
  'Complete':       S.CLOSED,
  'Lost':           S.LOST,
  // Also handle old crm.js tag names
  'Contacted':      S.CONTACTED,
  'Negotiating':    S.NEGOTIATING,
  'Closed Won':     S.CLOSED,
  'Closed Lost':    S.LOST,
};

// Reverse: new stage key → closest legacy name (for backward compat)
export const REVERSE_LEGACY = {};
Object.entries(LEGACY_MAP).forEach(([legacy, key]) => {
  if (!REVERSE_LEGACY[key]) REVERSE_LEGACY[key] = legacy;
});

/**
 * Normalize any stage value (legacy display name or new key) → internal key
 */
export function normalizeStage(raw) {
  if (!raw) return S.NEW;
  const trimmed = raw.trim();
  // Already a valid key?
  if (STAGE_META[trimmed]) return trimmed;
  // Legacy display name?
  if (LEGACY_MAP[trimmed]) return LEGACY_MAP[trimmed];
  // Case-insensitive search
  const lower = trimmed.toLowerCase();
  for (const [legacy, key] of Object.entries(LEGACY_MAP)) {
    if (legacy.toLowerCase() === lower) return key;
  }
  // Snake_case match attempt
  const snake = trimmed.replace(/\s+/g, '_').toLowerCase();
  if (STAGE_META[snake]) return snake;
  // Fallback
  return S.NEW;
}

/**
 * Get display label for any stage
 */
export function stageLabel(stageKey) {
  const normalized = normalizeStage(stageKey);
  return STAGE_META[normalized]?.label || stageKey || 'New Lead';
}

/**
 * Get color for any stage
 */
export function stageColor(stageKey) {
  const normalized = normalizeStage(stageKey);
  return STAGE_META[normalized]?.color || '#374151';
}

// ─────────────────────────────────────────────
// KANBAN VIEW CONFIGURATIONS
// ─────────────────────────────────────────────

/**
 * SIMPLE view — backward compatible 7-column layout
 * Maps to the original STAGES array
 */
export const VIEW_SIMPLE = [
  S.NEW,
  S.INSPECTED,
  S.ESTIMATE_SUBMITTED,
  S.CONTRACT_SIGNED,
  S.INSTALL_IN_PROGRESS,
  S.CLOSED,
  S.LOST,
];

/**
 * INSURANCE PIPELINE — full insurance restoration workflow
 * This is the primary view for Jo's business
 */
export const VIEW_INSURANCE = [
  S.NEW,
  S.CONTACTED,
  S.INSPECTED,
  S.CLAIM_FILED,
  S.ADJUSTER_SCHEDULED,
  S.ADJUSTER_DONE,
  S.SCOPE_RECEIVED,
  S.ESTIMATE_SUBMITTED,
  S.SUPPLEMENT_REQ,
  S.SUPPLEMENT_APPROVED,
  S.CONTRACT_SIGNED,
  S.LOST,
];

/**
 * CASH PIPELINE
 */
export const VIEW_CASH = [
  S.NEW,
  S.CONTACTED,
  S.INSPECTED,
  S.ESTIMATE_SENT_CASH,
  S.NEGOTIATING,
  S.CONTRACT_SIGNED,
  S.LOST,
];

/**
 * FINANCE PIPELINE
 */
export const VIEW_FINANCE = [
  S.NEW,
  S.CONTACTED,
  S.INSPECTED,
  S.PREQUAL_SENT,
  S.LOAN_APPROVED,
  S.CONTRACT_SIGNED,
  S.LOST,
];

/**
 * JOB BOARD — post-contract stages only
 */
export const VIEW_JOBS = [
  S.JOB_CREATED,
  S.PERMIT_PULLED,
  S.MATERIALS_ORDERED,
  S.MATERIALS_DELIVERED,
  S.CREW_SCHEDULED,
  S.INSTALL_IN_PROGRESS,
  S.INSTALL_COMPLETE,
  S.FINAL_PHOTOS,
  S.DEDUCTIBLE_COLLECTED,
  S.FINAL_PAYMENT,
  S.CLOSED,
];

/**
 * ALL VIEWS — for the view switcher dropdown
 */
export const KANBAN_VIEWS = {
  simple:    { label: 'Simple',              stages: VIEW_SIMPLE },
  insurance: { label: 'Insurance Pipeline',  stages: VIEW_INSURANCE },
  cash:      { label: 'Cash Pipeline',       stages: VIEW_CASH },
  finance:   { label: 'Finance Pipeline',    stages: VIEW_FINANCE },
  jobs:      { label: 'Job Board',           stages: VIEW_JOBS },
};

/**
 * Map a lead to its appropriate kanban column given the current view.
 * If the lead's stage doesn't match any visible column, finds the closest match.
 */
export function resolveColumn(stageKey, viewStages) {
  const normalized = normalizeStage(stageKey);
  // Direct match
  if (viewStages.includes(normalized)) return normalized;

  // For insurance view: group sub-stages into visible columns
  const INSURANCE_GROUPS = {
    [S.ADJUSTER_DONE]:      S.ADJUSTER_SCHEDULED,  // group with adjuster
    [S.SUPPLEMENT_APPROVED]: S.SUPPLEMENT_REQ,       // group with supplement
  };
  if (INSURANCE_GROUPS[normalized] && viewStages.includes(INSURANCE_GROUPS[normalized])) {
    return INSURANCE_GROUPS[normalized];
  }

  // Job stages → show in Jobs view or map to "In Progress" for simple
  const jobStages = VIEW_JOBS;
  if (jobStages.includes(normalized)) {
    // In simple view, all job stages go to "In Progress" equivalent
    if (viewStages.includes(S.INSTALL_IN_PROGRESS)) return S.INSTALL_IN_PROGRESS;
    if (viewStages.includes(S.CLOSED) && [S.INSTALL_COMPLETE, S.FINAL_PHOTOS, S.DEDUCTIBLE_COLLECTED, S.FINAL_PAYMENT, S.CLOSED].includes(normalized)) {
      return S.CLOSED;
    }
    return viewStages[viewStages.length - 2] || viewStages[0]; // second to last (before Lost)
  }

  // Cross-track mapping for simple view
  if (normalized === S.CONTACTED && !viewStages.includes(S.CONTACTED)) return S.NEW;
  if (normalized === S.ESTIMATE_SENT_CASH && viewStages.includes(S.ESTIMATE_SUBMITTED)) return S.ESTIMATE_SUBMITTED;
  if (normalized === S.NEGOTIATING && viewStages.includes(S.ESTIMATE_SUBMITTED)) return S.ESTIMATE_SUBMITTED;
  if (normalized === S.PREQUAL_SENT && viewStages.includes(S.ESTIMATE_SUBMITTED)) return S.ESTIMATE_SUBMITTED;
  if (normalized === S.LOAN_APPROVED && viewStages.includes(S.CONTRACT_SIGNED)) return S.CONTRACT_SIGNED;
  if (normalized === S.CLAIM_FILED && !viewStages.includes(S.CLAIM_FILED)) return S.INSPECTED;
  if (normalized === S.ADJUSTER_SCHEDULED && !viewStages.includes(S.ADJUSTER_SCHEDULED)) return S.INSPECTED;
  if (normalized === S.SCOPE_RECEIVED && !viewStages.includes(S.SCOPE_RECEIVED)) return S.ESTIMATE_SUBMITTED;

  // Fallback: first column
  return viewStages[0];
}

/**
 * Get ordered stage options for a dropdown/select, given a job type.
 * Returns array of { value, label } objects.
 */
export function stageOptionsForType(jobType) {
  let stages;
  switch (jobType) {
    case 'insurance': stages = [...VIEW_INSURANCE]; break;
    case 'cash':      stages = [...VIEW_CASH]; break;
    case 'finance':   stages = [...VIEW_FINANCE]; break;
    default:          stages = [...VIEW_INSURANCE]; break; // default to insurance
  }
  // Add job stages after contract_signed
  const jobIdx = stages.indexOf(S.CONTRACT_SIGNED);
  if (jobIdx !== -1) {
    stages.splice(jobIdx + 1, 0, ...VIEW_JOBS);
  }
  return stages.map(key => ({
    value: key,
    label: STAGE_META[key]?.label || key,
  }));
}

// ─────────────────────────────────────────────
// JOB TYPE DETECTION
// ─────────────────────────────────────────────

export const JOB_TYPES = {
  INSURANCE: 'insurance',
  CASH: 'cash',
  FINANCE: 'finance',
};

/**
 * Infer job type from a lead's data
 */
export function inferJobType(lead) {
  if (lead.jobType) return lead.jobType;
  // Check insurance indicators
  if (lead.insCarrier || lead.insuranceCarrier || lead.claimNumber ||
      lead.claimStatus === 'Filed' || lead.claimStatus === 'Approved') {
    return JOB_TYPES.INSURANCE;
  }
  // Check finance indicators
  if (lead.loanAmount || lead.softPullStatus || lead.preQualLink) {
    return JOB_TYPES.FINANCE;
  }
  // Check stage-based inference
  const stage = normalizeStage(lead.stage);
  const insuranceStages = [S.CLAIM_FILED, S.ADJUSTER_SCHEDULED, S.ADJUSTER_DONE, S.SCOPE_RECEIVED, S.SUPPLEMENT_REQ, S.SUPPLEMENT_APPROVED];
  if (insuranceStages.includes(stage)) return JOB_TYPES.INSURANCE;
  const financeStages = [S.PREQUAL_SENT, S.LOAN_APPROVED];
  if (financeStages.includes(stage)) return JOB_TYPES.FINANCE;
  const cashStages = [S.ESTIMATE_SENT_CASH, S.NEGOTIATING];
  if (cashStages.includes(stage)) return JOB_TYPES.CASH;
  // Default — insurance (most common for NBD)
  return null;
}

// ─────────────────────────────────────────────
// TAG CLASS (backward compat for CSS)
// ─────────────────────────────────────────────

export function tagClass(stageKey) {
  const normalized = normalizeStage(stageKey);
  const meta = STAGE_META[normalized];
  if (!meta) return 'tag-new';
  return `tag-${normalized.replace(/_/g, '-')}`;
}
