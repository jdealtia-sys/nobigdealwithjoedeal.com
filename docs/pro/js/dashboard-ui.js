/**
 * dashboard-ui.js — DOM render helpers, event delegates, modals,
 * sidebar/mobile/theme UI bindings for the dashboard surface.
 *
 * Extracted from dashboard-main.js (Step 4a — 2026-05-16). Fourth
 * in the state→api→widgets→ui→actions→main load chain.
 *
 * Lives here:
 *   - breadcrumb update + template hydration
 *   - the data-action click delegate (allowlists come from
 *     dashboard-state.js)
 *   - toast queue
 *   - Cal.com embed UI
 *   - autocomplete UI (renderAcDrop / initAddressAutocomplete /
 *     selectAcItem / hideAcDrop / initAllAutocomplete +
 *     formatMailingAddress helpers)
 *   - document template UI (DOC_TEMPLATES + tlToggleCat /
 *     openDocTemplate / closeDocViewer / printDoc / openUploadDoc /
 *     closeUploadDoc / handleDocUpload / injectBlankButtons IIFE)
 *   - property intel modal toggles
 *   - theme + comfort + auto-theme UI (applyTheme, loadSavedTheme,
 *     nbdComfortSet/*, nbdAutoTheme*)
 *   - kanban density + bold hierarchy UI
 *   - page-breathe: sidebar collapse, kanban fullscreen, Tools menu,
 *     scroll-collapse, FAB visibility
 *   - daily-program render helpers (theme grid, floors)
 *   - mobile nav (mobileNav, toggleMobileMore, closeMobileMore,
 *     toggleMapSidebar, syncMobileBadge)
 *   - CRM secondary-header auto-hide UI
 *   - spyglass / fab / quick-storm UI
 */

// ══════════════════════════════════════════════
// VIEW TEMPLATE HYDRATION + BREADCRUMB
// ══════════════════════════════════════════════
// Update breadcrumb navigation
function updateBreadcrumb(routeName, params = {}) {
  const breadcrumbEl = document.getElementById('breadcrumb-nav');
  if (!breadcrumbEl) return;

  const route = routeConfig[routeName];
  if (!route) {
    breadcrumbEl.innerHTML = '';
    return;
  }

  const crumbs = [];

  // Build breadcrumb trail
  if (route.parent) {
    const parentRoute = routeConfig[route.parent];
    if (parentRoute) {
      crumbs.push(`<a href="#/${route.parent}" class="breadcrumb-link">${parentRoute.label}</a>`);
    }
  }

  // Add current page
  crumbs.push(`<span class="breadcrumb-current">${route.label}</span>`);

  // Add detail params (like lead name, estimate number)
  if (params.detail) {
    crumbs.push(`<span class="breadcrumb-current">${params.detail}</span>`);
  }

  breadcrumbEl.innerHTML = crumbs.join('<span class="breadcrumb-sep">›</span>');
}

