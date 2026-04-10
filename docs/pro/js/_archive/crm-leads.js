/**
 * crm-leads.js — NBD PRO CRM Lead/Job Data Layer
 * Session 6 · Commit 1 · Schema Foundation
 *
 * USAGE:
 *   import { createLead, updateLead, getLead, stageTransition } from '/pro/crm-leads.js';
 *
 * All functions return a Promise.
 * All functions require Firebase `db` and `auth` to be initialized globally
 * (they already are in dashboard.html via the existing Firebase config).
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────

/**
 * Returns the Firestore collection ref for the current user's leads.
 * Path: leads/{uid}/{leadId}
 */
function leadsRef(db, uid) {
  return collection(db, 'leads', uid, 'leads');
}

function leadDocRef(db, uid, leadId) {
  return doc(db, 'leads', uid, 'leads', leadId);
}

// ─────────────────────────────────────────────
// STAGE ENUMS (source of truth — Session 5)
// ─────────────────────────────────────────────

export const LEAD_STAGES = {
  // Shared entry
  NEW:                          'new',
  CONTACTED:                    'contacted',
  INSPECTED:                    'inspected',
  // Insurance track
  CLAIM_FILED:                  'claim_filed',
  ADJUSTER_MEETING_SCHEDULED:   'adjuster_meeting_scheduled',
  ADJUSTER_INSPECTION_DONE:     'adjuster_inspection_done',
  SCOPE_RECEIVED:               'scope_received',
  ESTIMATE_SUBMITTED:           'estimate_submitted',
  SUPPLEMENT_REQUESTED:         'supplement_requested',
  SUPPLEMENT_APPROVED:          'supplement_approved',
  // Cash track
  ESTIMATE_SENT_CASH:           'estimate_sent_cash',
  NEGOTIATING:                  'negotiating',
  // Finance track
  PREQUAL_SENT:                 'prequal_sent',
  LOAN_APPROVED:                'loan_approved',
  // Convergence
  CONTRACT_SIGNED:              'contract_signed',
  // Exit
  LOST:                         'lost',
};

export const JOB_STAGES = {
  JOB_CREATED:        'job_created',
  PERMIT_PULLED:      'permit_pulled',
  MATERIALS_ORDERED:  'materials_ordered',
  MATERIALS_DELIVERED:'materials_delivered',
  CREW_SCHEDULED:     'crew_scheduled',
  INSTALL_IN_PROGRESS:'install_in_progress',
  INSTALL_COMPLETE:   'install_complete',
  FINAL_PHOTOS:       'final_photos',
  DEDUCTIBLE_COLLECTED:'deductible_collected',
  FINAL_PAYMENT:      'final_payment',
  CLOSED:             'closed',
};

export const JOB_TYPES = {
  INSURANCE: 'insurance',
  CASH:      'cash',
  FINANCE:   'finance',
};

export const RECORD_TYPES = {
  LEAD: 'lead',
  JOB:  'job',
};

export const LEAD_SOURCES = {
  MANUAL:     'manual',
  VISUALIZER: 'visualizer',
  REFERRAL:   'referral',
  DOOR_KNOCK: 'door_knock',
  STORM_ALERT:'storm_alert',
  WEBSITE:    'website',
};

// ─────────────────────────────────────────────
// CREATE LEAD
// ─────────────────────────────────────────────

/**
 * createLead(db, uid, data)
 *
 * Creates a new lead record with full Session 5 schema.
 * All fields are optional except name + phone.
 *
 * @param {object} db       — Firestore instance (window.db)
 * @param {string} uid      — Current user's Firebase UID
 * @param {object} data     — Lead fields (see schema below)
 * @returns {Promise<string>} — The new lead's Firestore document ID
 *
 * EXAMPLE (replace your existing addDoc call with this):
 *   const leadId = await createLead(db, auth.currentUser.uid, {
 *     name: formData.name,
 *     phone: formData.phone,
 *     address: formData.address,
 *     damageType: formData.damageType,
 *   });
 */
