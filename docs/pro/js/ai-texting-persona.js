/**
 * ai-texting-persona.js — T-4: AI texting persona editor (Settings tab)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Lets a rep customize the VOICE of their AI SMS-draft assistant — pick a
 * preset, fine-tune trait sliders, set an identity + sign-off, add free-text
 * notes, and live-preview a sample reply — then save it to
 * users/{uid}/settings/aiPersona (read server-side by handlers/ai-texting.js
 * at draft time). Owners can also publish it as the company default.
 *
 * The locked guardrails (no pricing, no scheduling/scope commitments,
 * escalate angry customers, TCPA identity) live SERVER-SIDE and cannot be
 * edited here — this screen only ever touches identity + style.
 *
 * Self-contained: renders into #aiPersonaMount and binds its own controls
 * via addEventListener (CSP-safe — no inline on*= handlers, no dependency on
 * the global data-action allowlist). Hooks switchSettingsTab to render on
 * first open of the "AI Texting" tab.
 */
(function () {
  'use strict';

  // ── UI metadata (display only) ───────────────────────────────
  // The SERVER (functions/handlers/ai-persona.js) is authoritative for the
  // actual prompt wording; these are just slider anchors + preset snapshots
  // for the editor. Preset trait values are kept in sync with the server.
  var TRAITS = [
    { key: 'warmth',    label: 'Warmth',    left: 'Businesslike', right: 'Warm & caring' },
    { key: 'formality', label: 'Formality', left: 'Casual',       right: 'Formal' },
    { key: 'brevity',   label: 'Brevity',   left: 'Fuller',       right: 'Ultra-brief' },
    { key: 'energy',    label: 'Energy',    left: 'Calm',         right: 'Upbeat' },
    { key: 'emoji',     label: 'Emoji',     left: 'None',         right: 'Liberal' },
    { key: 'humor',     label: 'Humor',     left: 'None',         right: 'Playful' },
  ];

  var PRESETS = [
    { id: 'joe-classic',       label: 'Joe Classic',       desc: 'Warm, brief, professional — the default voice.',        traits: { warmth: 60, formality: 55, brevity: 70, energy: 50, emoji: 0,  humor: 20 }, signOff: 'auto' },
    { id: 'straight-shooter',  label: 'Straight Shooter',  desc: 'Efficient and no-nonsense. No emoji, no fluff.',        traits: { warmth: 25, formality: 55, brevity: 90, energy: 35, emoji: 0,  humor: 5  }, signOff: 'none' },
    { id: 'friendly-neighbor', label: 'Friendly Neighbor', desc: 'Warm, casual, relationship-first. Light emoji + humor.', traits: { warmth: 85, formality: 25, brevity: 55, energy: 75, emoji: 60, humor: 55 }, signOff: 'auto' },
    { id: 'polished-pro',      label: 'Polished Pro',      desc: 'Formal and buttoned-up. Good for insurance-heavy work.', traits: { warmth: 50, formality: 85, brevity: 65, energy: 40, emoji: 0,  humor: 0  }, signOff: 'always' },
  ];

  var SIGN_OFFS = [
    { v: 'auto',   label: "Auto — “— {name}'s assistant” only when natural" },
    { v: 'always', label: 'Always sign off' },
    { v: 'none',   label: 'Never sign off' },
  ];

  var SAMPLE_DEFAULT = 'Hey, saw your truck in the neighborhood. How much would a new roof run me?';

  // ── state ─────────────────────────────────────────────────────
  var state = null;          // current edited config
  var rendered = false;      // panel built once
  var saving = false, previewing = false;

  function uid() {
    return (window._user && window._user.uid) ||
           (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || null;
  }
  function companyId() {
    return (window._userClaims && window._userClaims.companyId) || uid();
  }
  // Owner/solo can publish a company default; a member's companyProfile write
  // would be rules-denied, so only offer it when this user owns the tenant.
  function isOwner() {
    var role = window._userClaims && window._userClaims.role;
    return !(window._userClaims && window._userClaims.companyId) ||
           companyId() === uid() || role === 'owner' || role === 'admin';
  }

  function defaultName() {
    var u = window._user || {};
    var n = (u.displayName || '').trim().split(/\s+/)[0];
    return n || 'Joe';
  }

  function freshConfig() {
    var p = PRESETS[0];
    return {
      presetId: p.id,
      identityName: defaultName(),
      traits: Object.assign({}, p.traits),
      signOff: p.signOff,
      customInstructions: '',
      enabled: true,
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── render ────────────────────────────────────────────────────
  function render() {
    var mount = document.getElementById('aiPersonaMount');
    if (!mount) return;
    if (!state) state = freshConfig();

    var presetCards = PRESETS.map(function (p) {
      var active = state.presetId === p.id;
      return '<button type="button" class="aip-preset' + (active ? ' aip-preset-active' : '') + '" data-aip-preset="' + esc(p.id) + '" ' +
        'style="text-align:left;border:2px solid ' + (active ? 'var(--orange,#e8720c)' : 'var(--br,#2a2f3a)') + ';background:var(--s2,#1a1f29);border-radius:8px;padding:10px 12px;cursor:pointer;">' +
        '<div style="font-weight:700;font-size:13px;color:var(--t,#e8eaf0);">' + esc(p.label) + '</div>' +
        '<div style="font-size:11px;color:var(--m,#9aa3b2);margin-top:2px;line-height:1.35;">' + esc(p.desc) + '</div>' +
        '</button>';
    }).join('');

    var sliders = TRAITS.map(function (t) {
      var val = clamp(state.traits[t.key]);
      return '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">' +
          '<span style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);">' + esc(t.label) + '</span>' +
          '<span class="aip-val" data-aip-val="' + esc(t.key) + '" style="font-size:11px;color:var(--m,#9aa3b2);font-variant-numeric:tabular-nums;">' + val + '</span>' +
        '</div>' +
        '<input type="range" min="0" max="100" step="5" value="' + val + '" data-aip-trait="' + esc(t.key) + '" style="width:100%;accent-color:var(--orange,#e8720c);">' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--m,#9aa3b2);margin-top:1px;">' +
          '<span>' + esc(t.left) + '</span><span>' + esc(t.right) + '</span></div>' +
      '</div>';
    }).join('');

    var signOffOpts = SIGN_OFFS.map(function (s) {
      return '<option value="' + esc(s.v) + '"' + (state.signOff === s.v ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }).join('');

    var companyDefaultRow = isOwner()
      ? '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--m,#9aa3b2);margin-top:10px;cursor:pointer;">' +
          '<input type="checkbox" id="aipCompanyDefault" style="accent-color:var(--orange,#e8720c);"> ' +
          'Also set as my team’s default (used for reps who haven’t customized)</label>'
      : '';

    mount.innerHTML =
      '<div style="max-width:680px;">' +
        '<p style="font-size:12.5px;color:var(--m,#9aa3b2);line-height:1.5;margin:0 0 14px;">' +
          'Shape how your AI texting assistant sounds when it drafts replies to homeowners. ' +
          'Safety rules (no pricing, no scheduling/scope promises, escalating upset customers) are always enforced and can’t be turned off here.</p>' +

        '<div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:6px;">Start from a preset</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px;">' + presetCards + '</div>' +

        '<div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:8px;">Fine-tune the voice</div>' +
        sliders +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px;">' +
          '<div><div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:4px;">Rep first name</div>' +
            '<input type="text" id="aipName" value="' + esc(state.identityName) + '" placeholder="Joe" maxlength="40" ' +
            'style="width:100%;padding:8px 10px;border:1px solid var(--br,#2a2f3a);border-radius:6px;background:var(--s2,#1a1f29);color:var(--t,#e8eaf0);font:inherit;font-size:13px;"></div>' +
          '<div><div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:4px;">Sign-off</div>' +
            '<select id="aipSignOff" style="width:100%;padding:8px 10px;border:1px solid var(--br,#2a2f3a);border-radius:6px;background:var(--s2,#1a1f29);color:var(--t,#e8eaf0);font:inherit;font-size:13px;">' + signOffOpts + '</select></div>' +
        '</div>' +

        '<div style="margin-top:12px;"><div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:4px;">Extra notes <span style="font-weight:400;color:var(--m,#9aa3b2);">(optional — style only)</span></div>' +
          '<textarea id="aipNotes" rows="2" maxlength="600" placeholder="e.g. mention we’re local & family-owned; avoid the word ‘cheap’" ' +
          'style="width:100%;padding:8px 10px;border:1px solid var(--br,#2a2f3a);border-radius:6px;background:var(--s2,#1a1f29);color:var(--t,#e8eaf0);font:inherit;font-size:13px;line-height:1.5;resize:vertical;">' + esc(state.customInstructions) + '</textarea></div>' +

        // ── live preview ──
        '<div style="margin-top:18px;padding:12px;border:1px dashed var(--br,#2a2f3a);border-radius:8px;background:var(--s1,#11151c);">' +
          '<div style="font-size:12px;font-weight:700;color:var(--t,#e8eaf0);margin-bottom:6px;">Live preview</div>' +
          '<div style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;">' +
            '<input type="text" id="aipSample" value="' + esc(SAMPLE_DEFAULT) + '" maxlength="500" ' +
              'style="flex:1;min-width:220px;padding:8px 10px;border:1px solid var(--br,#2a2f3a);border-radius:6px;background:var(--s2,#1a1f29);color:var(--t,#e8eaf0);font:inherit;font-size:12px;" placeholder="A sample inbound text…">' +
            '<button type="button" id="aipPreviewBtn" style="padding:8px 16px;border:none;border-radius:6px;background:var(--orange,#e8720c);color:#fff;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;">Preview draft</button>' +
          '</div>' +
          '<div id="aipPreviewOut" style="margin-top:10px;font-size:13px;color:var(--m,#9aa3b2);line-height:1.5;"></div>' +
        '</div>' +

        // ── save ──
        '<div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<button type="button" id="aipSaveBtn" style="padding:9px 20px;border:none;border-radius:6px;background:var(--orange,#e8720c);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Save persona</button>' +
          '<button type="button" id="aipResetBtn" style="padding:9px 14px;border:1px solid var(--br,#2a2f3a);border-radius:6px;background:transparent;color:var(--m,#9aa3b2);font-weight:600;font-size:12px;cursor:pointer;">Reset to default</button>' +
          '<span id="aipStatus" role="status" aria-live="polite" style="font-size:12px;color:var(--m,#9aa3b2);"></span>' +
        '</div>' +
        companyDefaultRow +
      '</div>';

    bind(mount);
  }

  function clamp(v) {
    var n = Number(v);
    if (!isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  // ── event wiring (CSP-safe: addEventListener only) ────────────
  function bind(mount) {
    mount.querySelectorAll('[data-aip-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyPreset(btn.dataset.aipPreset); });
    });
    mount.querySelectorAll('[data-aip-trait]').forEach(function (sl) {
      sl.addEventListener('input', function () {
        var k = sl.dataset.aipTrait;
        state.traits[k] = clamp(sl.value);
        var lbl = mount.querySelector('[data-aip-val="' + k + '"]');
        if (lbl) lbl.textContent = state.traits[k];
        markCustom();
      });
    });
    var name = mount.querySelector('#aipName');
    if (name) name.addEventListener('input', function () { state.identityName = name.value; });
    var so = mount.querySelector('#aipSignOff');
    if (so) so.addEventListener('change', function () { state.signOff = so.value; markCustom(); });
    var notes = mount.querySelector('#aipNotes');
    if (notes) notes.addEventListener('input', function () { state.customInstructions = notes.value; });

    var prev = mount.querySelector('#aipPreviewBtn');
    if (prev) prev.addEventListener('click', doPreview);
    var save = mount.querySelector('#aipSaveBtn');
    if (save) save.addEventListener('click', doSave);
    var reset = mount.querySelector('#aipResetBtn');
    if (reset) reset.addEventListener('click', function () { state = freshConfig(); render(); setStatus('Reset to Joe Classic — not saved yet.'); });
  }

  // Editing a slider/sign-off means it's no longer a pristine preset.
  function markCustom() {
    var match = PRESETS.find(function (p) {
      return p.signOff === state.signOff && TRAITS.every(function (t) { return p.traits[t.key] === state.traits[t.key]; });
    });
    var newId = match ? match.id : 'custom';
    if (newId !== state.presetId) { state.presetId = newId; refreshPresetActive(); }
  }

  function refreshPresetActive() {
    var mount = document.getElementById('aiPersonaMount');
    if (!mount) return;
    mount.querySelectorAll('[data-aip-preset]').forEach(function (b) {
      var active = b.dataset.aipPreset === state.presetId;
      b.classList.toggle('aip-preset-active', active);
      b.style.borderColor = active ? 'var(--orange,#e8720c)' : 'var(--br,#2a2f3a)';
    });
  }

  function applyPreset(id) {
    var p = PRESETS.find(function (x) { return x.id === id; });
    if (!p) return;
    state.presetId = p.id;
    state.traits = Object.assign({}, p.traits);
    state.signOff = p.signOff;
    render(); // re-seed sliders + sign-off from the preset
    setStatus(p.label + ' selected — preview or save to apply.');
  }

  function setStatus(msg, kind) {
    var el = document.getElementById('aipStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'error' ? 'var(--red,#e05252)' : (kind === 'ok' ? 'var(--green,#2ECC8A)' : 'var(--m,#9aa3b2)');
  }

  // ── live preview (calls the previewAiPersona callable) ────────
  async function ensureFunctions() {
    if (window._functions && window._httpsCallable) return true;
    try {
      var mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = window._functions || mod.getFunctions();
      window._httpsCallable = window._httpsCallable || mod.httpsCallable;
      return true;
    } catch (e) { return false; }
  }

  function configPayload() {
    return {
      presetId: state.presetId,
      identityName: state.identityName,
      traits: state.traits,
      signOff: state.signOff,
      customInstructions: state.customInstructions,
    };
  }

  async function doPreview() {
    if (previewing) return;
    previewing = true;
    var out = document.getElementById('aipPreviewOut');
    var btn = document.getElementById('aipPreviewBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    if (out) out.innerHTML = '<span style="color:var(--m,#9aa3b2);">Drafting a sample reply…</span>';
    try {
      if (!(await ensureFunctions())) throw new Error('functions unavailable');
      var sampleEl = document.getElementById('aipSample');
      var sample = (sampleEl && sampleEl.value) || SAMPLE_DEFAULT;
      var fn = window._httpsCallable(window._functions, 'previewAiPersona');
      var r = await fn({ config: configPayload(), sampleMessage: sample });
      var draft = (r && r.data && r.data.draftText) || '';
      if (out) {
        out.innerHTML = draft
          ? '<div style="color:var(--m,#9aa3b2);font-size:11px;margin-bottom:4px;">Homeowner: “' + esc(sample) + '”</div>' +
            '<div style="background:var(--s2,#1a1f29);border-radius:8px;padding:9px 11px;color:var(--t,#e8eaf0);">' + esc(draft) + '</div>'
          : '<span style="color:var(--red,#e05252);">No preview returned.</span>';
      }
    } catch (e) {
      if (out) out.innerHTML = '<span style="color:var(--red,#e05252);">Couldn’t generate a preview. ' + esc((e && e.message) || '') + '</span>';
    } finally {
      previewing = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Preview draft'; }
    }
  }

  // ── save ──────────────────────────────────────────────────────
  async function doSave() {
    if (saving) return;
    var id = uid();
    if (!id) { setStatus('Sign in to save.', 'error'); return; }
    if (!window.db || !window.doc || !window.setDoc) { setStatus('Not ready — try again in a moment.', 'error'); return; }
    saving = true;
    setStatus('Saving…');
    var cfg = configPayload();
    cfg.enabled = true;
    cfg.updatedBy = id;
    if (window.serverTimestamp) cfg.updatedAt = window.serverTimestamp();
    try {
      await window.setDoc(window.doc(window.db, 'users', id, 'settings', 'aiPersona'), cfg, { merge: true });

      var asDefault = document.getElementById('aipCompanyDefault');
      if (asDefault && asDefault.checked && typeof window._saveCompanyProfile === 'function') {
        try {
          await window._saveCompanyProfile({ aiTexting: { defaultPersona: cfg } });
          setStatus('Saved — also set as your team’s default. New texts will use it.', 'ok');
        } catch (e) {
          setStatus('Saved your persona, but couldn’t set the team default (owner only).', 'error');
        }
      } else {
        setStatus('Saved. Your next AI text drafts will use this voice.', 'ok');
      }
      if (typeof window.showToast === 'function') window.showToast('AI texting persona saved', 'success');
    } catch (e) {
      setStatus('Save failed: ' + ((e && e.message) || 'unknown error'), 'error');
    } finally {
      saving = false;
    }
  }

  // ── load on first open ────────────────────────────────────────
  async function load() {
    state = freshConfig();
    var id = uid();
    if (id && window.db && window.getDoc && window.doc) {
      try {
        var snap = await window.getDoc(window.doc(window.db, 'users', id, 'settings', 'aiPersona'));
        if (snap && snap.exists && snap.exists()) {
          var d = snap.data() || {};
          state = {
            presetId: d.presetId || 'custom',
            identityName: d.identityName || defaultName(),
            traits: Object.assign({}, PRESETS[0].traits, d.traits || {}),
            signOff: d.signOff || 'auto',
            customInstructions: d.customInstructions || '',
            enabled: d.enabled !== false,
          };
        }
      } catch (e) { /* defaults stand */ }
    }
  }

  // ── tab hook ──────────────────────────────────────────────────
  async function onTabOpen() {
    var mount = document.getElementById('aiPersonaMount');
    if (!mount) return;
    if (!rendered) {
      rendered = true;
      mount.innerHTML = '<div style="padding:20px;color:var(--m,#9aa3b2);font-size:13px;">Loading…</div>';
      await load();
      render();
    }
  }

  function installTabHook() {
    var prev = window.switchSettingsTab;
    if (typeof prev !== 'function') return false;
    if (prev.__aipWrapped) return true;
    var wrapped = function (tab) {
      prev(tab);
      if (tab === 'ai-texting') onTabOpen();
    };
    wrapped.__aipWrapped = true;
    window.switchSettingsTab = wrapped;
    return true;
  }

  // switchSettingsTab lives in the lazy-hydrated settings template path, so
  // retry briefly until it exists (same concern as the team/billing hooks).
  function boot() {
    if (installTabHook()) return;
    var tries = 0;
    var iv = setInterval(function () {
      if (installTabHook() || ++tries > 40) clearInterval(iv);
    }, 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.NbdAiPersona = { onTabOpen: onTabOpen, render: render };
})();