// Rock 4 Phase 3 — lazy hydration for templated views.
// A view DIV carrying data-view-template="tpl-<id>" starts empty; on first
// goTo() we clone the matching <template> into it. Idempotent: re-hydration
// is a no-op once the view has children. This is the foundation for the
// stub-view batch (aitree, understand, projectcodex, aiusage, board, ...)
// per docs/dev/dashboard-decomposition-plan.md Phase 3.
function _hydrateViewTemplate(name) {
  const view = document.getElementById('view-' + name);
  if (!view) return false;
  if (view.children.length > 0) return true; // already hydrated
  const tplId = view.dataset.viewTemplate;
  if (!tplId) return false;
  const tpl = document.getElementById(tplId);
  if (!tpl || !('content' in tpl)) return false;
  view.appendChild(tpl.content.cloneNode(true));

  // Phase C.3+ — re-execute inline <script> elements after cloning.
  // cloneNode() copies script tags as inert nodes; the browser only
  // executes a script element when one is freshly inserted via
  // createElement. We swap each cloned-but-inert script for a brand-
  // new element carrying the same content + attributes, which the
  // browser will execute on insertion. This unblocks extraction of
  // views whose markup historically depended on inline scripts
  // (view-draw, view-settings, view-dash, view-reports). Scripts that
  // expect DOMContentLoaded need a `document.readyState` check (see
  // pattern used in tpl-view-draw's accessory-panel bootstrap).
  view.querySelectorAll('script').forEach(oldScript => {
    const newScript = document.createElement('script');
    for (const attr of Array.from(oldScript.attributes)) {
      newScript.setAttribute(attr.name, attr.value);
    }
    newScript.text = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
  return true;
}

// Phase C.1 — eager-hydrate any .view.active (i.e. the default-active
// view-home) at module load so the first paint shows real content
// instead of an empty mount div. goTo() at boot is idempotent: when
// it later calls _hydrateViewTemplate('home') the view already has
// children and the function returns early.
(function _eagerHydrateActiveViews(){
  try {
    document.querySelectorAll('.view.active[data-view-template]').forEach(v => {
      const id = (v.id || '').replace(/^view-/, '');
      if (id) _hydrateViewTemplate(id);
    });
  } catch (e) { /* non-fatal — goTo() will hydrate later */ }
})();

// ══════════════════════════════════════════════
// DATA-ACTION CLICK DELEGATE
// ══════════════════════════════════════════════
// Phase C.4 starter — body-level click delegate for [data-action] elements.
//
// First action wired: data-action="goTo" data-target="<viewname>" replaces
// 52 inline `onclick="goTo('xxx')"` handlers in dashboard.html. Future
// actions register in the switch below.
//
// Why a delegate
//   - Each onclick="..." attribute counts against script-src 'unsafe-
//     inline' in the CSP. Once every inline handler is delegated we can
//     drop 'unsafe-inline' (Phase C.5) and tighten the CSP.
//   - One bound listener vs. 416 inline handlers = lower DOM cost on
//     re-renders and fewer string-eval'd handler bodies.
//   - data-* attributes are easier to audit, search, and refactor than
//     inline JS strings.
//
// Capture phase + .closest() so clicks on icons/spans inside the action
// element still resolve to the data-action ancestor.
// ══════════════════════════════════════════════
// DATA-ON CHANGE / INPUT DELEGATE — CSP-safe replacement for
// inline `onchange="..."` and `oninput="..."` attributes (the same
// CSP `script-src-attr 'none'` that blocks `onclick=` blocks these).
//
// Markup:
//   <input data-on-change="setFoo" data-on-pass="checked" ...>
//   <input data-on-input="setBar" data-on-pass="value" ...>
//   <select data-on-change="setBaz" data-on-pass="value" ...>
//   <input type="file" data-on-change="handleUpload" data-on-pass="files0" ...>
//
// `data-on-pass` controls what's passed as the first argument:
//   'checked' → el.checked (booleans)
//   'value'   → el.value (default)
//   'files0'  → el.files && el.files[0]
//   'int'     → parseInt(el.value, 10)
//   'float'   → parseFloat(el.value)
//   'element' → el itself (for handlers that read multiple properties)
//   'event'   → the event object (rare; for handlers expecting an event)
//
// `data-on-arg` provides a STATIC second argument (literal string).
// Function name must be on `_NBD_CALL_ALLOWLIST`.
//
// `data-on-after` (optional) names a SECOND function called immediately
// after the first — covers the inline pattern `f(this.checked); g()`.
function _nbdOnChangeDelegate(e, attrName) {
  const el = e.target && e.target.closest && e.target.closest('[' + attrName + ']');
  if (!el) return;
  const fnName = el.getAttribute(attrName);
  if (!fnName || (typeof _NBD_CALL_ALLOWLIST !== 'undefined' && !_NBD_CALL_ALLOWLIST.has(fnName))) return;
  const fn = window[fnName];
  if (typeof fn !== 'function') return;
  const pass = el.getAttribute('data-on-pass') || 'value';
  let arg;
  switch (pass) {
    case 'checked': arg = el.checked; break;
    case 'value':   arg = el.value; break;
    case 'files0':  arg = el.files && el.files[0]; break;
    case 'int':     arg = parseInt(el.value, 10); break;
    case 'float':   arg = parseFloat(el.value); break;
    case 'element': arg = el; break;
    case 'event':   arg = e; break;
    default:        arg = el.value;
  }
  const args = [arg];
  const staticArg = el.getAttribute('data-on-arg');
  if (staticArg !== null) args.push(staticArg);
  fn(...args);
  const after = el.getAttribute('data-on-after');
  if (after && (typeof _NBD_CALL_ALLOWLIST === 'undefined' || _NBD_CALL_ALLOWLIST.has(after))) {
    const afterFn = window[after];
    if (typeof afterFn === 'function') afterFn();
  }
}
document.addEventListener('change', function _nbdOnChangeHandler(e) {
  _nbdOnChangeDelegate(e, 'data-on-change');
});
document.addEventListener('input', function _nbdOnInputHandler(e) {
  _nbdOnChangeDelegate(e, 'data-on-input');
});

document.addEventListener('click', function _nbdActionDelegate(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'goTo') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof goTo === 'function') goTo(target);
    return;
  }
  // C.4 cluster 2 — compound goTo patterns. Named actions for each
  // multi-statement onclick we couldn't cover with the generic goTo
  // branch above. Each handler covers a real cluster of buttons in
  // dashboard.html so converting the markup is mechanical.
  if (action === 'newEstimate') {
    e.preventDefault();
    if (typeof goTo === 'function') goTo('est');
    if (typeof startNewEstimate === 'function') startNewEstimate();
    return;
  }
  if (action === 'filterByStage') {
    e.preventDefault();
    const stage = el.dataset.stage;
    if (typeof goTo === 'function') goTo('crm');
    // The stage-filter call is wrapped in setTimeout so the kanban
    // has time to render before we filter (matches the original
    // inline handler's 200ms delay).
    setTimeout(function(){
      if (typeof window.filterByStage === 'function') window.filterByStage(stage);
    }, 200);
    return;
  }
  if (action === 'toolMenuGoTo') {
    // Pattern: tap a CRM-tools-menu item → goTo(target) + close the
    // menu so the next view paints over a clean header.
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof goTo === 'function') goTo(target);
    if (typeof closeCrmToolsMenu === 'function') closeCrmToolsMenu();
    return;
  }
  // C.4 cluster 5 — arg-bearing toggles. Each named action wraps a
  // specific global function whose original onclick passed a string,
  // an event, or `this`. Same allowlist discipline as the no-arg
  // toggle action.
  if (action === 'navSection') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof toggleNavSection === 'function') toggleNavSection(target);
    return;
  }
  if (action === 'mapSidebar') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof toggleMapSidebar === 'function') toggleMapSidebar(target);
    return;
  }
  if (action === 'mapOverlay') {
    // Pattern: data-target="heat" → toggleOverlay('heat', el). The
    // second arg in the original inline form was `this` — the clicked
    // element — used to toggle an .active class on the button itself.
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof toggleOverlay === 'function') toggleOverlay(target, el);
    return;
  }
  if (action === 'tradeChip') {
    e.preventDefault();
    if (window.toggleTradeChip && typeof window.toggleTradeChip === 'function') {
      window.toggleTradeChip(el);
    }
    return;
  }
  if (action === 'crmToolsMenu') {
    // Original inline was toggleCrmToolsMenu(event) — the function
    // uses event.stopPropagation() so it has to receive the real
    // event object.
    e.preventDefault();
    if (typeof toggleCrmToolsMenu === 'function') toggleCrmToolsMenu(e);
    return;
  }
  // C.4 cluster 4 — no-arg toggle handlers. Pattern: tap a button →
  // calls a global toggleXxx() with no arguments. Same allowlist
  // discipline as closeModal: data-target maps to a specific function
  // name in the registry. Markup with an unknown data-target is
  // silently ignored.
  if (action === 'toggle') {
    const target = el.dataset.target;
    if (!target) return;
    const fnName = _NBD_TOGGLE_FNS[target];
    if (!fnName) return;
    e.preventDefault();
    const fn = window[fnName];
    if (typeof fn === 'function') fn();
    return;
  }
  // C.4 kanban-view cluster — Insurance/Cash/Finance/Warranty/Service/
  // Jobs/All pipeline tabs on the CRM kanban. Original inline was
  // switchKanbanView('<view>'). Note: the original markup also carries
  // data-view="..." which other code reads; we leave that intact.
  if (action === 'kanbanView') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof switchKanbanView === 'function') switchKanbanView(target);
    return;
  }
  // C.4 zone-color cluster — D2D zone color swatches. Original inline
  // was selectZoneColor(<css-var-or-hex>, this). Delegate passes the
  // string from data-target and the resolved element.
  if (action === 'zoneColor') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof selectZoneColor === 'function') selectZoneColor(target, el);
    return;
  }
  // C.4 pin-status cluster — D2D pin status buttons (not-home /
  // interested / not-interested / signed / callback / do-not-knock /
  // left-material / follow-up). Original inline was selectPin(<key>,
  // <color>, this) — both args travel through data-target / data-color.
  if (action === 'selectPin') {
    const target = el.dataset.target;
    const color = el.dataset.color;
    if (!target || !color) return;
    e.preventDefault();
    if (typeof selectPin === 'function') selectPin(target, color, el);
    return;
  }
  // C.4 line-type cluster — draw-tool color-coded line type pickers
  // (ridge / ridge vent / hip / valley / rake / eave / flashing /
  // step flash / drip edge / parapet / gutters). Original inline was
  // selLT(<index>, this) — index drives the active line type, the
  // element ref is used for the active-state toggle inside selLT.
  if (action === 'selLineType') {
    const target = el.dataset.target;
    if (target === undefined) return;
    const idx = parseInt(target, 10);
    if (Number.isNaN(idx)) return;
    e.preventDefault();
    if (typeof selLT === 'function') selLT(idx, el);
    return;
  }
  // C.4 settings-tab cluster — the Settings view header has 10 tab
  // buttons that each call switchSettingsTab(<key>). data-target carries
  // the tab key (profile/appearance/estimates/daily/company/team/
  // billing/notifications/access/help).
  if (action === 'settingsTab') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof switchSettingsTab === 'function') switchSettingsTab(target);
    return;
  }
  // C.4 docgen cluster — every Templates view row called
  // NBDDocGen.fillAndGenerate(<template>). Single delegate branch
  // reads the template name from data-target and dispatches.
  if (action === 'docgen') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (window.NBDDocGen && typeof window.NBDDocGen.fillAndGenerate === 'function') {
      window.NBDDocGen.fillAndGenerate(target);
    }
    return;
  }
  // C.4 mobile-nav cluster — bottom-nav items and the More-drawer
  // menu items both call mobileNav(target). The More-drawer entries
  // additionally call closeMobileMore() to dismiss the drawer; that
  // post-step is signalled by the presence of a data-close-more
  // attribute on the markup (its value is irrelevant, the attribute's
  // existence is the flag).
  if (action === 'mobileNav') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    if (typeof mobileNav === 'function') mobileNav(target);
    if (el.hasAttribute('data-close-more') && typeof closeMobileMore === 'function') {
      closeMobileMore();
    }
    return;
  }
  // C.4 photo-engine cluster — inline handlers in dynamically-rendered
  // photo previews, galleries, and lightboxes. Each branch corresponds
  // to a window.PhotoEngine entry point; the el.dataset values carry
  // the photo/lead identifiers the original inline calls inlined.
  if (action === 'peRemove') {
    // Generic "remove an element by id" — used by lightbox/preview
    // close buttons that don't have a registered close function (the
    // element is removed from the DOM entirely on close).
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    document.getElementById(target)?.remove();
    return;
  }
  if (action === 'peTagToggle') {
    // Self-toggle on the clicked pill — used by the Review & Tag
    // modal's QUICK_LOCATIONS / QUICK_DAMAGE / QUICK_TYPE button rows.
    e.preventDefault();
    el.classList.toggle('selected');
    return;
  }
  if (action === 'peBulkAnalyze') {
    e.preventDefault();
    const leadId = el.dataset.leadId;
    if (!leadId) return;
    if (window.PhotoEngine && typeof window.PhotoEngine._bulkAnalyze === 'function') {
      window.PhotoEngine._bulkAnalyze(leadId);
    }
    return;
  }
  if (action === 'peOpenLightbox') {
    e.preventDefault();
    const photoId = el.dataset.photoId;
    const leadId = el.dataset.leadId;
    if (!photoId || !leadId) return;
    if (window.PhotoEngine && typeof window.PhotoEngine._openLightbox === 'function') {
      window.PhotoEngine._openLightbox(photoId, leadId);
    }
    return;
  }
  if (action === 'peStagePhoto') {
    e.preventDefault();
    const photoId = el.dataset.photoId;
    const leadId = el.dataset.leadId;
    if (!photoId || !leadId) return;
    if (window.PhotoEngine && typeof window.PhotoEngine._stagePhoto === 'function') {
      window.PhotoEngine._stagePhoto(photoId, leadId);
    }
    return;
  }
  if (action === 'peDeletePhoto') {
    e.preventDefault();
    const photoId = el.dataset.photoId;
    if (!photoId) return;
    if (window.PhotoEngine && typeof window.PhotoEngine._deletePhoto === 'function') {
      window.PhotoEngine._deletePhoto(photoId);
    }
    return;
  }
  // C.4 finale — generic dispatchers that cover the long tail of
  // inline handlers. Each shape gets its own action so the markup
  // stays explicit + the allowlist limits which globals the delegate
  // can ever invoke.
  //
  // call         → window[data-fn](...args) — args from data-arg/data-arg2;
  //                pass the resolved element if data-pass-el is set.
  //                Requires data-fn to be on _NBD_CALL_ALLOWLIST.
  // module       → window[Module]?.[method](...) defensive dispatch;
  //                falls back to a toast (data-fallback-toast).
  // windowOpen   → window.open(url, '_blank', 'noopener')
  // signOut      → window._signOut()
  // reload       → window.location.reload()
  // closeOpen    → getElementById(target).classList.remove('open')
  // clickProxy   → getElementById(target).click()  (file input triggers)
  // hideEl       → getElementById(target).style.display = 'none'
  // stopProp     → event.stopPropagation() (no preventDefault)
  if (action === 'call') {
    const fnName = el.dataset.fn;
    if (!fnName || !_NBD_CALL_ALLOWLIST.has(fnName)) return;
    const fn = window[fnName];
    if (typeof fn !== 'function') return;
    e.preventDefault();
    const args = [];
    if (el.dataset.arg !== undefined) args.push(el.dataset.arg);
    if (el.dataset.arg2 !== undefined) args.push(el.dataset.arg2);
    if (el.hasAttribute('data-pass-el')) args.push(el);
    fn(...args);
    return;
  }
  if (action === 'module') {
    const target = el.dataset.target;
    if (!target || target.indexOf('.') === -1) return;
    const dot = target.indexOf('.');
    const moduleName = target.slice(0, dot);
    const method = target.slice(dot + 1);
    e.preventDefault();
    const mod = window[moduleName];
    if (mod && typeof mod[method] === 'function') {
      const args = [];
      if (el.dataset.arg !== undefined) args.push(el.dataset.arg);
      if (el.dataset.arg2 !== undefined) args.push(el.dataset.arg2);
      mod[method](...args);
    } else {
      const fallback = el.dataset.fallbackToast;
      if (fallback && typeof showToast === 'function') showToast(fallback, 'error');
    }
    return;
  }
  if (action === 'windowOpen') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    window.open(target, '_blank', 'noopener');
    return;
  }
  if (action === 'signOut') {
    e.preventDefault();
    if (typeof window._signOut === 'function') window._signOut();
    return;
  }
  if (action === 'reload') {
    e.preventDefault();
    window.location.reload();
    return;
  }
  if (action === 'closeOpen') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    document.getElementById(target)?.classList.remove('open');
    return;
  }
  if (action === 'clickProxy') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    document.getElementById(target)?.click();
    return;
  }
  if (action === 'hideEl') {
    const target = el.dataset.target;
    if (!target) return;
    e.preventDefault();
    const tgt = document.getElementById(target);
    if (tgt) tgt.style.display = 'none';
    return;
  }
  if (action === 'stopProp') {
    e.stopPropagation();
    return;
  }
  if (action === 'removeSelf') {
    e.preventDefault();
    el.remove();
    return;
  }
  if (action === 'removeParent') {
    e.preventDefault();
    el.parentElement?.remove();
    return;
  }
  if (action === 'removeClosest') {
    const sel = el.dataset.target;
    if (!sel) return;
    e.preventDefault();
    el.closest(sel)?.remove();
    return;
  }
  if (action === 'modalBackdropClose') {
    // Original onclick: if(event.target===this)closeXxxModal()
    // Click only triggers close if it landed on the backdrop itself,
    // not on a child element (the modal content). data-target carries
    // the close fn name; e.target must equal el.
    if (e.target !== el) return;
    const fnName = el.dataset.target;
    if (!fnName) return;
    e.preventDefault();
    const fn = window[fnName];
    if (typeof fn === 'function') fn();
    return;
  }
  // C.4 cluster 3 — modal-close handlers. Every modal carries its own
  // closeXxxModal function (preserves cleanup logic — clear forms,
  // unbind handlers, etc.). The delegate maps a data-target value to
  // the right close function via an explicit allowlist so the markup
  // can't accidentally invoke an unrelated global.
  if (action === 'closeModal') {
    const target = el.dataset.target;
    if (!target) return;
    const fnName = _NBD_MODAL_CLOSE_FNS[target];
    if (!fnName) return;       // not on the allowlist; ignore
    e.preventDefault();
    const fn = window[fnName];
    if (typeof fn === 'function') fn();
    return;
  }
});

// ══════════════════════════════════════════════
// CAL.COM SCHEDULING FUNCTIONS
// ══════════════════════════════════════════════
function loadCalSettings() {
  try {
    const saved = localStorage.getItem('nbd_cal_settings');
    if (saved) {
      const s = JSON.parse(saved);
      const uEl = document.getElementById('calUsername');
      const eEl = document.getElementById('calEventSlug');
      const urlEl = document.getElementById('calBookingUrl');
      if (uEl && s.username) uEl.value = s.username;
      if (eEl && s.eventSlug) eEl.value = s.eventSlug;
      if (urlEl && s.username && s.eventSlug) {
        urlEl.value = 'https://cal.com/' + s.username + '/' + s.eventSlug;
      }
      updateCalEmbed();
    }
  } catch (e) { /* first load, no settings yet */ }
}