export async function createLead(db, uid, data = {}) {
  const now = serverTimestamp();

  const leadDoc = {
    // ── Core identity ──────────────────────────────
    recordType:     RECORD_TYPES.LEAD,
    stage:          LEAD_STAGES.NEW,
    stageUpdatedAt: now,
    jobType:        data.jobType        ?? null,   // set when known

    // ── Contact info ───────────────────────────────
    name:           data.name           ?? '',
    phone:          data.phone          ?? '',
    email:          data.email          ?? '',
    address:        data.address        ?? '',
    lat:            data.lat            ?? null,   // populated at 'inspected' stage
    lng:            data.lng            ?? null,

    // ── Lead metadata ──────────────────────────────
    damageType:     data.damageType     ?? '',
    source:         data.source         ?? LEAD_SOURCES.MANUAL,
    notes:          data.notes          ?? '',     // free-form, esp. for visualizer leads

    // ── Tier / access ──────────────────────────────
    tier:           data.tier           ?? 'free', // 'free' | 'pro' | 'elite'

    // ── Insurance fields ───────────────────────────
    insuranceCarrier:   data.insuranceCarrier   ?? '',
    claimNumber:        data.claimNumber        ?? '',
    claimFiledBy:       data.claimFiledBy       ?? null,  // 'contractor' | 'homeowner'
    estimateAmount:     data.estimateAmount     ?? null,
    supplementStatus:   data.supplementStatus   ?? '',

    // ── Job fields (empty until contract signed) ───
    contractSignedAt:   null,
    scopeOfWork:        data.scopeOfWork        ?? '',
    scheduledDate:      data.scheduledDate      ?? null,
    crew:               data.crew               ?? '',

    // ── Invoice / payment ──────────────────────────
    invoiceAmountInsurance:     data.invoiceAmountInsurance     ?? null,
    invoiceAmountHomeowner:     data.invoiceAmountHomeowner     ?? null,
    amountCollected:            data.amountCollected            ?? null,

    // ── Optional stage checkboxes (Session 5 Decision 9) ──
    supplementFiledPostInstall:   false,
    supplementApprovedPostInstall: false,
    invoiceSentInsurance:         false,
    invoiceSentHomeowner:         false,

    // ── Finance (Improvifi) fields ─────────────────
    financeCompany:     data.financeCompany     ?? 'Improvifi',
    loanAmount:         data.loanAmount         ?? null,
    softPullStatus:     data.softPullStatus     ?? null,  // 'pending'|'approved'|'declined'
    loanStatus:         data.loanStatus         ?? null,  // 'submitted'|'approved'|'funded'
    fundingDate:        data.fundingDate        ?? null,
    deductibleOrOwedByHO: data.deductibleOrOwedByHO ?? null,
    preQualLink:        data.preQualLink        ?? '',

    // ── Follow-up ──────────────────────────────────
    followUpDate:       data.followUpDate       ?? null,

    // ── Nudge engine ──────────────────────────────
    nudgeDisabled:          data.nudgeDisabled          ?? false,
    nudgeThresholdDays:     data.nudgeThresholdDays     ?? null,

    // ── Timestamps ─────────────────────────────────
    createdAt:  now,
    updatedAt:  now,
    _uid:       uid,
  };

  const docRef = await addDoc(leadsRef(db, uid), leadDoc);
  return docRef.id;
}

// ─────────────────────────────────────────────
// UPDATE LEAD (generic field update)
// ─────────────────────────────────────────────

/**
 * updateLead(db, uid, leadId, data)
 *
 * Updates any fields on an existing lead/job document.
 * Always stamps updatedAt.
 *
 * EXAMPLE:
 *   await updateLead(db, uid, leadId, { insuranceCarrier: 'State Farm', claimNumber: '12345' });
 */
