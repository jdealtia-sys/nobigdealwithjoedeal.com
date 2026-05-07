/**
 * ai-followup-draft.js — Wave 162 (AI follow-up SMS draft)
 *
 * Pre-writes a personalized SMS the rep can copy or send in one
 * tap from the customer page. Where the W113 SmartFollowup panel
 * tells the rep WHAT to do next, this panel tells the rep
 * WHAT TO SAY — pre-filled, in their voice, ready to send.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ ✉  Suggested SMS                            [↻]  [📋] │
 *   │ ──────────────────────────────────────────────────── │
 *   │ Hey Sarah — quick check on the estimate I sent       │
 *   │ Tuesday. Any questions before you sign? Happy to     │
 *   │ jump on a quick call.                                │
 *   │                                                       │
 *   │  [💬 Open in Messages]   [📋 Copy]   [↻ Regenerate]  │
 *   └────────────────────────────────────────────────────────┘
 *
 * Generation rules:
 *   - Max 320 chars (2 SMS segments max so it's safe to send)
 *   - Pulls lead context: name, stage, last contact age, last
 *     estimate snapshot, recent signals (unread, hot tier)
 *   - Uses Claude Haiku via callClaude() with a tight system
 *     prompt that enforces the rep's casual-professional tone
 *   - Output cached in localStorage per (leadId, calendarDay)
 *     so re-opening the customer page doesn't burn a fresh
 *     API call until tomorrow OR the rep clicks Regenerate
 *
 * Failure modes:
 *   - Claude unavailable → fall back to a deterministic
 *     template ("Hey [name] — checking in on your project.")
 *   - No phone on file → show the draft but disable the
 *     "Open in Messages" link
 *   - Lead has no name → "Hey there"
 *
 * Path-gated to customer.html (single-lead surface).
 *
 * Public API:
 *   window.NBDFollowupDraft.regenerate()
 *   window.NBDFollowupDraft.copy()
 *   window.NBDFollowupDraft.dismiss()
 */