function saveCalSettings() {
  const username = (document.getElementById('calUsername')?.value || '').trim();
  const eventSlug = (document.getElementById('calEventSlug')?.value || '').trim();
  if (!username) { showToast('Enter your Cal.com username', 'error'); return; }
  if (!eventSlug) { showToast('Enter your event type slug', 'error'); return; }
  const settings = { username, eventSlug };
  localStorage.setItem('nbd_cal_settings', JSON.stringify(settings));
  const urlEl = document.getElementById('calBookingUrl');
  if (urlEl) urlEl.value = 'https://cal.com/' + username + '/' + eventSlug;
  updateCalEmbed();
  showToast('Cal.com settings saved');
}

function updateCalEmbed() {
  const username = (document.getElementById('calUsername')?.value || '').trim();
  const eventSlug = (document.getElementById('calEventSlug')?.value || '').trim();
  const embed = document.getElementById('calEmbed');
  const placeholder = document.getElementById('calPlaceholder');
  if (!username || !eventSlug) {
    if (embed) embed.innerHTML = '';
    if (placeholder) placeholder.style.display = '';
    return;
  }
  if (placeholder) placeholder.style.display = 'none';
  if (embed) {
    const src = 'https://cal.com/' + username + '/' + eventSlug + '?embed=true&theme=dark';
    embed.innerHTML = '<iframe src="' + src + '" style="width:100%;min-height:500px;border:none;border-radius:0 0 10px 10px;" loading="lazy"></iframe>';
  }
  const urlEl = document.getElementById('calBookingUrl');
  if (urlEl) urlEl.value = 'https://cal.com/' + username + '/' + eventSlug;
}

function copyCalLink() {
  const urlEl = document.getElementById('calBookingUrl');
  if (!urlEl) return;
  navigator.clipboard.writeText(urlEl.value).then(() => showToast('Booking link copied!')).catch(() => {
    urlEl.select(); document.execCommand('copy'); showToast('Booking link copied!');
  });
}

function shareCalViaSMS() {
  const url = document.getElementById('calBookingUrl')?.value || '';
  if (!url) { showToast('Set up your booking link first', 'error'); return; }
  const msg = encodeURIComponent('Schedule your free roof inspection here: ' + url);
  window.open('sms:?body=' + msg);
}

function shareCalViaEmail() {
  const url = document.getElementById('calBookingUrl')?.value || '';
  if (!url) { showToast('Set up your booking link first', 'error'); return; }
  const subject = encodeURIComponent('Schedule Your Free Roof Inspection');
  const body = encodeURIComponent('Hi,\n\nYou can schedule your free roof inspection at a time that works for you:\n\n' + url + '\n\nLooking forward to helping you!\n\n- No Big Deal Exteriors');
  window.open('mailto:?subject=' + subject + '&body=' + body);
}

// ══════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════
function showToast(msg, type='success') {
  toastQueue.push({ msg, type });
  if (!toastActive) processToastQueue();
}

function processToastQueue() {
  if (!toastQueue.length) {
    toastActive = false;
    return;
  }

  toastActive = true;
  const { msg, type } = toastQueue.shift();

  const t = document.getElementById('toast');
  if (!t) {
    // Create toast if doesn't exist
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  const toast = document.getElementById('toast');
  toast.innerHTML = `
    <div style="flex:1;">${msg}</div>
    <div class="toast-progress"></div>
  `;
  toast.className = 'toast show '+(type==='error'?'error':'success');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => processToastQueue(), 200);
  }, 2800);
}

// ══════════════════════════════════════════════
// DAMAGE PHOTOS — modal close + photo mode toggle
// ══════════════════════════════════════════════
function closePhotoModal(){document.getElementById('photoModal').classList.remove('open');}
document.getElementById('photoModal').addEventListener('click',e=>{if(e.target===document.getElementById('photoModal'))closePhotoModal();});

// Photo search — filters the photo leads list by name/address
function filterPhotoLeads(query) {
  window._photoSearchQuery = (query || '').toLowerCase().trim();
  renderPhotoLeads();
}

function setPhotoMode(mode) {
  if (mode !== 'recent' && mode !== 'by-property') return;
  window._photoMode = mode;
  const byProp = document.getElementById('photoGalleryContainer');
  const recent = document.getElementById('photoRecentFeed');
  document.querySelectorAll('.ph-mode-btn').forEach(b => {
    const on = b.dataset.phMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (mode === 'recent') {
    if (byProp) byProp.style.display = 'none';
    if (recent) recent.style.display = 'block';
    renderRecentPhotoFeed();
  } else {
    if (recent) recent.style.display = 'none';
    if (byProp) byProp.style.display = '';
  }
}
window.setPhotoMode = setPhotoMode;

// ══════════════════════════════════════════════
// TIPS modal
// ══════════════════════════════════════════════
function openTips(){document.getElementById('tipsModal').classList.add('open');}
function closeTips(){document.getElementById('tipsModal').classList.remove('open');}
document.getElementById('tipsModal').addEventListener('click',e=>{if(e.target===document.getElementById('tipsModal'))closeTips();});

// ══════════════════════════════════════════════
// PROPERTY INTEL — modal open/close + cost UI
// ══════════════════════════════════════════════
// ── Pull intel inside lead modal ──────────────────────────────
// PROPERTY INTEL SELECTIVE PULL SYSTEM
async function pullIntelForModal() {
  const addr = document.getElementById('lAddr')?.value?.trim();
  if(!addr) { showToast('Enter an address first','error'); return; }

  // Store address for later use
  window._pendingIntelAddress = addr;

  // Reset selections
  document.getElementById('piOwnerContact').checked = false;
  document.getElementById('piPropertyDetails').checked = false;
  document.getElementById('piZestimate').checked = false;
  document.getElementById('piTaxData').checked = false;
  updatePropertyIntelCost();

  // Show selection modal
  document.getElementById('propertyIntelModal').style.display = 'flex';
}

function closePropertyIntelModal() {
  document.getElementById('propertyIntelModal').style.display = 'none';
}

function closePropertyIntelConfirmModal() {
  document.getElementById('propertyIntelConfirmModal').style.display = 'none';
}

function updatePropertyIntelCost() {
  const prices = {
    piOwnerContact: 0.30,
    piPropertyDetails: 0.15,
    piZestimate: 0.05,
    piTaxData: 0.10
  };

  let total = 0;
  for (const [id, price] of Object.entries(prices)) {
    if (document.getElementById(id)?.checked) {
      total += price;
    }
  }

  document.getElementById('piTotalCost').textContent = '$' + total.toFixed(2);

  // Disable pull button if nothing selected
  const btn = document.getElementById('piPullBtn');
  if (total === 0) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

function confirmPropertyIntelPull() {
  const selections = {
    'Owner Name & Contact': document.getElementById('piOwnerContact').checked,
    'Property Details': document.getElementById('piPropertyDetails').checked,
    'Zillow Zestimate': document.getElementById('piZestimate').checked,
    'Tax Assessor Data': document.getElementById('piTaxData').checked
  };

  const selected = Object.entries(selections).filter(([_, checked]) => checked).map(([name, _]) => name);

  if (selected.length === 0) {
    showToast('Select at least one data source', 'error');
    return;
  }

  // Calculate cost
  const prices = { 'Owner Name & Contact': 0.30, 'Property Details': 0.15, 'Zillow Zestimate': 0.05, 'Tax Assessor Data': 0.10 };
  const cost = selected.reduce((sum, name) => sum + prices[name], 0);

  // Update confirmation modal
  document.getElementById('piConfirmCost').textContent = '$' + cost.toFixed(2);
  const listEl = document.getElementById('piConfirmList');
  listEl.innerHTML = selected.map(name => `<li>${name}</li>`).join('');

  // Hide selection modal, show confirmation
  document.getElementById('propertyIntelModal').style.display = 'none';
  document.getElementById('propertyIntelConfirmModal').style.display = 'flex';
}

async function executePullPropertyIntel() {
  const confirmBtn = document.getElementById('piConfirmBtn');
  const originalText = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.textContent = '⏳ Pulling...';

  try {
    const addr = window._pendingIntelAddress;
    if (!addr) throw new Error('No address found');

    // Get selections
    const selections = {
      ownerContact: document.getElementById('piOwnerContact').checked,
      propertyDetails: document.getElementById('piPropertyDetails').checked,
      zestimate: document.getElementById('piZestimate').checked,
      taxData: document.getElementById('piTaxData').checked
    };

    // Calculate actual cost
    const prices = { ownerContact: 0.30, propertyDetails: 0.15, zestimate: 0.05, taxData: 0.10 };
    const cost = Object.entries(selections)
      .filter(([_, checked]) => checked)
      .reduce((sum, [key, _]) => sum + prices[key], 0);

    // Geocode address first
    const geo = await geocode(addr);
    if (!geo) throw new Error('Could not geocode address');

    // Per-source metering not yet wired — see js/property-intel.js for
    // the same note. Single aggregate pull until paid sources land.
    await fetchPropertyIntelModal(geo, addr);

    // Close modals
    closePropertyIntelConfirmModal();

    // Show success with cost
    const selectedCount = Object.values(selections).filter(Boolean).length;
    showToast(`✓ Pulled ${selectedCount} data point${selectedCount > 1 ? 's' : ''} for $${cost.toFixed(2)}`, 'success');

  } catch (error) {
    console.error('Property intel pull error:', error);
    showToast('Failed to pull property data: ' + error.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalText;
  }
}

// ══════════════════════════════════════════════
// ADDRESS AUTOCOMPLETE — UI wiring
// ══════════════════════════════════════════════
function initAddressAutocomplete(inputId, onSelect) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById('ac-' + inputId);
  if(!input || !drop) return;

  input.addEventListener('input', () => {
    clearTimeout(_acTimers[inputId]);
    const q = input.value.trim();
    if(q.length < 3) { drop.style.display='none'; return; }
    _acTimers[inputId] = setTimeout(() => fetchAcSuggestions(inputId, q, onSelect), 320);
  });

  input.addEventListener('keydown', e => {
    if(drop.style.display==='none') return;
    const items = drop.querySelectorAll('.ac-item');
    let active = drop.querySelector('.ac-active');
    if(e.key==='ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      if(next) { active?.classList.remove('ac-active'); next.classList.add('ac-active'); input.value=next.dataset.label; }
    } else if(e.key==='ArrowUp') {
      e.preventDefault();
      const prev = active?.previousElementSibling;
      if(prev) { active.classList.remove('ac-active'); prev.classList.add('ac-active'); input.value=prev.dataset.label; }
    } else if(e.key==='Enter') {
      if(active) { e.preventDefault(); active.click(); }
    } else if(e.key==='Escape') {
      drop.style.display='none';
    }
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if(!input.contains(e.target) && !drop.contains(e.target)) drop.style.display='none';
  }, {capture:false});
}

function renderAcDrop(inputId, results, onSelect) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById('ac-' + inputId);
  if(!drop) return;

  if(!results.length) { drop.style.display='none'; return; }

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  drop.innerHTML = results.map((r,i) => {
    // Wave 141: render the proper USPS mailing address as the
    // primary line. Sub-line shows county (where applicable) — the
    // disambiguator the rep cares about when two streets share the
    // same name in different towns. Fallback to display_name slice
    // for offline / non-US edge cases.
    const formatted = (typeof formatMailingAddress === 'function')
      ? formatMailingAddress(r) : '';
    const main = formatted || String(r.display_name || '').split(',').slice(0,2).join(',').trim();
    const a = r.address || {};
    const sub = a.county ? a.county : String(r.display_name || '').split(',').slice(2,4).join(',').trim();
    return `<div class="ac-item nbd-ac-item" data-label="${esc(main)}" data-idx="${i}"><b>${esc(main)}</b>${sub ? `<br><span style="color:var(--m);font-size:10px;">${esc(sub)}</span>` : ''}</div>`;
  }).join('');
  drop.querySelectorAll('.nbd-ac-item').forEach(el => {
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectAcItem(inputId, Number(el.dataset.idx));
    });
  });
  drop.style.display = 'block';
  drop._results = results;

  // Store results for selection
  if(!window._acResults) window._acResults = {};
  window._acResults[inputId] = results;
}