export async function updateLead(db, uid, leadId, data = {}) {
  const ref = leadDocRef(db, uid, leadId);
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ─────────────────────────────────────────────
// STAGE TRANSITION
// ─────────────────────────────────────────────

/**
 * stageTransition(db, uid, leadId, newStage)
 *
 * Moves a record to a new stage. Stamps stageUpdatedAt.
 * If newStage === 'contract_signed', also flips recordType to 'job'
 * and sets stage to 'job_created' (the dual-pipeline pivot).
 *
 * EXAMPLE:
 *   await stageTransition(db, uid, leadId, LEAD_STAGES.CLAIM_FILED);
 *   await stageTransition(db, uid, leadId, LEAD_STAGES.CONTRACT_SIGNED); // triggers lead→job
 */
export async function stageTransition(db, uid, leadId, newStage) {
  const ref = leadDocRef(db, uid, leadId);
  const now = serverTimestamp();

  const update = {
    stage:          newStage,
    stageUpdatedAt: now,
    updatedAt:      now,
  };

  // ── The dual-pipeline pivot (Session 5 Decision 6) ──
  if (newStage === LEAD_STAGES.CONTRACT_SIGNED) {
    update.recordType      = RECORD_TYPES.JOB;
    update.stage           = JOB_STAGES.JOB_CREATED;
    update.contractSignedAt = now;
    // stageUpdatedAt resets for job pipeline clock
    update.stageUpdatedAt  = now;
  }

  await updateDoc(ref, update);
}

// ─────────────────────────────────────────────
// GET LEAD
// ─────────────────────────────────────────────

/**
 * getLead(db, uid, leadId)
 *
 * Fetches a single lead/job document.
 * Returns the data object with id injected, or null if not found.
 *
 * EXAMPLE:
 *   const lead = await getLead(db, uid, leadId);
 *   console.log(lead.name, lead.stage, lead.recordType);
 */
export async function getLead(db, uid, leadId) {
  const ref = leadDocRef(db, uid, leadId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ─────────────────────────────────────────────
// GET ALL LEADS + JOBS
// ─────────────────────────────────────────────

/**
 * getAllRecords(db, uid, options)
 *
 * Fetches all lead and job records for a user.
 * options.type: 'lead' | 'job' | 'all' (default: 'all')
 * options.stage: filter by specific stage string
 *
 * Returns array sorted by createdAt desc.
 *
 * EXAMPLE:
 *   const allRecords  = await getAllRecords(db, uid);
 *   const leadsOnly   = await getAllRecords(db, uid, { type: 'lead' });
 *   const activeJobs  = await getAllRecords(db, uid, { type: 'job' });
 */
export async function getAllRecords(db, uid, options = {}) {
  const constraints = [orderBy('createdAt', 'desc')];

  if (options.type && options.type !== 'all') {
    constraints.unshift(where('recordType', '==', options.type));
  }

  if (options.stage) {
    constraints.unshift(where('stage', '==', options.stage));
  }

  const q = query(leadsRef(db, uid), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─────────────────────────────────────────────
// CREATE VISUALIZER LEAD (public — no auth)
// ─────────────────────────────────────────────

/**
 * createVisualizerLead(db, JOE_UID, data)
 *
 * Creates a lead from the public visualizer tool.
 * Writes to Joe's CRM directly using his hardcoded UID.
 * Requires a Firestore rule allowing public write to this path
 * (see integration note below).
 *
 * @param {object} db          — Firestore instance
 * @param {string} JOE_UID     — Joe's Firebase UID (hardcoded constant — see note)
 * @param {object} data        — { name, phone, address, visualizerSelections }
 *
 * NOTE: Add this Firestore rule to allow unauthenticated writes from visualizer:
 *   match /leads/{uid}/{document=**} {
 *     allow write: if uid == 'JOE_UID_HERE' && request.resource.data.source == 'visualizer';
 *   }
 *
 * EXAMPLE:
 *   await createVisualizerLead(db, 'abc123uid', {
 *     name: 'Sarah Johnson',
 *     phone: '513-555-0192',
 *     address: '4821 Maple Dr, Cincinnati OH',
 *     visualizerSelections: {
 *       components: ['roof', 'gutters'],
 *       roofStyle: 'Architectural',
 *       roofColor: 'Charcoal',
 *       gutterColor: 'Black',
 *     }
 *   });
 */
export async function createVisualizerLead(db, JOE_UID, data = {}) {
  const selectionsNote = data.visualizerSelections
    ? `Visualizer selections: ${JSON.stringify(data.visualizerSelections)}`
    : '';

  return createLead(db, JOE_UID, {
    name:       data.name    ?? '',
    phone:      data.phone   ?? '',
    address:    data.address ?? '',
    source:     LEAD_SOURCES.VISUALIZER,
    notes:      selectionsNote,
    jobType:    null,  // unknown at this stage — set during first contact
    damageType: data.visualizerSelections?.components?.includes('roof')
                  ? 'storm/hail (visualizer)'
                  : '',
  });
}

// ─────────────────────────────────────────────
// LOG ACTIVITY (sub-collection write)
// ─────────────────────────────────────────────

/**
 * logActivity(db, uid, leadId, entry)
 *
 * Adds an entry to the activity sub-collection.
 * entry.type: 'call' | 'text' | 'note' | 'knocked_no_answer' | 'voicemail' | 'in_person'
 * entry.note: string
 *
 * EXAMPLE:
 *   await logActivity(db, uid, leadId, { type: 'call', note: 'Left voicemail, will try again Fri' });
 */
export async function logActivity(db, uid, leadId, entry = {}) {
  const activityRef = collection(db, 'leads', uid, 'leads', leadId, 'activity');
  await addDoc(activityRef, {
    type:      entry.type ?? 'note',
    note:      entry.note ?? '',
    timestamp: serverTimestamp(),
    _uid:      uid,
  });
  // also stamp parent doc updatedAt
  await updateLead(db, uid, leadId, {});
}

// ─────────────────────────────────────────────
// CLOSED JOB → DS REVENUE SYNC
// ─────────────────────────────────────────────

/**
 * closeJob(db, uid, leadId, finalAmount)
 *
 * Marks a job as closed and writes the revenue amount
 * back to users/{uid}/ds_meta/streaks for Daily Success
 * revenue tracking + leaderboard sync.
 *
 * This is the CRM → Daily Success bridge (Session 5 2nd-order effect).
 *
 * EXAMPLE:
 *   await closeJob(db, uid, leadId, 14500);
 */
export async function closeJob(db, uid, leadId, finalAmount = 0) {
  // 1. Move record to closed stage
  await stageTransition(db, uid, leadId, JOB_STAGES.CLOSED);

  // 2. Stamp final amount collected
  await updateLead(db, uid, leadId, { amountCollected: finalAmount });

  // 3. Write revenue to DS meta (leaderboard + streak engine)
  const metaRef = doc(db, 'users', uid, 'ds_meta', 'streaks');
  const metaSnap = await getDoc(metaRef);

  if (metaSnap.exists()) {
    const current = metaSnap.data().total_revenue ?? 0;
    const { updateDoc: ud } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    await ud(metaRef, {
      total_revenue: current + finalAmount,
      _updatedAt: serverTimestamp(),
    });
  }

  // 4. Mirror to leaderboard
  const lbRef = doc(db, 'leaderboard', uid);
  const lbSnap = await getDoc(lbRef);
  if (lbSnap.exists()) {
    const currentLbRevenue = lbSnap.data().total_revenue ?? 0;
    await updateDoc(lbRef, {
      total_revenue: currentLbRevenue + finalAmount,
      _updatedAt: serverTimestamp(),
    });
  }
}
