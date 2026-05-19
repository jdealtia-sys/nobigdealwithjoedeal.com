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

  // ── Warranty track ──
  WARRANTY_SCHEDULED: 'warranty_scheduled',
  WARRANTY_REPAIRED:  'warranty_repaired',

  // ── Service track ──
  SERVICE_QUOTED:     'service_quoted',
  SERVICE_APPROVED:   'service_approved',

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

  // ── Warranty stages ────────────────────────
  [S.WARRANTY_SCHEDULED]: { label: 'Warranty Visit',     color: '#0891b2', headerClass: 'kh-warrsch',   track: 'warranty',  type: 'lead', icon: '🛠️' },
  [S.WARRANTY_REPAIRED]:  { label: 'Repair Done',        color: '#16a34a', headerClass: 'kh-warrdone',  track: 'warranty',  type: 'lead', icon: '✅' },

  // ── Service stages ─────────────────────────
  [S.SERVICE_QUOTED]:     { label: 'Service Quoted',     color: '#D4A017', headerClass: 'kh-svqt',      track: 'service',   type: 'lead', icon: '💰' },
  [S.SERVICE_APPROVED]:   { label: 'Service Approved',   color: '#16a34a', headerClass: 'kh-svok',      track: 'service',   type: 'lead', icon: '✅' },

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
 * WARRANTY PIPELINE — callbacks and post-install repairs
 * Skips claim/estimate/contract; goes straight from inspect → repair → closed.
 */
export const VIEW_WARRANTY = [
  S.NEW,
  S.CONTACTED,
  S.INSPECTED,
  S.WARRANTY_SCHEDULED,
  S.WARRANTY_REPAIRED,
  S.CLOSED,
  S.LOST,
];

/**
 * SERVICE PIPELINE — small one-off repair/maintenance jobs
 * Lightweight path: quote → approve → install → done (no claim, no supplements).
 */