function _abbreviateRoadSuffix(road) {
  const s = String(road || '').trim();
  if (!s) return '';
  // Tokenize on whitespace; abbreviate only the LAST token if it
  // matches a known suffix. "Klondyke Road" → "Klondyke Rd";
  // "St James Court" → "St James Ct" (first "St" untouched, last
  // "Court" → "Ct"). Doesn't touch directional suffixes (N/S/E/W).
  const tokens = s.split(/\s+/);
  if (tokens.length < 2) return s;
  const last = tokens[tokens.length - 1].toLowerCase().replace(/[.,]/g, '');
  if (_USPS_SUFFIX[last]) {
    tokens[tokens.length - 1] = _USPS_SUFFIX[last];
  }
  return tokens.join(' ');
}

function _state2letter(state, addrObj) {
  // Prefer Nominatim's ISO3166-2-lvl4 field (e.g. "US-OH") if present —
  // it's always 2 chars and never ambiguous.
  const iso = addrObj && addrObj['ISO3166-2-lvl4'];
  if (typeof iso === 'string' && /^US-[A-Z]{2}$/.test(iso)) {
    return iso.slice(3);
  }
  const s = String(state || '').trim().toLowerCase();
  if (_STATE_2L[s]) return _STATE_2L[s];
  // If it's already 2 chars, accept it (some Nominatim responses
  // already return abbreviated state).
  if (/^[A-Z]{2}$/.test(state)) return state;
  return state || '';
}

/**
 * Wave 141: format a Nominatim search result into a USPS-compliant
 * single-line mailing address.
 *
 *   formatMailingAddress({ display_name, address: { house_number,
 *     road, city, town, village, state, "ISO3166-2-lvl4", postcode } })
 *   → "1054 Klondyke Rd, Goshen, OH 45122"
 *
 * Falls back to a tidied display_name slice when structured fields
 * are missing (offline / non-US results / nominatim variants).
 */
function formatMailingAddress(r) {
  if (!r) return '';
  const a = r.address || {};
  const houseNum = a.house_number || '';
  const road = _abbreviateRoadSuffix(a.road || a.street || a.pedestrian || a.path || '');
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || '';
  const stateCode = _state2letter(a.state, a);
  const zip = a.postcode || '';

  const street = [houseNum, road].filter(Boolean).join(' ').trim();
  const cityState = [
    city,
    [stateCode, zip].filter(Boolean).join(' ').trim(),
  ].filter(Boolean).join(', ').trim();

  if (street && cityState) return street + ', ' + cityState;
  if (street) return street;
  if (cityState) return cityState;

  // Last-resort fallback: clean up display_name. Strip ", United
  // States" and the county field (which Nominatim usually places
  // between city and state).
  let dn = String(r.display_name || '').trim();
  dn = dn.replace(/,\s*United States\s*$/i, '');
  // Drop any "X County" segment.
  dn = dn.replace(/,\s*[A-Z][a-z]+ County\s*,/g, ',');
  // Collapse multi-comma sequences.
  dn = dn.replace(/\s*,\s*,\s*/g, ', ').trim();
  return dn;
}
window.formatMailingAddress = formatMailingAddress;

function selectAcItem(inputId, idx) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById('ac-' + inputId);
  const results = window._acResults?.[inputId] || [];
  const r = results[idx];
  if(!r || !input) return;

  // Wave 141: produce a proper USPS-style mailing address using the
  // structured nominatim addressdetails — house_number + road
  // (suffix-abbreviated) + city + 2-letter state + ZIP. Replaces the
  // old `display_name.split(',').slice(0,3)` which produced
  // "1054, Klondyke Road, Goshen" (wrong on every count: comma
  // after house number, full road name instead of "Rd", missing
  // ZIP, state spelled out, county included).
  const label = formatMailingAddress(r) || r.display_name || '';
  input.value = label;
  drop.style.display = 'none';

  // Run the onSelect callback if provided
  const cb = window._acCallbacks?.[inputId];
  if(cb) cb(r, label);
}

function hideAcDrop(inputId) {
  const drop = document.getElementById('ac-' + inputId);
  if(drop) drop.style.display = 'none';
}

function initAllAutocomplete() {
  if(!window._acCallbacks) window._acCallbacks = {};

  // mapSearch — on select, trigger full map search.
  // propCard/propCardInner live inside tpl-view-map; only present in
  // the DOM once #/map is hydrated. Guard so any pre-hydration call
  // (autocomplete fires before user navigates) doesn't null-deref.
  window._acCallbacks['mapSearch'] = (r, label) => {
    window._lastMapSearch = r;
    if(mainMap) mainMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 19);
    const propCard = document.getElementById('propCard');
    const propCardInner = document.getElementById('propCardInner');
    if (propCard && propCardInner) {
      propCard.style.display = 'block';
      propCardInner.innerHTML = `
        <div class="pi-card">
          <div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county"></span></div>
          <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
        </div>
        <button class="make-lead-btn" data-du-action="makeLeadFromSearch">＋ Make This a Lead</button>`;
      fetchPropertyIntel(r, 'propCardInner');
    }
  };

  // pinAddrInput — just fill, no side effect
  window._acCallbacks['pinAddrInput'] = null;

  // drawSearch — on select, move draw map
  window._acCallbacks['drawSearch'] = (r) => {
    if(drawMap) drawMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 19);
  };

  // estAddr — just fill
  window._acCallbacks['estAddr'] = null;

  // lAddr — just fill
  window._acCallbacks['lAddr'] = null;

  initAddressAutocomplete('mapSearch');
  initAddressAutocomplete('pinAddrInput');
  initAddressAutocomplete('drawSearch');
  initAddressAutocomplete('estAddr');
  initAddressAutocomplete('qaAddr');
  initAddressAutocomplete('lAddr');
}

// Boot autocomplete after DOM ready
if(document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded', initAllAutocomplete);
} else {
  initAllAutocomplete();
}

// HAV + MID — moved to docs/pro/js/maps.js (hoisted at top of file, also exposed on window)
// Canonical definitions now live there; this dashboard.html copy was deleted to prevent drift.

