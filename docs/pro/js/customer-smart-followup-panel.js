/**
 * customer-smart-followup-panel.js — Wave 113 (suggestion panel on customer page)
 *
 * Full UI for the W111 SmartFollowup engine. Where the W112
 * kanban pill is a glance-level signal, this panel is where the
 * rep ACTS: see the headline, the reasoning, the draft, and
 * one-click execute.
 *
 * Layout (rendered into a host div near the customer page action
 * bar — or auto-injected if the host is missing):
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ ⚡ Urgent · 90% confident                        │
 *   │ Call Sarah — they viewed your estimate 3× today  │
 *   │ Engaged customer (multi-view) but no rep activity│
 *   │ in 24h+. Engaged customers go cold fast — this is│
 *   │ the highest-leverage moment.                     │
 *   │                                                  │
 *   │ Draft (SMS):                                     │
 *   │ ┌──────────────────────────────────────────────┐ │
 *   │ │ Hi Sarah, saw you were just looking at the   │ │
 *   │ │ estimate — happy to walk through any         │ │
 *   │ │ questions. Got a minute?                     │ │
 *   │ └──────────────────────────────────────────────┘ │
 *   │                                                  │
 *   │  [📞 Call]  [💬 Send SMS]  [📧 Email]  [✕ Dismiss]│
 *   └──────────────────────────────────────────────────┘
 *
 * Action buttons:
 *   - Channel-primary action (📞/💬/📧 based on suggestion.channel)
 *     fires PortalLinkHelpers.smsForLead/emailForLead with the
 *     draft pre-filled. The W98 picker integration means the rep
 *     can still swap to a different template — the SmartFollowup
 *     draft becomes one option among the rep's saved templates.
 *   - Other channels render but are de-emphasized
 *   - Dismiss → hides the panel for this lead this session
 *     (W116 will track these dismissals to inform pattern learning)
 *
 * Path-gated to /pro/customer.html. Updates on:
 *   - DOMContentLoaded + 1.5s defer (so caches populate)
 *   - 'nbd:data-refreshed' event
 *
 * Compounds W111 (computeSuggestion), W41/W43/W98 (action
 * helpers + template picker), W85 (modal a11y patterns).
 */