(function () {
  'use strict';
  if (window.NBDFollowupDraft
      && window.NBDFollowupDraft.__sentinel === 'nbd-followup-draft-v1') return;

  const STORAGE_KEY = 'nbd_followup_draft_cache_v1';
  const DISMISS_KEY = 'nbd_followup_draft_dismissed_v1';
  const PANEL_ID = 'aiFollowupDraftPanel';
  const MAX_CHARS = 320;

  // ─── Path gate ────────────────────────────────────────────────
  function _onCustomerPage() {
    const p = (window.location && window.location.pathname || '').toLowerCase();
    return p.indexOf('/pro/customer') !== -1
      || p.indexOf('customer.html') !== -1;
  }

  // ─── State ────────────────────────────────────────────────────
  let _generating = false;
  let _currentLeadId = null; // tracked so async resolves can bail
                              // if rep navigated to another lead

  function _todayKey() {
    const d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }
  function _readCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function _writeCache(map) {
    try {
      // Trim cache to 50 most-recent entries to bound storage.
      const keys = Object.keys(map);
      if (keys.length > 50) {
        const sorted = keys.sort((a, b) => (map[b].savedAt || 0) - (map[a].savedAt || 0));
        const trimmed = {};
        for (let i = 0; i < 50; i++) trimmed[sorted[i]] = map[sorted[i]];
        map = trimmed;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }
  function _readDismissed() {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function _writeDismissed(map) {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch (_) {}
  }
  function _isDismissedToday(leadId) {
    const m = _readDismissed();
    return m[leadId] === _todayKey();
  }
  function _dismissForToday(leadId) {
    const m = _readDismissed();
    m[leadId] = _todayKey();
    _writeDismissed(m);
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch (_) { return 0; }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (v instanceof Date) return v.getTime();
    return 0;
  }
  function _firstName(lead) {
    return String(lead && lead.firstName || '').trim() || 'there';
  }
  function _stageLabel(stage) {
    const s = String(stage || '').toLowerCase();
    const map = {
      new: 'just added to my list',
      contacted: 'after our first conversation',
      inspection_scheduled: 'with the inspection on the calendar',
      inspection_completed: 'after the inspection',
      inspected: 'after the inspection',
      estimate_sent: 'after I sent over the estimate',
      quote_sent: 'after I sent over the quote',
      contract_signed: 'now that the contract is signed',
      job_created: 'as we get the job kicked off',
      install_scheduled: 'with the install on the calendar',
      install_in_progress: 'while the crew is on-site',
      install_complete: 'now that the install wrapped',
      final_payment: 'on closeout',
      completed: 'on closeout',
    };
    return map[s] || '';
  }
  function _ageDaysFrom(ms) {
    if (!ms) return null;
    return Math.floor((Date.now() - ms) / 86_400_000);
  }

  // ─── Build prompt context ─────────────────────────────────────
  function _buildContext(lead) {
    const ctx = {
      firstName: _firstName(lead),
      stage: _stageLabel(lead.stage),
      hasPhone: !!String(lead.phone || '').replace(/\D+/g, ''),
      lastContactDays: _ageDaysFrom(_toMillis(lead.lastContactedAt)),
      unread: Number(lead.unreadHomeownerMessages || 0),
      callbackRequested: !!_toMillis(lead.lastCallbackAt)
        && (Date.now() - _toMillis(lead.lastCallbackAt)) < 48 * 3600_000,
      uploadedPhoto: !!_toMillis(lead.lastUploadAt)
        && (Date.now() - _toMillis(lead.lastUploadAt)) < 48 * 3600_000,
    };

    // Latest estimate snapshot — gives the model a real anchor.
    const ests = Array.isArray(window._estimates) ? window._estimates : [];
    const leadEsts = ests.filter(e => e && e.leadId === lead.id);
    let latestEst = null;
    let bestSentMs = 0;
    for (const e of leadEsts) {
      const m = _toMillis(e.sentAt) || _toMillis(e.createdAt);
      if (m > bestSentMs) { bestSentMs = m; latestEst = e; }
    }
    if (latestEst) {
      ctx.estimateSentDays = _ageDaysFrom(bestSentMs);
      ctx.estimateViewCount = Number(latestEst.viewCount || 0);
      ctx.estimateSigned = !!_toMillis(latestEst.signedAt);
    }

    // Score signal — only mention if hot.
    if (window.NBDLeadScore && typeof window.NBDLeadScore.score === 'function') {
      try {
        const s = window.NBDLeadScore.score(lead);
        ctx.hot = s >= 80;
      } catch (_) {}
    }
    return ctx;
  }

  // ─── Fallback (deterministic) draft ───────────────────────────
  function _fallbackDraft(lead, ctx) {
    const name = ctx.firstName === 'there' ? 'there' : ctx.firstName;
    if (ctx.callbackRequested) {
      return 'Hey ' + name + ' — saw your callback request. When works best to chat?';
    }
    if (ctx.unread > 0) {
      return 'Hey ' + name + ' — got your message, replying now. Want me to call instead?';
    }
    if (ctx.estimateSentDays != null && ctx.estimateSentDays >= 1 && ctx.estimateSentDays <= 14) {
      return 'Hey ' + name + " — checking in on the estimate I sent. Any questions before you sign?";
    }
    if (ctx.uploadedPhoto) {
      return 'Hey ' + name + ' — got the photo, taking a look now. I\'ll be in touch shortly.';
    }
    if (ctx.lastContactDays == null || ctx.lastContactDays > 7) {
      return 'Hey ' + name + ' — wanted to circle back on your project. Got a minute to chat?';
    }
    return 'Hey ' + name + ' — quick check-in on your project. Let me know what works.';
  }

  // ─── Generate via Claude ──────────────────────────────────────
  async function _generateDraft(lead, ctx, opts) {
    opts = opts || {};
    const cacheId = lead.id + ':' + _todayKey();

    // Cache hit — return saved draft (skipped on Regenerate).
    if (!opts.force) {
      const cache = _readCache();
      if (cache[cacheId] && typeof cache[cacheId].text === 'string') {
        return { text: cache[cacheId].text, fromCache: true, ai: !!cache[cacheId].ai };
      }
    }

    // No Claude available → fallback only.
    if (typeof window.callClaude !== 'function') {
      const text = _fallbackDraft(lead, ctx);
      const cache = _readCache();
      cache[cacheId] = { text, savedAt: Date.now(), ai: false };
      _writeCache(cache);
      return { text, fromCache: false, ai: false };
    }

    // Build a tight prompt. Tone rules in system, facts in user.
    const facts = [];
    facts.push('First name: ' + ctx.firstName);
    if (ctx.stage) facts.push('Pipeline context: ' + ctx.stage);
    if (ctx.callbackRequested) facts.push('They requested a callback in the last 48h');
    if (ctx.unread > 0) facts.push('They sent ' + ctx.unread + ' unread message' + (ctx.unread === 1 ? '' : 's'));
    if (ctx.uploadedPhoto) facts.push('They uploaded a photo in the last 48h');
    if (ctx.estimateSentDays != null && ctx.estimateSentDays <= 30) {
      facts.push('Estimate sent ' + ctx.estimateSentDays + ' day' + (ctx.estimateSentDays === 1 ? '' : 's') + ' ago'
        + (ctx.estimateViewCount ? ' (viewed ' + ctx.estimateViewCount + ' times)' : '')
        + (ctx.estimateSigned ? ', signed' : ', not yet signed'));
    }
    if (ctx.lastContactDays != null && ctx.lastContactDays > 0) {
      facts.push('Last rep-side contact: ' + ctx.lastContactDays + ' day' + (ctx.lastContactDays === 1 ? '' : 's') + ' ago');
    }
    if (ctx.hot) facts.push('Lead score is in the Hot tier (≥80/100)');

    const system = 'You write SMS drafts for a roofing/restoration field rep. ' +
      'Voice: warm, casual-professional, like a real person. No corporate fluff. ' +
      'Never use "Hi there" — always use the first name (or "Hey there" if unknown). ' +
      'Constraints: under 320 characters total. ONE paragraph. No emoji. ' +
      'No links. No "RE:" prefixes. Two short sentences max. ' +
      'End with an open question or a low-friction next step. ' +
      'Output ONLY the message text — no preamble, no quotes around it.';
    const user = 'Write a follow-up SMS for this lead.\n\nFacts:\n- ' + facts.join('\n- ') + '\n\nSMS:';

    try {
      const result = await Promise.race([
        window.callClaude({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: system,
          messages: [{ role: 'user', content: user }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 9000)),
      ]);
      let text = '';
      if (result && Array.isArray(result.content)) {
        for (const c of result.content) {
          if (c && c.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      }
      text = String(text || '').trim().replace(/^"+|"+$/g, '');
      // Hard cap so we never accidentally send a 4-segment SMS.
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '…';
      if (!text) {
        const fb = _fallbackDraft(lead, ctx);
        const cache = _readCache();
        cache[cacheId] = { text: fb, savedAt: Date.now(), ai: false };
        _writeCache(cache);
        return { text: fb, fromCache: false, ai: false };
      }
      const cache = _readCache();
      cache[cacheId] = { text, savedAt: Date.now(), ai: true };
      _writeCache(cache);
      return { text, fromCache: false, ai: true };
    } catch (e) {
      console.warn('[followup-draft] Claude failed:', e && e.message);
      const fb = _fallbackDraft(lead, ctx);
      const cache = _readCache();
      cache[cacheId] = { text: fb, savedAt: Date.now(), ai: false };
      _writeCache(cache);
      return { text: fb, fromCache: false, ai: false };
    }
  }

  // ─── Render ───────────────────────────────────────────────────
  function _ensureHost() {
    let host = document.getElementById(PANEL_ID);
    if (host) return host;
    // Mount right after the smartFollowupPanel if it exists,
    // otherwise above the quick-actions / customer-id-badge.
    const sfp = document.getElementById('smartFollowupPanel');
    if (sfp && sfp.parentNode) {
      host = document.createElement('div');
      host.id = PANEL_ID;
      host.style.display = 'none';
      sfp.parentNode.insertBefore(host, sfp.nextSibling);
      return host;
    }
    const anchor =
      document.querySelector('.quick-actions') ||
      document.getElementById('customerIdBadge') ||
      document.querySelector('.meta-row');
    if (!anchor || !anchor.parentNode) return null;
    host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.display = 'none';
    anchor.parentNode.insertBefore(host, anchor);
    return host;
  }

  function _renderShell(host, opts) {
    opts = opts || {};
    const phone = String((opts.lead && opts.lead.phone) || '').replace(/\D+/g, '');
    const draft = String(opts.draft || '');
    const aiBadge = opts.ai
      ? '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(168,85,247,0.15);color:#c4b5fd;letter-spacing:0.06em;">AI</span>'
      : '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(148,163,184,0.15);color:#94a3b8;letter-spacing:0.06em;">DRAFT</span>';

    const smsHref = phone && draft
      ? 'sms:' + phone + '?body=' + encodeURIComponent(draft)
      : '';

    host.style.display = 'block';
    host.style.cssText = 'display:block;background:rgba(15,23,42,0.45);border:1px solid var(--border, #2a3344);border-left:3px solid #a855f7;border-radius:10px;padding:14px 16px;margin:12px 0;font:inherit;';

    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span style="font-size:14px;">✉️</span>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted,#94a3b8);">Suggested SMS</div>' +
        aiBadge +
        '<div style="flex:1;"></div>' +
        '<button type="button" data-fd-action="dismiss" title="Dismiss for today" aria-label="Dismiss" style="background:transparent;border:none;color:var(--muted,#94a3b8);cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;">×</button>' +
      '</div>' +
      (opts.loading
        ? '<div style="color:var(--muted,#94a3b8);font-size:13px;line-height:1.55;padding:6px 0;">Drafting your message…</div>'
        : '<div data-fd-draft style="color:var(--text,#e2e8f0);font-size:14px;line-height:1.55;padding:6px 8px 8px;background:rgba(0,0,0,0.18);border-radius:6px;white-space:pre-wrap;word-break:break-word;">' + _esc(draft) + '</div>'
      ) +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
        (smsHref
          ? '<a data-fd-action="open" href="' + _esc(smsHref) + '" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:#a855f7;color:#fff;text-decoration:none;font:inherit;font-size:12px;font-weight:700;">💬 Open in Messages</a>'
          : '<span title="No phone on file" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:12px;font-weight:700;cursor:not-allowed;">💬 Open in Messages</span>'
        ) +
        '<button type="button" data-fd-action="copy" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(168,85,247,0.14);color:#c4b5fd;border:1px solid rgba(168,85,247,0.45);font:inherit;font-size:12px;font-weight:700;cursor:pointer;">📋 Copy</button>' +
        '<button type="button" data-fd-action="regen" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:transparent;color:var(--muted,#94a3b8);border:1px solid var(--border,#2a3344);font:inherit;font-size:12px;font-weight:700;cursor:pointer;">↻ Regenerate</button>' +
      '</div>';

    // ─── Wire up actions ───────────────────────────────────
    host.querySelectorAll('[data-fd-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        const action = el.getAttribute('data-fd-action');
        if (action === 'dismiss') {
          _dismissForToday(opts.lead.id);
          host.style.display = 'none';
          host.innerHTML = '';
          return;
        }
        if (action === 'copy') {
          e.preventDefault();
          await _copyToClipboard(draft);
          // Brief visual feedback.
          const orig = el.textContent;
          el.textContent = '✓ Copied';
          setTimeout(() => { el.textContent = orig; }, 1200);
          return;
        }
        if (action === 'regen') {
          e.preventDefault();
          if (_generating) return;
          _generating = true;
          const draftEl = host.querySelector('[data-fd-draft]');
          if (draftEl) {
            draftEl.style.opacity = '0.5';
            draftEl.textContent = 'Drafting…';
          }
          try {
            const ctx = _buildContext(opts.lead);
            const fresh = await _generateDraft(opts.lead, ctx, { force: true });
            // Bail if rep navigated away.
            if (!window._currentLead || window._currentLead.id !== opts.lead.id) return;
            _renderShell(host, { lead: opts.lead, draft: fresh.text, ai: fresh.ai });
          } catch (err) {
            console.warn('[followup-draft] regen failed:', err);
          } finally {
            _generating = false;
          }
          return;
        }
        // 'open' is a real anchor — let the browser handle it.
      });
    });
  }

  async function _copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    // Fallback for older browsers / non-secure contexts.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) { return false; }
  }

  // ─── Update on lead change ────────────────────────────────────
  async function update() {
    if (!_onCustomerPage()) return;
    const host = _ensureHost();
    if (!host) return;
    const lead = window._currentLead;
    if (!lead || !lead.id) {
      host.style.display = 'none';
      host.innerHTML = '';
      _currentLeadId = null;
      return;
    }
    if (_isDismissedToday(lead.id)) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    // Skip if already rendered for THIS lead with a non-cache draft.
    if (_currentLeadId === lead.id && host.style.display !== 'none'
        && host.querySelector('[data-fd-draft]')) {
      return;
    }
    _currentLeadId = lead.id;

    // Show loading state immediately so the panel doesn't "pop in"
    // after the API resolves.
    _renderShell(host, { lead, loading: true });

    try {
      const ctx = _buildContext(lead);
      const result = await _generateDraft(lead, ctx);
      // Bail if the rep navigated to another lead while we waited.
      if (!window._currentLead || window._currentLead.id !== lead.id) return;
      if (_isDismissedToday(lead.id)) {
        host.style.display = 'none';
        host.innerHTML = '';
        return;
      }
      _renderShell(host, { lead, draft: result.text, ai: result.ai });
    } catch (e) {
      console.warn('[followup-draft] update failed:', e);
      // Fall back to the deterministic template.
      const ctx = _buildContext(lead);
      _renderShell(host, { lead, draft: _fallbackDraft(lead, ctx), ai: false });
    }
  }

  // ─── Init ─────────────────────────────────────────────────────
  function _init() {
    if (!_onCustomerPage()) return;
    // Initial run after a short delay so window._currentLead +
    // _estimates have time to populate.
    setTimeout(update, 1500);
    document.addEventListener('nbd:data-refreshed', update);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
  } else {
    setTimeout(_init, 0);
  }

  window.NBDFollowupDraft = {
    __sentinel: 'nbd-followup-draft-v1',
    update,
    regenerate: async () => {
      const lead = window._currentLead;
      if (!lead) return null;
      const ctx = _buildContext(lead);
      return _generateDraft(lead, ctx, { force: true }).then(r => {
        update();
        return r;
      });
    },
    copy: async () => {
      const lead = window._currentLead;
      if (!lead) return false;
      const cache = _readCache();
      const entry = cache[lead.id + ':' + _todayKey()];
      if (!entry) return false;
      return _copyToClipboard(entry.text);
    },
    dismiss: () => {
      const lead = window._currentLead;
      if (!lead) return;
      _dismissForToday(lead.id);
      update();
    },
  };
})();