// ══════════════════════════════════════════════
// DOCUMENT LIBRARY — templates + UI
// ══════════════════════════════════════════════
const DOC_TEMPLATES = {
  contract: {
    title: 'Roofing Contract',
    content: `<h2>ROOFING CONTRACT</h2>
<p><strong>Contractor:</strong> No Big Deal Home Solutions · <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> · (859) 420-7382</p>
<p><strong>Homeowner:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Property Address:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Scope of Work:</strong> Complete roof replacement including tear-off, decking inspection, synthetic underlayment, architectural shingles (GAF Timberline series), ridge cap, flashing, pipe boots, drip edge, and full cleanup.</p>
<p><strong>Materials:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Color: <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Contract Price:</strong> $<span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Start Date:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>NBD Guarantee:</strong> NBD Lifetime Pledge on every install — Standard (NBD backed, no expiration), Preferred (Lifetime + transferable to one owner + 48hr callback), Elite (Lifetime + fully transferable + annual inspection + signed certificate). GAF Timberline shingle manufacturer lifetime warranty included on all installs.</p>
<p><strong>Payment Terms:</strong> 50% due at material delivery. Balance due upon completion.</p>
<p>By signing below, homeowner authorizes No Big Deal Home Solutions to perform the above work.</p>
<p><strong>Homeowner Signature:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Date: <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Contractor Signature:</strong> Joe Deal <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Date: <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>`
  },
  warranty: {
    title: 'NBD Warranty Certificate',
    content: `<div style="text-align:center;padding:20px 0 10px;">
<div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;">No Big <span style="color:var(--orange);">Deal</span> Home Solutions</div>
<div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--orange);padding:3px 12px;border-radius:2px;display:inline-block;margin:6px 0;">Insurance Restoration Specialists · Greater Cincinnati</div>
</div>
<div style="text-align:center;padding:24px 0 16px;border-top:3px solid var(--orange);border-bottom:1px solid #eee;margin-bottom:24px;">
<div style="font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#999;margin-bottom:6px;">Certificate of Guarantee</div>
<div style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#111;">NBD Labor Guarantee</div>
</div>
<p>This certificate confirms that the installation performed by <strong>No Big Deal Home Solutions</strong> at the property listed below is covered by the NBD Labor Guarantee as described herein.</p>
<h2>Property &amp; Installation</h2>
<div class="doc-row-2">
  <div class="doc-field-row"><span class="doc-field-label">Property Address</span><span class="doc-field-line"></span></div>
  <div class="doc-field-row"><span class="doc-field-label">Homeowner</span><span class="doc-field-line"></span></div>
  <div class="doc-field-row"><span class="doc-field-label">Installation Date</span><span class="doc-field-line short"></span></div>
  <div class="doc-field-row"><span class="doc-field-label">Guarantee Tier</span><span class="doc-field-line short"></span></div>
</div>
<h2>Guarantee Terms</h2>
<div class="doc-check-grid">
  <div class="doc-check-item"><span class="doc-checkbox"></span>Standard — NBD Lifetime Pledge</div>
  <div class="doc-check-item"><span class="doc-checkbox"></span>Preferred — 10-Year Labor Guarantee (transferable to 1 owner)</div>
  <div class="doc-check-item"><span class="doc-checkbox"></span>Elite — NBD Lifetime Pledge (fully transferable)</div>
</div>
<p style="font-size:12px;color:#555;margin-top:12px;line-height:1.7;">No Big Deal Home Solutions guarantees all labor performed under this installation against defects in workmanship for the lifetime of the installation, beginning on the installation date. This guarantee covers labor costs to repair or correct any installation defect at no charge to the homeowner. It does not cover damage caused by acts of nature, improper maintenance, or alterations made by others. Manufacturer shingle warranty is separate and provided by GAF directly.</p>
<h2>Transferability</h2>
<p style="font-size:12px;color:#555;line-height:1.7;">Preferred and Elite guarantees are transferable as noted above. To transfer, notify No Big Deal Home Solutions in writing within 30 days of property sale. A transfer fee of $0 applies. New owner receives the remaining guarantee term in writing.</p>
<div class="doc-sig-block">
  <div class="doc-sig-row">
    <div class="doc-sig-field"><div class="doc-field-line"></div><div class="doc-sig-label">Homeowner Signature &amp; Date</div></div>
    <div class="doc-sig-field"><div class="doc-field-line"></div><div class="doc-sig-label">Joe Deal — No Big Deal Home Solutions</div></div>
  </div>
  <div style="text-align:center;font-size:10px;color:#aaa;margin-top:16px;">Certificate #: NBD-<span class="doc-field-line short" style="display:inline-block;width:80px;"></span> · Keep this document with your home records</div>
</div>`
  },
  supplement: {
    title: 'Supplement Request',
    content: `<h2>INSURANCE SUPPLEMENT REQUEST</h2>
<p><strong>Contractor:</strong> No Big Deal Home Solutions | License # ________ | (859) 420-7382</p>
<p><strong>Claim #:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Policy #:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Insured:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Property:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Carrier:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Adjuster:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Supplement Items:</strong></p>
<p>1. Pipe boots (replace all) — $______ ea × ______ = $______</p>
<p>2. Drip edge (not included in initial estimate) — ______ LF @ $______ = $______</p>
<p>3. Ice & water shield (valleys) — ______ SQ @ $______ = $______</p>
<p>4. Decking replacement (damaged boards) — ______ SF @ $______ = $______</p>
<p>5. Ridge vent — ______ LF @ $______ = $______</p>
<p>6. Permit fee — $______</p>
<p>7. Dumpster/haul-away — $______</p>
<p><strong>Total Supplement:</strong> $______</p>
<p>Supporting documentation and photos attached.</p>`
  },
  scope: {
    title: 'Scope of Work',
    content: `<h2>SCOPE OF WORK</h2>
<p><strong>Property:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>ROOF REPLACEMENT — Full scope includes:</strong></p>
<p>☐ Complete tear-off of existing roofing material down to deck</p>
<p>☐ Inspect roof deck — replace damaged/rotted sections as needed</p>
<p>☐ Install synthetic underlayment (30 lb equivalent)</p>
<p>☐ Install ice & water shield in valleys and eave edges</p>
<p>☐ Install new drip edge (color to match)</p>
<p>☐ Install starter strip at eaves and rakes</p>
<p>☐ Install architectural shingles — Brand: ______ Color: ______</p>
<p>☐ Install hip and ridge cap shingles</p>
<p>☐ Replace all pipe boots and collars</p>
<p>☐ Re-flash chimney / skylights / walls as needed</p>
<p>☐ Install ridge vent (if applicable)</p>
<p>☐ Full cleanup — magnetic nail sweep, debris haul-away</p>
<p>☐ Final inspection with homeowner walk-through</p>
<p><strong>Measurements:</strong> ______ squares | Pitch: ______ | Estimated start: ______</p>`
  },
  authorization: {
    title: 'Work Authorization',
    content: `<h2>WORK AUTHORIZATION FORM</h2>
<p>I, <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>, owner of the property located at:</p>
<p><span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p>hereby authorize <strong>No Big Deal Home Solutions</strong> to perform the following work:</p>
<p><span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p>I authorize No Big Deal Home Solutions to negotiate with my insurance company on my behalf and to receive payment directly from the insurance carrier for covered work.</p>
<p><strong>Homeowner Signature:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Date:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Phone:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>`
  },
  inspection: {
    title: 'Inspection Checklist',
    content: `<h2>ROOF & EXTERIOR INSPECTION CHECKLIST</h2>
<p><strong>Property:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Date: <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>ROOF:</strong></p>
<p>☐ Hail damage to shingles &nbsp; ☐ Wind damage / missing shingles &nbsp; ☐ Granule loss</p>
<p>☐ Ridge cap damage &nbsp; ☐ Hip cap damage &nbsp; ☐ Valley damage</p>
<p>☐ Flashing damage &nbsp; ☐ Pipe boot damage &nbsp; ☐ Skylights &nbsp; ☐ Chimney flashing</p>
<p>☐ Drip edge bent/damaged &nbsp; ☐ Fascia damage &nbsp; ☐ Soffit damage</p>
<p><strong>SIDING:</strong></p>
<p>☐ Hail spatter/cracks &nbsp; ☐ Dents (vinyl) &nbsp; ☐ Holes / punctures &nbsp; ☐ Missing panels</p>
<p><strong>GUTTERS:</strong></p>
<p>☐ Hail dents &nbsp; ☐ Bent sections &nbsp; ☐ Downspout damage &nbsp; ☐ Pulled away from fascia</p>
<p><strong>SOFT METALS (AC unit, window trim, mailbox, etc.):</strong></p>
<p>☐ AC condenser top &nbsp; ☐ Window trim/capping &nbsp; ☐ Door trim &nbsp; ☐ Other: ______</p>
<p><strong>Estimated Damage:</strong> ☐ Roof ☐ Siding ☐ Gutters ☐ Full Exterior</p>
<p><strong>Claim Recommended:</strong> ☐ Yes &nbsp; ☐ No — Below deductible &nbsp; ☐ Repair only</p>
<p><strong>Inspector:</strong> Joe Deal &nbsp;&nbsp; <strong>Signature:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>`
  },
  completion: {
    title: 'Certificate of Completion',
    content: `<h2>CERTIFICATE OF COMPLETION</h2>
<p>This certifies that <strong>No Big Deal Home Solutions</strong> has completed the following work:</p>
<p><strong>Property:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Work Completed:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Completion Date:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> &nbsp;&nbsp; <strong>Invoice #:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Total Contract Amount:</strong> $<span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Warranty:</strong> NBD NBD Lifetime Pledge — effective date of installation. <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p>All work has been completed per the agreed scope of work and to the homeowner's satisfaction.</p>
<p><strong>Homeowner Signature:</strong> <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Date: <span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
<p><strong>Contractor:</strong> Joe Deal — No Big Deal Home Solutions — (859) 420-7382</p>`
  }
};

// ═══ TEMPLATE LIBRARY — toggle / filter ═══
function tlToggleCat(headerEl){
  const cat = headerEl.closest('.tl-category');
  if(cat) cat.classList.toggle('tl-collapsed');
}
function tlFilterCat(catKey, btnEl){
  // Update active button
  document.querySelectorAll('.tl-filter-btn').forEach(b=>b.classList.remove('tl-filter-active'));
  if(btnEl) btnEl.classList.add('tl-filter-active');
  // Show/hide categories
  document.querySelectorAll('.tl-category').forEach(c=>{
    if(catKey==='all'){
      c.style.display='';
      c.classList.remove('tl-collapsed');
    } else {
      if(c.dataset.cat===catKey){
        c.style.display='';
        c.classList.remove('tl-collapsed');
      } else {
        c.style.display='none';
      }
    }
  });
}

function openDocTemplate(key){
  const t = DOC_TEMPLATES[key];
  if(!t) return;
  document.getElementById('docViewerTitle').textContent = t.title;
  document.getElementById('docViewerContent').innerHTML = t.content;
  document.getElementById('docViewerModal').classList.add('open');
}
function closeDocViewer(){ document.getElementById('docViewerModal').classList.remove('open'); }
function printDoc(){ window.print(); }
function openUploadDoc(){
  // docUploadArea lives inside tpl-view-docs (lazy-hydrated). Guard
  // for routes that haven't visited #/docs yet.
  const el = document.getElementById('docUploadArea');
  if (el) el.style.display = 'block';
}

// ── Inject "Blank" buttons on every template row ──
// Runs once after DOM is ready. Each .tl-doc-row that calls
// NBDDocGen.fillAndGenerate('type') gets a small "Blank" button
// inserted before the arrow. Clicking it calls generateBlank()
// instead, producing a printable empty copy.
(function injectBlankButtons() {
  document.querySelectorAll('.tl-doc-row').forEach(function(row) {
    var onclick = row.getAttribute('onclick') || '';
    var match = onclick.match(/fillAndGenerate\(['"]([^'"]+)['"]\)/);
    if (!match) return;
    var type = match[1];
    var btn = document.createElement('button');
    btn.textContent = 'Blank';
    btn.title = 'Print a blank copy to fill by hand';
    btn.style.cssText = 'background:var(--s2);border:1px solid var(--br);color:var(--m);padding:4px 10px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s;';
    btn.addEventListener('mouseenter', function() { btn.style.borderColor = 'var(--orange)'; btn.style.color = 'var(--orange)'; });
    btn.addEventListener('mouseleave', function() { btn.style.borderColor = 'var(--br)'; btn.style.color = 'var(--m)'; });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (window.NBDDocGen && typeof window.NBDDocGen.generateBlank === 'function') {
        window.NBDDocGen.generateBlank(type);
      } else {
        if (typeof showToast === 'function') showToast('Doc generator not loaded', 'error');
      }
    });
    // Insert before the arrow
    var arrow = row.querySelector('.tl-doc-arrow');
    if (arrow) row.insertBefore(btn, arrow);
    else row.appendChild(btn);
  });
})();
function closeUploadDoc(){
  const el = document.getElementById('docUploadArea');
  if (el) el.style.display = 'none';
}
function handleDocUpload(inp){ _docFile = inp.files[0]; showToast('File selected: '+(_docFile?.name||''),'ok'); }

// ══════════════════════════════════════════════
// THEME SYSTEM — apply/load + auto-theme
// ══════════════════════════════════════════════
function applyTheme(key, save=true) {
  // Delegate to ThemeEngine if loaded (supports 155 themes with overlays, sounds, etc.)
  if(window.ThemeEngine) {
    window.ThemeEngine.apply(key, save);
    // Also update legacy UI elements
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('active', c.dataset.key === key);
    });
    window._currentTheme = key;
    return;
  }
  // Legacy fallback for themes defined in CSS
  if(!THEME_KEYS.includes(key)) key = DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', key);
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === key);
  });
  try { localStorage.setItem('nbd-theme', key); } catch(e){}
  if(save && window._user && window._db) {
    try {
      const { doc, setDoc } = window._firestoreOps || {};
      if(setDoc) setDoc(doc(window._db,'userSettings',window._user.uid), {theme:key}, {merge:true}).catch(()=>{});
    } catch(e){}
  }
  window._currentTheme = key;
}

function loadSavedTheme() {
  // Try localStorage first (instant)
  let saved = null;
  try { saved = localStorage.getItem('nbd-theme'); } catch(e){}
  if(saved && THEME_KEYS.includes(saved)) { applyTheme(saved, false); return; }
  // Fallback to Firebase pref (async)
  applyTheme(DEFAULT_THEME, false);
}

// ── KANBAN DENSITY + HIERARCHY ─────────────────────────────────────────────
function setKanbanDensity(d) {
  if (!['compact', 'comfortable', 'spacious'].includes(d)) d = 'comfortable';
  // 'comfortable' is the CSS default; clear the attribute so we don't carry stale values.
  if (d === 'comfortable') document.documentElement.removeAttribute('data-density');
  else document.documentElement.setAttribute('data-density', d);
  try { localStorage.setItem(KANBAN_DENSITY_KEY, d); } catch (e) {}
  // Reflect active state in the picker buttons.
  document.querySelectorAll('.kdens-btn').forEach(b => {
    const active = b.dataset.density === d;
    b.style.background = active ? 'var(--orange)' : 'var(--s)';
    b.style.color = active ? '#fff' : 'var(--m)';
    b.style.borderColor = active ? 'var(--orange)' : 'var(--br)';
  });
}