(function () {
  'use strict';

  if (window.CustomerSmartFollowupPanel
      && window.CustomerSmartFollowupPanel.__sentinel === 'nbd-customer-smart-followup-panel-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  // Per-session dismissed set so a rep doesn't see the same
  // suggestion repeatedly after acknowledging it. Cleared on
  // page reload — W116 will persist this to Firestore for
  // pattern learning.
  const _dismissedThisSession = new Set();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ─── Render ──────────────────────────────────────────────────────
  // W114: render-once-then-enrich pattern. The heuristic suggestion
  // appears instantly (no waiting on the network), then we kick off
  // an AI enrichment in the background and re-render with the
  // improved headline/reasoning/draft when it returns. Failures
  // degrade silently — the heuristic version stays visible.
  function update() {
    const host = ensureHost();
    if (!host) return;
    const lead = window._currentLead;
    if (!lead || _dismissedThisSession.has(lead.id)) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    if (!window.SmartFollowup
        || typeof window.SmartFollowup.computeSuggestion !== 'function') {
      host.style.display = 'none';
      return;
    }
    const sug = window.SmartFollowup.computeSuggestion(lead);
    if (!sug || sug.priority === 'wait' || sug.priority === 'monitor') {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    // Render the heuristic version immediately, then enrich.
    _renderSuggestion(host, lead, sug);
    if (typeof window.SmartFollowup.enrichSuggestionAI === 'function') {
      window.SmartFollowup.enrichSuggestionAI(lead).then(enriched => {
        // Defensive: skip if rep navigated to a different lead or
        // dismissed during the API call.
        if (!enriched || _dismissedThisSession.has(lead.id)) return;
        if (!window._currentLead || window._currentLead.id !== lead.id) return;
        // Skip the re-render if AI returned the same heuristic
        // (no enrichment happened — failure or API unavailable).
        if (!enriched._aiEnriched) return;
        _renderSuggestion(host, lead, enriched);
      }).catch(() => { /* silent — heuristic stays visible */ });
    }
  }

  function _renderSuggestion(host, lead, sug) {

    // Color register matches W112 kanban pill so cross-surface
    // priorities read identically.
    let bg, color, border, accent, icon, label;
    if (sug.priority === 'urgent') {
      bg = 'rgba(239,68,68,0.10)'; color = '#fca5a5'; border = 'rgba(239,68,68,0.45)'; accent = '#ef4444'; icon = '⚡'; label = 'Urgent';
    } else if (sug.priority === 'today') {
      bg = 'rgba(245,158,11,0.10)'; color = '#fcd34d'; border = 'rgba(245,158,11,0.45)'; accent = '#f59e0b'; icon = '💡'; label = 'Today';
    } else { // this-week
      bg = 'rgba(96,165,250,0.10)'; color = '#93c5fd'; border = 'rgba(96,165,250,0.45)'; accent = '#3b82f6'; icon = '👁'; label = 'This week';
    }

    const phone = String(lead.phone || '').replace(/\D+/g, '');
    const email = String(lead.email || '').trim();
    const channel = sug.channel || 'sms';
    const draft = sug.draft || '';

    // Determine which channel buttons to highlight as primary.
    // Primary = the suggestion's channel; secondary = others that
    // are reachable. Disabled = no contact info on file.
    const callPrimary  = channel === 'call';
    const smsPrimary   = channel === 'sms';
    const emailPrimary = channel === 'email';

    const callBtnHtml = `
      <a class="csf-btn" href="tel:${escapeHtml(phone)}"
        title="Call ${escapeHtml(lead.phone || '')}"
        style="display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border-radius:7px;
               background:${callPrimary ? accent : 'rgba(16,185,129,0.14)'}; color:${callPrimary ? '#fff' : '#10b981'};
               border:1px solid ${callPrimary ? accent : 'rgba(16,185,129,0.45)'};
               text-decoration:none; font:inherit; font-size:12px; font-weight:700;
               cursor:${phone ? 'pointer' : 'not-allowed'}; opacity:${phone ? 1 : 0.4};
               -webkit-tap-highlight-color:transparent; transition:transform .12s;"
        ${phone ? "" : "data-csfp-stop-self=\"1\""}
        onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform=''">📞 Call</a>`;

    const smsBtnHtml = `
      <button class="csf-btn" type="button" data-csf-action="sms"
        title="Send SMS with the draft below"
        style="display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border-radius:7px;
               background:${smsPrimary ? accent : 'rgba(59,130,246,0.14)'}; color:${smsPrimary ? '#fff' : '#3b82f6'};
               border:1px solid ${smsPrimary ? accent : 'rgba(59,130,246,0.45)'};
               font:inherit; font-size:12px; font-weight:700;
               cursor:${phone ? 'pointer' : 'not-allowed'}; opacity:${phone ? 1 : 0.4};
               -webkit-tap-highlight-color:transparent; transition:transform .12s;"
        onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform=''">💬 SMS</button>`;

    const emailBtnHtml = `
      <button class="csf-btn" type="button" data-csf-action="email"
        title="Compose email with the draft below"
        style="display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border-radius:7px;
               background:${emailPrimary ? accent : 'rgba(139,92,246,0.14)'}; color:${emailPrimary ? '#fff' : '#8b5cf6'};
               border:1px solid ${emailPrimary ? accent : 'rgba(139,92,246,0.45)'};
               font:inherit; font-size:12px; font-weight:700;
               cursor:${email ? 'pointer' : 'not-allowed'}; opacity:${email ? 1 : 0.4};
               -webkit-tap-highlight-color:transparent; transition:transform .12s;"
        onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform=''">📧 Email</button>`;

    const dismissBtnHtml = `
      <button class="csf-btn" type="button" data-csf-action="dismiss"
        title="Dismiss this suggestion (this session only)"
        aria-label="Dismiss suggestion"
        style="margin-left:auto; padding:9px 12px; border-radius:7px;
               background:transparent; color:var(--m,#9aa3b2);
               border:1px solid var(--br,#2a3344);
               font:inherit; font-size:12px; font-weight:600;
               cursor:pointer; -webkit-tap-highlight-color:transparent;">✕ Dismiss</button>`;

    const draftHtml = draft ? `
      <div style="margin-top:12px; padding:11px 13px; background:rgba(255,255,255,0.02); border:1px solid var(--br,#2a3344); border-radius:8px;">
        <div style="font-size:10px; font-weight:600; color:var(--m,#9aa3b2); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">
          Suggested ${escapeHtml(channel === 'email' ? 'email' : 'SMS')}
        </div>
        <div style="font-size:13px; color:var(--t,#e8eaf0); line-height:1.5; white-space:pre-wrap;">${escapeHtml(draft)}</div>
      </div>` : '';

    host.innerHTML = `
      <div role="region" aria-label="Smart follow-up suggestion"
        style="background:${bg}; border:1px solid ${border}; border-radius:10px; padding:14px 16px; margin:12px 0;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span aria-hidden="true" style="font-size:18px;">${icon}</span>
          <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:${color};">${escapeHtml(label)}</span>
          <span style="font-size:11px; color:var(--m,#9aa3b2); font-weight:500;">· ${escapeHtml(String(sug.confidence))}% confident</span>
          ${sug._aiEnriched ? '<span title="AI-enriched suggestion" style="font-size:10px; color:#a78bfa; font-weight:600; padding:2px 7px; border-radius:9px; background:rgba(167,139,250,0.14); border:1px solid rgba(167,139,250,0.35); margin-left:4px;">✨ AI</span>' : ''}
        </div>
        <div style="font-size:14px; font-weight:700; color:var(--t,#e8eaf0); margin-bottom:4px;">
          ${escapeHtml(sug.headline)}
        </div>
        <div style="font-size:12px; color:var(--m,#9aa3b2); line-height:1.45;">
          ${escapeHtml(sug.reasoning)}
        </div>
        ${draftHtml}
        <div style="display:flex; align-items:center; gap:8px; margin-top:12px; flex-wrap:wrap;">
          ${phone ? callBtnHtml + smsBtnHtml : ''}
          ${email ? emailBtnHtml : ''}
          ${dismissBtnHtml}
        </div>
      </div>`;
    host.style.display = '';
    wireActions(host, lead);
  }

  function wireActions(host, lead) {
    host.querySelectorAll('[data-csf-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.getAttribute('data-csf-action');
        // W116: track outcome before firing so we capture even if
        // the action navigates away. Use the live suggestion (not
        // cached) so the signals match what the rep actually saw.
        const sug = (window.SmartFollowup && typeof window.SmartFollowup.computeSuggestion === 'function')
          ? window.SmartFollowup.computeSuggestion(lead) : null;
        if (action === 'sms' && window.PortalLinkHelpers
            && typeof window.PortalLinkHelpers.smsForLead === 'function') {
          if (window.SmartFollowup && window.SmartFollowup.recordOutcome) {
            window.SmartFollowup.recordOutcome(lead.id, 'acted', sug);
          }
          window.PortalLinkHelpers.smsForLead(lead);
        } else if (action === 'email' && window.PortalLinkHelpers
            && typeof window.PortalLinkHelpers.emailForLead === 'function') {
          if (window.SmartFollowup && window.SmartFollowup.recordOutcome) {
            window.SmartFollowup.recordOutcome(lead.id, 'acted', sug);
          }
          window.PortalLinkHelpers.emailForLead(lead);
        } else if (action === 'dismiss') {
          if (window.SmartFollowup && window.SmartFollowup.recordOutcome) {
            window.SmartFollowup.recordOutcome(lead.id, 'dismissed', sug);
          }
          _dismissedThisSession.add(lead.id);
          update();
        }
      });
    });
    // W116: also record the call action when the rep clicks the
    // tel: anchor — captures the most-frequent action type in
    // the field.
    host.querySelectorAll('a[href^="tel:"]').forEach(a => {
      a.addEventListener('click', () => {
        if (!window.SmartFollowup || !window.SmartFollowup.recordOutcome) return;
        const sug = (typeof window.SmartFollowup.computeSuggestion === 'function')
          ? window.SmartFollowup.computeSuggestion(lead) : null;
        window.SmartFollowup.recordOutcome(lead.id, 'acted', sug);
      });
    });
  }

  // ─── Host injection ──────────────────────────────────────────────
  // The customer page doesn't have a stable "smart-followup-panel"
  // div by default. Inject one above the action bar (#quick-action-bar
  // or .quick-actions), or fall back to right after the meta-row.
  function ensureHost() {
    let host = document.getElementById('smartFollowupPanel');
    if (host) return host;
    const anchor =
      document.querySelector('.quick-actions') ||
      document.getElementById('customerIdBadge') ||
      document.querySelector('.meta-row');
    if (!anchor || !anchor.parentNode) return null;
    host = document.createElement('div');
    host.id = 'smartFollowupPanel';
    host.style.display = 'none';
    anchor.parentNode.insertBefore(host, anchor);
    return host;
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
  }

  window.CustomerSmartFollowupPanel = {
    __sentinel: 'nbd-customer-smart-followup-panel-v1',
    update,
    dismiss: (id) => { _dismissedThisSession.add(id); update(); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


(function(){if(window._NBD_CSFP_DELEGATE)return;window._NBD_CSFP_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-csfp-stop-self="1"]');if(t&&ev.target===t)ev.preventDefault();});})();
