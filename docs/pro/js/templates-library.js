/**
 * templates-library.js — Wave 97 (SMS/Email templates library)
 *
 * Opens the eighth arc — productivity polish on the message
 * composition flow. Reps currently retype the same follow-up
 * text dozens of times a week. W97 introduces a local templates
 * library so they can save canned messages and pick one before
 * sending.
 *
 * Data shape (per template):
 *   {
 *     id:        string  (uuid-ish, generated)
 *     name:      string  (rep-facing label, e.g. "Initial follow-up")
 *     channel:   'sms' | 'email'
 *     subject:   string  (email only, optional for sms)
 *     body:      string  (with placeholder tokens — see apply())
 *     createdAt: ms timestamp
 *     updatedAt: ms timestamp
 *   }
 *
 * Persisted to localStorage as `nbd_templates_v1` JSON array.
 * Per-device only (matches the W37 / W78 preference pattern).
 *
 * Placeholder tokens supported by apply():
 *   {firstName}    — lead.firstName
 *   {lastName}     — lead.lastName
 *   {fullName}     — concatenated first + last (or "there" if missing)
 *   {greeting}     — "Hi {firstName}, " or "Hi, "
 *   {address}      — lead.address (first line)
 *   {portalUrl}    — generated portal URL (passed in)
 *   {repName}      — current rep's display name (window._currentRep)
 *   {repPhone}     — current rep's phone (window._currentRep)
 *
 * On first run, seeds three default templates so the rep has
 * something to use immediately. Defaults are flagged with a
 * `_seeded: true` marker so we can detect & migrate the seeds
 * across schema changes without overwriting the rep's edits.
 *
 * Compounds W41 (smsForLead prefilled body) + W43 (emailForLead
 * prefilled body). Wave 98 will wire `apply()` into PortalLinkHelpers
 * so reps can pick a template before send.
 *
 * Exposes:
 *   window.TemplatesLibrary.list(channel?)
 *   window.TemplatesLibrary.get(id)
 *   window.TemplatesLibrary.save(template)
 *   window.TemplatesLibrary.remove(id)
 *   window.TemplatesLibrary.apply(template, ctx)
 *   window.TemplatesLibrary.openManager()
 */