// Sweep R3 (C): one-tap cycle invoked by the kanban-header
// density toggle. Reads the current value from localStorage so the
// cycle starts from wherever the user left off, even if the
// data-density attribute got cleared (Comfortable = no attribute).
// Updates the button tooltip + label so the rep sees current state.
function cycleKanbanDensity() {
  const order = ['compact', 'comfortable', 'spacious'];
  let cur = 'comfortable';
  try { cur = localStorage.getItem(KANBAN_DENSITY_KEY) || 'comfortable'; } catch (_) {}
  if (!order.includes(cur)) cur = 'comfortable';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setKanbanDensity(next);
  // Toast so the rep gets feedback without staring at the button.
  if (typeof showToast === 'function') {
    const labelMap = { compact: '📏 Compact', comfortable: '📐 Comfortable', spacious: '📊 Spacious' };
    showToast(labelMap[next] + ' card density', 'info');
  }
  // Update the toolbar button's title attr so hover hint stays current.
  const btn = document.getElementById('kanbanDensityToggleBtn');
  if (btn) {
    const titleMap = {
      compact: 'Card density: Compact — click for Comfortable',
      comfortable: 'Card density: Comfortable — click for Spacious',
      spacious: 'Card density: Spacious — click for Compact'
    };
    btn.title = titleMap[next];
  }
}
window.cycleKanbanDensity = cycleKanbanDensity;

function setKanbanBoldHierarchy(on) {
  if (on) document.documentElement.setAttribute('data-bold', 'true');
  else document.documentElement.removeAttribute('data-bold');
  try { localStorage.setItem(KANBAN_BOLD_KEY, on ? '1' : '0'); } catch (e) {}
}

// Wire up the settings panel state when it opens.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const d = localStorage.getItem(KANBAN_DENSITY_KEY) || 'comfortable';
    setKanbanDensity(d);
    const bold = localStorage.getItem(KANBAN_BOLD_KEY) === '1';
    const t = document.getElementById('kanbanBoldToggle');
    if (t) t.checked = bold;
    // Sync auto-collapse toggle from localStorage (default off).
    const ac = localStorage.getItem('nbd-crm-autocollapse') === '1';
    const acT = document.getElementById('crmAutoCollapseToggle');
    if (acT) acT.checked = ac;
  }, 200);
});
window.setKanbanDensity = setKanbanDensity;
window.setKanbanBoldHierarchy = setKanbanBoldHierarchy;

// ══════════════════════════════════════════════════════════════════
// Wave 101: Comfort tab handlers — quick-access density / text size /
// motion / professional-mode controls in the 🎨 picker. Each setting
// persists to localStorage and applies to <html>/<body> attributes
// that CSS reads to drive the actual look.
// ══════════════════════════════════════════════════════════════════
function nbdComfortSet(kind, value) {
  const html = document.documentElement;
  const body = document.body;
  try {
    if (kind === 'density') {
      // Reuse the existing setKanbanDensity machinery so the deep-
      // settings density toggle stays in sync.
      if (typeof setKanbanDensity === 'function') setKanbanDensity(value);
    } else if (kind === 'size') {
      // 'medium' is the default — clear the attribute so we don't
      // carry stale values through theme changes.
      if (value === 'medium') html.removeAttribute('data-text-size');
      else html.setAttribute('data-text-size', value);
      try { localStorage.setItem('nbd_text_size', value); } catch (_) {}
    } else if (kind === 'motion') {
      if (value === 'reduce') html.setAttribute('data-motion', 'reduce');
      else html.removeAttribute('data-motion');
      try {
        if (value === 'reduce') localStorage.setItem('nbd_motion', 'reduce');
        else localStorage.removeItem('nbd_motion');
      } catch (_) {}
    } else if (kind === 'proMode') {
      if (value === '1') body.classList.add('professional-mode');
      else body.classList.remove('professional-mode');
      try {
        if (value === '1') localStorage.setItem('nbd_professional_mode', '1');
        else localStorage.removeItem('nbd_professional_mode');
      } catch (_) {}
    } else if (kind === 'cbSafe') {
      // W106: color-blind-safe palette
      if (value === '1') html.setAttribute('data-cb-safe', '1');
      else html.removeAttribute('data-cb-safe');
      try {
        if (value === '1') localStorage.setItem('nbd_cb_safe', '1');
        else localStorage.removeItem('nbd_cb_safe');
      } catch (_) {}
    } else if (kind === 'autoTheme') {
      // W107: auto theme switching. When ON, schedules a check
      // every minute that switches the active theme based on
      // local hour. Daytime (7am–7pm) uses 'paper' (light); rest
      // uses the rep's preferred dark theme (defaults to
      // 'nbd-original'). Rep can still pick a different theme
      // manually mid-day; auto only kicks in on the next
      // boundary.
      try {
        if (value === '1') localStorage.setItem('nbd_auto_theme', '1');
        else localStorage.removeItem('nbd_auto_theme');
      } catch (_) {}
      if (value === '1') nbdAutoThemeStart();
      else nbdAutoThemeStop();
    }
  } catch (_) { /* best effort */ }
  nbdComfortRefresh();
}
window.nbdComfortSet = nbdComfortSet;

// Wave 131: hold-to-talk hotkey toggle + key picker. Stored on
// localStorage via the NBDWhisper public API so the FAB tooltip,
// the hotkey listener, and this tab all share state.
function nbdComfortSetWhisperHotkey(enabled) {
  if (window.NBDWhisper && window.NBDWhisper.setHotkeyEnabled) {
    window.NBDWhisper.setHotkeyEnabled(!!enabled);
  } else {
    // NBDWhisper not loaded yet — just stash the flag for it to pick up.
    try {
      if (enabled) localStorage.removeItem('nbd_whisper_hotkey_disabled');
      else localStorage.setItem('nbd_whisper_hotkey_disabled', '1');
    } catch (_) {}
  }
  // Reveal/hide the key picker.
  const cfg = document.getElementById('npm-whisper-hotkey-config');
  if (cfg) cfg.style.display = enabled ? 'block' : 'none';
}
window.nbdComfortSetWhisperHotkey = nbdComfortSetWhisperHotkey;

function nbdComfortSetWhisperKey(keyName) {
  if (window.NBDWhisper && window.NBDWhisper.setHotkey) {
    window.NBDWhisper.setHotkey(keyName);
  } else {
    try { localStorage.setItem('nbd_whisper_hotkey', keyName); } catch (_) {}
  }
}
window.nbdComfortSetWhisperKey = nbdComfortSetWhisperKey;

// Reflect current state in the comfort tab's buttons + toggles
// so opening the picker shows the right active item.
function nbdComfortRefresh() {
  const html = document.documentElement;
  const body = document.body;
  const density = html.getAttribute('data-density') || 'comfortable';
  const size = html.getAttribute('data-text-size') || 'medium';
  const motion = html.getAttribute('data-motion') === 'reduce';
  const proMode = body.classList.contains('professional-mode');

  document.querySelectorAll('.npm-comfort-btn').forEach(b => {
    const kind = b.getAttribute('data-comfort');
    const val = b.getAttribute('data-value');
    let active = false;
    if (kind === 'density') active = (val === density);
    else if (kind === 'size') active = (val === size);
    if (active) {
      b.style.background = 'var(--orange)';
      b.style.color = '#fff';
      b.style.borderColor = 'var(--orange)';
    } else {
      b.style.background = 'var(--s)';
      b.style.color = 'var(--m)';
      b.style.borderColor = 'var(--br)';
    }
  });

  const motionEl = document.getElementById('npm-reduce-motion');
  if (motionEl) motionEl.checked = motion;
  const proEl = document.getElementById('npm-pro-mode');
  if (proEl) proEl.checked = proMode;
  // W106: reflect color-blind-safe state
  const cbSafe = html.getAttribute('data-cb-safe') === '1';
  const cbEl = document.getElementById('npm-cb-safe');
  if (cbEl) cbEl.checked = cbSafe;
  // W107: reflect auto-theme state
  const autoTheme = (function(){ try { return localStorage.getItem('nbd_auto_theme') === '1'; } catch (_) { return false; } })();
  const autoEl = document.getElementById('npm-auto-theme');
  if (autoEl) autoEl.checked = autoTheme;
  // W131: reflect hold-to-talk hotkey state + chosen key.
  const whisperEnabled = (function(){
    try { return localStorage.getItem('nbd_whisper_hotkey_disabled') !== '1'; }
    catch (_) { return true; }
  })();
  const whisperKey = (function(){
    try { return localStorage.getItem('nbd_whisper_hotkey') || 'F2'; }
    catch (_) { return 'F2'; }
  })();
  const whisperToggle = document.getElementById('npm-whisper-hotkey');
  const whisperCfg = document.getElementById('npm-whisper-hotkey-config');
  const whisperKeyEl = document.getElementById('npm-whisper-hotkey-key');
  if (whisperToggle) whisperToggle.checked = whisperEnabled;
  if (whisperCfg) whisperCfg.style.display = whisperEnabled ? 'block' : 'none';
  if (whisperKeyEl) whisperKeyEl.value = whisperKey;
}

// ══════════════════════════════════════════════════════════════════
// Wave 107: time-of-day auto-theme switching.
// 7 AM – 7 PM local → light theme (paper); rest → dark theme
// (rep's last manually-chosen dark theme, or 'nbd-original'). The
// switch fires on enable + every minute. When the rep picks a
// theme manually, we remember which "side" of the day it falls on
// so future auto-switches respect their preference per side.
// ══════════════════════════════════════════════════════════════════
function nbdAutoThemeIsDay() {
  const h = new Date().getHours();
  return h >= 7 && h < 19;
}

function nbdAutoThemePreferredFor(side) {
  // side = 'day' or 'night'
  try {
    const saved = localStorage.getItem('nbd_auto_theme_' + side);
    if (saved) return saved;
  } catch (_) {}
  return side === 'day' ? 'paper' : 'nbd-original';
}

function nbdAutoThemeApplyForNow() {
  if (!window.ThemeEngine) return;
  const isDay = nbdAutoThemeIsDay();
  const want = nbdAutoThemePreferredFor(isDay ? 'day' : 'night');
  const cur = window.ThemeEngine.getCurrent && window.ThemeEngine.getCurrent();
  if (cur === want) return;
  try { window.ThemeEngine.apply(want, true); } catch (_) {}
}

function nbdAutoThemeStart() {
  nbdAutoThemeStop();
  nbdAutoThemeApplyForNow();
  _nbdAutoThemeInterval = setInterval(nbdAutoThemeApplyForNow, 60_000);
}
function nbdAutoThemeStop() {
  if (_nbdAutoThemeInterval) {
    clearInterval(_nbdAutoThemeInterval);
    _nbdAutoThemeInterval = null;
  }
}

