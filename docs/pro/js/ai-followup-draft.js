/**
 * ai-followup-draft.js — Wave 162 + Wave 163 + Wave 164
 *
 * Pre-writes a personalized follow-up the rep can copy or send in
 * one tap from the customer page. Where W113 SmartFollowup tells
 * the rep WHAT to do next, this panel tells the rep WHAT TO SAY.
 *
 * W164 closes the activity-tracking loop: clicking the primary
 * send action calls `window.logCommunication()` which writes a
 * `communications` doc + bumps `lead.lastContactedAt`, so the
 * outbound shows up in the timeline, smart-followup stops nagging
 * the lead, lead-score recency rises, and the Daily Brief drops it
 * from tomorrow's list.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ ✉  Suggested follow-up                          [×]       │
 *   │ ┌─SMS─┬─Email─┬─Voicemail─┐                                │
 *   │ │ ⬤   │       │           │                                │
 *   │ └─────┴───────┴───────────┘                                │
 *   │ ──────────────────────────────────────────────────────── │
 *   │ Hey Sarah — quick check on the estimate I sent Tuesday.   │
 *   │ Any questions before you sign? Happy to hop on a call.    │
 *   │                                                            │
 *   │  [💬 Open in Messages]   [📋 Copy]   [↻ Regenerate]       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Wave 163 adds Email + Voicemail channels alongside the W162 SMS
 * baseline. Each channel has its own system prompt + length budget +
 * action buttons:
 *   - SMS:        320 chars, 2 sentences, casual          → sms: link
 *   - Email:      ~500 chars, subject + body, warmer prof → mailto:
 *   - Voicemail:  50-90 words, friendly script            → speak via TTS
 *
 * Caching is per (leadId, calendarDay, channel) so switching tabs
 * doesn't burn fresh API calls — only the first visit to each
 * channel that day costs a generation. The rep's last-selected
 * channel persists in localStorage so re-opening a customer page
 * defaults to whatever they used last (most reps live in one
 * channel).
 *
 * Failure modes:
 *   - Claude unavailable → deterministic template fallback that
 *     still incorporates lead signals
 *   - No phone on file → SMS open + Voicemail TTS disabled
 *   - No email on file → Email open disabled
 *   - Lead has no name → "Hey there"
 *   - Lead navigation mid-async → bail before stomping new
 *     lead's panel
 *
 * Path-gated to customer.html (single-lead surface).
 *
 * Public API:
 *   window.NBDFollowupDraft.update()
 *   window.NBDFollowupDraft.setChannel('sms'|'email'|'voicemail')
 *   window.NBDFollowupDraft.regenerate()
 *   window.NBDFollowupDraft.copy()
 *   window.NBDFollowupDraft.dismiss()
 */
