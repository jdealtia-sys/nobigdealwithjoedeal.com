/**
 * pipeline-builder.js — Settings → Pipelines editor (freeform pipelines, Phase 2).
 *
 * Lets an owner / company_admin edit their kanban pipelines: per job-type view,
 * reorder / rename / recolor stages, change a stage's semantic role, add custom
 * stages, and remove stages from a view. Writes the config to
 * companyProfile.pipelines (owner/admin-write per the Settings sweep) and calls
 * window.applyPipelineConfig() so the board updates immediately on save.
 *
 * Ships INSIDE the lazily-hydrated <template id="tpl-view-settings">, so it wires
 * itself via a switchSettingsTab hook (same idiom as dashboard-team-tab.js) and
 * renders on the first Settings → Pipelines open (after DCL). Strict-CSP-safe:
 * all interaction is delegated data-pb-action attributes, no inline handlers.
 *
 * Engine deps (from crm-stages.js via dashboard-bootstrap):
 *   window.resolvePipelineConfig, window.STAGE_ROLE, window.applyPipelineConfig,
 *   window._saveCompanyProfile, window._companyProfile, window.KANBAN_VIEWS.
 */
(function () {
  'use strict';

  var ROOT_ID = 'pipelineBuilderRoot';
  var _cfg = null;      // working config (raw overrides), cloned from companyProfile.pipelines
  var _dirty = false;
  var _wired = false;   // root-level delegate installed once
  var _drag = null;     // active drag payload { view, stage } during row reorder

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function toast(msg, kind) { if (typeof window.showToast === 'function') window.showToast(msg, kind || 'ok'); }

  // Owner (doc keyed by uid → no companyId claim, or companyId===uid) or
  // company_admin/admin may edit; everyone else sees it read-only (matches the
  // companyProfile firestore rule so a denied save never surprises them).
  function canEdit() {
    var c = window._userClaims || {};
    var role = c.role || '';
    if (role === 'admin' || role === 'company_admin') return true;
    if (!c.companyId) return true; // solo owner (no companyId claim)
    return window._user && c.companyId === window._user.uid; // owner keyed by uid
  }

  function ROLES() {
    var R = window.STAGE_ROLE || { NEW: 'new', ACTIVE: 'active', JOB: 'job', WON: 'won', LOST: 'lost' };
    return [R.NEW, R.ACTIVE, R.JOB, R.WON, R.LOST];
  }
  var ROLE_LABEL = { new: 'New', active: 'Active', job: 'In Production', won: 'Won', lost: 'Lost' };

  function loadCfg() {
    var raw = (window._companyProfile && window._companyProfile.pipelines) || null;
    try { _cfg = raw ? JSON.parse(JSON.stringify(raw)) : { stages: {}, views: {} }; }
    catch (_) { _cfg = { stages: {}, views: {} }; }
    if (!_cfg.stages) _cfg.stages = {};
    if (!_cfg.views) _cfg.views = {};
  }

  function resolved() {
    var fn = window.resolvePipelineConfig;
    if (typeof fn !== 'function') return null;
    try { return fn(_cfg); } catch (_) { return null; }
  }

  // Materialize a view's stage order into the working config so a reorder/remove
  // persists (until then the view inherits the default order).
  function ensureViewStages(vk, res) {
    if (!_cfg.views[vk] || !Array.isArray(_cfg.views[vk].stages)) {
      var base = (res.views[vk] && res.views[vk].stages) ? res.views[vk].stages.slice() : [];
      _cfg.views[vk] = Object.assign({}, _cfg.views[vk], { stages: base });
    }
    return _cfg.views[vk].stages;
  }

  function setStageField(key, field, val) {
    _cfg.stages[key] = Object.assign({}, _cfg.stages[key], (function () { var o = {}; o[field] = val; return o; })());
    _dirty = true;
  }

  // ── render ──────────────────────────────────────────────
  function render() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var res = resolved();
    if (!res) { root.innerHTML = '<div style="padding:16px;color:var(--m);">Pipeline engine not loaded yet — reopen this tab in a moment.</div>'; return; }
    var editable = canEdit();
    var roles = ROLES();

    var html = '';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">';
    html += '<div style="font-size:12px;color:var(--m);flex:1;min-width:200px;">Reorder, rename, recolor and add stages per pipeline. Each stage has a <b>role</b> (Won/Lost/etc.) that drives your KPIs, revenue and the customer portal — so custom stages still count correctly.</div>';
    if (editable) {
      html += '<button type="button" class="btn btn-primary" data-pb-action="save" style="font-size:12px;padding:8px 14px;"' + (_dirty ? '' : ' disabled') + '>💾 Save changes</button>';
      html += '<button type="button" class="btn btn-ghost" data-pb-action="reset" style="font-size:12px;padding:8px 12px;">↺ Reset to defaults</button>';
    } else {
      html += '<div style="font-size:11px;color:var(--m);font-style:italic;">Read-only — only the owner or a company admin can edit pipelines.</div>';
    }
    html += '</div>';

    var viewOrder = Object.keys(res.views);
    viewOrder.forEach(function (vk) {
      var view = res.views[vk];
      var stages = view.stages || [];
      html += '<div style="border:1px solid var(--br);border-radius:10px;margin-bottom:14px;overflow:hidden;">';
      html += '<div style="padding:10px 12px;background:var(--s2);font-weight:700;font-size:13px;color:var(--t);">'
        + esc(view.label || vk) + ' <span style="font-weight:400;color:var(--m);font-size:11px;">· ' + stages.length + ' stages</span></div>';
      html += '<div style="padding:8px;">';

      stages.forEach(function (key, i) {
        var m = res.stageMeta[key] || {};
        var isCustom = !!m.custom;
        html += '<div class="pb-stage-row" data-view="' + esc(vk) + '" data-stage="' + esc(key) + '" style="display:flex;align-items:center;gap:6px;padding:5px 4px;border-bottom:1px solid var(--br);flex-wrap:wrap;">';
        // drag handle (primary reorder affordance; ▲/▼ stay for touch / a11y)
        if (editable) {
          html += '<span class="pb-grip" draggable="true" data-view="' + esc(vk) + '" data-stage="' + esc(key) + '" title="Drag to reorder">⠿</span>';
        }
        // reorder
        html += '<div style="display:flex;flex-direction:column;gap:1px;">';
        html += '<button type="button" class="pb-mini" data-pb-action="up" data-view="' + esc(vk) + '" data-stage="' + esc(key) + '"' + (i === 0 || !editable ? ' disabled' : '') + ' title="Move up">▲</button>';
        html += '<button type="button" class="pb-mini" data-pb-action="down" data-view="' + esc(vk) + '" data-stage="' + esc(key) + '"' + (i === stages.length - 1 || !editable ? ' disabled' : '') + ' title="Move down">▼</button>';
        html += '</div>';
        // color
        html += '<input type="color" value="' + esc(m.color || '#374151') + '" data-pb-action="recolor" data-stage="' + esc(key) + '"' + (editable ? '' : ' disabled') + ' style="width:26px;height:26px;border:none;background:none;padding:0;cursor:pointer;" title="Stage color" />';
        // label
        html += '<input type="text" value="' + esc(m.label || key) + '" data-pb-action="rename" data-stage="' + esc(key) + '"' + (editable ? '' : ' disabled') + ' maxlength="40" style="flex:1;min-width:120px;font-size:12px;padding:5px 8px;border:1px solid var(--br);border-radius:6px;background:var(--s1);color:var(--t);" />';
        // role
        html += '<select data-pb-action="role" data-stage="' + esc(key) + '"' + (editable ? '' : ' disabled') + ' style="font-size:11px;padding:5px 6px;border:1px solid var(--br);border-radius:6px;background:var(--s1);color:var(--t);" title="Semantic role (drives KPIs/portal)">';
        roles.forEach(function (r) {
          html += '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + esc(ROLE_LABEL[r] || r) + '</option>';
        });
        html += '</select>';
        // remove-from-view / delete-custom
        html += '<button type="button" class="pb-mini pb-danger" data-pb-action="remove" data-view="' + esc(vk) + '" data-stage="' + esc(key) + '"' + (editable ? '' : ' disabled') + ' title="Remove from this pipeline">✕</button>';
        if (isCustom) {
          html += '<button type="button" class="pb-mini pb-danger" data-pb-action="delete" data-stage="' + esc(key) + '"' + (editable ? '' : ' disabled') + ' title="Delete this custom stage everywhere">🗑</button>';
        }
        html += '</div>';
      });

      // add-custom row
      if (editable) {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:8px 4px 2px;flex-wrap:wrap;">';
        html += '<input type="text" placeholder="New stage name…" data-pb-add-label="' + esc(vk) + '" maxlength="40" style="flex:1;min-width:120px;font-size:12px;padding:5px 8px;border:1px solid var(--br);border-radius:6px;background:var(--s1);color:var(--t);" />';
        html += '<select data-pb-add-role="' + esc(vk) + '" style="font-size:11px;padding:5px 6px;border:1px solid var(--br);border-radius:6px;background:var(--s1);color:var(--t);">';
        roles.forEach(function (r) { html += '<option value="' + r + '"' + (r === 'active' ? ' selected' : '') + '>' + esc(ROLE_LABEL[r] || r) + '</option>'; });
        html += '</select>';
        html += '<button type="button" class="btn btn-ghost" data-pb-action="add" data-view="' + esc(vk) + '" style="font-size:11px;padding:6px 10px;">+ Add stage</button>';
        html += '</div>';
      }

      html += '</div></div>';
    });

    root.innerHTML = html;
  }

  // ── delegated handlers ──────────────────────────────────
  function onChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var action = t.getAttribute('data-pb-action');
    if (action === 'rename') { setStageField(t.getAttribute('data-stage'), 'label', t.value); markDirtyLight(); }
    else if (action === 'recolor') { setStageField(t.getAttribute('data-stage'), 'color', t.value); render(); }
    else if (action === 'role') { setStageField(t.getAttribute('data-stage'), 'role', t.value); render(); }
  }

  // Rename fires on every keystroke via 'input'; keep the field focused (don't
  // re-render) and just flip the Save button on.
  function markDirtyLight() {
    _dirty = true;
    var root = document.getElementById(ROOT_ID);
    var saveBtn = root && root.querySelector('[data-pb-action="save"]');
    if (saveBtn) saveBtn.disabled = false;
  }

  async function onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-pb-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-pb-action');
    if (action === 'rename' || action === 'recolor' || action === 'role') return; // handled on change
    e.preventDefault();
    var res = resolved(); if (!res && action !== 'reset') return;
    var vk = btn.getAttribute('data-view');
    var key = btn.getAttribute('data-stage');

    if (action === 'up' || action === 'down') {
      var arr = ensureViewStages(vk, res);
      var idx = arr.indexOf(key);
      if (idx === -1) return;
      var swap = action === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= arr.length) return;
      var tmp = arr[idx]; arr[idx] = arr[swap]; arr[swap] = tmp;
      _dirty = true; render();
    } else if (action === 'remove') {
      var a2 = ensureViewStages(vk, res);
      var j = a2.indexOf(key);
      if (j !== -1) { a2.splice(j, 1); _dirty = true; render(); }
    } else if (action === 'delete') {
      if (typeof confirm === 'function' && !confirm('Delete this custom stage from every pipeline? Leads already in it keep their stage value.')) return;
      delete _cfg.stages[key];
      Object.keys(_cfg.views || {}).forEach(function (v) {
        if (_cfg.views[v] && Array.isArray(_cfg.views[v].stages)) {
          _cfg.views[v].stages = _cfg.views[v].stages.filter(function (s) { return s !== key; });
        }
      });
      _dirty = true; render();
    } else if (action === 'add') {
      var root = document.getElementById(ROOT_ID);
      var labEl = root && root.querySelector('[data-pb-add-label="' + cssEsc(vk) + '"]');
      var roleEl = root && root.querySelector('[data-pb-add-role="' + cssEsc(vk) + '"]');
      var label = (labEl && labEl.value || '').trim();
      var role = (roleEl && roleEl.value) || 'active';
      if (!label) { toast('Enter a stage name', 'error'); return; }
      var newKey = makeCustomKey(label, res);
      _cfg.stages[newKey] = { label: label.slice(0, 40), role: role, color: '#6366f1', icon: '📌' };
      var arr3 = ensureViewStages(vk, res);
      // Insert before the terminal Lost/Closed column if present, else append.
      var insAt = arr3.length;
      for (var k = 0; k < arr3.length; k++) {
        var rk = (res.stageMeta[arr3[k]] || {}).role;
        if (rk === 'lost' || arr3[k] === 'closed') { insAt = k; break; }
      }
      arr3.splice(insAt, 0, newKey);
      _dirty = true; render();
    } else if (action === 'save') {
      await save();
    } else if (action === 'reset') {
      if (typeof confirm === 'function' && !confirm('Reset ALL pipelines to the NBD defaults? Your custom stages + ordering will be removed.')) return;
      _cfg = { stages: {}, views: {} };
      _dirty = true;
      await save();
    }
  }

  function cssEsc(s) { return String(s || '').replace(/["\\]/g, '\\$&'); }

  function makeCustomKey(label, res) {
    var slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'stage';
    var base = 'custom_' + slug, key = base, n = 2;
    while (res.stageMeta[key] || _cfg.stages[key]) { key = base + '_' + n; n++; }
    return key;
  }

  async function save() {
    if (!canEdit()) { toast('Only the owner or a company admin can edit pipelines', 'error'); return; }
    if (typeof window._saveCompanyProfile !== 'function') { toast('Cannot save right now', 'error'); return; }
    var btn = document.querySelector('[data-pb-action="save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await window._saveCompanyProfile({ pipelines: _cfg });
      if (typeof window.applyPipelineConfig === 'function') window.applyPipelineConfig();
      _dirty = false;
      toast('Pipelines saved', 'ok');
      // Reload from the (now-merged) profile so the working copy matches server.
      loadCfg(); render();
    } catch (e) {
      console.warn('[pipelines] save failed', e);
      toast('Save failed: ' + ((e && e.message) || 'unknown'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save changes'; }
    }
  }

  // ── drag-to-reorder (HTML5 DnD, delegated + CSP-safe) ───────────
  function _clearDropHints(root) {
    var rows = root.querySelectorAll('.pb-stage-row.pb-dragover');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('pb-dragover');
  }
  function onDragStart(e) {
    var g = e.target && e.target.closest && e.target.closest('.pb-grip');
    if (!g) return;
    _drag = { view: g.getAttribute('data-view'), stage: g.getAttribute('data-stage') };
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', _drag.stage); } catch (_) {} }
  }
  function onDragOver(e) {
    if (!_drag) return;
    var row = e.target && e.target.closest && e.target.closest('.pb-stage-row');
    if (!row || row.getAttribute('data-view') !== _drag.view) return; // reorder within a pipeline only
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var root = document.getElementById(ROOT_ID);
    if (root) { _clearDropHints(root); if (row.getAttribute('data-stage') !== _drag.stage) row.classList.add('pb-dragover'); }
  }
  function onDrop(e) {
    if (!_drag) return;
    var row = e.target && e.target.closest && e.target.closest('.pb-stage-row');
    var payload = _drag; _drag = null;
    var root = document.getElementById(ROOT_ID);
    if (root) _clearDropHints(root);
    if (!row) return;
    var view = row.getAttribute('data-view');
    var target = row.getAttribute('data-stage');
    if (view !== payload.view || target === payload.stage) return;
    e.preventDefault();
    var res = resolved(); if (!res) return;
    var arr = ensureViewStages(view, res);
    var from = arr.indexOf(payload.stage);
    if (from === -1) return;
    arr.splice(from, 1);
    var to = arr.indexOf(target);
    if (to === -1) { arr.splice(from, 0, payload.stage); return; } // target vanished — undo
    // Drop before/after the target based on where in the row we released.
    var rect = row.getBoundingClientRect();
    var after = (e.clientY - rect.top) > rect.height / 2;
    arr.splice(after ? to + 1 : to, 0, payload.stage);
    _dirty = true; render();
  }

  function wireRoot() {
    var root = document.getElementById(ROOT_ID);
    if (!root || root._pbWired) return;
    root._pbWired = true;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-pb-action') === 'rename') { setStageField(e.target.getAttribute('data-stage'), 'label', e.target.value); markDirtyLight(); }
    });
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', function () { _drag = null; _clearDropHints(root); });
  }

  function openBuilder() {
    loadCfg();
    _dirty = false;
    wireRoot();
    render();
  }

  // Inject the once-only CSS for the mini buttons.
  function injectCss() {
    if (document.getElementById('pb-style')) return;
    var s = document.createElement('style');
    s.id = 'pb-style';
    s.textContent = '.pb-mini{background:var(--s2);border:1px solid var(--br);color:var(--m);border-radius:5px;width:22px;height:20px;font-size:9px;line-height:1;cursor:pointer;padding:0;}'
      + '.pb-mini:disabled{opacity:.35;cursor:default;}.pb-mini.pb-danger{color:var(--red,#e05252);border-color:var(--red,#e05252);height:26px;width:26px;font-size:11px;}'
      + '.pb-grip{cursor:grab;color:var(--m);font-size:14px;line-height:1;padding:0 2px;user-select:none;touch-action:none;}'
      + '.pb-grip:active{cursor:grabbing;}'
      + '.pb-stage-row{border-radius:6px;transition:background .08s;}'
      + '.pb-stage-row.pb-dragover{background:var(--accent-weak,rgba(232,114,12,.14));box-shadow:inset 0 2px 0 var(--accent,#e8720c);}';
    document.head.appendChild(s);
  }

  // Hook switchSettingsTab so the builder renders when Settings → Pipelines opens
  // (the panel is inside the lazily-hydrated settings template).
  function installHook() {
    injectCss();
    var _prev = window.switchSettingsTab;
    if (typeof _prev !== 'function' || _prev._pbWrapped) { return; }
    var wrapped = function (tab) {
      var r = _prev.apply(this, arguments);
      if (tab === 'pipelines') { try { openBuilder(); } catch (e) { console.warn('[pipelines] open failed', e); } }
      return r;
    };
    wrapped._pbWrapped = true;
    window.switchSettingsTab = wrapped;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHook);
  } else {
    installHook();
  }
})();