// Listen for manual theme changes — when rep picks a theme by
// hand, remember it for the current side of the day so future
// auto-switches honor their dark / light preference.
// Bug fix: event name was 'nbd:theme-change' but theme-engine.js
// dispatches 'themechange' (no namespace prefix) at line 4541. The
// listener was silently dead — manual theme picks never got
// remembered for the auto-theme day/night system. Listening for
// both names so we work with any future dispatcher rename too.
function _nbdRememberManualTheme(ev) {
  try {
    const themeKey = (ev && ev.detail && (ev.detail.themeKey || ev.detail)) ||
                     (window.ThemeEngine && window.ThemeEngine.getCurrent && window.ThemeEngine.getCurrent());
    if (!themeKey || typeof themeKey !== 'string') return;
    if (localStorage.getItem('nbd_auto_theme') !== '1') return;
    const side = nbdAutoThemeIsDay() ? 'day' : 'night';
    localStorage.setItem('nbd_auto_theme_' + side, themeKey);
  } catch (_) {}
}
document.addEventListener('themechange', _nbdRememberManualTheme);
window.addEventListener('nbd:theme-change', _nbdRememberManualTheme);

window.nbdAutoThemeStart = nbdAutoThemeStart;
window.nbdAutoThemeStop = nbdAutoThemeStop;
window.nbdAutoThemeApplyForNow = nbdAutoThemeApplyForNow;

// Boot auto-theme on page load if user enabled it.
(function bootAutoTheme() {
  try {
    if (localStorage.getItem('nbd_auto_theme') === '1') {
      // Wait for ThemeEngine to be ready.
      const tryStart = () => {
        if (window.ThemeEngine) nbdAutoThemeStart();
        else setTimeout(tryStart, 200);
      };
      setTimeout(tryStart, 500);
    }
  } catch (_) {}
})();
window.nbdComfortRefresh = nbdComfortRefresh;

// Sync the comfort tab when the picker opens.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(nbdComfortRefresh, 250);
});

// ══════════════════════════════════════════════════════════════════
// PIPELINE PAGE-BREATHE — sidebar collapse, fullscreen, Tools menu,
// FAB visibility, scroll-collapse, ESC handling.
// One self-contained block so future changes touch one place.
// ══════════════════════════════════════════════════════════════════
function toggleSidebarCollapse() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) {}
  // Sync the button's `active` state
  const btn = document.getElementById('sidebarToggleBtn');
  if (btn) btn.classList.toggle('active', collapsed);
  // Leaflet maps need an invalidate-size after the rail width changes
  // so they don't render with the old viewport dimensions.
  setTimeout(() => {
    if (window.mainMap?.invalidateSize) window.mainMap.invalidateSize();
    if (window.d2dMap?.invalidateSize)  window.d2dMap.invalidateSize();
  }, 200);
}
window.toggleSidebarCollapse = toggleSidebarCollapse;

function toggleKanbanFullscreen() {
  const fullscreen = document.body.classList.toggle('kanban-fullscreen');
  // Sync the icon button's active state when present
  const btn = document.getElementById('kanbanFullscreenBtn');
  if (btn) btn.classList.toggle('active', fullscreen);
}
window.toggleKanbanFullscreen = toggleKanbanFullscreen;

// Tools dropdown (collapsed secondary toolbar)
function toggleCrmToolsMenu(ev) {
  const menu = document.getElementById('crmToolsMenu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('open');
  if (isOpen) {
    // Close on next click outside
    setTimeout(() => {
      const onAway = (e) => {
        if (!menu.contains(e.target) && e.target.id !== 'crmToolsBtn') {
          closeCrmToolsMenu();
          document.removeEventListener('click', onAway, true);
        }
      };
      document.addEventListener('click', onAway, true);
    }, 0);
  }
  if (ev) ev.stopPropagation();
}
function closeCrmToolsMenu() {
  document.getElementById('crmToolsMenu')?.classList.remove('open');
}
window.toggleCrmToolsMenu = toggleCrmToolsMenu;
window.closeCrmToolsMenu = closeCrmToolsMenu;

// FAB visibility — show only on the CRM view. Hooks goTo() so we don't
// have to touch every nav site.
(function setupAddLeadFab() {
  const _origGoTo = window.goTo;
  if (typeof _origGoTo !== 'function') return; // page boot ordering — should always be defined here, but guard anyway
  const updateFab = () => {
    const onCrm = document.getElementById('view-crm')?.classList.contains('active');
    document.body.classList.toggle('show-add-lead-fab', !!onCrm);
  };
  // Initial
  updateFab();
  // Re-evaluate after every navigation
  window.goTo = function() {
    const r = _origGoTo.apply(this, arguments);
    setTimeout(updateFab, 50);
    return r;
  };
})();

// Scroll-collapse — OPT-IN behavior (was on by default; users found the
// header twitching during scroll/drag distracting). Now gated on the
// `nbd-crm-autocollapse` localStorage flag, which the toggle in
// Settings → CRM Pipeline Preferences flips. Default OFF.
function setCrmAutoCollapse(on) {
  try { localStorage.setItem(CRM_AUTOCOLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
  // If turning OFF, immediately drop any active collapse state so the
  // header pops back to full size without waiting for the next scroll.
  if (!on) document.body.classList.remove('crm-scrolling');
}
window.setCrmAutoCollapse = setCrmAutoCollapse;
function _isCrmAutoCollapseOn() {
  try { return localStorage.getItem(CRM_AUTOCOLLAPSE_KEY) === '1'; }
  catch (e) { return false; }
}

(function setupCrmScrollCollapse() {
  let scrollTimer = null;
  const onScroll = () => {
    if (!_isCrmAutoCollapseOn()) return;
    if (!document.getElementById('view-crm')?.classList.contains('active')) return;
    document.body.classList.add('crm-scrolling');
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      document.body.classList.remove('crm-scrolling');
    }, 700);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('dragstart', (e) => {
    if (!_isCrmAutoCollapseOn()) return;
    if (e.target?.closest?.('.kanban-board')) {
      document.body.classList.add('crm-scrolling');
    }
  });
  document.addEventListener('dragend', () => {
    if (!_isCrmAutoCollapseOn()) return;
    setTimeout(() => document.body.classList.remove('crm-scrolling'), 200);
  });
})();

// Boot: ESC to exit fullscreen (sidebar-collapsed restore moved to
// dashboard-state.js so it runs before this script).
(function bootPageBreathe() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('kanban-fullscreen')) {
      // Don't steal Escape from open modals — they handle it themselves
      const openModal = document.querySelector('.modal-bg.open, .d2d-modal-overlay.open');
      if (!openModal) toggleKanbanFullscreen();
    }
  });
})();

// Load saved theme when user auth resolves
document.addEventListener('DOMContentLoaded', () => {
  loadSavedTheme();
  // Boot Theme Engine (overlays, sounds, achievements)
  setTimeout(() => {
    if(window.ThemeEngine) {
      window.ThemeEngine.init();
      if(window.ThemeOverlays) window.ThemeOverlays.init();
      if(window.ThemeSounds) window.ThemeSounds.init();
      if(window.ThemeGX) window.ThemeGX.init({ intensity: 0.6, glow: true, animatedBg: true });
      if(window.ThemeGXPanel) ThemeGXPanel.render('gx-settings-panel');
    }
  }, 500);
  // Boot achievements after leads load
  setTimeout(() => {
    if(window.ThemeAchievements && window._user) {
      window.ThemeAchievements.init();
    }
  }, 3000);
});

// Mark current theme card active whenever settings opens
const origGoTo = typeof goTo === 'function' ? goTo : null;
function goToWithTheme(view) {
  if(origGoTo) origGoTo(view);
  if(view === 'settings') {
    setTimeout(() => {
      const cur = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
      document.querySelectorAll('.theme-card').forEach(c => {
        c.classList.toggle('active', c.dataset.key === cur);
      });
    }, 50);
  }
}

// ══════════════════════════════════════════════
// DAILY PROGRAM SETTINGS — render helpers (UI side)
// ══════════════════════════════════════════════
function dsRenderFloors() {
  const wrap = document.getElementById('ds-floor-editor');
  if (!wrap) return;
  wrap.innerHTML = '';
  const inputStyle = 'background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:6px 8px;color:var(--t);font-size:12px;width:100%;outline:none;';
  dsFloors.forEach((f, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 70px 28px;gap:6px;margin-bottom:6px;align-items:center;';

    const label = document.createElement('input');
    label.style.cssText = inputStyle;
    label.placeholder = 'Floor label';
    label.value = f.label || '';
    label.addEventListener('input', () => { dsFloors[i].label = label.value; });

    const target = document.createElement('input');
    target.style.cssText = inputStyle + 'text-align:center;';
    target.type = 'number';
    target.placeholder = 'Tgt';
    target.value = f.targetValue || 1;
    target.addEventListener('input', () => { dsFloors[i].targetValue = +target.value; });

    const unit = document.createElement('input');
    unit.style.cssText = inputStyle + 'text-align:center;';
    unit.placeholder = 'Unit';
    unit.value = f.unit || 'done';
    unit.addEventListener('input', () => { dsFloors[i].unit = unit.value; });

    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.style.cssText = 'background:transparent;border:none;cursor:pointer;color:#c04040;font-size:17px;line-height:1;padding:0;width:28px;text-align:center;';
    rm.addEventListener('click', () => dsRemoveFloor(i));

    row.append(label, target, unit, rm);
    wrap.appendChild(row);
  });
}

function dsBuildThemeGrid() {
  const grid = document.getElementById('ds-theme-grid');
  if (!grid) return;
  grid.innerHTML = DS_THEMES.map(t => `
    <div data-du-action="dsPickTheme" data-du-id="${t.key}" id="ds-tc-${t.key}" style="
      cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;
      padding:10px 6px;border-radius:6px;border:2px solid ${t.key===dsSelectedTheme?'var(--orange)':'var(--br)'};
      background:${t.key===dsSelectedTheme?'color-mix(in srgb, var(--orange) 8%, transparent)':'var(--s2)'};
      transition:all .15s;
    ">
      <span style="width:18px;height:18px;border-radius:50%;background:${t.dot};display:block;flex-shrink:0;"></span>
      <span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;letter-spacing:.04em;color:var(--t);text-align:center;white-space:nowrap;">${t.label}</span>
    </div>
  `).join('');
}

function dsPickTheme(key) {
  dsSelectedTheme = key;
  dsBuildThemeGrid();
}

// ══════════════════════════════════════════════
// MOBILE NAVIGATION — UI
// ══════════════════════════════════════════════
function mobileNav(view) {
  // Use the existing goTo() to switch views
  goTo(view);
  // Update bottom nav active state
  MOBILE_NAV_TABS.forEach(t => {
    const el = document.getElementById('mni-' + t);
    if (el) el.classList.toggle('active', t === view);
  });
  // If "more" items, deactivate all bottom tabs
  if (!MOBILE_NAV_TABS.includes(view)) {
    MOBILE_NAV_TABS.forEach(t => {
      const el = document.getElementById('mni-' + t);
      if (el) el.classList.remove('active');
    });
  }
  // Close any open map sidebar when switching views
  document.querySelectorAll('.map-sidebar.open').forEach(s => s.classList.remove('open'));
}

function toggleMobileMore() {
  const menu = document.getElementById('mobile-more-menu');
  const moreBtn = document.getElementById('mni-more');
  const isOpen = menu.classList.contains('open');
  menu.classList.toggle('open', !isOpen);
  if (moreBtn) moreBtn.classList.toggle('active', !isOpen);
  document.body.style.overflow = !isOpen ? 'hidden' : '';
}

function closeMobileMore() {
  document.getElementById('mobile-more-menu')?.classList.remove('open');
  document.getElementById('mni-more')?.classList.remove('active');
  document.body.style.overflow = '';
}

