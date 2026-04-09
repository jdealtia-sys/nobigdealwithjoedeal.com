/**
 * Insurance Claim Workflow Automation Module
 * NBD Pro CRM - Roofing Contractor SaaS
 *
 * Guides contractors through the insurance claim process with visual
 * workflow tracking, checklist management, and Firestore integration.
 */

(function() {
  'use strict';

  // Claim workflow stages in order
  const CLAIM_STAGES = [
    { id: 'initial_inspection', label: 'Initial Inspection' },
    { id: 'documentation', label: 'Documentation' },
    { id: 'claim_filed', label: 'Claim Filed' },
    { id: 'adjuster_scheduled', label: 'Adjuster Scheduled' },
    { id: 'adjuster_visit', label: 'Adjuster Visit' },
    { id: 'estimate_review', label: 'Estimate Review' },
    { id: 'supplement_filed', label: 'Supplement Filed' },
    { id: 'approved', label: 'Approved' },
    { id: 'work_scheduled', label: 'Work Scheduled' },
    { id: 'completed', label: 'Completed' },
    { id: 'denied', label: 'Denied' }
  ];

  // Document requirements per stage
  const STAGE_CHECKLISTS = {
    initial_inspection: [
      'Damage photos',
      'Measurements',
      'Initial assessment'
    ],
    documentation: [
      'Close-up damage photos',
      'Wide-angle photos',
      'Written damage report'
    ],
    claim_filed: [
      'Claim number',
      'Carrier name',
      'Policy number',
      'Date filed'
    ],
    adjuster_scheduled: [
      'Adjuster name',
      'Date/time scheduled',
      'Contact information'
    ],
    adjuster_visit: [
      'Adjuster photos',
      'Adjuster estimate',
      'Scope of work'
    ],
    estimate_review: [
      'Contractor estimate',
      'Variance analysis'
    ],
    supplement_filed: [
      'Supplement documents',
      'Additional damage found',
      'Updated estimate'
    ],
    approved: [
      'Approval letter',
      'Approved amount',
      'Deductible amount'
    ],
    work_scheduled: [
      'Scheduled date',
      'Work scope confirmed'
    ],
    completed: [
      'Final inspection passed',
      'Insurance paperwork signed',
      'Payment received'
    ],
    denied: [
      'Denial letter',
      'Denial reason',
      'Appeal strategy (if applicable)'
    ]
  };

  /**
   * Get current claim status, progress, and next actions
   * @param {Object} lead - Lead document object
   * @returns {Object} Status object with stage, progress percentage, next actions
   */
  function getClaimStatus(lead) {
    const claimHistory = lead.claimHistory || [];
    const currentStageId = lead.claimStage || CLAIM_STAGES[0].id;
    const currentIndex = CLAIM_STAGES.findIndex(s => s.id === currentStageId);
    const progress = ((currentIndex + 1) / CLAIM_STAGES.length) * 100;

    const currentStage = CLAIM_STAGES[currentIndex] || CLAIM_STAGES[0];
    const nextStage = currentIndex < CLAIM_STAGES.length - 1
      ? CLAIM_STAGES[currentIndex + 1]
      : null;

    const checklist = STAGE_CHECKLISTS[currentStageId] || [];
    const completedItems = lead[`checklist_${currentStageId}`] || [];
    const checklistProgress = checklist.length > 0
      ? (completedItems.length / checklist.length) * 100
      : 0;

    return {
      currentStage: currentStage.label,
      currentStageId,
      progress,
      nextStage: nextStage ? nextStage.label : 'Complete',
      checklistProgress,
      claimNumber: lead.claimNumber,
      insuranceCarrier: lead.insuranceCarrier,
      approvedAmount: lead.approvedAmount,
      deductible: lead.deductible,
      history: claimHistory
    };
  }

  /**
   * Advance to next claim stage with optional notes
   * @param {string} leadId - Lead document ID
   * @param {string} notes - Stage transition notes
   * @returns {Promise} Resolves when Firestore update completes
   */
  async function advanceClaimStage(leadId, notes = '') {
    try {
      const leadDocRef = window.doc(window.db, 'leads', leadId);
      const leadSnap = await window.getDoc(leadDocRef);

      if (!leadSnap.exists()) {
        console.error('Lead not found:', leadId);
        return false;
      }

      const lead = leadSnap.data();
      const currentIndex = CLAIM_STAGES.findIndex(
        s => s.id === (lead.claimStage || CLAIM_STAGES[0].id)
      );

      if (currentIndex >= CLAIM_STAGES.length - 1) {
        console.warn('Claim already at final stage');
        return false;
      }

      const nextStageId = CLAIM_STAGES[currentIndex + 1].id;
      const historyEntry = {
        stage: nextStageId,
        timestamp: new Date().toISOString(),
        notes: notes,
        completedAt: new Date()
      };

      await window.updateDoc(leadDocRef, {
        claimStage: nextStageId,
        claimStatus: 'in_progress',
        claimHistory: window.arrayUnion(historyEntry),
        [`checklist_${nextStageId}`]: []
      });

      return true;
    } catch (error) {
      console.error('Error advancing claim stage:', error);
      return false;
    }
  }

  /**
   * Render visual claim workflow UI
   * @param {string} containerId - HTML element ID for rendering
   * @param {string} leadId - Lead document ID
   */
  async function renderClaimWorkflow(containerId, leadId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('Container not found:', containerId);
      return;
    }

    try {
      const leadSnap = await window.getDoc(window.doc(window.db, 'leads', leadId));
      if (!leadSnap.exists()) {
        console.error('Lead not found:', leadId);
        return;
      }

      const lead = leadSnap.data();
      const status = getClaimStatus(lead);
      const currentIndex = CLAIM_STAGES.findIndex(s => s.id === status.currentStageId);

      const html = `
        <div class="claim-workflow" style="background: var(--s,#1a1a2e); border: 1px solid var(--br,rgba(255,255,255,.08)); border-radius: 8px; padding: 20px;">
          <h3 style="color: var(--h,#fff); margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">Insurance Claim Progress</h3>

          <div class="claim-progress-bar" style="background: rgba(255,255,255,.05); height: 8px; border-radius: 4px; margin-bottom: 24px; overflow: hidden;">
            <div style="background: #C8541A; height: 100%; width: ${status.progress}%; transition: width 0.3s ease;"></div>
          </div>

          <div class="claim-stages" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px;">
            ${CLAIM_STAGES.map((stage, idx) => {
              const isCompleted = idx < currentIndex;
              const isCurrent = idx === currentIndex;
              const statusBg = isCompleted
                ? '#10b981'
                : isCurrent
                  ? '#C8541A'
                  : 'rgba(255,255,255,.05)';
              const statusText = isCompleted
                ? '#fff'
                : isCurrent
                  ? '#fff'
                  : 'var(--m,#9ca3af)';

              return `
                <div style="
                  background: ${statusBg};
                  border-radius: 6px;
                  padding: 12px;
                  text-align: center;
                  cursor: pointer;
                  transition: all 0.2s ease;
                  border: 1px solid ${isCurrent ? '#ff9c4d' : 'transparent'};
                ">
                  <div style="color: ${statusText}; font-size: 12px; font-weight: 500; word-break: break-word;">
                    ${stage.label}
                  </div>
                  ${isCompleted ? '<div style="color: #fff; font-size: 16px; margin-top: 4px;">✓</div>' : ''}
                </div>
              `;
            }).join('')}
          </div>

          <div class="claim-current-stage" style="background: rgba(255,255,255,.02); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--br,rgba(255,255,255,.08));">
            <div style="color: var(--m,#9ca3af); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Current Stage</div>
            <div style="color: var(--h,#fff); font-size: 18px; font-weight: 600; margin-bottom: 12px;">${status.currentStage}</div>
            <div style="color: var(--m,#9ca3af); font-size: 13px; line-height: 1.5;">
              ${status.nextStage !== 'Complete'
                ? `<strong>Next:</strong> ${status.nextStage}`
                : '<strong style="color: #10b981;">Workflow Complete</strong>'}
            </div>
          </div>

          <div class="claim-details" style="background: rgba(255,255,255,.02); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--br,rgba(255,255,255,.08)); font-size: 13px;">
            ${status.claimNumber ? `<div style="color: var(--m,#9ca3af); margin-bottom: 8px;"><strong style="color: var(--h,#fff);">Claim #:</strong> ${status.claimNumber}</div>` : ''}
            ${status.insuranceCarrier ? `<div style="color: var(--m,#9ca3af); margin-bottom: 8px;"><strong style="color: var(--h,#fff);">Carrier:</strong> ${status.insuranceCarrier}</div>` : ''}
            ${status.approvedAmount ? `<div style="color: var(--m,#9ca3af);"><strong style="color: var(--h,#fff);">Approved:</strong> $${status.approvedAmount.toLocaleString()}</div>` : ''}
          </div>

          <div class="claim-actions">
            <textarea
              id="claim-notes-${leadId}"
              placeholder="Add notes for stage transition..."
              style="
                width: 100%;
                background: rgba(255,255,255,.05);
                border: 1px solid var(--br,rgba(255,255,255,.08));
                border-radius: 6px;
                color: var(--h,#fff);
                padding: 10px;
                font-size: 13px;
                font-family: inherit;
                margin-bottom: 12px;
                resize: vertical;
                min-height: 60px;
              "
            ></textarea>
            <button
              onclick="window.InsuranceClaim.advanceClaimStage('${leadId}', document.getElementById('claim-notes-${leadId}').value)"
              style="
                background: #C8541A;
                color: white;
                border: none;
                border-radius: 6px;
                padding: 10px 16px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s ease;
                width: 100%;
              "
              onmouseover="this.style.background='#d96326'"
              onmouseout="this.style.background='#C8541A'"
            >
              ${status.nextStage !== 'Complete' ? 'Advance to ' + status.nextStage : 'Workflow Complete'}
            </button>
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (error) {
      console.error('Error rendering claim workflow:', error);
      container.innerHTML = '<div style="color: #ef4444; padding: 16px;">Error loading claim workflow</div>';
    }
  }

  /**
   * Render document checklist for current claim stage
   * @param {string} containerId - HTML element ID for rendering
   * @param {string} leadId - Lead document ID
   */
  async function renderClaimChecklist(containerId, leadId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('Container not found:', containerId);
      return;
    }

    try {
      const leadSnap = await window.getDoc(window.doc(window.db, 'leads', leadId));
      if (!leadSnap.exists()) {
        console.error('Lead not found:', leadId);
        return;
      }

      const lead = leadSnap.data();
      const currentStageId = lead.claimStage || CLAIM_STAGES[0].id;
      const checklist = STAGE_CHECKLISTS[currentStageId] || [];
      const completed = lead[`checklist_${currentStageId}`] || [];

      const checklistHtml = checklist.map((item, idx) => {
        const isChecked = completed.includes(item);
        return `
          <div style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid var(--br,rgba(255,255,255,.08)); gap: 12px;">
            <input
              type="checkbox"
              ${isChecked ? 'checked' : ''}
              onchange="window.InsuranceClaim.updateChecklistItem('${leadId}', '${currentStageId}', '${item.replace(/'/g, "\\'")}', this.checked)"
              style="cursor: pointer; width: 16px; height: 16px;"
            >
            <label style="flex: 1; color: ${isChecked ? 'var(--m,#9ca3af)' : 'var(--h,#fff)'}; text-decoration: ${isChecked ? 'line-through' : 'none'}; cursor: pointer;">
              ${item}
            </label>
          </div>
        `;
      }).join('');

      const html = `
        <div class="claim-checklist" style="background: var(--s,#1a1a2e); border: 1px solid var(--br,rgba(255,255,255,.08)); border-radius: 8px; overflow: hidden;">
          <div style="background: rgba(255,255,255,.02); padding: 16px; border-bottom: 1px solid var(--br,rgba(255,255,255,.08));">
            <h3 style="color: var(--h,#fff); margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">
              ${CLAIM_STAGES.find(s => s.id === currentStageId)?.label || 'Checklist'} Documents
            </h3>
            <div style="color: var(--m,#9ca3af); font-size: 12px;">
              ${completed.length} of ${checklist.length} items complete
            </div>
          </div>
          <div>
            ${checklistHtml || '<div style="padding: 16px; color: var(--m,#9ca3af);">No items for this stage</div>'}
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (error) {
      console.error('Error rendering checklist:', error);
      container.innerHTML = '<div style="color: #ef4444; padding: 16px;">Error loading checklist</div>';
    }
  }

  /**
   * Update checklist item completion status
   * @param {string} leadId - Lead document ID
   * @param {string} stageId - Stage ID
   * @param {string} item - Checklist item text
   * @param {boolean} isChecked - Completion status
   */
  async function updateChecklistItem(leadId, stageId, item, isChecked) {
    try {
      const leadDocRef = window.doc(window.db, 'leads', leadId);
      const fieldName = `checklist_${stageId}`;

      if (isChecked) {
        await window.updateDoc(leadDocRef, {
          [fieldName]: window.arrayUnion(item)
        });
      } else {
        await window.updateDoc(leadDocRef, {
          [fieldName]: window.arrayRemove(item)
        });
      }
    } catch (error) {
      console.error('Error updating checklist:', error);
    }
  }

  /**
   * Get compact claim summary HTML for kanban cards
   * @param {Object} lead - Lead document object
   * @returns {string} HTML badge/summary
   */
  function getClaimSummaryHTML(lead) {
    const status = getClaimStatus(lead);
    const stageColor = status.currentStageId === 'denied' ? '#ef4444' :
                       status.currentStageId === 'approved' ? '#10b981' :
                       status.currentStageId === 'completed' ? '#10b981' :
                       '#C8541A';

    return `
      <div style="
        background: rgba(255,255,255,.05);
        border-left: 3px solid ${stageColor};
        border-radius: 4px;
        padding: 8px 12px;
        margin-top: 8px;
        font-size: 12px;
      ">
        <div style="color: var(--m,#9ca3af); margin-bottom: 4px;">Insurance Claim</div>
        <div style="color: var(--h,#fff); font-weight: 600; margin-bottom: 4px;">${status.currentStage}</div>
        ${status.claimNumber ? `<div style="color: var(--m,#9ca3af);">Claim #${status.claimNumber}</div>` : ''}
      </div>
    `;
  }

  // Export public API
  window.InsuranceClaim = {
    CLAIM_STAGES,
    STAGE_CHECKLISTS,
    getClaimStatus,
    advanceClaimStage,
    renderClaimWorkflow,
    renderClaimChecklist,
    updateChecklistItem,
    getClaimSummaryHTML
  };

})();