/**
 * customer-ai-drafts-panel.js — T-2: AI texting rep UI
 * ═══════════════════════════════════════════════════════════════
 *
 * Surfaces the AI-suggested SMS replies that the incomingSMS webhook
 * generates (handlers/ai-texting.js → /leads/{leadId}/ai_drafts with
 * status:'pending'). Before T-2 those drafts were written to Firestore
 * but nothing displayed them — the AI pipeline was dead-ended. This
 * panel is the rep's review surface:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 🤖 AI reply draft · 2m ago                            │
 *   │ They texted: "How much for a new roof?"               │
 *   │ ┌──────────────────────────────────────────────────┐ │
 *   │ │ Joe handles all pricing personally — he'll come  │ │  ← editable
 *   │ │ out, take a look, and put a real number on it.   │ │
 *   │ │ Want to set up a free inspection?                │ │
 *   │ └──────────────────────────────────────────────────┘ │
 *   │             [ ✅ Approve & Send ]   [ ✕ Dismiss ]     │
 *   └──────────────────────────────────────────────────────┘
 *
 * "Approve & Send" writes status:'approved' (+ any edits the rep made
 * to the text). It does NOT send from the browser — the server trigger
 * onAiDraftApproved (functions/sms-functions.js) sends through the
 * Twilio business line so the reply goes out the SAME number the
 * homeowner texted, then flips the draft to 'sent' (or 'failed').
 * "Dismiss" writes status:'dismissed' and the trigger ignores it.
 *
 * The rep never gets a draft sent without tapping approve — there is
 * no autonomous customer-facing send in v1.
 *
 * Path-gated to /pro/customer.html. Refreshes on DOMContentLoaded
 * (+1.5s defer so window._currentLead + the Firestore shims populate)
 * and on the 'nbd:data-refreshed' event. CSP-safe: all actions are
 * delegated off data-* attributes, no inline onclick / no inline
 * <script> (see [[csp-onclick-sweep-shipped]]).
 */