(function () {
  'use strict';

  if (window.TemplatesLibrary
      && window.TemplatesLibrary.__sentinel === 'nbd-templates-library-v1') return;

  const STORAGE_KEY = 'nbd_templates_v1';
  const SEEDED_FLAG_KEY = 'nbd_templates_seeded_v1';

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function newId() {
    // Simple unique-ish id — collision risk is irrelevant for a
    // per-device list of <50 entries. Avoids importing crypto.
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function _write(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || [])); } catch (_) {}
  }

  function _toast(msg, kind) {
    if (typeof window.showToast === 'function') return window.showToast(msg, kind);
    if (typeof window.toast === 'function') return window.toast(msg);
    console.log('[Templates]', msg);
  }

  // ─── Seed defaults ──────────────────────────────────────────────
  function seedDefaults() {
    if (localStorage.getItem(SEEDED_FLAG_KEY) === '1') return;
    const existing = _read();
    if (existing.length > 0) {
      // Rep already has templates — don't overwrite.
      localStorage.setItem(SEEDED_FLAG_KEY, '1');
      return;
    }
    const now = Date.now();
    const seeds = [
      {
        id: newId(),
        name: 'Portal link · initial',
        channel: 'sms',
        body: '{greeting}here\'s your project portal — photos, status updates, and what\'s coming next: {portalUrl}',
        createdAt: now, updatedAt: now, _seeded: true,
      },
      {
        id: newId(),
        name: 'Portal link · email',
        channel: 'email',
        subject: 'Your project portal — photos, status, and next steps',
        body:
`{greeting}

Here\'s your project portal — photos from your inspection / install, status updates, and what\'s coming next:

{portalUrl}

Bookmark it; the link stays live as we work through the project.

— {repName}`,
        createdAt: now, updatedAt: now, _seeded: true,
      },
      {
        id: newId(),
        name: 'Following up',
        channel: 'sms',
        body: '{greeting}just checking in on the estimate I sent — any questions? Happy to walk through it: {portalUrl}',
        createdAt: now, updatedAt: now, _seeded: true,
      },
    ];
    _write(seeds);
    localStorage.setItem(SEEDED_FLAG_KEY, '1');
  }

  // ─── CRUD ───────────────────────────────────────────────────────
  function list(channel) {
    const all = _read();
    if (!channel) return all;
    return all.filter(t => t && t.channel === channel);
  }
  function get(id) {
    return _read().find(t => t && t.id === id) || null;
  }
  function save(template) {
    if (!template || typeof template !== 'object') throw new Error('template object required');
    if (!template.channel || (template.channel !== 'sms' && template.channel !== 'email')) {
      throw new Error('channel must be "sms" or "email"');
    }
    if (!template.name || typeof template.name !== 'string') throw new Error('name required');
    if (typeof template.body !== 'string') throw new Error('body required');

    const all = _read();
    const now = Date.now();
    if (template.id) {
      const i = all.findIndex(t => t && t.id === template.id);
      if (i >= 0) {
        all[i] = { ...all[i], ...template, updatedAt: now };
      } else {
        all.push({ ...template, createdAt: now, updatedAt: now });
      }
    } else {
      all.push({ ...template, id: newId(), createdAt: now, updatedAt: now });
    }
    _write(all);
    return all[all.findIndex(t => t.id === template.id) >= 0
      ? all.findIndex(t => t.id === template.id)
      : all.length - 1];
  }
  function remove(id) {
    const all = _read();
    const next = all.filter(t => t && t.id !== id);
    _write(next);
    return next.length !== all.length;
  }

  // ─── Apply (placeholder substitution) ────────────────────────────
  function apply(template, ctx) {
    if (!template) return '';
    const lead = (ctx && ctx.lead) || {};
    const url  = (ctx && ctx.url)  || '';
    const repName  = (ctx && ctx.repName)
      || (window._currentRep && (window._currentRep.displayName || window._currentRep.name))
      || 'No Big Deal Home Solutions';
    const repPhone = (ctx && ctx.repPhone)
      || (window._currentRep && window._currentRep.phone)
      || '';

    const firstName = String(lead.firstName || '').trim();
    const lastName  = String(lead.lastName  || '').trim();
    const fullName  = (firstName + ' ' + lastName).trim() || 'there';
    const greeting  = firstName ? `Hi ${firstName}, ` : 'Hi, ';
    const address   = String(lead.address || '').split(',')[0].trim();

    const tokens = {
      '{firstName}': firstName,
      '{lastName}':  lastName,
      '{fullName}':  fullName,
      '{greeting}':  greeting,
      '{address}':   address,
      '{portalUrl}': url,
      '{repName}':   repName,
      '{repPhone}':  repPhone,
    };
    let body = template.body || '';
    for (const [k, v] of Object.entries(tokens)) {
      body = body.split(k).join(v);
    }
    let subject = template.subject || '';
    for (const [k, v] of Object.entries(tokens)) {
      subject = subject.split(k).join(v);
    }
    return { body, subject };
  }

  // ─── Manager modal (basic CRUD UI) ──────────────────────────────
  let _modalOpen = false;
  function openManager(channel) {
    if (_modalOpen) return;
    _modalOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'nbd-templates-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'nbd-templates-title');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:99996;
      display:flex; align-items:center; justify-content:center; padding:20px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;

    function renderList() {
      const all = list(channel);
      const items = all.map(t => `
        <div style="display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid var(--br,#2a3344); border-radius:8px; margin-bottom:6px; background:var(--s2,#0f1419);">
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600; color:var(--t,#e8eaf0);">
              <span style="display:inline-block; padding:1px 6px; border-radius:8px; font-size:9px; margin-right:6px; ${t.channel === 'sms' ? 'background:rgba(59,130,246,0.18); color:#3b82f6;' : 'background:rgba(139,92,246,0.18); color:#8b5cf6;'}">${t.channel.toUpperCase()}</span>
              ${escapeHtml(t.name)}${t._seeded ? ' <span style="font-size:9px; color:var(--m,#9aa3b2);">· default</span>' : ''}
            </div>
            <div style="font-size:11px; color:var(--m,#9aa3b2); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml((t.body || '').slice(0, 90))}${(t.body || '').length > 90 ? '…' : ''}</div>
          </div>
          <button data-template-edit="${escapeHtml(t.id)}" type="button" aria-label="Edit ${escapeHtml(t.name)}" title="Edit"
            style="background:transparent; color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); padding:6px 10px; border-radius:6px; font: inherit; font-size:11px; font-weight:600; cursor:pointer; -webkit-tap-highlight-color:transparent;">Edit</button>
          <button data-template-delete="${escapeHtml(t.id)}" type="button" aria-label="Delete ${escapeHtml(t.name)}" title="Delete"
            style="background:transparent; color:#fb7185; border:1px solid var(--br,#2a3344); padding:6px 10px; border-radius:6px; font: inherit; font-size:11px; font-weight:600; cursor:pointer; -webkit-tap-highlight-color:transparent;">Delete</button>
        </div>`).join('');
      const empty = `<div style="padding:22px; text-align:center; color:var(--m,#9aa3b2); font-size:12px;">No templates yet${channel ? ` for ${channel.toUpperCase()}` : ''}. Click + Add below.</div>`;
      return all.length ? items : empty;
    }

    function renderEditor(template) {
      const isNew = !template;
      const t = template || { name: '', channel: channel || 'sms', subject: '', body: '' };
      const placeholders = '{firstName} · {lastName} · {fullName} · {greeting} · {address} · {portalUrl} · {repName} · {repPhone}';
      return `
        <div style="margin-top:12px; padding:14px; background:var(--s2,#0f1419); border:1px solid var(--br,#2a3344); border-radius:8px;">
          <h3 style="margin:0 0 12px; font-size:14px; color:var(--t,#e8eaf0);">${isNew ? 'New template' : 'Edit template'}</h3>
          <div style="display:flex; gap:8px; margin-bottom:10px;">
            <label style="flex:1; font-size:11px; color:var(--m,#9aa3b2); font-weight:600;">
              Name
              <input id="nbd-tpl-name" type="text" value="${escapeHtml(t.name)}"
                style="display:block; width:100%; margin-top:4px; padding:8px 10px; background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:6px; font:inherit; font-size:13px; box-sizing:border-box;">
            </label>
            <label style="font-size:11px; color:var(--m,#9aa3b2); font-weight:600;">
              Channel
              <select id="nbd-tpl-channel"
                style="display:block; margin-top:4px; padding:8px 10px; background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:6px; font:inherit; font-size:13px;">
                <option value="sms" ${t.channel === 'sms' ? 'selected' : ''}>SMS</option>
                <option value="email" ${t.channel === 'email' ? 'selected' : ''}>Email</option>
              </select>
            </label>
          </div>
          <label id="nbd-tpl-subject-row" style="display:${t.channel === 'email' ? 'block' : 'none'}; margin-bottom:10px; font-size:11px; color:var(--m,#9aa3b2); font-weight:600;">
            Subject
            <input id="nbd-tpl-subject" type="text" value="${escapeHtml(t.subject || '')}"
              style="display:block; width:100%; margin-top:4px; padding:8px 10px; background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:6px; font:inherit; font-size:13px; box-sizing:border-box;">
          </label>
          <label style="display:block; font-size:11px; color:var(--m,#9aa3b2); font-weight:600;">
            Body
            <textarea id="nbd-tpl-body" rows="6"
              style="display:block; width:100%; margin-top:4px; padding:8px 10px; background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:6px; font:inherit; font-size:13px; box-sizing:border-box; resize:vertical;">${escapeHtml(t.body || '')}</textarea>
          </label>
          <div style="font-size:10px; color:var(--m,#9aa3b2); margin-top:6px;">
            Tokens: ${escapeHtml(placeholders)}
          </div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:10px;">
            <button id="nbd-tpl-cancel" type="button" style="background:transparent; color:var(--m,#9aa3b2); border:1px solid var(--br,#2a3344); padding:8px 14px; border-radius:6px; font:inherit; font-size:12px; font-weight:600; cursor:pointer;">Cancel</button>
            <button id="nbd-tpl-save" type="button" style="background:linear-gradient(135deg,#c8541a 0%,#a64516 100%); color:#fff; border:none; padding:8px 14px; border-radius:6px; font:inherit; font-size:12px; font-weight:700; cursor:pointer;" data-template-id="${escapeHtml(t.id || '')}">Save</button>
          </div>
        </div>`;
    }

    let mode = 'list'; // 'list' | 'edit'
    let editingTemplate = null;

    function shell() {
      return `
        <div style="background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:12px; padding:22px; max-width:560px; width:100%; box-shadow:0 12px 40px rgba(0,0,0,0.5); max-height:85vh; overflow-y:auto;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
            <span style="font-size:24px;" aria-hidden="true">📝</span>
            <h2 id="nbd-templates-title" style="font-size:17px; margin:0;">Message templates</h2>
            <button id="nbd-tpl-close-x" type="button" aria-label="Close"
              style="margin-left:auto; background:transparent; color:var(--m,#9aa3b2); border:none; font-size:22px; line-height:1; cursor:pointer; padding:4px 8px;">×</button>
          </div>
          <p style="font-size:11px; color:var(--m,#9aa3b2); margin:0 0 14px; line-height:1.5;">
            Saved messages auto-fill the SMS / email composer when you share a portal link. Tokens like {firstName} and {portalUrl} get substituted before sending.
          </p>
          ${mode === 'edit' ? renderEditor(editingTemplate) : `
            <div id="nbd-tpl-list">${renderList()}</div>
            <div style="display:flex; justify-content:flex-end; margin-top:10px;">
              <button id="nbd-tpl-add" type="button" style="background:transparent; color:var(--orange,#c8541a); border:1px solid var(--orange,#c8541a); padding:8px 14px; border-radius:6px; font:inherit; font-size:12px; font-weight:700; cursor:pointer;">+ Add template</button>
            </div>
          `}
        </div>`;
    }

    function rerender() {
      overlay.innerHTML = shell();
      wire();
    }

    function wire() {
      const closeX = overlay.querySelector('#nbd-tpl-close-x');
      if (closeX) closeX.addEventListener('click', close);

      // List mode
      overlay.querySelectorAll('[data-template-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          editingTemplate = get(btn.getAttribute('data-template-edit'));
          mode = 'edit';
          rerender();
        });
      });
      overlay.querySelectorAll('[data-template-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-template-delete');
          const tpl = get(id);
          if (!tpl) return;
          if (!confirm(`Delete "${tpl.name}"?`)) return;
          remove(id);
          _toast('Template deleted', 'success');
          rerender();
        });
      });
      const add = overlay.querySelector('#nbd-tpl-add');
      if (add) add.addEventListener('click', () => {
        editingTemplate = null;
        mode = 'edit';
        rerender();
      });

      // Edit mode
      const channelSel = overlay.querySelector('#nbd-tpl-channel');
      const subjectRow = overlay.querySelector('#nbd-tpl-subject-row');
      if (channelSel && subjectRow) {
        channelSel.addEventListener('change', () => {
          subjectRow.style.display = channelSel.value === 'email' ? 'block' : 'none';
        });
      }
      const cancelBtn = overlay.querySelector('#nbd-tpl-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => {
        mode = 'list';
        editingTemplate = null;
        rerender();
      });
      const saveBtn = overlay.querySelector('#nbd-tpl-save');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const id   = saveBtn.getAttribute('data-template-id') || '';
        const name = (overlay.querySelector('#nbd-tpl-name').value || '').trim();
        const ch   = overlay.querySelector('#nbd-tpl-channel').value;
        const subj = (overlay.querySelector('#nbd-tpl-subject')?.value || '').trim();
        const body = overlay.querySelector('#nbd-tpl-body').value || '';
        if (!name) { _toast('Name required', 'error'); return; }
        if (!body.trim()) { _toast('Body required', 'error'); return; }
        try {
          save({ id: id || undefined, name, channel: ch, subject: ch === 'email' ? subj : undefined, body });
          _toast('Template saved', 'success');
          mode = 'list';
          editingTemplate = null;
          rerender();
        } catch (e) {
          _toast('Save failed: ' + (e.message || 'unknown'), 'error');
        }
      });
    }

    function close() {
      _modalOpen = false;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    rerender();
    document.body.appendChild(overlay);
  }

  // ─── Init ────────────────────────────────────────────────────────
  seedDefaults();

  // ─── Pick + render (W98) ─────────────────────────────────────────
  // Quick picker modal for use from the send flow. Returns:
  //   { body, subject } if rep picked a template
  //   null              if rep clicked "Use default" (caller falls back)
  //   undefined         if rep cancelled (caller aborts send)
  //
  // Picker is skipped automatically when there's exactly 1 template
  // for the channel — that template is applied directly. When 0
  // templates exist, returns null immediately so the caller falls
  // back to its hardcoded body.
  function pickAndRender(channel, ctx) {
    return new Promise((resolve) => {
      const templates = list(channel);
      if (templates.length === 0) {
        resolve(null);
        return;
      }
      if (templates.length === 1) {
        const rendered = apply(templates[0], ctx);
        resolve(rendered);
        return;
      }

      // Multiple templates — open picker.
      if (_modalOpen) {
        // Defensive: if the manager modal is already open, fall
        // through to the most recently used template (or the first).
        resolve(apply(templates[0], ctx));
        return;
      }
      _modalOpen = true;

      const overlay = document.createElement('div');
      overlay.id = 'nbd-templates-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'nbd-templates-picker-title');
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:99996;
        display:flex; align-items:center; justify-content:center; padding:20px;
        font-family:'Barlow',-apple-system,system-ui,sans-serif;`;

      const channelLabel = channel === 'email' ? 'Email' : 'SMS';
      overlay.innerHTML = `
        <div style="background:var(--s,#1a1f2a); color:var(--t,#e8eaf0); border:1px solid var(--br,#2a3344); border-radius:12px; padding:20px; max-width:440px; width:100%; box-shadow:0 12px 40px rgba(0,0,0,0.5); max-height:80vh; overflow-y:auto;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <span style="font-size:22px;" aria-hidden="true">${channel === 'email' ? '📧' : '💬'}</span>
            <h2 id="nbd-templates-picker-title" style="font-size:16px; margin:0;">Pick ${escapeHtml(channelLabel)} template</h2>
            <button id="nbd-tpl-pick-close" type="button" aria-label="Cancel"
              style="margin-left:auto; background:transparent; color:var(--m,#9aa3b2); border:none; font-size:22px; line-height:1; cursor:pointer; padding:4px 8px;">×</button>
          </div>
          <p style="font-size:11px; color:var(--m,#9aa3b2); margin:0 0 12px; line-height:1.4;">Tokens like {firstName} get filled in before the message opens.</p>
          <div id="nbd-tpl-pick-list" style="display:flex; flex-direction:column; gap:6px;">
            ${templates.map((t, i) => `
              <button data-tpl-pick="${escapeHtml(t.id)}" type="button" style="
                text-align:left; padding:10px 12px; border-radius:8px;
                background:var(--s2,#0f1419); color:var(--t,#e8eaf0);
                border:1px solid var(--br,#2a3344);
                font:inherit; font-size:13px; font-weight:600;
                cursor:pointer; -webkit-tap-highlight-color:transparent;">
                <div style="margin-bottom:4px;">${escapeHtml(t.name)}${t._seeded ? ' <span style="font-size:10px; color:var(--m,#9aa3b2); font-weight:500;">· default</span>' : ''}</div>
                <div style="font-size:11px; color:var(--m,#9aa3b2); font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml((t.body || '').slice(0, 80))}${(t.body || '').length > 80 ? '…' : ''}</div>
              </button>
            `).join('')}
          </div>
          <div style="display:flex; gap:6px; justify-content:space-between; margin-top:12px; padding-top:12px; border-top:1px solid var(--br,#2a3344);">
            <button id="nbd-tpl-pick-default" type="button" style="background:transparent; color:var(--m,#9aa3b2); border:1px solid var(--br,#2a3344); padding:7px 12px; border-radius:6px; font:inherit; font-size:11px; font-weight:600; cursor:pointer;">Use built-in default</button>
            <button id="nbd-tpl-pick-cancel" type="button" style="background:transparent; color:var(--m,#9aa3b2); border:1px solid var(--br,#2a3344); padding:7px 12px; border-radius:6px; font:inherit; font-size:11px; font-weight:600; cursor:pointer;">Cancel</button>
          </div>
        </div>`;

      function close(result) {
        _modalOpen = false;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(undefined);
      }

      overlay.querySelectorAll('[data-tpl-pick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = get(btn.getAttribute('data-tpl-pick'));
          if (!t) { close(undefined); return; }
          close(apply(t, ctx));
        });
      });
      overlay.querySelector('#nbd-tpl-pick-default').addEventListener('click', () => close(null));
      overlay.querySelector('#nbd-tpl-pick-cancel').addEventListener('click', () => close(undefined));
      overlay.querySelector('#nbd-tpl-pick-close').addEventListener('click', () => close(undefined));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(undefined); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);

      // Initial focus on first template option.
      setTimeout(() => {
        const first = overlay.querySelector('[data-tpl-pick]');
        if (first) first.focus();
      }, 0);
    });
  }

  window.TemplatesLibrary = {
    __sentinel: 'nbd-templates-library-v1',
    list,
    get,
    save,
    remove,
    apply,
    pickAndRender,
    openManager,
  };
})();
