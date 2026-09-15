/**
 * warranty-claim.js — the claim sub-workflow for a job that's already closed.
 *
 * 2026-09-15 (Warranty Claim lane). A claim is its OWN document at
 * leads/{leadId}/warrantyClaims/{claimId}, distinct from the lead's `stage`
 * (S.WARRANTY_CLAIM in crm-stages.js handles the board-column side — one
 * hard gate on re-entering S.CLOSED). Two hard gates need to stay
 * synchronous (missingRequiredFields() and moveCard()'s own guard read the
 * LEAD in-memory, no await): rather than teach either to await a
 * subcollection read, a denormalized scalar `lead.openWarrantyClaimId` is
 * stamped in the SAME batch write as claim creation, and cleared in the same
 * update as resolution/denial.
 *
 * Claim STATUS (open -> scheduled -> repaired -> resolved|denied) is a
 * separate state machine from lead.stage — advanceClaimStatus() below never
 * touches lead.stage/stageHistory and is never routed through
 * commitStageChange(). Only two moments touch the LEAD doc: opening a claim
 * (stamps openWarrantyClaimId) and resolving/denying one (clears it).
 *
 * Same "plain deferred script, window global" convention as paperwork-write.js
 * — loaded on both dashboard.html and customer.html, dispatched via
 * window.WarrantyClaim.* rather than an ES import (dashboard-bootstrap.module.js
 * and customer-bootstrap.module.js both dispatch through window.* globals,
 * never static-import sibling plain scripts).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function _ready() {
    return !!(window.db && window.doc && window.collection && window.writeBatch && window.updateDoc && window.serverTimestamp);
  }

  function _actorLabel() {
    return (window._currentUser && window._currentUser.email)
      || (window.auth && window.auth.currentUser && window.auth.currentUser.email)
      || 'system';
  }

  function _esc(s) {
    return (window.nbdEsc || (v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))))(s);
  }

  function hasOpenClaim(lead) {
    return !!(lead && lead.openWarrantyClaimId);
  }

  // ─────────────────────────────────────────────
  // Modal shell — mirrors crm-pipeline.js's promptLostReason() DOM-built
  // style (hand-built elements, never innerHTML with user-authored text).
  // ─────────────────────────────────────────────
  function _modal(titleText, subText, buildBody, submitLabel) {
    return new Promise((resolve) => {
      const existing = document.getElementById('nbd-warranty-claim-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'nbd-warranty-claim-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';

      const sheet = document.createElement('div');
      sheet.style.cssText = 'background:var(--s, #1a1d23);border:1px solid var(--br, #2a2d35);border-radius:12px;padding:28px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);';

      const hdrTitle = document.createElement('div');
      hdrTitle.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;color:var(--t);text-transform:uppercase;letter-spacing:.04em;";
      hdrTitle.textContent = titleText;
      sheet.appendChild(hdrTitle);

      if (subText) {
        const hdrSub = document.createElement('div');
        hdrSub.style.cssText = 'font-size:12px;color:var(--m);margin:4px 0 16px;';
        hdrSub.textContent = subText;
        sheet.appendChild(hdrSub);
      }

      const fields = {};
      buildBody(sheet, fields);

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background:transparent;border:1px solid var(--br);color:var(--m);padding:10px 18px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;';
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.textContent = submitLabel;
      submitBtn.style.cssText = 'background:var(--orange, #A14A22);border:none;color:#fff;padding:10px 18px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;';
      submitBtn.addEventListener('click', () => { overlay.remove(); resolve(fields); });

      footer.appendChild(cancelBtn);
      footer.appendChild(submitBtn);
      sheet.appendChild(footer);
      overlay.appendChild(sheet);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
      document.body.appendChild(overlay);
    });
  }

  function _fieldLabel(text) {
    const l = document.createElement('label');
    l.style.cssText = 'display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);margin-bottom:6px;';
    l.textContent = text;
    return l;
  }

  function _select(sheet, labelText, options) {
    sheet.appendChild(_fieldLabel(labelText));
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:13px;margin-bottom:14px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sheet.appendChild(sel);
    return sel;
  }

  function _textarea(sheet, labelText, placeholder) {
    sheet.appendChild(_fieldLabel(labelText));
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = placeholder || '';
    ta.style.cssText = 'width:100%;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:12px;outline:none;resize:vertical;margin-bottom:14px;';
    sheet.appendChild(ta);
    return ta;
  }

  function _checkbox(sheet, labelText) {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t);margin-bottom:14px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(labelText));
    sheet.appendChild(wrap);
    return cb;
  }

  // ─────────────────────────────────────────────
  // Intake — moveCard()'s guard calls this BEFORE the lead.stage write. If
  // the rep cancels, the caller must abort the move (same contract as
  // promptLostReason). On submit, this function performs the batch write
  // itself (claim doc + lead.openWarrantyClaimId, atomically) and resolves
  // true so the caller can proceed with the stage change.
  // ─────────────────────────────────────────────
  async function promptIntake(lead) {
    const reasons = (window.subTypeOptionsFor ? window.subTypeOptionsFor('warranty') : []) || [];
    const customerName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.address || 'This customer';
    const fields = await _modal(
      'File a Warranty Claim',
      customerName + ' — this job is already closed; filing a claim reopens it as a tracked issue.',
      (sheet, out) => {
        out.reasonSel = _select(sheet, 'Reason', reasons.length ? reasons : [{ value: 'workmanship', label: 'Workmanship' }]);
        out.descInput = _textarea(sheet, "What's the issue?", 'e.g. Leak at the chimney flashing, first noticed after last week’s storm');
      },
      'File Claim'
    );
    if (!fields) return false;
    if (!_ready()) throw new Error('promptIntake: Firebase helpers not available on this page');

    const claimsCol = window.collection(window.db, 'leads', lead.id, 'warrantyClaims');
    const claimRef = window.doc(claimsCol);
    const leadRef = window.doc(window.db, 'leads', lead.id);
    const batch = window.writeBatch(window.db);
    const now = window.serverTimestamp();
    batch.set(claimRef, {
      status: 'open',
      reason: fields.reasonSel.value,
      issueDescription: fields.descInput.value.trim().slice(0, 2000),
      reportedBy: 'rep',
      reportedAt: now,
      scheduledDate: null,
      diagnosisNotes: '',
      resolutionNotes: '',
      billable: false,
      resolvedAt: null,
      linkedPhotoIds: [],
      linkedDocumentIds: [],
      companyId: lead.companyId || null,
      userId: lead.userId || null,
      createdBy: _actorLabel(),
      createdAt: now,
      updatedAt: now,
    });
    batch.update(leadRef, { openWarrantyClaimId: claimRef.id, updatedAt: now });
    await batch.commit();

    lead.openWarrantyClaimId = claimRef.id;
    return true;
  }

  // ─────────────────────────────────────────────
  // Resolution — moveCard()'s guard calls this BEFORE allowing a move away
  // from S.WARRANTY_CLAIM. Requires resolutionNotes (mirrors
  // REQUIRED_FIELDS_BY_CLAIM_STATUS.resolved). "Deny" skips the billable
  // question — a denied claim was never worked.
  // ─────────────────────────────────────────────
  async function promptResolution(lead) {
    if (!lead.openWarrantyClaimId) return true; // nothing open — never block the move
    const fields = await _modal(
      'Resolve Warranty Claim',
      'Close out this claim before moving the job back to Closed.',
      (sheet, out) => {
        out.outcomeSel = _select(sheet, 'Outcome', [
          { value: 'resolved', label: 'Resolved — repair completed' },
          { value: 'denied', label: 'Denied — not a covered issue' },
        ]);
        out.notesInput = _textarea(sheet, 'Resolution notes', 'What was found and done (or why it was denied)');
        out.billableCb = _checkbox(sheet, 'Billable to the homeowner (out of warranty / goodwill)');
      },
      'Resolve'
    );
    if (!fields) return false;
    const notes = fields.notesInput.value.trim();
    if (!notes) {
      if (typeof window.showToast === 'function') window.showToast('Resolution notes are required to close a claim', 'warning');
      return false;
    }
    if (!_ready()) throw new Error('promptResolution: Firebase helpers not available on this page');

    const status = fields.outcomeSel.value; // 'resolved' | 'denied'
    const claimRef = window.doc(window.db, 'leads', lead.id, 'warrantyClaims', lead.openWarrantyClaimId);
    const leadRef = window.doc(window.db, 'leads', lead.id);
    const now = window.serverTimestamp();
    const batch = window.writeBatch(window.db);
    batch.update(claimRef, {
      status,
      resolutionNotes: notes.slice(0, 2000),
      billable: status === 'resolved' && !!fields.billableCb.checked,
      resolvedAt: now,
      updatedAt: now,
    });
    batch.update(leadRef, { openWarrantyClaimId: null, updatedAt: now });
    await batch.commit();

    lead.openWarrantyClaimId = null;
    return true;
  }

  // Claim-doc-ONLY status advance (schedule visit, log diagnosis) — never
  // touches lead.stage/stageHistory, never routed through commitStageChange().
  async function advanceClaimStatus(lead, newStatus, extra) {
    if (!(lead && lead.openWarrantyClaimId)) throw new Error('advanceClaimStatus: no open claim on this lead');
    if (!_ready()) throw new Error('advanceClaimStatus: Firebase helpers not available on this page');
    const missing = (window.missingClaimFields ? window.missingClaimFields(extra || {}, newStatus) : []);
    if (missing.length) throw new Error('advanceClaimStatus: missing ' + missing.join(', ') + ' for status ' + newStatus);
    const claimRef = window.doc(window.db, 'leads', lead.id, 'warrantyClaims', lead.openWarrantyClaimId);
    const payload = Object.assign({}, extra, { status: newStatus, updatedAt: window.serverTimestamp() });
    await window.updateDoc(claimRef, payload);
    return true;
  }

  // ─────────────────────────────────────────────
  // Panel — customer.html's #warrantyClaimPanel. Renders nothing when the
  // job was never closed and has no history of a claim (keeps the panel
  // invisible for the common case). Read-only summary; status ADVANCES
  // happen from the dashboard side (rep tools), this panel is informational
  // for the customer-facing rep view.
  // ─────────────────────────────────────────────
  async function renderPanel(elId, lead) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!lead || !lead.openWarrantyClaimId) { el.innerHTML = ''; return; }
    if (!(window.db && window.doc && window.getDoc)) return;

    let claim = null;
    try {
      const snap = await window.getDoc(window.doc(window.db, 'leads', lead.id, 'warrantyClaims', lead.openWarrantyClaimId));
      if (snap.exists()) claim = snap.data();
    } catch (e) { console.warn('[warranty-claim] panel read failed:', e && e.message); return; }
    if (!claim) { el.innerHTML = ''; return; }

    const reasonLabel = (window.subTypeLabel ? window.subTypeLabel('warranty', claim.reason) : claim.reason) || claim.reason || '';
    el.innerHTML =
      '<div class="panel" style="border-left:3px solid #c2410c;">' +
        '<div class="panel-title">🛟 Open Warranty Claim</div>' +
        '<div class="info-grid">' +
          '<div class="info-item"><div class="info-label">Status</div><div class="info-value">' + _esc(claim.status || 'open') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Reason</div><div class="info-value">' + _esc(reasonLabel) + '</div></div>' +
        '</div>' +
        (claim.issueDescription ? '<div style="margin-top:10px;font-size:13px;color:var(--t);">' + _esc(claim.issueDescription) + '</div>' : '') +
      '</div>';
  }

  window.WarrantyClaim = {
    hasOpenClaim: hasOpenClaim,
    promptIntake: promptIntake,
    promptResolution: promptResolution,
    advanceClaimStatus: advanceClaimStatus,
    renderPanel: renderPanel,
  };
})();