(function () {
  'use strict';

  if (window.CustomerAiDraftsPanel
      && window.CustomerAiDraftsPanel.__sentinel === 'nbd-customer-ai-drafts-panel-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  // Guards against a card whose action is mid-flight, so a double-tap
  // can't fire two approves (which the server trigger would dedupe
  // anyway, but belt-and-suspenders on the client).
  const _busy = new Set();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function relTime(ts) {
    try {
      const d = ts && typeof ts.toDate === 'function' ? ts.toDate()
        : (ts && ts.seconds ? new Date(ts.seconds * 1000) : null);
      if (!d) return '';
      const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
      if (secs < 60) return 'just now';
      const mins = Math.round(secs / 60);
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.round(hrs / 24) + 'd ago';
    } catch (_) { return ''; }
  }

  function currentUserRef() {
    const u = (window._auth && window._auth.currentUser)
      || (window.auth && window.auth.currentUser) || null;
    return u ? (u.uid || u.email || null) : null;
  }

  // ─── Host injection (above the action bar, mirrors W113 panel) ───
  function ensureHost() {
    let host = document.getElementById('aiDraftsPanel');
    if (host) return host;
    const anchor =
      document.querySelector('.quick-actions') ||
      document.getElementById('customerIdBadge') ||
      document.querySelector('.meta-row');
    if (!anchor || !anchor.parentNode) return null;
    host = document.createElement('div');
    host.id = 'aiDraftsPanel';
    host.style.display = 'none';
    anchor.parentNode.insertBefore(host, anchor);
    return host;
  }

  function fsReady() {
    return window.db && window.collection && window.query
      && window.where && window.getDocs && window.doc && window.updateDoc;
  }

  // ─── Fetch pending drafts for the open lead ──────────────────────
  async function fetchPending(leadId) {
    const col = window.collection(window.db, 'leads', leadId, 'ai_drafts');
    // Prefer newest-first; fall back to an unordered query if the
    // generatedAt index isn't present yet (first-run on a project).
    let snap;
    try {
      snap = await window.getDocs(window.query(col,
        window.where('status', '==', 'pending'),
        window.orderBy('generatedAt', 'desc')));
    } catch (_) {
      snap = await window.getDocs(window.query(col,
        window.where('status', '==', 'pending')));
    }
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ─── Render ──────────────────────────────────────────────────────
  function cardHtml(draft) {
    const incoming = String(draft.incomingBody || '').trim();
    const draftText = String(draft.draftText || '');
    const when = relTime(draft.generatedAt);
    const incomingHtml = incoming ? `
      <div style="font-size:12px; color:var(--m,#9aa3b2); margin:2px 0 10px;">
        They texted:
        <span style="color:var(--t,#e8eaf0);">"${escapeHtml(incoming.slice(0, 280))}"</span>
      </div>` : '';

    return `
      <div class="aidp-card" data-aidp-id="${escapeHtml(draft.id)}"
        data-aidp-original="${escapeHtml(draftText)}"
        style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.40);
               border-radius:10px; padding:14px 16px; margin:12px 0;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span aria-hidden="true" style="font-size:17px;">🤖</span>
          <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#a5b4fc;">AI reply draft</span>
          ${when ? `<span style="font-size:11px; color:var(--m,#9aa3b2); font-weight:500;">· ${escapeHtml(when)}</span>` : ''}
        </div>
        ${incomingHtml}
        <label style="display:block; font-size:10px; font-weight:600; color:var(--m,#9aa3b2);
                      text-transform:uppercase; letter-spacing:0.05em; margin-bottom:5px;">
          Draft (editable) — sends from the business line
        </label>
        <textarea class="aidp-text" rows="3"
          aria-label="AI draft reply text (editable)"
          style="width:100%; box-sizing:border-box; resize:vertical; min-height:64px;
                 background:rgba(255,255,255,0.03); color:var(--t,#e8eaf0);
                 border:1px solid var(--br,#2a3344); border-radius:8px;
                 padding:9px 11px; font:inherit; font-size:13px; line-height:1.5;">${escapeHtml(draftText)}</textarea>
        <div style="display:flex; align-items:center; gap:8px; margin-top:11px;">
          <button type="button" data-aidp-action="approve" class="aidp-btn"
            style="display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border-radius:7px;
                   background:#6366f1; color:#fff; border:1px solid #6366f1;
                   font:inherit; font-size:12px; font-weight:700; cursor:pointer;
                   -webkit-tap-highlight-color:transparent;">✅ Approve &amp; Send</button>
          <button type="button" data-aidp-action="dismiss" class="aidp-btn"
            title="Discard this draft (won't be sent)"
            style="margin-left:auto; padding:9px 12px; border-radius:7px;
                   background:transparent; color:var(--m,#9aa3b2); border:1px solid var(--br,#2a3344);
                   font:inherit; font-size:12px; font-weight:600; cursor:pointer;
                   -webkit-tap-highlight-color:transparent;">✕ Dismiss</button>
        </div>
        <div class="aidp-status" role="status" aria-live="polite"
          style="font-size:11px; color:var(--m,#9aa3b2); margin-top:8px; min-height:14px;"></div>
      </div>`;
  }

  async function update() {
    const host = ensureHost();
    if (!host) return;
    const lead = window._currentLead;
    if (!lead || !lead.id || !fsReady()) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }

    let drafts = [];
    try {
      drafts = await fetchPending(lead.id);
    } catch (e) {
      // Permission or network error — don't surface a broken panel.
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    // Guard against a late return after the rep navigated to another lead.
    if (!window._currentLead || window._currentLead.id !== lead.id) return;

    if (!drafts.length) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }

    host.style.display = '';
    host.innerHTML = drafts.map(cardHtml).join('');
  }

  // ─── Actions ─────────────────────────────────────────────────────
  async function handleAction(action, card) {
    const lead = window._currentLead;
    if (!lead || !lead.id) return;
    const draftId = card.getAttribute('data-aidp-id');
    if (!draftId || _busy.has(draftId)) return;

    const statusEl = card.querySelector('.aidp-status');
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    const setBusy = (on) => {
      _busy[on ? 'add' : 'delete'](draftId);
      card.querySelectorAll('.aidp-btn').forEach(b => { b.disabled = on; b.style.opacity = on ? '0.55' : '1'; });
    };

    const ref = window.doc(window.db, 'leads', lead.id, 'ai_drafts', draftId);
    const stamp = window.serverTimestamp ? window.serverTimestamp() : new Date();

    if (action === 'dismiss') {
      setBusy(true); setStatus('Dismissing…');
      try {
        await window.updateDoc(ref, { status: 'dismissed', dismissedAt: stamp });
        card.remove();
        if (window.showToast) window.showToast('Draft dismissed', 'info');
        if (!document.querySelector('#aiDraftsPanel .aidp-card')) {
          const host = document.getElementById('aiDraftsPanel');
          if (host) { host.style.display = 'none'; host.innerHTML = ''; }
        }
      } catch (e) {
        setBusy(false); setStatus('Could not dismiss — try again.');
        if (window.showToast) window.showToast('Dismiss failed: ' + (e && e.message || 'error'), 'error');
      }
      return;
    }

    if (action === 'approve') {
      const ta = card.querySelector('.aidp-text');
      const edited = (ta ? ta.value : '').trim();
      if (!edited) { setStatus('Add some text before sending.'); if (ta) ta.focus(); return; }
      const original = card.getAttribute('data-aidp-original') || '';
      setBusy(true); setStatus('Approving — sending from the business line…');
      try {
        await window.updateDoc(ref, {
          status: 'approved',
          draftText: edited,
          editedByRep: edited !== original,
          approvedBy: currentUserRef(),
          approvedAt: stamp,
        });
        card.remove();
        if (window.showToast) window.showToast('Approved — reply is sending 📤', 'success');
        if (!document.querySelector('#aiDraftsPanel .aidp-card')) {
          const host = document.getElementById('aiDraftsPanel');
          if (host) { host.style.display = 'none'; host.innerHTML = ''; }
        }
      } catch (e) {
        setBusy(false); setStatus('Could not send — try again.');
        if (window.showToast) window.showToast('Send failed: ' + (e && e.message || 'error'), 'error');
      }
    }
  }

  // Delegated click handler scoped to the panel host.
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest && ev.target.closest('#aiDraftsPanel [data-aidp-action]');
    if (!btn) return;
    const card = btn.closest('.aidp-card');
    if (!card) return;
    ev.preventDefault();
    handleAction(btn.getAttribute('data-aidp-action'), card);
  });

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
  }

  window.CustomerAiDraftsPanel = {
    __sentinel: 'nbd-customer-ai-drafts-panel-v1',
    update,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