(function () {
  'use strict';
  if (window.NBDFollowupDraft
      && window.NBDFollowupDraft.__sentinel === 'nbd-followup-draft-v2') return;

  const STORAGE_KEY = 'nbd_followup_draft_cache_v2';
  const DISMISS_KEY = 'nbd_followup_draft_dismissed_v1';
  const CHANNEL_PREF_KEY = 'nbd_followup_channel_v1';
  const PANEL_ID = 'aiFollowupDraftPanel';

  // ─── Channel definitions ─────────────────────────────────────
  // Per-channel: id, label, system prompt, max chars, format hints
  // for fallback + cap, action button kit. The system prompt is
  // intentionally explicit about format because Claude tends to
  // drift toward boilerplate without firm constraints.
  const CHANNELS = {
    sms: {
      id: 'sms',
      label: 'SMS',
      icon: '💬',
      maxChars: 320,
      maxTokens: 200,
      system:
        'You write SMS drafts for a roofing/restoration field rep. ' +
        'Voice: warm, casual-professional, like a real person. No corporate fluff. ' +
        'Never use "Hi there" — always use the first name (or "Hey there" if unknown). ' +
        'Constraints: under 320 characters total. ONE paragraph. No emoji. ' +
        'No links. No "RE:" prefixes. Two short sentences max. ' +
        'End with an open question or a low-friction next step. ' +
        'Output ONLY the message text — no preamble, no quotes around it.',
      userVerb: 'follow-up SMS',
      outputLabel: 'SMS',
    },
    email: {
      id: 'email',
      label: 'Email',
      icon: '📧',
      maxChars: 800,
      maxTokens: 400,
      system:
        'You write follow-up emails for a roofing/restoration field rep. ' +
        'Voice: warm, professional, never stuffy. Like a real human contractor, ' +
        'not a corporate template. Always use the first name. ' +
        'Format EXACTLY:\n' +
        'Subject: [a 4-6 word subject line, no clickbait]\n' +
        '[blank line]\n' +
        'Hey [first name],\n' +
        '[blank line]\n' +
        '[2-3 sentence body — reference the actual context]\n' +
        '[blank line]\n' +
        '[one short closing line: "Talk soon," / "Thanks," / "Looking forward,"]\n' +
        '[blank line]\n' +
        '[blank line for the rep\'s signature]\n\n' +
        'Constraints: under 800 characters total INCLUDING the subject line. ' +
        'No emoji. No links unless explicitly relevant. No bullet points. ' +
        'Output the message ONLY — no preamble, no quotes around it.',
      userVerb: 'follow-up email',
      outputLabel: 'Email',
    },
    voicemail: {
      id: 'voicemail',
      label: 'Voicemail',
      icon: '🎙️',
      maxChars: 600,
      maxTokens: 250,
      system:
        'You write voicemail SCRIPTS for a roofing/restoration field rep ' +
        'to read aloud when a call goes to voicemail. ' +
        'Voice: friendly, conversational, paced for speaking out loud. ' +
        'Always use the first name. ' +
        'Constraints: 50-90 words total (about 15-25 seconds spoken). ' +
        'ONE paragraph. No bullet points. No emoji. No links. ' +
        'Start with "Hey [first name], it\'s [the rep] from [the company] —" ' +
        'and write [the rep] / [the company] literally as bracketed placeholders ' +
        'so the rep can fill in their own name. ' +
        'End with the rep\'s callback number prompt: "Give me a call back when you get a sec." ' +
        'Output ONLY the script text — no stage directions, no preamble.',
      userVerb: 'voicemail script',
      outputLabel: 'Voicemail script',
    },
  };
  const CHANNEL_ORDER = ['sms', 'email', 'voicemail'];
  const DEFAULT_CHANNEL = 'sms';

  // ─── Path gate ────────────────────────────────────────────────
  function _onCustomerPage() {
    const p = (window.location && window.location.pathname || '').toLowerCase();
    return p.indexOf('/pro/customer') !== -1
      || p.indexOf('customer.html') !== -1;
  }

  // ─── State ────────────────────────────────────────────────────
  let _generating = false;
  let _currentLeadId = null;
  let _currentChannel = _readPreferredChannel();

  function _readPreferredChannel() {
    try {
      const v = localStorage.getItem(CHANNEL_PREF_KEY);
      if (v && CHANNELS[v]) return v;
    } catch (_) {}
    return DEFAULT_CHANNEL;
  }
  function _writePreferredChannel(ch) {
    try { localStorage.setItem(CHANNEL_PREF_KEY, ch); } catch (_) {}
  }

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
      // Trim cache to 100 most-recent entries (3 channels × ~33 leads).
      const keys = Object.keys(map);
      if (keys.length > 100) {
        const sorted = keys.sort((a, b) => (map[b].savedAt || 0) - (map[a].savedAt || 0));
        const trimmed = {};
        for (let i = 0; i < 100; i++) trimmed[sorted[i]] = map[sorted[i]];
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
      hasEmail: !!String(lead.email || '').trim(),
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

    if (window.NBDLeadScore && typeof window.NBDLeadScore.score === 'function') {
      try {
        const s = window.NBDLeadScore.score(lead);
        ctx.hot = s >= 80;
      } catch (_) {}
    }
    return ctx;
  }

  function _factsList(ctx) {
    const facts = [];
    facts.push('First name: ' + ctx.firstName);
    if (ctx.stage) facts.push('Pipeline context: ' + ctx.stage);
    if (ctx.callbackRequested) facts.push('They requested a callback in the last 48h');
    if (ctx.unread > 0) facts.push('They sent ' + ctx.unread + ' unread message' + (ctx.unread === 1 ? '' : 's'));
    if (ctx.uploadedPhoto) facts.push('They uploaded a photo in the last 48h');
    if (ctx.estimateSentDays != null && ctx.estimateSentDays <= 30) {
      facts.push('Estimate sent ' + ctx.estimateSentDays + ' day'
        + (ctx.estimateSentDays === 1 ? '' : 's') + ' ago'
        + (ctx.estimateViewCount ? ' (viewed ' + ctx.estimateViewCount + ' times)' : '')
        + (ctx.estimateSigned ? ', signed' : ', not yet signed'));
    }
    if (ctx.lastContactDays != null && ctx.lastContactDays > 0) {
      facts.push('Last rep-side contact: ' + ctx.lastContactDays + ' day'
        + (ctx.lastContactDays === 1 ? '' : 's') + ' ago');
    }
    if (ctx.hot) facts.push('Lead score is in the Hot tier (≥80/100)');
    return facts;
  }

  // ─── Channel-specific fallbacks ───────────────────────────────
  function _fallbackDraft(lead, ctx, channelId) {
    const name = ctx.firstName === 'there' ? 'there' : ctx.firstName;
    if (channelId === 'email') {
      const subject = ctx.callbackRequested
        ? 'Following up on your callback request'
        : (ctx.estimateSentDays != null && ctx.estimateSentDays <= 14)
          ? 'Quick check on your estimate'
          : 'Checking in on your project';
      const opener = ctx.callbackRequested
        ? 'Saw your callback request come through and wanted to follow up.'
        : (ctx.unread > 0)
          ? 'I got your message and wanted to circle back.'
          : (ctx.estimateSentDays != null && ctx.estimateSentDays >= 1 && ctx.estimateSentDays <= 14)
            ? 'Just wanted to check in on the estimate I sent over.'
            : 'Wanted to circle back on your project.';
      return 'Subject: ' + subject + '\n\nHey ' + name + ',\n\n' +
        opener + ' Let me know if you have any questions or if a quick call would be easier.\n\n' +
        'Talk soon,\n\n';
    }
    if (channelId === 'voicemail') {
      const reason = ctx.callbackRequested
        ? 'returning your callback'
        : (ctx.estimateSentDays != null && ctx.estimateSentDays <= 14)
          ? 'following up on the estimate I sent over'
          : 'checking in on your project';
      return 'Hey ' + name + ", it's [the rep] from [the company] — just " + reason +
        '. Wanted to see if you had any questions or if a quick chat would help. Give me a call back when you get a sec.';
    }
    // SMS default
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
  async function _generateDraft(lead, ctx, channelId, opts) {
    opts = opts || {};
    const ch = CHANNELS[channelId] || CHANNELS[DEFAULT_CHANNEL];
    const cacheId = lead.id + ':' + _todayKey() + ':' + ch.id;

    // Cache hit — return saved draft (skipped on Regenerate).
    if (!opts.force) {
      const cache = _readCache();
      if (cache[cacheId] && typeof cache[cacheId].text === 'string') {
        return { text: cache[cacheId].text, fromCache: true, ai: !!cache[cacheId].ai, channel: ch.id };
      }
    }

    if (typeof window.callClaude !== 'function') {
      const text = _fallbackDraft(lead, ctx, ch.id);
      const cache = _readCache();
      cache[cacheId] = { text, savedAt: Date.now(), ai: false, channel: ch.id };
      _writeCache(cache);
      return { text, fromCache: false, ai: false, channel: ch.id };
    }

    const facts = _factsList(ctx);
    const user = 'Write a ' + ch.userVerb + ' for this lead.\n\nFacts:\n- ' + facts.join('\n- ') + '\n\n' + ch.outputLabel + ':';

    try {
      const result = await Promise.race([
        window.callClaude({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: ch.maxTokens,
          system: ch.system,
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
      if (text.length > ch.maxChars) {
        text = text.slice(0, ch.maxChars - 1).replace(/\s+\S*$/, '') + '…';
      }
      if (!text) {
        const fb = _fallbackDraft(lead, ctx, ch.id);
        const cache = _readCache();
        cache[cacheId] = { text: fb, savedAt: Date.now(), ai: false, channel: ch.id };
        _writeCache(cache);
        return { text: fb, fromCache: false, ai: false, channel: ch.id };
      }
      const cache = _readCache();
      cache[cacheId] = { text, savedAt: Date.now(), ai: true, channel: ch.id };
      _writeCache(cache);
      return { text, fromCache: false, ai: true, channel: ch.id };
    } catch (e) {
      console.warn('[followup-draft] Claude failed (' + ch.id + '):', e && e.message);
      const fb = _fallbackDraft(lead, ctx, ch.id);
      const cache = _readCache();
      cache[cacheId] = { text: fb, savedAt: Date.now(), ai: false, channel: ch.id };
      _writeCache(cache);
      return { text: fb, fromCache: false, ai: false, channel: ch.id };
    }
  }

  // ─── Email parse helper ───────────────────────────────────────
  // Pulls "Subject: …" from an email-mode draft so the mailto link
  // gets a proper subject line. The body is everything after the
  // first blank line.
  function _splitEmail(text) {
    const m = String(text || '').match(/^Subject:\s*(.+)\s*\n\s*\n([\s\S]*)$/);
    if (!m) return { subject: '', body: String(text || '') };
    return { subject: m[1].trim(), body: m[2].trim() };
  }

  // ─── Render ───────────────────────────────────────────────────
  function _ensureHost() {
    let host = document.getElementById(PANEL_ID);
    if (host) return host;
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

  function _renderTabStrip(activeId) {
    const tabs = CHANNEL_ORDER.map(id => {
      const ch = CHANNELS[id];
      const active = id === activeId;
      return '<button type="button" data-fd-tab="' + id + '" ' +
        'role="tab" aria-selected="' + (active ? 'true' : 'false') + '" ' +
        'style="flex:1;background:' + (active ? 'rgba(168,85,247,0.18)' : 'transparent') + ';' +
        'color:' + (active ? '#c4b5fd' : 'var(--muted, #94a3b8)') + ';' +
        'border:none;border-bottom:2px solid ' + (active ? '#a855f7' : 'transparent') + ';' +
        'padding:7px 8px;font:inherit;font-size:11px;font-weight:700;letter-spacing:0.04em;' +
        'text-transform:uppercase;cursor:pointer;transition:background 120ms ease;">' +
        ch.icon + ' ' + ch.label +
      '</button>';
    }).join('');
    return '<div role="tablist" style="display:flex;gap:0;background:rgba(0,0,0,0.18);border-radius:6px 6px 0 0;overflow:hidden;margin-bottom:8px;">' + tabs + '</div>';
  }

  function _renderActions(opts) {
    const ch = CHANNELS[opts.channel];
    const phone = String((opts.lead && opts.lead.phone) || '').replace(/\D+/g, '');
    const email = String((opts.lead && opts.lead.email) || '').trim();
    const draft = String(opts.draft || '');

    let primaryHtml = '';
    if (ch.id === 'sms') {
      const href = phone && draft ? 'sms:' + phone + '?body=' + encodeURIComponent(draft) : '';
      primaryHtml = href
        ? '<a data-fd-action="open" href="' + _esc(href) + '" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:#a855f7;color:#fff;text-decoration:none;font:inherit;font-size:12px;font-weight:700;">💬 Open in Messages</a>'
        : '<span title="No phone on file" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:12px;font-weight:700;cursor:not-allowed;">💬 Open in Messages</span>';
    } else if (ch.id === 'email') {
      const split = _splitEmail(draft);
      const href = email && draft
        ? 'mailto:' + encodeURIComponent(email)
            + '?subject=' + encodeURIComponent(split.subject)
            + '&body=' + encodeURIComponent(split.body)
        : '';
      primaryHtml = href
        ? '<a data-fd-action="open" href="' + _esc(href) + '" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:#a855f7;color:#fff;text-decoration:none;font:inherit;font-size:12px;font-weight:700;">📧 Open in Mail</a>'
        : '<span title="No email on file" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:12px;font-weight:700;cursor:not-allowed;">📧 Open in Mail</span>';
    } else if (ch.id === 'voicemail') {
      const ttsAvailable = typeof window.speechSynthesis !== 'undefined';
      primaryHtml = ttsAvailable
        ? '<button type="button" data-fd-action="speak" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:#a855f7;color:#fff;border:none;font:inherit;font-size:12px;font-weight:700;cursor:pointer;">🔊 Read aloud</button>'
        : '<span title="Speech synthesis not available" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:12px;font-weight:700;cursor:not-allowed;">🔊 Read aloud</span>';
    }

    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
      primaryHtml +
      '<button type="button" data-fd-action="copy" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:rgba(168,85,247,0.14);color:#c4b5fd;border:1px solid rgba(168,85,247,0.45);font:inherit;font-size:12px;font-weight:700;cursor:pointer;">📋 Copy</button>' +
      '<button type="button" data-fd-action="regen" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:6px;background:transparent;color:var(--muted,#94a3b8);border:1px solid var(--border,#2a3344);font:inherit;font-size:12px;font-weight:700;cursor:pointer;">↻ Regenerate</button>' +
    '</div>';
  }

  function _renderShell(host, opts) {
    opts = opts || {};
    const draft = String(opts.draft || '');
    const channelId = opts.channel || _currentChannel;
    const ch = CHANNELS[channelId];
    const aiBadge = opts.ai
      ? '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(168,85,247,0.15);color:#c4b5fd;letter-spacing:0.06em;">AI</span>'
      : '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(148,163,184,0.15);color:#94a3b8;letter-spacing:0.06em;">DRAFT</span>';

    host.style.display = 'block';
    host.style.cssText = 'display:block;background:rgba(15,23,42,0.45);border:1px solid var(--border, #2a3344);border-left:3px solid #a855f7;border-radius:10px;padding:14px 16px;margin:12px 0;font:inherit;';

    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span style="font-size:14px;">✉️</span>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted,#94a3b8);">Suggested follow-up</div>' +
        aiBadge +
        '<div style="flex:1;"></div>' +
        '<button type="button" data-fd-action="dismiss" title="Dismiss for today" aria-label="Dismiss" style="background:transparent;border:none;color:var(--muted,#94a3b8);cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;">×</button>' +
      '</div>' +
      _renderTabStrip(channelId) +
      (opts.loading
        ? '<div style="color:var(--muted,#94a3b8);font-size:13px;line-height:1.55;padding:6px 0;">Drafting your ' + ch.label.toLowerCase() + '…</div>'
        : '<div data-fd-draft style="color:var(--text,#e2e8f0);font-size:14px;line-height:1.55;padding:8px 10px;background:rgba(0,0,0,0.18);border-radius:6px;white-space:pre-wrap;word-break:break-word;font-family:' + (channelId === 'email' ? '"Inter", "Segoe UI", system-ui, sans-serif' : 'inherit') + ';">' + _esc(draft) + '</div>'
      ) +
      _renderActions({ lead: opts.lead, draft, channel: channelId });

    // ─── Wire up actions ───────────────────────────────────
    host.querySelectorAll('[data-fd-tab]').forEach(el => {
      el.addEventListener('click', () => {
        const ch = el.getAttribute('data-fd-tab');
        if (!ch || !CHANNELS[ch] || ch === _currentChannel) return;
        _setChannel(ch);
      });
    });

    host.querySelectorAll('[data-fd-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        const action = el.getAttribute('data-fd-action');
        if (action === 'dismiss') {
          _dismissForToday(opts.lead.id);
          host.style.display = 'none';
          host.innerHTML = '';
          return;
        }
        if (action === 'open') {
          // W164: log the outbound send BEFORE navigation. We
          // don't preventDefault — the sms: / mailto: handler
          // still fires after this synchronous call returns. The
          // log call itself is async but we don't await — fire
          // and forget so navigation feels instant.
          _logSend(opts.lead, channelId, draft);
          _flashLogged(el);
          // Let the anchor's default behavior handle navigation.
          return;
        }
        if (action === 'copy') {
          e.preventDefault();
          await _copyToClipboard(draft);
          const orig = el.textContent;
          el.textContent = '✓ Copied';
          setTimeout(() => { el.textContent = orig; }, 1200);
          return;
        }
        if (action === 'speak') {
          e.preventDefault();
          _speak(draft);
          // W164: speaking the voicemail script counts as the
          // rep "left a voicemail" intent — log it.
          _logSend(opts.lead, channelId, draft);
          _flashLogged(el);
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
            const fresh = await _generateDraft(opts.lead, ctx, channelId, { force: true });
            if (!window._currentLead || window._currentLead.id !== opts.lead.id) return;
            _renderShell(host, { lead: opts.lead, draft: fresh.text, ai: fresh.ai, channel: channelId });
          } catch (err) {
            console.warn('[followup-draft] regen failed:', err);
          } finally {
            _generating = false;
          }
          return;
        }
      });
    });
  }

  // ─── W164: log outbound follow-up sends ──────────────────────
  // Fire-and-forget into customer.html's inline logCommunication
  // helper (writes communications doc + updates lastContactedAt).
  // Voicemail tags as type='call' with subtype='voicemail' since
  // the rep dialed the number. Defensive: if the helper isn't
  // loaded the send still happens, just isn't tracked.
  function _logSend(lead, channelId, draft) {
    try {
      if (typeof window.logCommunication !== 'function') return;
      if (!lead || !lead.id) return;
      let type = channelId;
      const extra = { source: 'ai-followup-draft', channel: channelId };
      if (channelId === 'voicemail') { type = 'call'; extra.subtype = 'voicemail'; }
      window.logCommunication(lead.id, type, String(draft || '').slice(0, 500), extra);
    } catch (e) {
      console.warn('[followup-draft] logCommunication failed:', e && e.message);
    }
  }
  // Brief "✓ Sent + logged" flash on the button so the rep knows
  // NBD captured it. Restore-on-timeout guards against rep clicking
  // Regenerate mid-flash.
  function _flashLogged(el) {
    if (!el) return;
    const orig = el.textContent;
    try { el.textContent = '✓ Sent + logged'; } catch (_) { return; }
    setTimeout(() => {
      try {
        if (el.isConnected && el.textContent === '✓ Sent + logged') el.textContent = orig;
      } catch (_) {}
    }, 1400);
  }

  async function _copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
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

  // ─── Voicemail TTS ────────────────────────────────────────────
  // Strip bracket placeholders ([the rep], [the company]) before
  // speaking so the user actually has to fill them in via a
  // teleprompter-style read rather than the synth saying
  // "open bracket the rep close bracket".
  function _speak(text) {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const cleaned = String(text || '').replace(/\[[^\]]+\]/g, '___');
    const u = new window.SpeechSynthesisUtterance(cleaned);
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 1.0;
    window.speechSynthesis.speak(u);
  }

  // ─── Channel switching ────────────────────────────────────────
  async function _setChannel(channelId) {
    if (!CHANNELS[channelId]) return;
    if (channelId === _currentChannel) return;
    _currentChannel = channelId;
    _writePreferredChannel(channelId);
    // Re-render with the new channel — the draft will come from
    // cache if we've already generated for this channel today,
    // otherwise it kicks off a fresh generation.
    const lead = window._currentLead;
    if (!lead) return;
    const host = document.getElementById(PANEL_ID);
    if (!host) return;
    _renderShell(host, { lead, loading: true, channel: channelId });
    try {
      const ctx = _buildContext(lead);
      const result = await _generateDraft(lead, ctx, channelId);
      if (!window._currentLead || window._currentLead.id !== lead.id) return;
      _renderShell(host, { lead, draft: result.text, ai: result.ai, channel: channelId });
    } catch (e) {
      const ctx = _buildContext(lead);
      _renderShell(host, {
        lead,
        draft: _fallbackDraft(lead, ctx, channelId),
        ai: false,
        channel: channelId,
      });
    }
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
    if (_currentLeadId === lead.id && host.style.display !== 'none'
        && host.querySelector('[data-fd-draft]')) {
      return;
    }
    _currentLeadId = lead.id;

    _renderShell(host, { lead, loading: true, channel: _currentChannel });

    try {
      const ctx = _buildContext(lead);
      const result = await _generateDraft(lead, ctx, _currentChannel);
      if (!window._currentLead || window._currentLead.id !== lead.id) return;
      if (_isDismissedToday(lead.id)) {
        host.style.display = 'none';
        host.innerHTML = '';
        return;
      }
      _renderShell(host, { lead, draft: result.text, ai: result.ai, channel: _currentChannel });
    } catch (e) {
      console.warn('[followup-draft] update failed:', e);
      const ctx = _buildContext(lead);
      _renderShell(host, {
        lead,
        draft: _fallbackDraft(lead, ctx, _currentChannel),
        ai: false,
        channel: _currentChannel,
      });
    }
  }

  // ─── Init ─────────────────────────────────────────────────────
  function _init() {
    if (!_onCustomerPage()) return;
    setTimeout(update, 1500);
    document.addEventListener('nbd:data-refreshed', update);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
  } else {
    setTimeout(_init, 0);
  }

  window.NBDFollowupDraft = {
    __sentinel: 'nbd-followup-draft-v2',
    update,
    setChannel: _setChannel,
    regenerate: async () => {
      const lead = window._currentLead;
      if (!lead) return null;
      const ctx = _buildContext(lead);
      return _generateDraft(lead, ctx, _currentChannel, { force: true }).then(r => {
        update();
        return r;
      });
    },
    copy: async () => {
      const lead = window._currentLead;
      if (!lead) return false;
      const cache = _readCache();
      const entry = cache[lead.id + ':' + _todayKey() + ':' + _currentChannel];
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
