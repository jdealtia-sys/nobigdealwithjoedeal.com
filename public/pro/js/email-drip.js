/**
 * NBD Pro — Stage-Based Email Drip Automation
 * Configurable auto-email triggers when leads move between stages.
 * Watches stage transitions in moveCard() and fires the appropriate
 * email template from email_system.js after a configurable delay.
 *
 * Also supports time-based drip sequences (follow-up reminders).
 * All settings stored in Firestore userSettings/{uid}/dripConfig.
 *
 * Exposes: window.EmailDrip
 */

(function() {
  'use strict';

  // Default drip rules — can be customized per user
  const DEFAULT_RULES = [
    { id: 'new_welcome',        fromStage: null,               toStage: 'new',                template: 'welcome',            delaySec: 0,    enabled: true, label: 'Welcome email on new lead' },
    { id: 'inspection_sched',   fromStage: 'new',              toStage: 'inspection_scheduled', template: 'inspectionScheduled', delaySec: 0,  enabled: true, label: 'Confirmation when inspection is scheduled' },
    { id: 'claim_filed',        fromStage: null,               toStage: 'claim_filed',          template: 'claimFiled',          delaySec: 0,  enabled: true, label: 'Update when claim is filed' },
    { id: 'approved_congrats',  fromStage: null,               toStage: 'approved',             template: 'approved',            delaySec: 0,  enabled: true, label: 'Congrats when claim is approved' },
    { id: 'install_sched',      fromStage: null,               toStage: 'install_scheduled',    template: 'installScheduled',    delaySec: 0,  enabled: true, label: 'Install scheduling confirmation' },
    { id: 'closed_review',      fromStage: null,               toStage: 'closed',               template: null,                  delaySec: 86400, enabled: true, label: 'Review request 24h after close',   action: 'review_request' },
    { id: 'closed_referral',    fromStage: null,               toStage: 'closed',               template: null,                  delaySec: 259200, enabled: true, label: 'Referral code 3 days after close', action: 'referral_code' },
    { id: 'followup_reminder',  fromStage: null,               toStage: null,                   template: 'followUpGeneric',     delaySec: 172800, enabled: false, label: 'Auto follow-up 48h after no activity', trigger: 'stale' }
  ];

  let _dripRules = [];
  let _dripLog = []; // In-memory log of sent drips this session

  // ═════════════════════════════════════════════════════════════
  // CONFIG MANAGEMENT
  // ═════════════════════════════════════════════════════════════

  async function loadDripConfig() {
    _dripRules = JSON.parse(JSON.stringify(DEFAULT_RULES));

    if (!window.db || !window._user) return _dripRules;

    try {
      const snap = await window.getDoc(window.doc(window.db, 'userSettings', window._user.uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.dripRules && Array.isArray(data.dripRules)) {
          // Merge user overrides with defaults
          data.dripRules.forEach(userRule => {
            const idx = _dripRules.findIndex(r => r.id === userRule.id);
            if (idx >= 0) {
              _dripRules[idx] = { ..._dripRules[idx], ...userRule };
            } else {
              _dripRules.push(userRule); // Custom user rule
            }
          });
        }
      }
    } catch(e) { console.warn('Drip config load failed:', e.message); }

    return _dripRules;
  }

  async function saveDripConfig(rules) {
    if (!window.db || !window._user) return false;
    try {
      await window.updateDoc(window.doc(window.db, 'userSettings', window._user.uid), {
        dripRules: rules || _dripRules
      });
      if (typeof showToast === 'function') showToast('Drip automation saved', 'ok');
      return true;
    } catch(e) {
      // Try setDoc if doc doesn't exist
      try {
        await window.setDoc(window.doc(window.db, 'userSettings', window._user.uid), {
          dripRules: rules || _dripRules
        }, { merge: true });
        return true;
      } catch(e2) {
        console.error('Drip config save failed:', e2);
        return false;
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // STAGE TRANSITION HANDLER
  // ═════════════════════════════════════════════════════════════

  /**
   * Called by moveCard() or any stage change.
   * Finds matching drip rules and queues them.
   */
  async function onStageChange(leadId, fromStage, toStage) {
    if (!leadId || !toStage) return;
    if (_dripRules.length === 0) await loadDripConfig();

    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead || !lead.email) return; // No email = can't drip

    const matchingRules = _dripRules.filter(r => {
      if (!r.enabled) return false;
      if (r.trigger === 'stale') return false; // Handled separately
      if (r.toStage && r.toStage !== toStage) return false;
      if (r.fromStage && r.fromStage !== fromStage) return false;
      return true;
    });

    for (const rule of matchingRules) {
      // Check if already sent
      const alreadySent = await checkDripSent(leadId, rule.id);
      if (alreadySent) continue;

      if (rule.delaySec <= 0) {
        // Immediate
        await executeDrip(leadId, rule);
      } else {
        // Delayed — schedule
        await scheduleDrip(leadId, rule);
      }
    }
  }

  /**
   * Execute a drip action
   */
  async function executeDrip(leadId, rule) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;

    try {
      if (rule.action === 'review_request') {
        // Trigger review request via ReviewEngine
        if (window.ReviewEngine?.sendReviewEmail) {
          window.ReviewEngine.sendReviewEmail(leadId);
        }
      } else if (rule.action === 'referral_code') {
        // Trigger referral code via ReviewEngine
        if (window.ReviewEngine?.sendReferralSMS) {
          window.ReviewEngine.sendReferralSMS(leadId);
        }
      } else if (rule.template) {
        // Send email via emailSystem
        const template = window.emailSystem?.stageTemplates?.[rule.template] || window.emailSystem?.templates?.[rule.template];
        if (template && lead.email) {
          const data = buildTemplateData(lead);
          let subject = template.subject;
          let body = template.body;
          Object.keys(data).forEach(key => {
            subject = subject.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key]);
            body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key]);
          });

          // Use EmailJS if configured, otherwise log (don't auto-open mailto)
          if (window.emailSystem?.config?.provider === 'emailjs') {
            await window.emailSystem.send(lead.email, subject, body);
          } else {
            // Create notification instead of auto-opening mailto
            if (window.db && window._user) {
              await window.addDoc(window.collection(window.db, 'notifications'), {
                userId: window._user.uid,
                leadId,
                type: 'drip_email',
                title: '📧 Auto-Email Ready',
                message: `Drip email "${rule.label}" ready for ${lead.firstName || 'lead'}. Tap to send.`,
                read: false,
                dismissed: false,
                createdAt: window.serverTimestamp(),
                meta: { ruleId: rule.id, subject, template: rule.template }
              });
            }
          }
        }
      }

      // Log the drip as sent
      await logDripSent(leadId, rule);
    } catch(e) {
      console.warn('Drip execution failed:', e.message);
    }
  }

  /**
   * Schedule a delayed drip
   */
  async function scheduleDrip(leadId, rule) {
    if (!window.db || !window._user) return;
    try {
      const fireAt = new Date(Date.now() + (rule.delaySec * 1000));
      await window.addDoc(window.collection(window.db, 'drip_queue'), {
        userId: window._user.uid,
        leadId,
        ruleId: rule.id,
        action: rule.action || null,
        template: rule.template || null,
        label: rule.label,
        fireAt: window.Timestamp ? window.Timestamp.fromDate(fireAt) : fireAt.toISOString(),
        status: 'pending',
        createdAt: window.serverTimestamp()
      });
    } catch(e) { console.warn('Schedule drip failed:', e.message); }
  }

  /**
   * Process pending drips (called periodically)
   */
  async function processPendingDrips() {
    if (!window.db || !window._user) return;
    try {
      const now = new Date();
      const snap = await window.getDocs(window.query(
        window.collection(window.db, 'drip_queue'),
        window.where('userId', '==', window._user.uid),
        window.where('status', '==', 'pending')
      ));

      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const fireAt = data.fireAt?.toDate ? data.fireAt.toDate() : new Date(data.fireAt);
        if (fireAt <= now) {
          // Find the rule
          const rule = _dripRules.find(r => r.id === data.ruleId) || {
            id: data.ruleId,
            action: data.action,
            template: data.template,
            label: data.label,
            enabled: true
          };
          await executeDrip(data.leadId, rule);
          // Mark as processed
          await window.updateDoc(window.doc(window.db, 'drip_queue', docSnap.id), {
            status: 'sent',
            sentAt: window.serverTimestamp()
          });
        }
      }
    } catch(e) { console.warn('Process drips failed:', e.message); }
  }

  // ═════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════

  async function checkDripSent(leadId, ruleId) {
    // Quick check in-memory first
    if (_dripLog.find(d => d.leadId === leadId && d.ruleId === ruleId)) return true;

    if (!window.db || !window._user) return false;
    try {
      const snap = await window.getDocs(window.query(
        window.collection(window.db, 'drip_log'),
        window.where('userId', '==', window._user.uid),
        window.where('leadId', '==', leadId),
        window.where('ruleId', '==', ruleId)
      ));
      return !snap.empty;
    } catch(e) { return false; }
  }

  async function logDripSent(leadId, rule) {
    _dripLog.push({ leadId, ruleId: rule.id, at: Date.now() });
    if (!window.db || !window._user) return;
    try {
      await window.addDoc(window.collection(window.db, 'drip_log'), {
        userId: window._user.uid,
        leadId,
        ruleId: rule.id,
        label: rule.label,
        sentAt: window.serverTimestamp()
      });
    } catch(e) { console.warn('Drip log failed:', e.message); }
  }

  function buildTemplateData(lead) {
    return {
      customerName: ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'there',
      address: lead.address || 'your property',
      damageType: lead.damageType || 'storm/hail',
      carrier: lead.insCarrier || lead.insuranceCarrier || 'your insurance company',
      claimNumber: lead.claimNumber || '[pending]',
      estimateAmount: lead.estimateAmount ? '$' + parseFloat(lead.estimateAmount).toLocaleString() : '[pending]',
      scheduledDate: lead.scheduledDate || '[to be confirmed]',
      crew: lead.crew || 'our installation team',
      preQualLink: lead.preQualLink || '[link will be sent separately]'
    };
  }

  // ═════════════════════════════════════════════════════════════
  // SETTINGS UI
  // ═════════════════════════════════════════════════════════════

  function renderDripSettings(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `
      <div style="background:var(--c,#111827);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:14px;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h3 style="margin:0;font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:var(--h,#fff);">📧 Email Drip Automation</h3>
          <button onclick="window.EmailDrip.saveConfig()" style="padding:6px 16px;background:#C8541A;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Save</button>
        </div>
        <div style="font-size:12px;color:var(--m,#9ca3af);margin-bottom:16px;">
          Configure automatic emails that trigger when leads move between stages.
          ${window.emailSystem?.config?.provider === 'emailjs' ? '<span style="color:#16a34a;">✓ EmailJS active — emails send automatically</span>' : '<span style="color:#eab308;">⚠ Mailto mode — emails show as notifications to approve</span>'}
        </div>
        ${_dripRules.map((rule, i) => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--s,rgba(255,255,255,.03));border:1px solid var(--br,rgba(255,255,255,.06));border-radius:10px;margin-bottom:8px;">
            <label style="position:relative;cursor:pointer;">
              <input type="checkbox" ${rule.enabled ? 'checked' : ''}
                onchange="window.EmailDrip._rules[${i}].enabled=this.checked"
                style="width:18px;height:18px;cursor:pointer;">
            </label>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--h,#fff);">${esc(rule.label)}</div>
              <div style="font-size:11px;color:var(--m,#9ca3af);margin-top:2px;">
                ${rule.toStage ? `Stage → <strong>${esc(rule.toStage)}</strong>` : 'Any stage'}
                ${rule.delaySec > 0 ? ` · Delay: ${formatDelay(rule.delaySec)}` : ' · Immediate'}
                ${rule.template ? ` · Template: ${esc(rule.template)}` : ''}
                ${rule.action ? ` · Action: ${esc(rule.action)}` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function formatDelay(sec) {
    if (sec >= 86400) return Math.round(sec / 86400) + ' day' + (sec >= 172800 ? 's' : '');
    if (sec >= 3600) return Math.round(sec / 3600) + ' hour' + (sec >= 7200 ? 's' : '');
    return sec + ' sec';
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // Init: load config and start drip processor
  async function initDrip() {
    await loadDripConfig();
    // Process pending drips every 5 minutes
    setInterval(processPendingDrips, 5 * 60 * 1000);
    // Process once on load
    setTimeout(processPendingDrips, 10000);
  }

  // Auto-init when user is ready
  function waitAndInit() {
    if (window._user && window.db) {
      initDrip();
    } else {
      setTimeout(waitAndInit, 2000);
    }
  }
  setTimeout(waitAndInit, 5000);

  window.EmailDrip = {
    onStageChange,
    loadConfig: loadDripConfig,
    saveConfig: saveDripConfig,
    renderSettings: renderDripSettings,
    processPending: processPendingDrips,
    _rules: _dripRules
  };

})();
