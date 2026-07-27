/* ══════════════════════════════════════════════════════════════════════
   customer-checklist.js — persisted per-job workflow checklist
   (RoofLink "View Checklist" parity).

   The stage-based next-action chips (crm-stages.js) are transient
   suggestions — nothing stored a job-level check-off state. This panel
   renders a jobType-appropriate checklist on customer.html and persists
   ticks as a flat map on the lead doc:

     lead.jobChecklist = { 'ins-inspect': true, 'ins-file-claim': true, … }

   CSP contract: checkboxes carry data-change-action="toggleJobChecklistItem"
   + data-arg="<key>" + data-pass-el="true" and ride customer-tasks-ui.js's
   existing change delegate → window.toggleJobChecklistItem(key, el).
   Item keys are stable slugs (safe as Firestore map keys + dot paths).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.JobChecklist) return; // single owner

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  // Stable keys — NEVER rename one (renames orphan saved ticks).
  var CHECKLISTS = {
    insurance: [
      { key: 'ins-inspect',      label: 'Inspect roof & document damage' },
      { key: 'ins-photos',       label: 'Capture photo set (Before)' },
      { key: 'ins-file-claim',   label: 'File claim with carrier' },
      { key: 'ins-adjuster',     label: 'Meet adjuster on site' },
      { key: 'ins-scope',        label: 'Receive carrier scope / approval' },
      { key: 'ins-estimate',     label: 'Build & send estimate' },
      { key: 'ins-contract',     label: 'Sign contract' },
      { key: 'ins-materials',    label: 'Order materials' },
      { key: 'ins-install',      label: 'Install & photo (During / After)' },
      { key: 'ins-supplement',   label: 'File supplement (if needed)' },
      { key: 'ins-invoice',      label: 'Final invoice & COC to carrier' },
      { key: 'ins-collect',      label: 'Collect deductible + final payment' }
    ],
    default: [
      { key: 'job-inspect',      label: 'Inspect & photo document' },
      { key: 'job-estimate',     label: 'Build & send estimate' },
      { key: 'job-follow-up',    label: 'Follow up on estimate' },
      { key: 'job-contract',     label: 'Sign contract' },
      { key: 'job-materials',    label: 'Order materials' },
      { key: 'job-schedule',     label: 'Schedule crew' },
      { key: 'job-install',      label: 'Install & photo (During / After)' },
      { key: 'job-walkthrough',  label: 'Final walkthrough' },
      { key: 'job-collect',      label: 'Collect final payment' },
      { key: 'job-review',       label: 'Request a review' }
    ]
  };

  function itemsFor(lead) {
    return (lead && lead.jobType === 'insurance') ? CHECKLISTS.insurance : CHECKLISTS.default;
  }

  function render(lead) {
    var panel = document.getElementById('checklistPanel');
    if (!panel) return;
    lead = lead || window._currentLead || {};
    var items = itemsFor(lead);
    var state = lead.jobChecklist || {};
    var done = items.filter(function (i) { return !!state[i.key]; }).length;
    var pct = items.length ? Math.round((done / items.length) * 100) : 0;

    var rows = items.map(function (i) {
      var checked = !!state[i.key];
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid var(--br,rgba(255,255,255,.06));cursor:pointer;">' +
        '<input type="checkbox"' + (checked ? ' checked' : '') +
          ' data-change-action="toggleJobChecklistItem" data-arg="' + esc(i.key) + '" data-pass-el="true"' +
          ' style="width:16px;height:16px;cursor:pointer;flex:0 0 auto;accent-color:var(--orange,#e8720c);">' +
        '<span style="flex:1;font-size:13px;color:' + (checked ? 'var(--m,#9ca3af)' : 'var(--t)') + ';' +
          (checked ? 'text-decoration:line-through;' : '') + '">' + esc(i.label) + '</span>' +
        '</label>';
    }).join('');

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div class="panel-title" style="margin:0;">Job Checklist</div>' +
        '<span style="font-size:12px;color:var(--m,#9ca3af);font-weight:700;">' + done + ' of ' + items.length + '</span>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,.06);height:6px;border-radius:3px;overflow:hidden;margin-bottom:6px;">' +
        '<div style="background:var(--orange,#e8720c);height:100%;width:' + pct + '%;transition:width .25s ease;"></div>' +
      '</div>' +
      rows;
    panel.style.display = 'block';
  }

  // data-change-action handler — el is the checkbox (data-pass-el).
  window.toggleJobChecklistItem = async function (key, el) {
    if (!key || !window._customerId) return;
    var checked = !!(el && el.checked);
    try {
      var update = { updatedAt: new Date() };
      update['jobChecklist.' + key] = checked;
      await window.updateDoc(window.doc(window.db, 'leads', window._customerId), update);
      var lead = window._currentLead || {};
      lead.jobChecklist = lead.jobChecklist || {};
      lead.jobChecklist[key] = checked;
      render(lead); // repaint strike-through + progress bar
    } catch (e) {
      console.error('Checklist toggle failed:', e);
      if (el) el.checked = !checked; // revert the optimistic flip
      if (typeof window.showToast === 'function') {
        window.showToast('Could not save checklist — try again', 'error');
      }
    }
  };

  window.JobChecklist = { render: render, CHECKLISTS: CHECKLISTS };

  // Late-load self-render (defer order races the bootstrap module).
  if (window._currentLead && document.getElementById('checklistPanel')) {
    try { render(window._currentLead); } catch (e) {}
  }
})();