export const VIEW_SERVICE = [
  S.NEW,
  S.CONTACTED,
  S.INSPECTED,
  S.SERVICE_QUOTED,
  S.SERVICE_APPROVED,
  S.INSTALL_IN_PROGRESS,
  S.INSTALL_COMPLETE,
  S.CLOSED,
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
  warranty:  { label: 'Warranty Pipeline',   stages: VIEW_WARRANTY },
  service:   { label: 'Service Pipeline',    stages: VIEW_SERVICE },
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
  let appendJobs = true;
  switch (jobType) {
    case 'insurance': stages = [...VIEW_INSURANCE]; break;
    case 'cash':      stages = [...VIEW_CASH]; break;
    case 'finance':   stages = [...VIEW_FINANCE]; break;
    case 'warranty':  stages = [...VIEW_WARRANTY]; appendJobs = false; break;
    case 'service':   stages = [...VIEW_SERVICE];  appendJobs = false; break;
    default:          stages = [...VIEW_INSURANCE]; break; // default to insurance
  }
  // Add job stages after contract_signed for tracks that converge there
  if (appendJobs) {
    const jobIdx = stages.indexOf(S.CONTRACT_SIGNED);
    if (jobIdx !== -1) {
      stages.splice(jobIdx + 1, 0, ...VIEW_JOBS);
    }
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
  WARRANTY: 'warranty',
  SERVICE: 'service',
};

/**
 * Metadata for each job type — drives labels, icons, default behaviors.
 */
export const JOB_TYPE_META = {
  insurance: { label: 'Insurance',  icon: '📋', color: '#7c3aed', description: 'Claim-based restoration paid by the carrier' },
  cash:      { label: 'Cash',       icon: '💵', color: '#16a34a', description: 'Homeowner pays out of pocket' },
  finance:   { label: 'Finance',    icon: '🏦', color: '#0891b2', description: 'Job funded through a lender' },
  warranty:  { label: 'Warranty',   icon: '🛠️', color: '#0369a1', description: 'Callback or service under existing warranty' },
  service:   { label: 'Service',    icon: '🔧', color: '#ea580c', description: 'Small repair or maintenance, not a full replacement' },
};

export function jobTypeLabel(jobType) {
  return JOB_TYPE_META[jobType]?.label || jobType || 'Unset';
}

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

// ─────────────────────────────────────────────
// SUB-TYPES
// Optional second-level classification per job type.
// Drives template variant selection (e.g., storm AOB vs fire AOB,
// GreenSky terms vs in-house terms) and reporting cuts.
// ─────────────────────────────────────────────

export const SUB_TYPES = {
  insurance: [
    { value: 'storm_hail',  label: 'Storm — Hail' },
    { value: 'storm_wind',  label: 'Storm — Wind' },
    { value: 'storm_combo', label: 'Storm — Hail & Wind' },
    { value: 'fire',        label: 'Fire' },
    { value: 'water',       label: 'Water / Leak' },
    { value: 'other',       label: 'Other' },
  ],
  cash: [
    { value: 'full_replace', label: 'Full Replacement' },
    { value: 'partial',      label: 'Partial Replacement' },
    { value: 'repair',       label: 'Repair' },
  ],
  finance: [
    { value: 'third_party',  label: 'Third-Party Lender' },
    { value: 'in_house',     label: 'In-House Financing' },
  ],
  warranty: [
    { value: 'workmanship',  label: 'Workmanship' },
    { value: 'material',     label: 'Material Defect' },
    { value: 'manufacturer', label: 'Manufacturer Claim' },
    { value: 'goodwill',     label: 'Goodwill / Out of Warranty' },
  ],
  service: [
    { value: 'repair',       label: 'Repair' },
    { value: 'maintenance',  label: 'Maintenance' },
    { value: 'inspection',   label: 'Inspection Only' },
  ],
};

export function subTypeOptionsFor(jobType) {
  return SUB_TYPES[jobType] || [];
}

export function subTypeLabel(jobType, value) {
  return SUB_TYPES[jobType]?.find(s => s.value === value)?.label || value || '';
}

// ─────────────────────────────────────────────
// TRADES — multi-select, orthogonal to job type
// Drives estimate template, crew assignment, material list.
// Stored on a lead as `lead.trades` (array of values).
// ─────────────────────────────────────────────

export const TRADES = [
  { value: 'roof',      label: 'Roof',            icon: '🏠' },
  { value: 'gutters',   label: 'Gutters',         icon: '🌧️' },
  { value: 'siding',    label: 'Siding',          icon: '🧱' },
  { value: 'windows',   label: 'Windows',         icon: '🪟' },
  { value: 'fascia',    label: 'Fascia / Soffit', icon: '🔲' },
  { value: 'paint',     label: 'Paint',           icon: '🎨' },
  { value: 'skylights', label: 'Skylights',       icon: '☀️' },
  { value: 'other',     label: 'Other',           icon: '🔧' },
];

export function tradeLabel(value) {
  return TRADES.find(t => t.value === value)?.label || value || '';
}

export function tradesLabel(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  return values.map(tradeLabel).join(', ');
}

// ─────────────────────────────────────────────
// STAGE ACTIONS — context-aware "what to do next"
// For each stage, list the actions/docs that make sense right now.
// `kind` = 'doc' (generates a document), 'stage' (advances pipeline),
// 'action' (other workflow step).
// `jobTypes` is an optional whitelist; omitted means all types.
// Consumed by the Next Actions panel in Phase 2.
// ─────────────────────────────────────────────

export const STAGE_ACTIONS = {
  [S.NEW]: [
    { id: 'log_contact',     label: 'Log Contact',             icon: '📞',  kind: 'action' },
    { id: 'sched_inspect',   label: 'Schedule Inspection',     icon: '📅',  kind: 'action' },
  ],
  [S.CONTACTED]: [
    { id: 'sched_inspect',   label: 'Schedule Inspection',     icon: '📅',  kind: 'action' },
    { id: 'photo_intake',    label: 'Capture Photos',          icon: '📸',  kind: 'action' },
  ],
  [S.INSPECTED]: [
    { id: 'photo_report',    label: 'Photo Report',            icon: '📸',  kind: 'doc' },
    { id: 'inspect_report',  label: 'Inspection Report',       icon: '📄',  kind: 'doc' },
    { id: 'file_claim',      label: 'File Claim',              icon: '📋',  kind: 'action', jobTypes: ['insurance'] },
    { id: 'send_aob',        label: 'Send AOB',                icon: '✍️', kind: 'doc',    jobTypes: ['insurance'] },
    { id: 'send_estimate',   label: 'Send Estimate',           icon: '💰',  kind: 'doc',    jobTypes: ['cash'] },
    { id: 'send_prequal',    label: 'Send Pre-Qual Link',      icon: '🏦',  kind: 'doc',    jobTypes: ['finance'] },
    { id: 'send_quote',      label: 'Send Service Quote',      icon: '💰',  kind: 'doc',    jobTypes: ['service'] },
    { id: 'sched_warranty',  label: 'Schedule Warranty Visit', icon: '🛠️', kind: 'action', jobTypes: ['warranty'] },
  ],
  [S.CLAIM_FILED]: [
    { id: 'log_adjuster',    label: 'Log Adjuster Meeting',    icon: '📅',  kind: 'action', jobTypes: ['insurance'] },
  ],
  [S.ADJUSTER_SCHEDULED]: [
    { id: 'mark_adj_done',   label: 'Mark Adjuster Met',       icon: '✅',  kind: 'stage',  jobTypes: ['insurance'] },
  ],
  [S.ADJUSTER_DONE]: [
    { id: 'upload_scope',    label: 'Upload Scope',            icon: '📄',  kind: 'action', jobTypes: ['insurance'] },
  ],
  [S.SCOPE_RECEIVED]: [
    { id: 'send_estimate',   label: 'Send Estimate',           icon: '💰',  kind: 'doc',    jobTypes: ['insurance'] },
  ],
  [S.ESTIMATE_SUBMITTED]: [
    { id: 'request_supp',    label: 'Request Supplement',      icon: '📝',  kind: 'action', jobTypes: ['insurance'] },
    { id: 'send_contract',   label: 'Send Contract',           icon: '✍️', kind: 'doc' },
  ],
  [S.SUPPLEMENT_REQ]: [
    { id: 'follow_supp',     label: 'Follow Up Supplement',    icon: '📞',  kind: 'action', jobTypes: ['insurance'] },
  ],
  [S.SUPPLEMENT_APPROVED]: [
    { id: 'send_contract',   label: 'Send Contract',           icon: '✍️', kind: 'doc' },
  ],
  [S.ESTIMATE_SENT_CASH]: [
    { id: 'follow_up',       label: 'Follow Up',               icon: '📞',  kind: 'action', jobTypes: ['cash'] },
    { id: 'send_contract',   label: 'Send Contract',           icon: '✍️', kind: 'doc',    jobTypes: ['cash'] },
  ],
  [S.NEGOTIATING]: [
    { id: 'revise_estimate', label: 'Revise Estimate',         icon: '💰',  kind: 'doc',    jobTypes: ['cash'] },
    { id: 'send_contract',   label: 'Send Contract',           icon: '✍️', kind: 'doc',    jobTypes: ['cash'] },
  ],
  [S.PREQUAL_SENT]: [
    { id: 'follow_lender',   label: 'Follow Up with Lender',   icon: '🏦',  kind: 'action', jobTypes: ['finance'] },
  ],
  [S.LOAN_APPROVED]: [
    { id: 'send_contract',   label: 'Send Contract',           icon: '✍️', kind: 'doc',    jobTypes: ['finance'] },
  ],
  [S.CONTRACT_SIGNED]: [
    { id: 'create_job',      label: 'Create Job',              icon: '🏗️', kind: 'stage' },
    { id: 'collect_deposit', label: 'Collect Deposit',         icon: '💵',  kind: 'action' },
  ],
  [S.JOB_CREATED]: [
    { id: 'pull_permit',     label: 'Pull Permit',             icon: '📜',  kind: 'action' },
    { id: 'order_materials', label: 'Order Materials',         icon: '📦',  kind: 'action' },
  ],
  [S.PERMIT_PULLED]: [
    { id: 'order_materials', label: 'Order Materials',         icon: '📦',  kind: 'action' },
  ],
  [S.MATERIALS_ORDERED]: [
    { id: 'confirm_delivery', label: 'Confirm Delivery',       icon: '🚚',  kind: 'action' },
  ],
  [S.MATERIALS_DELIVERED]: [
    { id: 'sched_crew',      label: 'Schedule Crew',           icon: '👷',  kind: 'action' },
  ],
  [S.CREW_SCHEDULED]: [
    { id: 'start_install',   label: 'Start Install',           icon: '🔨',  kind: 'stage' },
    { id: 'work_order',      label: 'Work Order',              icon: '📋',  kind: 'doc' },
  ],
  [S.INSTALL_IN_PROGRESS]: [
    { id: 'progress_photos', label: 'Progress Photos',         icon: '📸',  kind: 'action' },
    { id: 'change_order',    label: 'Change Order',            icon: '📝',  kind: 'doc' },
  ],
  [S.INSTALL_COMPLETE]: [
    { id: 'final_photos',    label: 'Final Photos',            icon: '📸',  kind: 'action' },
    { id: 'closeout',        label: 'Close-Out Checklist',     icon: '✅',  kind: 'doc' },
  ],
  [S.FINAL_PHOTOS]: [
    { id: 'collect_deduct',  label: 'Collect Deductible',      icon: '💵',  kind: 'action', jobTypes: ['insurance'] },
    { id: 'final_invoice',   label: 'Final Invoice',           icon: '🧾',  kind: 'doc' },
  ],
  [S.DEDUCTIBLE_COLLECTED]: [
    { id: 'request_payment', label: 'Request Final Payment',   icon: '🏦',  kind: 'action' },
  ],
  [S.FINAL_PAYMENT]: [
    { id: 'warranty_cert',   label: 'Warranty Certificate',    icon: '🏆',  kind: 'doc' },
    { id: 'close_job',       label: 'Close Job',               icon: '🎉',  kind: 'stage' },
  ],
  [S.CLOSED]: [
    { id: 'request_review',  label: 'Request Review',          icon: '⭐',  kind: 'action' },
  ],
  [S.WARRANTY_SCHEDULED]: [
    { id: 'log_diagnosis',   label: 'Log Diagnosis',           icon: '🔍',  kind: 'action', jobTypes: ['warranty'] },
  ],
  [S.WARRANTY_REPAIRED]: [
    { id: 'final_photos',    label: 'Final Photos',            icon: '📸',  kind: 'action', jobTypes: ['warranty'] },
    { id: 'warranty_report', label: 'Warranty Service Report', icon: '📄',  kind: 'doc',    jobTypes: ['warranty'] },
  ],
  [S.SERVICE_QUOTED]: [
    { id: 'follow_up',       label: 'Follow Up',               icon: '📞',  kind: 'action', jobTypes: ['service'] },
  ],
  [S.SERVICE_APPROVED]: [
    { id: 'sched_crew',      label: 'Schedule Crew',           icon: '👷',  kind: 'action', jobTypes: ['service'] },
  ],
};

/**
 * Return the actions relevant for a given stage + job type.
 * If jobType is null/empty, returns only universal actions.
 */
export function actionsForStage(stage, jobType) {
  const normalized = normalizeStage(stage);
  const list = STAGE_ACTIONS[normalized] || [];
  if (!jobType) return list.filter(a => !a.jobTypes);
  return list.filter(a => !a.jobTypes || a.jobTypes.includes(jobType));
}

// ─────────────────────────────────────────────
// REQUIRED FIELDS — stage transition gates
// Map: jobType → stageKey → required lead-field names.
// Used by validation to block stage advancement when data is missing.
// Phase 2 will wire this into the form; for now it's data only.
// ─────────────────────────────────────────────

export const REQUIRED_FIELDS_BY_TYPE = {
  insurance: {
    [S.CLAIM_FILED]:        ['insCarrier', 'claimNumber'],
    [S.ADJUSTER_SCHEDULED]: ['insCarrier'],
    [S.ESTIMATE_SUBMITTED]: ['estimateAmount', 'deductibleOrOwedByHO'],
    [S.CONTRACT_SIGNED]:    ['estimateAmount'],
  },
  cash: {
    [S.ESTIMATE_SENT_CASH]: ['jobValue'],
    [S.CONTRACT_SIGNED]:    ['jobValue'],
  },
  finance: {
    [S.PREQUAL_SENT]:       ['financeCompany'],
    [S.LOAN_APPROVED]:      ['loanAmount', 'financeCompany'],
    [S.CONTRACT_SIGNED]:    ['loanAmount', 'financeCompany'],
  },
  warranty: {
    [S.WARRANTY_SCHEDULED]: ['scheduledDate'],
  },
  service: {
    [S.SERVICE_QUOTED]:     ['jobValue'],
    [S.SERVICE_APPROVED]:   ['jobValue'],
  },
};

/**
 * Required field names for a given job type + stage. Empty array if none.
 */
export function requiredFieldsFor(jobType, stage) {
  const normalized = normalizeStage(stage);
  return REQUIRED_FIELDS_BY_TYPE[jobType]?.[normalized] || [];
}

/**
 * Returns the list of required fields a lead is missing for its current stage.
 * Treats numeric 0 as a valid value (not missing).
 *
 * When jobType is unset AND the target stage requires any per-type fields,
 * `jobType` itself is returned as a missing field — the rep has to pick a
 * type before the per-type required fields are even visible in the modal,
 * so listing the downstream fields first is misleading.
 */
export function missingRequiredFields(lead) {
  if (!lead) return [];
  const jobType = lead.jobType || inferJobType(lead);
  if (!jobType) {
    const normalized = normalizeStage(lead.stage);
    const anyTypeRequires = Object.keys(REQUIRED_FIELDS_BY_TYPE).some(jt =>
      (REQUIRED_FIELDS_BY_TYPE[jt]?.[normalized] || []).length > 0
    );
    return anyTypeRequires ? ['jobType'] : [];
  }
  const required = requiredFieldsFor(jobType, lead.stage);
  return required.filter(f => {
    const v = lead[f];
    return v === undefined || v === null || v === '';
  });
}