function toggleMapSidebar(id) {
  const sidebar = document.getElementById(id);
  if (!sidebar) return;
  // Close all other map sidebars first
  document.querySelectorAll('.map-sidebar').forEach(s => {
    if (s.id !== id) s.classList.remove('open');
  });
  sidebar.classList.toggle('open');
  // Update button text
  const btn = sidebar.closest('.map-view')?.querySelector('.map-toggle-btn');
  if (btn) btn.textContent = sidebar.classList.contains('open') ? '✕ Close' : btn.textContent.replace('✕ Close','').trim() || '☰ Tools';
}

// Sync bottom nav active state with goTo() calls from desktop sidebar
// (wraps the existing goTo — safe because we already wrap it once above for DS settings).
// Forward `arguments` so the (view, params) signature is preserved.
(function() {
  const _prev = window.goTo;
  window.goTo = function() {
    const view = arguments[0];
    if (_prev) _prev.apply(this, arguments);
    // Keep bottom nav in sync
    MOBILE_NAV_TABS.forEach(t => {
      const el = document.getElementById('mni-' + t);
      if (el) el.classList.toggle('active', t === view);
    });
    // Mirror lead badge to mobile nav
    const badge = document.getElementById('leadBadge');
    const mbadge = document.getElementById('mni-crm-badge');
    if (badge && mbadge) {
      const count = badge.textContent.trim();
      mbadge.textContent = count;
      mbadge.style.display = (count && count !== '0') ? 'block' : 'none';
    }
  };
})();

// Keep mobile CRM badge in sync with lead count updates
const _origUpdateLeadBadge = window.updateLeadBadge;
function syncMobileBadge() {
  setTimeout(() => {
    const badge = document.getElementById('leadBadge');
    const mbadge = document.getElementById('mni-crm-badge');
    if (badge && mbadge) {
      const count = badge.textContent.trim();
      mbadge.textContent = count;
      mbadge.style.display = (count && count !== '0') ? 'block' : 'none';
    }
  }, 200);
}
// Observe leadBadge for changes
const _leadBadgeEl = document.getElementById('leadBadge');
if (_leadBadgeEl) {
  new MutationObserver(syncMobileBadge).observe(_leadBadgeEl, { childList: true, characterData: true, subtree: true });
}

// ══════════════════════════════════════════════════════════════════════
// CRM SECONDARY HEADER — AUTO-HIDE ON SCROLL + SETTINGS TOGGLE
// ══════════════════════════════════════════════════════════════════════
function getCrmSecHeaderEnabled() {
  try {
    const val = localStorage.getItem(CRM_SEC_HEADER_SETTING);
    return val === null ? true : val === 'true'; // default ON
  } catch { return true; }
}

function setCrmSecHeaderEnabled(enabled) {
  try { localStorage.setItem(CRM_SEC_HEADER_SETTING, String(enabled)); } catch {}
  applyCrmSecHeaderState();
}

function applyCrmSecHeaderState() {
  const enabled = getCrmSecHeaderEnabled();
  const header = document.getElementById('crmSecondaryHeader');
  const restoreBtn = document.getElementById('crmSecRestoreBtn');
  if (!header || !restoreBtn) return;

  if (!enabled) {
    header.classList.add('hidden');
    restoreBtn.style.display = 'none';
  } else {
    header.classList.remove('hidden');
    restoreBtn.style.display = 'none';
  }
}

function restoreCrmSecondary() {
  const header = document.getElementById('crmSecondaryHeader');
  const restoreBtn = document.getElementById('crmSecRestoreBtn');
  if (!header || !restoreBtn) return;
  header.classList.remove('hidden');
  restoreBtn.style.display = 'none';
}
window.restoreCrmSecondary = restoreCrmSecondary;

// Auto-hide on scroll within kanban board
const kanbanBoard = document.getElementById('kanbanBoard');
if (kanbanBoard) {
  kanbanBoard.addEventListener('scroll', function() {
    const enabled = getCrmSecHeaderEnabled();
    if (!enabled) return; // Don't auto-hide if setting is off

    const header = document.getElementById('crmSecondaryHeader');
    const restoreBtn = document.getElementById('crmSecRestoreBtn');
    if (!header || !restoreBtn) return;

    const scrollTop = kanbanBoard.scrollLeft; // horizontal scroll
    const currentView = document.querySelector('.view.active');
    const isCrmView = currentView && currentView.id === 'view-crm';
    if (!isCrmView) return;

    if (scrollTop > 50 && scrollTop > _lastScrollTop) {
      // Scrolling right → hide
      header.classList.add('hidden');
      restoreBtn.style.display = 'block';
    } else if (scrollTop < 20) {
      // Scrolled back to start → show
      header.classList.remove('hidden');
      restoreBtn.style.display = 'none';
    }
    _lastScrollTop = scrollTop;
  });
}

// Apply state on page load
document.addEventListener('DOMContentLoaded', applyCrmSecHeaderState);

// ══════════════════════════════════════════════
// MAP ENHANCEMENTS — spyglass, fab bar, quick storm check
// ══════════════════════════════════════════════
// ── Spyglass search ──────────────────────────
async function spyglassSearch() {
  const q = document.getElementById('spyglassInput')?.value?.trim();
  if(!q) return;
  hideAcDrop('spyglassInput');
  const data = await geocode(q);
  if(!data) return;
  if(mainMap) mainMap.setView([parseFloat(data.lat), parseFloat(data.lon)], 18);
  // Also show property card — guard since propCard lives in tpl-view-map.
  window._lastMapSearch = data;
  const propCard = document.getElementById('propCard');
  const propCardInner = document.getElementById('propCardInner');
  if (propCard && propCardInner) {
    propCard.style.display = 'block';
    propCardInner.innerHTML = `
      <div class="pi-card">
        <div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county"></span></div>
        <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
      </div>
      <button class="make-lead-btn" data-du-action="makeLeadFromSearch">＋ Make This a Lead</button>`;
    fetchPropertyIntel(data, 'propCardInner');
  }
  // Show sidebar if hidden
  const sidebar = document.getElementById('map-sidebar-map');
  if(sidebar && !sidebar.classList.contains('open') && window.innerWidth <= 768) {
    sidebar.classList.add('open');
  }
}

function spyglassGoToLocation() {
  showToast('Getting your location...');
  if(!navigator.geolocation) { showToast('Location unavailable','error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if(!mainMap) return;
      mainMap.setView([lat, lng], 17);
      // Accuracy ring
      if(window._locMarker) mainMap.removeLayer(window._locMarker);
      if(window._locRing) mainMap.removeLayer(window._locRing);
      window._locMarker = L.circleMarker([lat,lng], {
        radius:8, color:'#fff', fillColor:'var(--blue)', fillOpacity:1, weight:2
      }).addTo(mainMap);
      window._locRing = L.circleMarker([lat,lng], {
        radius:20, color:'var(--blue)', fillColor:'transparent', weight:2, opacity:.5, className:'loc-pulse-ring'
      }).addTo(mainMap);
      showToast('Located ✓');
    },
    () => showToast('Location access denied','error'),
    {enableHighAccuracy:true, timeout:8000}
  );
}

// ── FAB bar toggles (sync with sidebar toggles) ──
function fabToggle(type, el) {
  const tog = document.getElementById('tog-'+type);
  if(tog) {
    toggleOverlay(type, tog);
    el.classList.toggle('active', tog.classList.contains('on'));
  }
}

// Sync fab active states when overlay toggles happen from sidebar
const _origToggleOverlay = window.toggleOverlay;
window.toggleOverlay = function(type, el) {
  if(_origToggleOverlay) _origToggleOverlay(type, el);
  const fab = document.getElementById('fab-'+type);
  if(fab) fab.classList.toggle('active', el?.classList?.contains('on'));
};

// ── Quick storm check at current location ──
async function quickStormCheck() {
  showToast('Getting location for storm check...');
  if(!navigator.geolocation) { showToast('Location unavailable','error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if(mainMap) mainMap.setView([lat, lng], 13);
      // Turn on storm overlay
      const tog = document.getElementById('tog-storm');
      if(tog && !tog.classList.contains('on')) {
        toggleOverlay('storm', tog);
      }
      const fab = document.getElementById('fab-storm');
      if(fab) fab.classList.add('active');
      showToast('Storm radar active at your location');
    },
    () => showToast('Location access denied','error')
  );
}

// ── Auto-setup spyglass autocomplete ──────────────────────────
(function() {
  // Wait for initAllAutocomplete to run, then add spyglass
  const _origInit = window.initAllAutocomplete;
  window.initAllAutocomplete = function() {
    if(_origInit) _origInit();
    if(!window._acCallbacks) window._acCallbacks = {};
    window._acCallbacks['spyglassInput'] = (r, label) => {
      window._lastMapSearch = r;
      if(mainMap) mainMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 18);
      // propCard/propCardInner live in tpl-view-map — guard.
      const propCard = document.getElementById('propCard');
      const propCardInner = document.getElementById('propCardInner');
      if (propCard && propCardInner) {
        propCard.style.display = 'block';
        propCardInner.innerHTML = `
          <div class="pi-card">
            <div class="pi-header"><span class="pi-title">🏠 Property Intel</span></div>
            <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
          </div>
          <button class="make-lead-btn" data-du-action="makeLeadFromSearch">＋ Make This a Lead</button>`;
        fetchPropertyIntel(r, 'propCardInner');
      }
    };
    if(typeof initAddressAutocomplete === 'function') {
      initAddressAutocomplete('spyglassInput');
    }
  };
})();

// ── Hook pin stats refresh into dropPin and deletePin ──────────
const _origDropPin = window.dropPin || null;
const _origDeletePin = window.deletePin || null;

// Refresh stats after map init
const _origInitMainMap = window.initMainMap;

// ── Zone tooltip CSS ─────────────────────────────────────────
(function injectZoneCSS(){
  const s = document.createElement('style');
  s.textContent = `.zone-tooltip{background:rgba(10,12,15,.85)!important;border:1px solid rgba(255,255,255,.1)!important;color:var(--t)!important;border-radius:4px!important;padding:2px 8px!important;font-size:11px!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important;}
  .zone-tooltip::before{display:none!important;}`;
  document.head.appendChild(s);
})();


// CSP-safe delegation for 2 data-du-action attrs (dashboard-ui residual).
// (Other dashboard-ui buttons use the dashboard global action delegate via
//  data-action="goTo" etc. — that delegate is in dashboard-actions.js.)
(function () {
  if (window._NBD_DU_DELEGATE_BOUND) return;
  window._NBD_DU_DELEGATE_BOUND = true;
  document.addEventListener('click', function (ev) {
    const t = ev.target.closest && ev.target.closest('[data-du-action]');
    if (!t) return;
    const action = t.dataset.duAction;
    const id = t.dataset.duId;
    try {
      switch (action) {
        case 'makeLeadFromSearch': if (typeof makeLeadFromSearch === 'function') makeLeadFromSearch(); break;
        case 'dsPickTheme':        if (typeof dsPickTheme === 'function') dsPickTheme(id); break;
        default: console.warn('[dashboard-ui] no dispatch for', action);
      }
    } catch (e) { console.error('[dashboard-ui] dispatch ' + action + ' failed:', e); }
  });
})();
