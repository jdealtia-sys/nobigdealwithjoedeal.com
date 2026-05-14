/**
 * dashboard-main.js — main routing, map init, and CRM-page handlers.
 *
 * Extracted from dashboard.html in audit batch 10. Was a 3986-line
 * inline <script> block (between </body>'s area and the deferred
 * script defer chain) that defined:
 *   - waitForLeaflet() safety guard
 *   - goTo() router + view setup
 *   - Map init (Leaflet stormMap, mainMap, etc.)
 *   - Photo modal, lightbox, property-intel modal helpers
 *   - Estimate builder hooks
 *   - All the inline event handlers the kanban + map + photo grid bind
 *
 * Why extract:
 *   1. dashboard.html was ~1MB+; pulling 3986 LOC out shrinks the parse
 *      window for the rest of the markup + makes the inline-script
 *      blob reviewable as a real file
 *   2. Browser can cache dashboard-main.js separately from the markup
 *      → repeat loads serve from disk after a deploy that touched only
 *      HTML
 *
 * Why NOT defer:
 *   Several inline classic <script> blocks LATER in dashboard.html
 *   (~line 18782 SW bootstrap, ~line 19023 load-status banner) might
 *   reference functions/globals defined here at parse time. Defer
 *   would push our execution AFTER those inline scripts, breaking the
 *   reference. Plain <script src> blocks parsing in document order,
 *   which preserves the original semantics. Future PR can audit the
 *   downstream references and switch to defer for the first-paint win.
 */
// ══════════════════════════════════════════════
// WAIT FOR LEAFLET — safety guard
// ══════════════════════════════════════════════
function waitForLeaflet(cb) {
  if (typeof L !== 'undefined') { cb(); return; }
  const t = setInterval(() => { if (typeof L !== 'undefined') { clearInterval(t); cb(); } }, 50);
}

// ══════════════════════════════════════════════
// NAVIGATION & URL ROUTING
// ══════════════════════════════════════════════
const mapInited = {};

// Route configuration: maps view names to display labels and parent routes
const routeConfig = {
  'home': { label: 'Home', parent: null },
  'dash': { label: 'Dashboard', parent: null },
  'schedule': { label: 'Schedule', parent: null },
  'crm': { label: 'Pipeline', parent: null },
  'est': { label: 'Estimates', parent: null },
  'd2d': { label: 'Door-to-Door', parent: null },
  'map': { label: 'Maps & Pins', parent: null },
  'photos': { label: 'Photos', parent: null },
  'docs': { label: 'Templates', parent: null },
  'draw': { label: 'Drawing', parent: null },
  'storm': { label: 'Storm Center', parent: null },
  'closeboard': { label: 'Close Board', parent: null },
  'repos': { label: 'Rep OS', parent: null },
  'joe': { label: 'Ask Joe', parent: null },
  'board': { label: 'Leaderboard', parent: null },
  'products': { label: 'Products', parent: null },
  'training': { label: 'Sales Training', parent: null },
  'settings': { label: 'Settings', parent: null }
};

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

// Navigate to a view and update URL hash
// Pro-only views — Lite users see upgrade prompt instead
const PRO_ONLY_VIEWS = ['photos','docs','map','draw','storm','joe','schedule','board','closeboard','repos','training','academy'];

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
  return true;
}

function goTo(name, params = {}) {
  // ── Lite tier gate: block Pro-only views ──
  if (window._userPlan === 'lite' && PRO_ONLY_VIEWS.includes(name)) {
    showToast('Upgrade to Pro to access this feature — $79/mo', 'error');
    return;
  }

  // Force-exit bulk-select mode whenever leaving the kanban — otherwise a
  // bulk selection started on the CRM bleeds into the next view's click
  // handlers (e.g. tapping a prospect card opens a checkbox toggle instead
  // of the detail modal). Audit fix H4.
  if (name !== 'crm' && window._bulkMode && typeof window.exitBulkMode === 'function') {
    window.exitBulkMode();
  }

  // Update URL hash (without triggering hashchange event)
  if (!params.skipHash) {
    const hash = params.id ? `#/${name}/${params.id}` : `#/${name}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }

  // Hydrate templated views the first time they're shown.
  _hydrateViewTemplate(name);

  // Update UI
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.crm-sec-btn').forEach(btn => btn.classList.remove('active'));
  const view = document.getElementById('view-'+name);
  const nav  = document.getElementById('nav-'+name);
  if(view) view.classList.add('active');
  if(nav)  nav.classList.add('active');
  
  // Highlight active secondary toolbar tab
  const secBtns = document.querySelectorAll('.crm-sec-btn');
  secBtns.forEach(btn => {
    const onclick = btn.getAttribute('onclick');
    if(onclick && onclick.includes(`'${name}'`)) btn.classList.add('active');
  });
  
  // Update breadcrumb
  updateBreadcrumb(name, params);

  // Lazy-load the view's script bundle. ScriptLoader resolves an
  // already-eager-loaded bundle immediately, so this is a no-op for
  // views not in the bundle map. Returning a promise lets specific
  // views below chain init onto it when their module ships lazy.
  const _lazyPreload = (window.ScriptLoader && typeof window.ScriptLoader.preloadForView === 'function')
    ? window.ScriptLoader.preloadForView(name)
    : Promise.resolve();

  // View-specific initialization
  // Maps require both Leaflet (sync) AND maps.js (deferred) to be loaded.
  // waitForLeaflet handles the first; we also need to wait for initDrawMap/initMainMap.
  function waitForMapFn(fnName, cb) {
    if (typeof window[fnName] === 'function') { cb(); return; }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (typeof window[fnName] === 'function') { clearInterval(t); cb(); }
      else if (tries > 80) { clearInterval(t); console.error(fnName + ' never loaded'); }
    }, 50);
  }
  // Helper: ensure Leaflet map is properly sized after view becomes visible.
  // Uses rAF → rAF to guarantee the browser has painted the container with
  // real dimensions before Leaflet measures it.
  function ensureMapSize(mapObj, retries) {
    if (!mapObj) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        mapObj.invalidateSize();
        // Extra retries to cover Safari standalone paint delays
        if (retries !== false) {
          setTimeout(function() { if(mapObj) mapObj.invalidateSize(); }, 200);
          setTimeout(function() { if(mapObj) mapObj.invalidateSize(); }, 800);
          setTimeout(function() { if(mapObj) mapObj.invalidateSize(); }, 2000);
        }
      });
    });
  }
  if(name==='map') {
    if (!mapInited.map) {
      waitForLeaflet(()=>{ waitForMapFn('initMainMap', ()=>{
        requestAnimationFrame(()=>{ initMainMap(); mapInited.map=true; ensureMapSize(mainMap); });
      }); });
    } else if (typeof mainMap !== 'undefined' && mainMap) {
      ensureMapSize(mainMap);
    }
  }
  if(name==='draw') {
    if (!mapInited.draw) {
      waitForLeaflet(()=>{ waitForMapFn('initDrawMap', ()=>{
        requestAnimationFrame(()=>{ initDrawMap(); mapInited.draw=true; ensureMapSize(drawMap); });
      }); });
    } else if (typeof drawMap !== 'undefined' && drawMap) {
      // Re-entry: map already created, just refresh the size
      ensureMapSize(drawMap);
    }
  }
  // CRM: re-render kanban on every entry (not just first)
  if(name==='crm') {
    if (typeof renderLeads === 'function' && window._leads?.length) {
      // Ensure kanban columns exist
      if (!document.getElementById('kanbanBoard')?.children?.length && typeof window.buildKanbanColumns === 'function') {
        window.buildKanbanColumns(window._currentViewKey || 'insurance');
      }
      renderLeads(window._leads, window._filteredLeads);
    }
  }
  // These views' modules are lazy-loaded — chain init onto the preload
  // promise so the init call runs AFTER the module has defined the
  // window global it needs.
  if(name==='storm')      { _lazyPreload.then(() => { if (window.StormCenter) window.StormCenter.init(); }); }
  if(name==='closeboard') { _lazyPreload.then(() => { if (window.CloseBoard)  window.CloseBoard.init();  }); }
  if(name==='repos')      { _lazyPreload.then(() => { if (window.RepOS)       window.RepOS.init();       }); }
  if(name==='board') { if(window.AnalyticsKPI) window.AnalyticsKPI.render('analyticsContainer'); renderLeaderboard(); }
  if(name==='photos') {
    renderPhotoLeads();
    // Populate lead selector for photo engine
    const sel = document.getElementById('photoLeadSelect');
    if (sel && window._leads) {
      sel.innerHTML = '<option value="">Select a property...</option>';
      window._leads.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = (l.name || 'Unknown') + ' — ' + (l.address || 'No address');
        sel.appendChild(opt);
      });
      // Restore last selected lead
      if (window._currentPhotoLeadId) sel.value = window._currentPhotoLeadId;
    }
  }
  if(name==='settings') { setTimeout(() => switchSettingsTab('profile'), 50); }
  if(name==='home') { if(window.NBDWidgets) window.NBDWidgets.render(); }
  if(name==='prospects') {
    // Init / refresh on every entry so a prospect promoted from another
    // view immediately disappears here, and a new D2D knock immediately appears.
    if (window.Prospects) {
      if (!window.Prospects._inited) {
        window.Prospects.init();
        window.Prospects._inited = true;
      } else {
        window.Prospects.refresh();
      }
    }
  }
  if(name==='d2d') {
    // D2D content (feed, stats, knocks) loads independently of Leaflet.
    // waitForD2D polls for window.D2D (set at the end of d2d-tracker.js IIFE).
    // In practice window.D2D is always set before goTo('d2d') can fire
    // (defer scripts run before DOMContentLoaded), but we poll defensively
    // to cover edge cases where d2d-tracker.js is served a 503 by the SW
    // on first load after a cache-version bump (poor connectivity + empty
    // nbd-cdn cache). In that case we surface a retry button instead of
    // leaving the spinner up forever.
    function waitForD2D(cb) {
      if (window.D2D) { cb(); return; }
      let t2 = 0;
      const iv = setInterval(()=> {
        t2++;
        if (window.D2D) {
          clearInterval(iv);
          cb();
        } else if (t2 > 160) { // 8 seconds
          clearInterval(iv);
          console.error('D2D never loaded — d2d-tracker.js may have failed to load');
          const c = document.getElementById('d2dContent');
          if (c) c.innerHTML = '<div class="empty"><div class="empty-icon">😕</div><p style="color:var(--m);font-size:14px;margin:8px 0 16px;">D2D Tracker failed to load.<br>Check your connection and try again.</p><button onclick="window.location.reload()" style="background:var(--orange);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;">Reload</button></div>';
        }
      }, 50);
    }
    waitForD2D(()=>{
      // Always call init() — initD2D() is idempotent via its internal
      // d2dInited flag. On first load it runs full init + renderD2D.
      // On re-entry it re-renders + invalidates the map size. This also
      // handles the case where a previous init() threw before completing:
      // window._d2dInited would be stale-true but d2dInited would be
      // false, so init() correctly re-runs the full sequence.
      requestAnimationFrame(()=>{ window.D2D.init(); });

      // Belt-and-suspenders watchdog: independent of d2d-tracker.js. If
      // #d2dContent still shows the static "Loading…" placeholder after
      // 14 seconds (8s Firestore timeout + padding), something inside
      // initD2D() hung silently. Replace with a user-visible retry UI so
      // the spinner never stays forever regardless of root cause.
      setTimeout(() => {
        const c = document.getElementById('d2dContent');
        if (c && c.textContent.includes('Loading Door-to-Door')) {
          console.error('[d2d-watchdog] initD2D hung — replacing spinner with retry UI');
          c.innerHTML = '<div class="empty"><div class="empty-icon">😕</div><p style="color:var(--m);font-size:14px;margin:8px 0 16px;">D2D Tracker took too long to load.<br>Check your connection and try again.</p><button onclick="window.location.reload()" style="background:var(--orange);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;">Reload</button></div>';
        }
      }, 14000);
    });
  }
  if(name==='training') { _lazyPreload.then(() => { if (window.SalesTraining) window.SalesTraining.init(); }); }
  if(name==='academy') {
    _lazyPreload.then(() => {
      if (window.RealDealAcademy) {
        window.RealDealAcademy.init();
        window.RealDealAcademy.renderAcademy('academyContainer');
      }
    });
  }
  if(name==='products') {
    const pc = document.getElementById('productLibraryContainer');
    if (pc && window._productLib) { pc.innerHTML = window._productLib.render(); }
    else if (pc && typeof window.renderProductLibrary === 'function') { pc.innerHTML = window.renderProductLibrary(); }
  }
  if(name==='docs') {
    // Upgrade docs view with template suite if available
    if (typeof window.NBDTemplateSuite !== 'undefined' && window.NBDTemplateSuite.render) {
      const docsView = document.querySelector('#view-docs .view-scroll');
      if (docsView && !docsView.dataset.suiteLoaded) {
        docsView.innerHTML = window.NBDTemplateSuite.render();
        docsView.dataset.suiteLoaded = '1';
      }
    }
  }
  if(name==='reports') {
    // rep-report-generator is lazy-loaded via ScriptLoader.preloadForView.
    // Chain init so it runs once the module has registered NBDReports.
    _lazyPreload.then(() => {
      if (window.NBDReports && typeof window.NBDReports.init === 'function') {
        window.NBDReports.init();
      }
    });
    // Lead Source ROI panel — instant render off the live lead cache.
    // Init only once; afterward it self-updates on the leadsChanged event.
    if (window.LeadSourceROI && !window.LeadSourceROI._inited) {
      window.LeadSourceROI.init('leadSourceROIPanel');
      window.LeadSourceROI._inited = true;
    } else if (window.LeadSourceROI) {
      window.LeadSourceROI.render('leadSourceROIPanel');
    }
    // Pipeline Forecast — same init-once-then-live-update pattern.
    if (window.Forecasting && !window.Forecasting._inited) {
      window.Forecasting.init('forecastPanel');
      window.Forecasting._inited = true;
    } else if (window.Forecasting) {
      window.Forecasting.render('forecastPanel');
    }
  }
  // ── AI tool iframes — lazy-load on first open ──
  // Each AI tool page is embedded as an iframe inside its view.
  // The iframe src is stored in data-src and only set on first
  // navigation, so pages don't load until the user actually opens
  // the tool. This keeps dashboard startup fast.
  const _iframeMap = {
    'aitree': 'iframe-aitree',
    'understand': 'iframe-understand',
    'projectcodex': 'iframe-projectcodex',
    'aiusage': 'iframe-aiusage'
  };
  if (_iframeMap[name]) {
    const iframe = document.getElementById(_iframeMap[name]);
    if (iframe && !iframe.src && iframe.dataset.src) {
      iframe.src = iframe.dataset.src;
    }
  }
}

// Handle browser back/forward navigation
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1); // Remove #
  if (!hash || hash === '/') {
    goTo('dash', { skipHash: true });
    return;
  }
  
  const parts = hash.split('/').filter(p => p);
  const routeName = parts[0];
  const routeId = parts[1];
  
  if (routeConfig[routeName]) {
    goTo(routeName, { id: routeId, skipHash: true });
  }
});

// Initialize route on page load
// ══════════════════════════════════════════════
// ══ CAL.COM SCHEDULING FUNCTIONS ════════════
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

window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash.slice(1);
  if (hash && hash !== '/') {
    const parts = hash.split('/').filter(p => p);
    const routeName = parts[0];
    const routeId = parts[1];
    if (routeConfig[routeName]) {
      goTo(routeName, { id: routeId, skipHash: true });
      return;
    }
  }
  // Default to home (widget dashboard)
  goTo('home', { skipHash: true });

  // Render widgets on home page
  if(window.NBDWidgets) window.NBDWidgets.render();

  // Load Cal.com settings on page load
  loadCalSettings();
});

// ══════════════════════════════════════════════
// ══ UI MODULE (extracted to js/ui.js) ══════════════════════
// Command Palette, Shortcuts, Skeletons, Toasts, Settings Nav
// See pro/js/ui.js for implementation

// TOAST
// ══════════════════════════════════════════════
const toastQueue = [];
let toastActive = false;

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
// MAPS + DRAWING TOOL — extracted to /pro/js/maps.js
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// ESTIMATE BUILDER
// ══════════════════════════════════════════════
let estCurrentStep=0, selectedTier=null, estData={};

// RATES (overrideable from settings)
const R = {
  shingle:185, felt:28, tear:55, starter:1.85, iws:72, drip:2.10,
  ridge:3.20, hip:3.20, pipe:65, deck:95, gutter:8.50, deckPct:0.15
};

// ══ ESTIMATES MODULE (extracted to js/estimates.js) ════════
// See pro/js/estimates.js for implementation
// Rates, builder, tiers, export/print all live in js/estimates.js

/* REMOVED: orphaned CSS/HTML template literal content that was
   left behind during extraction — caused SyntaxError killing
   all JS after this point. The exportEstimate() function with
   its print template now lives in js/estimates.js. */

// ══ renderEstimatesList kept here (used by loadEstimates above) ══

function renderEstimatesList(ests) {
  document.getElementById('statEsts').textContent=ests?.length||0;
  const totalVal=(ests||[]).reduce((s,e)=>s+(e.grandTotal||0),0);
  document.getElementById('statVal').textContent='$'+Math.round(totalVal/1000)+'K';

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  const wrap=document.getElementById('estListWrap');
  if(!ests||!ests.length){
    // Empty state — the 2 builder options are already visible
    // above this wrap in the page header, so we just invite the
    // user to start one.
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📋</div>'
      + 'No estimates yet.<br><span style="font-size:11px;color:var(--m);">'
      + 'Click <strong>Classic</strong> or <strong>V2 Builder</strong> above to create one.</span></div>';
    return;
  }

  // Helper: find the linked customer (lead) for this estimate
  // and render a short tag. Unassigned estimates get a neutral
  // "Unassigned" chip that's click-to-assign.
  const findLead = (leadId) => (window._leads || []).find(l => l.id === leadId);
  const formatDate = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      if (!d || isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    } catch (e) { return '—'; }
  };
  const displayName = (e) => {
    if (e.name && e.name.trim()) return e.name.trim();
    if (e.addr && e.addr.trim()) return e.addr.trim();
    if (e.owner && e.owner.trim()) return e.owner.trim() + ' estimate';
    return 'Untitled estimate';
  };

  wrap.innerHTML = ests.map(e => {
    const lead = e.leadId ? findLead(e.leadId) : null;
    const leadTag = lead
      ? '<span class="est-lead-chip assigned" data-act="open-lead" data-lead="' + esc(lead.id) + '">'
          + '👤 ' + esc((lead.firstName || '') + ' ' + (lead.lastName || '')).trim()
          + (lead.firstName || lead.lastName ? '' : esc(lead.address || 'Customer'))
        + '</span>'
      : '<span class="est-lead-chip unassigned" data-act="assign">➕ Unassigned</span>';
    const builderTag = e.builder === 'v2'
      ? '<span class="est-src-chip v2">V2</span>'
      : '<span class="est-src-chip classic">CLASSIC</span>';
    // Signature status — emitted by BoldSign webhook. Distinct colors
    // so reps can eyeball the pipeline without clicking into each.
    let sigTag = '';
    if (e.signatureStatus === 'signed') {
      sigTag = '<span class="est-src-chip" style="background:rgba(46,204,138,.15);color:var(--green,#2ecc8a);border-color:var(--green,#2ecc8a);">✓ SIGNED</span>';
    } else if (e.signatureStatus === 'sent' || e.signatureStatus === 'viewed') {
      sigTag = '<span class="est-src-chip" style="background:rgba(232,114,12,.12);color:var(--orange);border-color:var(--orange);">✍ AWAITING</span>';
    } else if (e.signatureStatus === 'declined') {
      sigTag = '<span class="est-src-chip" style="background:rgba(197,48,48,.15);color:#ff6b6b;border-color:#ff6b6b;">✗ DECLINED</span>';
    } else if (e.signatureStatus === 'expired') {
      sigTag = '<span class="est-src-chip" style="opacity:.6;">⧗ EXPIRED</span>';
    }
    return ''
      + '<div class="est-card nbd-est-card" data-id="' + esc(e.id) + '">'
        + '<div class="est-card-main" data-act="open">'
          + '<div class="est-card-icon">📋</div>'
          + '<div class="est-card-body">'
            + '<div class="est-card-name">' + esc(displayName(e)) + '</div>'
            + '<div class="est-card-meta">'
              + esc(e.addr || 'No address') + ' · '
              + esc(e.roofType || '—') + ' · '
              + esc((e.sq != null ? Number(e.sq).toFixed(2) : '—')) + ' SQ · '
              + esc(e.tierName || '—')
            + '</div>'
            + '<div class="est-card-chips">'
              + leadTag + builderTag + sigTag
              + '<span class="est-date">' + esc(formatDate(e.createdAt || e.updatedAt)) + '</span>'
            + '</div>'
          + '</div>'
          + '<div class="est-card-total">$' + Number(e.grandTotal || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</div>'
        + '</div>'
        + '<div class="est-card-actions">'
          + '<button class="est-act-btn" data-act="open" title="Open & edit">✎ Edit</button>'
          + '<button class="est-act-btn" data-act="duplicate" title="Duplicate this estimate">⎘ Duplicate</button>'
          + '<button class="est-act-btn" data-act="rename" title="Rename estimate">✏ Rename</button>'
          + '<button class="est-act-btn" data-act="assign" title="Assign to customer">👤 Assign</button>'
          + '<button class="est-act-btn danger" data-act="delete" title="Delete estimate">🗑</button>'
        + '</div>'
      + '</div>';
  }).join('');

  // Single delegated handler for every action button on every
  // card. Walks up to .nbd-est-card to get the id, then dispatches
  // on data-act. CSP-clean (no inline onclicks, works under the
  // Report-Only script-src-attr 'none' policy).
  wrap.querySelectorAll('.nbd-est-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-act]');
      if (!target) return;
      const act = target.dataset.act;
      const id = card.dataset.id;
      if (!id) return;
      ev.stopPropagation();
      switch (act) {
        case 'open':       if (typeof viewEstimate === 'function') viewEstimate(id); break;
        case 'duplicate':  if (typeof duplicateEstimateAction === 'function') duplicateEstimateAction(id); break;
        case 'rename':     if (typeof renameEstimateAction === 'function') renameEstimateAction(id); break;
        case 'assign':     if (typeof assignEstimateAction === 'function') assignEstimateAction(id); break;
        case 'delete':     if (typeof deleteEstimateAction === 'function') deleteEstimateAction(id); break;
        case 'open-lead': {
          const leadId = target.dataset.lead;
          if (leadId) window.location.href = '/pro/customer.html?id=' + encodeURIComponent(leadId);
          break;
        }
      }
    });
  });

  // Recent on dashboard — each card opens that specific estimate
  const rc=document.getElementById('recentEsts');
  rc.innerHTML=ests.slice(0,4).map(e=>`
    <div class="est-card nbd-recent-est" data-id="${esc(e.id)}" style="margin-bottom:8px;cursor:pointer;">
      <div style="font-size:18px;">📋</div>
      <div><div class="est-addr" style="font-size:12px;">${esc(e.addr||'No address')}</div>
      <div class="est-meta">${esc(e.tierName||'')}</div></div>
      <div class="est-total" style="font-size:16px;">$${Number(e.grandTotal||0).toLocaleString('en-US',{maximumFractionDigits:0})}</div>
    </div>`).join('');
  rc.querySelectorAll('.nbd-recent-est').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      goTo('est');
      setTimeout(() => viewEstimate(id), 200);
    });
  });
  
  // Update weekly stats
  if (typeof calculateWeeklyStats === 'function') calculateWeeklyStats();
}

function viewEstimate(id) {
  const est = (window._estimates || []).find(e => e.id === id);
  if (!est) { showToast('Estimate not found — it may still be loading', 'error'); console.error('viewEstimate: not found in _estimates, id=', id, 'available:', (window._estimates||[]).map(e=>e.id)); return; }

  // Show builder, hide list
  const listEl = document.getElementById('est-list');
  const builderEl = document.getElementById('est-builder');
  if (listEl) listEl.style.display = 'none';
  if (builderEl) { builderEl.style.display = 'flex'; builderEl.style.flexDirection = 'column'; }
  const noteEl = document.getElementById('drawImportNote');
  if (noteEl) noteEl.style.display = 'none';

  // Update title to reflect editing
  const titleEl = document.getElementById('estBuilderTitle');
  if (titleEl) titleEl.textContent = 'Edit Estimate';

  // Populate Step 1 — Measurements (handle null/0 gracefully)
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = (val != null && val !== '') ? val : ''; };
  setVal('estAddr', est.addr);
  setVal('estOwner', est.owner);
  setVal('estParcel', est.parcel);
  setVal('estYear', est.yr);
  setVal('estRawSqft', est.raw);
  setVal('estRidge', est.ridge != null ? est.ridge : '');
  setVal('estEave', est.eave != null ? est.eave : '');
  setVal('estHip', est.hip != null ? est.hip : '');
  setVal('estPipes', est.pipes || 4);

  // Populate Step 2 — Roof Type, Pitch, Waste
  setVal('estRoofType', est.roofType);

  // Match pitch to dropdown option value (format: "factor|label" like "1.202|8/12")
  const pitchSel = document.getElementById('estPitch');
  if (pitchSel && est.pitch) {
    const pitchLabel = est.pitch; // e.g. "8/12"
    let matched = false;
    for (let i = 0; i < pitchSel.options.length; i++) {
      // Exact match on the label portion after the pipe
      const parts = pitchSel.options[i].value.split('|');
      if (parts[1] === pitchLabel || pitchSel.options[i].value === pitchLabel) {
        pitchSel.selectedIndex = i;
        matched = true;
        break;
      }
    }
    // Fallback: try includes match (handles edge cases)
    if (!matched) {
      for (let i = 0; i < pitchSel.options.length; i++) {
        if (pitchSel.options[i].value.includes('|' + pitchLabel)) {
          pitchSel.selectedIndex = i;
          break;
        }
      }
    }
  }

  // Restore waste factor if saved
  if (est.wf) {
    const wasteSel = document.getElementById('estWaste');
    if (wasteSel) {
      for (let i = 0; i < wasteSel.options.length; i++) {
        if (Math.abs(parseFloat(wasteSel.options[i].value) - parseFloat(est.wf)) < 0.001) {
          wasteSel.selectedIndex = i;
          break;
        }
      }
    }
  }

  // Restore linked lead
  window._estLinkedLeadId = est.leadId || null;

  // Store the Firestore doc ID so we can update instead of creating new
  window._editingEstimateId = est.id;

  // Set tier BEFORE calculating so syncRatesFromProductLibrary uses the right tier
  selectedTier = est.tier || 'good';

  // Reset estData and run calculations (order matters: updateEstCalc reads DOM, calcTierPrices needs estData)
  estData = {};
  updateEstCalc();
  calcTierPrices();

  // Select saved tier in the UI
  document.querySelectorAll('.tier-card').forEach(c => {
    c.classList.remove('selected');
    const onclick = c.getAttribute('onclick') || '';
    if (onclick.includes("'" + selectedTier + "'")) {
      c.classList.add('selected');
    }
  });

  // Enable the step 3 next button (since tier is pre-selected)
  const step3Btn = document.getElementById('estStep3Next');
  if (step3Btn) { step3Btn.disabled = false; step3Btn.style.opacity = '1'; }

  // Build review and jump to Step 4 (use requestAnimationFrame to ensure DOM is painted)
  requestAnimationFrame(() => {
    buildReview();
    showEstStep(4);
    showToast('Estimate loaded — review and save or edit any step', 'info');
  });
}
window.viewEstimate = viewEstimate;

// ══════════════════════════════════════════════
// CRM — extracted to /pro/js/crm.js
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// DAMAGE PHOTOS
// ══════════════════════════════════════════════
let currentPhotoLeadId=null, currentPhotoAddr='';

// ─── Photo count cache (April 2026) ───
// The "Photos Near Me" list used to show every lead in the CRM,
// sorted only by creation time. After knock segregation landed,
// knock-leads were still flooding this list. Worse: leads with
// zero photos were showing up first since they were newest,
// making it impossible to find a real customer with real photos
// when a homeowner was standing at the door.
//
// Fix: fetch photo counts per lead once, cache, then filter +
// sort the render to show photos-first and exclude prospects.
window._photoCountByLead = window._photoCountByLead || {};
window._photoCountsLoaded = false;

async function loadPhotoCounts() {
  if (window._photoCountsLoaded) return window._photoCountByLead;
  try {
    const uid = window._user?.uid;
    if (!uid) return {};
    // One Firestore read — all photos owned by this user. We only
    // need the leadId field, so we don't pull the actual photo data.
    const snap = await getDocs(query(
      collection(db, 'photos'),
      where('userId', '==', uid)
    ));
    const counts = {};
    snap.forEach(d => {
      const data = d.data();
      const lid = data.leadId;
      if (lid) counts[lid] = (counts[lid] || 0) + 1;
    });
    window._photoCountByLead = counts;
    window._photoCountsLoaded = true;
    return counts;
  } catch (e) {
    console.warn('[Photos Near Me] loadPhotoCounts failed:', e.message);
    return {};
  }
}

// Photo search — filters the photo leads list by name/address
window._photoSearchQuery = '';
function filterPhotoLeads(query) {
  window._photoSearchQuery = (query || '').toLowerCase().trim();
  renderPhotoLeads();
}

async function renderPhotoLeads(){
  const wrap=document.getElementById('photoLeadsList');

  // Ensure photo counts are loaded before we render so the sort
  // can put photos-first. First open shows a loading state; later
  // opens are instant because the counts cache hits.
  if (!window._photoCountsLoaded) {
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📸</div>Loading photo counts...</div>';
    await loadPhotoCounts();
  }

  const allLeads = window._leads || [];
  // Exclude prospects (hidden from kanban, should also be hidden
  // from the Photos Near Me picker — they're not real customers).
  const counts = window._photoCountByLead || {};
  let realLeads = allLeads.filter(l => !l.isProspect);
  // Apply search filter if the user typed in the photo search bar
  const _pq = window._photoSearchQuery || '';
  if (_pq) {
    realLeads = realLeads.filter(l => {
      const text = [l.firstName, l.lastName, l.address, l.phone, l.name].filter(Boolean).join(' ').toLowerCase();
      return text.includes(_pq);
    });
  }
  // "Only with photos" toggle — hides jobs that have zero photos
  if (window._photosOnlyWithPhotos) {
    realLeads = realLeads.filter(l => (counts[l.id] || 0) > 0);
  }

  if(!realLeads.length){
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📸</div>No customers yet. Add a lead or promote a prospect to attach photos.</div>';
    return;
  }

  // Smart rank: photos-first, then alphabetical by name
  const ranked = realLeads.slice().sort((a, b) => {
    const cntA = counts[a.id] || 0;
    const cntB = counts[b.id] || 0;
    if (cntA !== cntB) return cntB - cntA; // most photos first
    const nameA = ((a.firstName||'') + ' ' + (a.lastName||'')).trim() || a.address || '';
    const nameB = ((b.firstName||'') + ' ' + (b.lastName||'')).trim() || b.address || '';
    return nameA.localeCompare(nameB);
  });

  // Split into two sections: 'Jobs with photos' and 'Jobs without'
  const withPhotos = ranked.filter(l => (counts[l.id] || 0) > 0);
  const withoutPhotos = ranked.filter(l => !counts[l.id]);

  const e = window.nbdEsc || (s => String(s == null ? '' : s));
  const cardHTML = (l) => {
    const name = ((l.firstName||'')+ ' ' + (l.lastName||'')).trim() || l.name || 'Unknown';
    const addr = l.address || 'No address';
    const stage = l.stage || 'new';
    const stageLabel = {'new':'New','contacted':'Contacted','inspected':'Inspected','claim_filed':'Claim Filed','contract_signed':'Signed','closed':'Closed'}[stage] || stage.replace(/_/g,' ');
    const count = counts[l.id] || 0;
    const badgeBg = count > 0 ? '#22c55e' : 'var(--s3)';
    const badgeColor = count > 0 ? '#fff' : 'var(--m)';
    return `
    <div class="panel" style="margin:0;">
      <div class="panel-hdr nbd-photo-lead" style="cursor:pointer;" data-lead-id="${e(l.id)}" data-addr="${e(addr)}">
        <div>
          <div class="panel-label" style="display:flex;align-items:center;gap:6px;">
            📸 Photos
            <span style="background:${badgeBg};color:${badgeColor};font-size:9px;padding:1px 6px;border-radius:4px;font-weight:700;">${count} photo${count === 1 ? '' : 's'}</span>
            <span style="background:var(--s3);color:var(--orange);font-size:9px;padding:1px 6px;border-radius:4px;font-weight:700;">${e(stageLabel)}</span>
          </div>
          <div class="panel-title" style="font-size:14px;">${e(name)}</div>
          <div style="font-size:11px;color:var(--m);margin-top:2px;">📍 ${e(addr)}</div>
        </div>
        <button class="btn btn-orange" style="font-size:11px;padding:7px 14px;">${count > 0 ? '📷 View / Add' : '📷 Upload'}</button>
      </div>
    </div>`;
  };

  let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
  if (withPhotos.length) {
    html += '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green, #22c55e);padding:6px 2px 0;">📸 Jobs with Photos (' + withPhotos.length + ')</div>';
    html += withPhotos.map(cardHTML).join('');
  }
  if (withoutPhotos.length) {
    html += '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);padding:14px 2px 0;">Customers Without Photos (' + withoutPhotos.length + ')</div>';
    html += withoutPhotos.map(cardHTML).join('');
  }
  html += '</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.nbd-photo-lead').forEach(el => {
    el.addEventListener('click', () => {
      openPhotoFor(el.dataset.leadId, el.dataset.addr);
    });
  });
}

async function openPhotoFor(leadId, addr){
  currentPhotoLeadId=leadId; currentPhotoAddr=addr;
  document.getElementById('photoModalTitle').textContent='Damage Photos';
  document.getElementById('photoModalAddr').textContent=addr;
  document.getElementById('photoGridModal').innerHTML='<div style="font-size:12px;color:var(--m);padding:10px;text-align:center;">Loading...</div>';
  document.getElementById('photoModal').classList.add('open');
  const photos=await window._getPhotos(leadId);
  renderPhotoGrid(photos);
}

function closePhotoModal(){document.getElementById('photoModal').classList.remove('open');}
document.getElementById('photoModal').addEventListener('click',e=>{if(e.target===document.getElementById('photoModal'))closePhotoModal();});

function renderPhotoGrid(photos){
  const grid=document.getElementById('photoGridModal');
  if(!photos.length){grid.innerHTML='<p style="font-size:11px;color:var(--m);text-align:center;padding:10px;">No photos yet. Upload above.</p>';return;}
  // Build via DOM so user-controlled `p.url` and `p.name` cannot inject markup.
  grid.textContent='';
  const e = window.nbdEsc || (s => String(s == null ? '' : s));
  photos.forEach(p => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = p.name || '';
    img.addEventListener('click', () => {
      // Validate url before opening to avoid javascript: schemes.
      const safe = /^https?:/i.test(p.url) ? p.url : '#';
      window.open(safe, '_blank', 'noopener,noreferrer');
    });
    wrap.appendChild(img);
    grid.appendChild(wrap);
    void e; // keep helper referenced
  });
}

const PHOTO_MAX_SIZE = 15 * 1024 * 1024; // 15 MB per file
const PHOTO_MAX_BATCH = 25; // max photos per upload session (iOS 'Select All' safety cap)
const PHOTO_ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif'];

async function uploadPhotos(input){
  let files=Array.from(input.files);
  if(!files.length||!currentPhotoLeadId) return;

  // Batch cap — iPhone 'Select All' can grab 200+ photos. Cap at 25
  // to keep the browser responsive and avoid runaway Storage bills.
  if(files.length > PHOTO_MAX_BATCH){
    const dropped = files.length - PHOTO_MAX_BATCH;
    files = files.slice(0, PHOTO_MAX_BATCH);
    showToast(`Only the first ${PHOTO_MAX_BATCH} photos will upload. ${dropped} skipped — add them in the next batch.`, 'warning');
  }

  // Validate each file before uploading
  const valid = [];
  for(const f of files){
    if(!PHOTO_ALLOWED_TYPES.includes(f.type) && !f.name.match(/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i)){
      showToast(`"${f.name}" is not a supported image type`,'error'); continue;
    }
    if(f.size > PHOTO_MAX_SIZE){
      showToast(`"${f.name}" exceeds 15 MB limit (${(f.size/1024/1024).toFixed(1)} MB)`,'error'); continue;
    }
    valid.push(f);
  }
  if(!valid.length){ input.value=''; return; }

  showToast('Uploading '+valid.length+' photo(s)...');
  let uploaded = 0;
  for(const f of valid){
    const url = await window._uploadPhoto(currentPhotoLeadId,f);
    if(url) uploaded++;
  }
  const photos=await window._getPhotos(currentPhotoLeadId);
  renderPhotoGrid(photos);
  // Invalidate the photo-count cache so the Photos Near Me list
  // re-sorts this lead to the top (it just gained photos).
  if (window._photoCountByLead) {
    window._photoCountByLead[currentPhotoLeadId] =
      (window._photoCountByLead[currentPhotoLeadId] || 0) + uploaded;
  }
  showToast(uploaded === valid.length ? 'Photos uploaded!' : `${uploaded}/${valid.length} uploaded — some failed`);
  input.value='';
}

function damageNearMePhotos(){
  navigator.geolocation?.getCurrentPosition(async pos=>{
    showToast('Finding nearby inspections...');
    goTo('map');
    if(mainMap) mainMap.setView([pos.coords.latitude,pos.coords.longitude],14);
  },()=>showToast('Location access denied','error'));
}

// ══════════════════════════════════════════════
// STORM MAP
// ══════════════════════════════════════════════
let stormMap;
function initStormMap(){
  stormMap=L.map('stormMap').setView([39.4,-84.2],8);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:19}).addTo(stormMap);
  loadStorm();
}
async function loadStorm(){
  const list=document.getElementById('alertsList');
  list.innerHTML='<div style="font-size:11px;color:var(--m);">Loading alerts...</div>';
  try{
    const res=await fetch('https://api.weather.gov/alerts/active?area=OH',{headers:{'User-Agent':'NBDPro/1.0'}});
    const data=await res.json();
    const alerts=(data.features||[]).slice(0,8);
    if(!alerts.length){list.innerHTML='<div style="font-size:11px;color:var(--green);">✓ No active alerts for Ohio</div>';return;}
    const esc = window.nbdEsc || (s => String(s == null ? '' : s));
    list.innerHTML=alerts.map(a=>{
      const p=a.properties || {};
      return`<div style="background:rgba(224,82,82,.08);border:1px solid rgba(224,82,82,.25);border-left:3px solid var(--red);border-radius:6px;padding:9px;margin-bottom:7px;">
        <div style="font-size:11px;font-weight:700;color:var(--red);margin-bottom:3px;">⚠️ ${esc(p.event)}</div>
        <div style="font-size:10px;color:var(--m);">${esc(p.areaDesc)}</div>
        <div style="font-size:10px;color:var(--m);margin-top:3px;">${esc(String(p.headline||'').substring(0,120))}</div>
      </div>`;
    }).join('');
    if(stormMap) alerts.forEach(a=>{if(a.geometry)L.geoJSON(a.geometry,{style:{color:'var(--red)',weight:2,fillOpacity:.12}}).addTo(stormMap);});
  }catch(e){list.innerHTML='<div style="font-size:11px;color:var(--m);">Could not load alerts.</div>';}
}

// ══════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════
async function renderLeaderboard(){
  const WON = ['closed','install_complete','final_photos','final_payment','deductible_collected','Complete'];
  const leads = window._leads || [];
  const db = window._db || window.db;
  const uid = window._user?.uid;
  const lbEl = document.getElementById('lbRows');
  if (!lbEl) return;

  // Build rep stats from leads
  const reps = {};
  leads.filter(l => !l.deleted).forEach(l => {
    const n = l.repName || window._user?.displayName || 'You';
    if (!reps[n]) reps[n] = { name: n, leads: 0, won: 0, revenue: 0, knocks: 0 };
    reps[n].leads++;
    if (WON.includes(l._stageKey || l.stage || '')) {
      reps[n].won++;
      reps[n].revenue += parseFloat(l.jobValue) || 0;
    }
  });

  // Enrich with knock data if available
  if (db && uid) {
    try {
      const snap = await window.getDocs(window.query(window.collection(db, 'knocks'), window.where('userId', '==', uid)));
      const knockCount = snap.size;
      // Assign knocks to first (or only) rep
      const repKeys = Object.keys(reps);
      if (repKeys.length > 0) reps[repKeys[0]].knocks = knockCount;
      else reps[window._user?.displayName || 'You'] = { name: window._user?.displayName || 'You', leads: 0, won: 0, revenue: 0, knocks: knockCount };
    } catch (e) { /* knocks may not have index — skip */ }
  }

  // If still empty show a friendly message
  if (!Object.keys(reps).length) {
    lbEl.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--m);font-size:13px;"><div style="font-size:28px;margin-bottom:8px;">📊</div>No data yet. Close deals to appear on the leaderboard.</div>';
    return;
  }

  const sorted = Object.values(reps).sort((a, b) => b.won - a.won || b.revenue - a.revenue);
  const medals = ['🥇', '🥈', '🥉'];
  const maxWon = sorted[0]?.won || 1;

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  lbEl.innerHTML = sorted.map((r, i) => {
    const rateStr = r.leads ? Math.round(r.won / r.leads * 100) + '%' : '—';
    const revStr = r.revenue > 0 ? '$' + (r.revenue >= 1000 ? (r.revenue / 1000).toFixed(1) + 'K' : Math.round(r.revenue)) : '$0';
    const barW = Math.round((r.won / maxWon) * 100);
    const knockStr = r.knocks > 0 ? ' · ' + Number(r.knocks) + ' doors' : '';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--br);">' +
      '<div style="font-size:20px;width:28px;text-align:center;">' + (medals[i] || '#' + (i + 1)) + '</div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:13px;font-weight:600;">' + esc(r.name) + '</div>' +
        '<div style="font-size:11px;color:var(--m);">' + Number(r.leads || 0) + ' leads · ' + Number(r.won || 0) + ' won · ' + esc(rateStr) + ' close rate' + esc(knockStr) + '</div>' +
        '<div style="background:var(--s3);border-radius:4px;height:5px;margin-top:6px;overflow:hidden;"><div style="height:100%;border-radius:4px;background:var(--orange);width:' + barW + '%;transition:width .6s;"></div></div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:20px;font-weight:700;color:var(--orange);">' + r.won + ' <span style="font-size:11px;color:var(--m);">WON</span></div>' +
        '<div style="font-size:10px;color:var(--m);margin-top:2px;">' + revStr + ' revenue</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ══════════════════════════════════════════════
// TIPS
// ══════════════════════════════════════════════
function openTips(){document.getElementById('tipsModal').classList.add('open');}
function closeTips(){document.getElementById('tipsModal').classList.remove('open');}
document.getElementById('tipsModal').addEventListener('click',e=>{if(e.target===document.getElementById('tipsModal'))closeTips();});

// ══════════════════════════════════════════════
// GEOCODE HELPER
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// PROPERTY INTEL ENGINE
// ══════════════════════════════════════════════

// County → auditor URL builder
function getAuditorUrl(county, address, nominatimData) {
  const c = (county||'').toLowerCase();
  if(c.includes('hamilton')) {
    // Hamilton County: use address search page
    const a = nominatimData?.address || {};
    const num  = (a.house_number||'').toUpperCase();
    const road = (a.road||a.street||'').toUpperCase().replace(/\s+/g,' ').trim();
    return `https://wedge1.hcauditor.org/search/address/${encodeURIComponent(num)}/${encodeURIComponent(road)}//1/10`;
  }
  if(c.includes('clermont')) {
    return `https://www.wcauditor.org/PropertySearch/`; // fallback — Clermont uses different system
  }
  if(c.includes('warren')) {
    return `https://www.wcauditor.org/PropertySearch/`;
  }
  if(c.includes('butler')) {
    const a = nominatimData?.address || {};
    const num  = (a.house_number||'').toUpperCase();
    const road = (a.road||a.street||'').toUpperCase();
    return `https://propertysearch.bcohio.gov/search/commonsearch.aspx?mode=address`;
  }
  return null;
}

// Determine direct summary URL for Hamilton (most used county)
function getHamiltonSummaryUrl(parcelId) {
  // Hamilton parcel IDs look like: 040-0003-0039-00
  // URL: wedge1.hcauditor.org/view/re/0400003003900/2024/summary
  const clean = parcelId.replace(/-/g,'').replace(/\s/g,'');
  return `https://wedge1.hcauditor.org/view/re/${clean}/2024/summary`;
}

// Cache to avoid repeat lookups on same address
var _piCache = _piCache || {};

async function fetchPropertyIntel(nominatimData, targetElId) {
  const targetEl = document.getElementById(targetElId);

  // Determine county from Nominatim response
  const addr = nominatimData?.address || {};
  const county = addr.county || addr.state_district || '';
  const countyClean = county.replace(' County','').trim();

  // Build the clean address for searching
  const num   = addr.house_number || '';
  const road  = addr.road || addr.street || '';
  const city  = addr.city || addr.town || addr.village || '';
  const state = addr.state_code || addr.state || 'OH';
  const zip   = addr.postcode || '';
  const fullAddr = [num+' '+road, city, state+' '+zip].map(s=>s.trim()).filter(Boolean).join(', ');

  // Cache check
  const cacheKey = fullAddr.toLowerCase().replace(/\s/g,'');
  if(_piCache[cacheKey]) {
    renderIntelCard(targetElId, _piCache[cacheKey], countyClean, fullAddr);
    return;
  }

  // Build the auditor URL based on county
  let auditorUrl = '';
  let searchUrl  = '';

  if(county.toLowerCase().includes('hamilton')) {
    const numEnc  = encodeURIComponent(num.toUpperCase());
    const roadEnc = encodeURIComponent(road.toUpperCase());
    // Hamilton address search returns list with parcel IDs
    auditorUrl = `https://wedge1.hcauditor.org/search/address/${numEnc}/${roadEnc}//1/10`;
    searchUrl  = auditorUrl;
  } else if(county.toLowerCase().includes('clermont')) {
    auditorUrl = `https://www.clermontauditor.org/real-estate/`;
    searchUrl  = `https://opendata.clermontauditor.org/resource/ti6j-ub22.json?$$app_token=&$where=situs_address+like+%27${encodeURIComponent(num+'%25')}%27&$limit=5`;
  } else if(county.toLowerCase().includes('warren')) {
    auditorUrl = `https://www.wcauditor.org/PropertySearch/`;
  } else if(county.toLowerCase().includes('butler')) {
    auditorUrl = `https://propertysearch.bcohio.gov/search/commonsearch.aspx?mode=address`;
  } else {
    // Unknown county — use Claude to try to find it
    auditorUrl = `https://www.hamiltoncountyauditor.org/`;
  }

  // ── Claude-powered extraction ─────────────────────────────────
  // For Hamilton we can fetch the search page HTML and parse parcel ID,
  // then fetch the summary page. For others, we ask Claude to help interpret.

  try {
    // Step 1: Ask Claude to look up the property data
    const prompt = `You are a property data extraction assistant for a roofing contractor app covering the Cincinnati, Ohio metro area (Hamilton, Clermont, Warren, Butler counties).

The user needs property intel for this address: "${fullAddr}"
County: ${countyClean || 'unknown — likely Hamilton or Clermont, OH'}

Your job: Return ONLY a valid JSON object with these fields (use null for unknown):
{
  "ownerName": "FULL NAME OR LLC NAME",
  "isLLC": true/false,
  "yearBuilt": 1985,
  "roofAge": 40,
  "lastSaleDate": "MM/DD/YYYY",
  "lastSaleAmount": 245000,
  "marketValue": 310000,
  "assessedValue": 108500,
  "propertyType": "Single Family",
  "bedrooms": 3,
  "sqft": 1850,
  "acreage": 0.25,
  "homestead": true,
  "ownerOccupied": true,
  "taxDistrict": "CINTI CORP",
  "parcelId": "040-0003-0039-00",
  "auditorUrl": "${auditorUrl}",
  "dataSource": "Hamilton County Auditor"
}

To find this data, use the Hamilton County auditor search at: ${auditorUrl}
The page at wedge1.hcauditor.org/search/address/[HOUSE_NUMBER]/[STREET_NAME]//1/10 returns matching parcels.
Then wedge1.hcauditor.org/view/re/[PARCEL_ID_NO_DASHES]/2024/summary has the full record.

For the address "${fullAddr}", search the auditor, find the parcel, and extract all available fields.
If you cannot access the page, return your best estimate with "dataSource": "estimated" and null for unknown fields.
RETURN ONLY THE JSON OBJECT. No explanation, no markdown, no preamble.`;

    if (!window.callClaude) {
      throw new Error('Claude proxy not loaded. Refresh the page and try again.');
    }

    const data = await window.callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{role: 'user', content: prompt}]
    });

    // Extract text from Anthropic response
    let rawText = data?.content?.[0]?.text || '';

    // Parse JSON from response
    let intel = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if(jsonMatch) intel = JSON.parse(jsonMatch[0]);
    } catch(e) {}

    if(!intel) throw new Error('No parseable data returned');

    // Compute roofAge if we have yearBuilt but not roofAge
    if(intel.yearBuilt && !intel.roofAge) {
      intel.roofAge = new Date().getFullYear() - parseInt(intel.yearBuilt);
    }

    _piCache[cacheKey] = intel;
    renderIntelCard(targetElId, intel, countyClean, fullAddr);

  } catch(err) {
    if(targetEl) {
      const card = targetEl.querySelector('.pi-card');
      const errHtml = `<div class="pi-card"><div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county">${countyClean}</span></div><div class="pi-error">Could not load property data. Check your API key or try again.<br><small>${err.message}</small></div></div>`;
      if(card) card.outerHTML = errHtml;
    }
  }
}

function renderIntelCard(targetElId, intel, county, address) {
  const targetEl = document.getElementById(targetElId);
  if(!targetEl) return;

  // Store intel globally for pre-fill
  window._lastIntel = intel;

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  const yr = intel.yearBuilt ? parseInt(intel.yearBuilt) : null;
  const age = yr ? (new Date().getFullYear() - yr) : null;
  const roofAge = intel.roofAge || age;

  let roofBadgeClass = 'pi-roof-mid';
  let roofLabel = '';
  if(roofAge !== null) {
    const rn = Number(roofAge);
    if(rn < 10)      { roofBadgeClass='pi-roof-new';     roofLabel=`${rn} yrs — Likely good`; }
    else if(rn < 20) { roofBadgeClass='pi-roof-mid';     roofLabel=`${rn} yrs — Watch it`; }
    else if(rn < 30) { roofBadgeClass='pi-roof-old';     roofLabel=`${rn} yrs — Needs attention`; }
    else             { roofBadgeClass='pi-roof-ancient'; roofLabel=`${rn} yrs — Due for replacement`; }
  }

  const ownerName  = intel.ownerName || 'Owner Unknown';
  const isLLC     = intel.isLLC || /LLC|INC|CORP|TRUST|PROPERTIES|HOLDINGS|INVESTMENTS/i.test(ownerName);
  const lastSale  = intel.lastSaleAmount ? '$'+parseInt(intel.lastSaleAmount).toLocaleString() : null;
  const mktVal    = intel.marketValue ? '$'+parseInt(intel.marketValue).toLocaleString() : null;
  const dataNote  = intel.dataSource === 'estimated' ? ' (est.)' : '';
  const safeAuditor = /^https?:/i.test(intel.auditorUrl || '') ? intel.auditorUrl : null;

  const card = `<div class="pi-card">
    <div class="pi-header">
      <span class="pi-title">🏠 Property Intel${esc(dataNote)}</span>
      <span class="pi-county">${esc(county || 'OH')} County</span>
    </div>
    <div class="pi-body">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
        <span class="pi-owner">${esc(ownerName)}</span>
        ${isLLC ? '<span class="pi-llc-flag">🏢 LLC/Corp</span>' : ''}
      </div>
      <div class="pi-addr-line">${esc(address)}</div>
      ${roofAge !== null ? `<div class="pi-roof-badge ${esc(roofBadgeClass)}">🏠 ${esc(roofLabel)}</div>` : ''}
      <div class="pi-grid">
        ${yr ? `<div class="pi-stat"><span class="pi-stat-val">${Number(yr)}</span><span class="pi-stat-key">Year Built</span></div>` : ''}
        ${intel.propertyType ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.propertyType)}</span><span class="pi-stat-key">Type</span></div>` : ''}
        ${mktVal ? `<div class="pi-stat"><span class="pi-stat-val">${esc(mktVal)}</span><span class="pi-stat-key">Market Value</span></div>` : ''}
        ${lastSale ? `<div class="pi-stat"><span class="pi-stat-val">${esc(lastSale)}</span><span class="pi-stat-key">Last Sale</span></div>` : ''}
        ${intel.lastSaleDate ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.lastSaleDate)}</span><span class="pi-stat-key">Sale Date</span></div>` : ''}
        ${intel.bedrooms ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.bedrooms)} bed</span><span class="pi-stat-key">Bedrooms</span></div>` : ''}
        ${intel.sqft ? `<div class="pi-stat"><span class="pi-stat-val">${parseInt(intel.sqft).toLocaleString()} sf</span><span class="pi-stat-key">Living Area</span></div>` : ''}
        ${intel.acreage ? `<div class="pi-stat"><span class="pi-stat-val">${parseFloat(intel.acreage).toFixed(3)} ac</span><span class="pi-stat-key">Acreage</span></div>` : ''}
        ${intel.homestead ? `<div class="pi-stat"><span class="pi-stat-val" style="color:var(--green);">Yes</span><span class="pi-stat-key">Homestead</span></div>` : ''}
        ${intel.parcelId ? `<div class="pi-stat"><span class="pi-stat-val" style="font-size:10px;">${esc(intel.parcelId)}</span><span class="pi-stat-key">Parcel ID</span></div>` : ''}
      </div>
      ${safeAuditor ? `<a class="pi-link" href="${esc(safeAuditor)}" target="_blank" rel="noopener noreferrer">↗ View Full County Record</a>` : ''}
    </div>
  </div>`;

  // Replace loading card, keep Make This a Lead button
  const existingCard = targetEl.querySelector('.pi-card');
  if(existingCard) {
    existingCard.outerHTML = card;
  } else {
    targetEl.innerHTML = card + '<button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>';
  }
}

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

async function fetchPropertyIntelModal(geo, addr) {
  const resultEl = document.getElementById('modalIntelResult');
  const gAddr = geo.address || {};
  const county = (gAddr.county||'').replace(' County','').trim();

  // Run same engine but capture result for modal
  const cacheKey = addr.toLowerCase().replace(/\s/g,'');
  let intel = _piCache[cacheKey] || null;

  if(!intel) {
    // Temporarily show result container
    resultEl.innerHTML = '<div style="color:var(--m);font-size:11px;">Fetching county records...</div>';
    resultEl.classList.add('visible');
    // Fire the intel engine with a temp container
    const tempId = 'pi-temp-' + Date.now();
    const tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
    await fetchPropertyIntel(geo, tempId);
    intel = window._lastIntel || null;
    document.body.removeChild(tempDiv);
  }

  if(!intel) {
    resultEl.innerHTML = '<div style="color:var(--red);font-size:11px;">Could not retrieve property data. Check your API key in Settings.</div>';
    resultEl.classList.add('visible');
    return;
  }

  // Pre-fill lead modal fields
  if(intel.ownerName && intel.ownerName !== 'Owner Unknown') {
    const parts = intel.ownerName.trim().split(/\s+/);
    const fname = document.getElementById('lFname');
    const lname = document.getElementById('lLname');
    if(fname && !fname.value) {
      if(parts.length >= 2) {
        fname.value = parts[0];
        lname.value = parts.slice(1).join(' ');
      } else {
        fname.value = intel.ownerName;
      }
    }
  }

  // Build notes pre-fill
  const notesEl = document.getElementById('lNotes');
  if(notesEl && !notesEl.value) {
    const yr = intel.yearBuilt;
    const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
    const lines = [];
    if(yr) lines.push(`Year Built: ${yr} (${age} yr old roof)`);
    if(intel.ownerName) lines.push(`Owner of Record: ${intel.ownerName}`);
    if(intel.propertyType) lines.push(`Property: ${intel.propertyType}`);
    if(intel.marketValue) lines.push(`Market Value: $${parseInt(intel.marketValue).toLocaleString()}`);
    if(intel.lastSaleDate && intel.lastSaleAmount) lines.push(`Last Sale: $${parseInt(intel.lastSaleAmount).toLocaleString()} on ${intel.lastSaleDate}`);
    if(intel.isLLC) lines.push('Owner is LLC/Corporate entity');
    notesEl.value = lines.join('\n');
  }

  // Store yearBuilt for Firestore save
  window._modalIntel = intel;

  // Show compact result card
  const yr = intel.yearBuilt;
  const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
  const roofAge = intel.roofAge || age;
  let roofColor = 'var(--gold)';
  if(roofAge !== null) {
    if(roofAge < 10) roofColor = 'var(--green)';
    else if(roofAge < 20) roofColor = 'var(--gold)';
    else if(roofAge < 30) roofColor = 'var(--red)';
    else roofColor = 'var(--purple)';
  }

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  resultEl.innerHTML = `
    <div class="mir-owner">${esc(intel.ownerName||'Unknown Owner')}${intel.isLLC?'&nbsp;<span style="font-size:9px;color:var(--blue);font-weight:700;">LLC</span>':''}</div>
    <div class="mir-grid">
      ${yr ? `<div class="mir-item">Built <span>${esc(yr)}</span></div>` : ''}
      ${roofAge !== null ? `<div class="mir-item">Roof <span style="color:${esc(roofColor)};">${Number(roofAge)} yrs</span></div>` : ''}
      ${intel.marketValue ? `<div class="mir-item">Value <span>$${parseInt(intel.marketValue).toLocaleString()}</span></div>` : ''}
      ${intel.propertyType ? `<div class="mir-item">Type <span>${esc(intel.propertyType)}</span></div>` : ''}
      ${intel.bedrooms ? `<div class="mir-item">Beds <span>${esc(intel.bedrooms)}</span></div>` : ''}
      ${intel.homestead ? `<div class="mir-item">Homestead <span style="color:var(--green);">Yes</span></div>` : ''}
    </div>
    <div style="font-size:10px;color:var(--m);margin-top:5px;">✓ Owner name and notes pre-filled below</div>`;
  resultEl.classList.add('visible');
}

async function geocode(q){
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`);
    const d=await res.json();
    if(!d.length){showToast('Address not found','error');return null;}
    return d[0];
  }catch(e){showToast('Geocode failed','error');return null;}
}

// ══════════════════════════════════════════════
// ADDRESS AUTOCOMPLETE ENGINE
// ══════════════════════════════════════════════
const _acTimers = {};
const _acCache  = {};

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

async function fetchAcSuggestions(inputId, q, onSelect) {
  const drop = document.getElementById('ac-' + inputId);
  if(!drop) return;

  // Cache hit
  if(_acCache[q]) { renderAcDrop(inputId, _acCache[q], onSelect); return; }

  drop.innerHTML = '<div class="ac-spinner">Searching...</div>';
  drop.style.display = 'block';

  try {
    // Bias to Ohio/Cincinnati area for better local results
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1&countrycodes=us&viewbox=-84.9,38.4,-83.6,39.7&bounded=0`;
    const res = await fetch(url);
    const data = await res.json();
    _acCache[q] = data;
    renderAcDrop(inputId, data, onSelect);
  } catch(e) {
    drop.style.display = 'none';
  }
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

// Wave 141: USPS-standard road-suffix abbreviations + state name →
// 2-letter code mapping. Used by formatMailingAddress() below to
// produce a USPS-compliant single-line label like
// "1054 Klondyke Rd, Goshen, OH 45122" instead of the old
// comma-spliced "1054, Klondyke Road, Goshen".
//
// Source list mirrors USPS Pub 28 Appendix C — only the suffixes
// nominatim is realistically going to surface in the US (the full
// pub has 200+ variants we'd never see). Comparison is case-
// insensitive on the LAST whitespace-delimited token of road.
const _USPS_SUFFIX = Object.freeze({
  alley: 'Aly', avenue: 'Ave', boulevard: 'Blvd', branch: 'Br',
  bridge: 'Br', center: 'Ctr', circle: 'Cir', cliff: 'Clf',
  commons: 'Cmns', common: 'Cmn', corner: 'Cor', court: 'Ct',
  cove: 'Cv', creek: 'Crk', crossing: 'Xing', cross: 'Xrd',
  dale: 'Dl', divide: 'Dv', drive: 'Dr', estate: 'Est',
  expressway: 'Expy', extension: 'Ext', fall: 'Fall', fork: 'Frk',
  fort: 'Ft', freeway: 'Fwy', garden: 'Gdn', glen: 'Gln',
  green: 'Grn', grove: 'Grv', harbor: 'Hbr', haven: 'Hvn',
  heights: 'Hts', highway: 'Hwy', hill: 'Hl', hills: 'Hls',
  hollow: 'Holw', island: 'Is', junction: 'Jct', key: 'Ky',
  knoll: 'Knl', lake: 'Lk', land: 'Land', landing: 'Lndg',
  lane: 'Ln', light: 'Lgt', loaf: 'Lf', locks: 'Lcks',
  lodge: 'Ldg', loop: 'Loop', mall: 'Mall', manor: 'Mnr',
  meadow: 'Mdw', meadows: 'Mdws', mews: 'Mews', mill: 'Ml',
  mission: 'Msn', motorway: 'Mtwy', mount: 'Mt', mountain: 'Mtn',
  neck: 'Nck', orchard: 'Orch', overpass: 'Opas', park: 'Park',
  parkway: 'Pkwy', pass: 'Pass', passage: 'Psge', path: 'Path',
  pike: 'Pike', pine: 'Pne', place: 'Pl', plain: 'Pln',
  plaza: 'Plz', point: 'Pt', port: 'Prt', prairie: 'Pr',
  radial: 'Radl', ramp: 'Ramp', ranch: 'Rnch', rapids: 'Rpds',
  rest: 'Rst', ridge: 'Rdg', river: 'Riv', road: 'Rd',
  route: 'Rte', row: 'Row', run: 'Run', shoal: 'Shl',
  shore: 'Shr', skyway: 'Skwy', spring: 'Spg', square: 'Sq',
  station: 'Sta', stream: 'Strm', street: 'St', summit: 'Smt',
  terrace: 'Ter', throughway: 'Trwy', trace: 'Trce', track: 'Trak',
  trafficway: 'Trfy', trail: 'Trl', tunnel: 'Tunl', turnpike: 'Tpke',
  underpass: 'Upas', union: 'Un', valley: 'Vly', via: 'Via',
  viaduct: 'Via', view: 'Vw', village: 'Vlg', ville: 'Vl',
  vista: 'Vis', walk: 'Walk', way: 'Way', well: 'Wl',
});
const _STATE_2L = Object.freeze({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR',
  california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI',
  idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  // Territories that USPS handles
  'puerto rico': 'PR', 'us virgin islands': 'VI', guam: 'GU',
  'american samoa': 'AS', 'northern mariana islands': 'MP',
});

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

  // mapSearch — on select, trigger full map search
  window._acCallbacks['mapSearch'] = (r, label) => {
    window._lastMapSearch = r;
    if(mainMap) mainMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 19);
    document.getElementById('propCard').style.display = 'block';
    document.getElementById('propCardInner').innerHTML = `
      <div class="pi-card">
        <div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county"></span></div>
        <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
      </div>
      <button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>`;
    fetchPropertyIntel(r, 'propCardInner');
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
// DOCUMENT LIBRARY
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
<p><span class="field-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
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
function openUploadDoc(){ document.getElementById('docUploadArea').style.display='block'; }

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
function closeUploadDoc(){ document.getElementById('docUploadArea').style.display='none'; }
let _docFile = null;
function handleDocUpload(inp){ _docFile = inp.files[0]; showToast('File selected: '+(_docFile?.name||''),'ok'); }
async function saveDocUpload(){
  const name = document.getElementById('docName')?.value.trim();
  const cat  = document.getElementById('docCategory')?.value;
  if(!name||!_docFile){ showToast('Add a name and select a file','error'); return; }
  try {
    const storageRef = window._storage.ref ? window._storage.ref('docs/'+Date.now()+'_'+_docFile.name) : null;
    if(storageRef){
      await uploadBytes(storageRef, _docFile);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(window._db,'documents'), {name,category:cat,url,fileName:_docFile.name,createdAt:serverTimestamp(),userId:window._user?.uid});
    }
    showToast('Document uploaded!','ok');
    closeUploadDoc();
    loadDocs();
  } catch(e){ showToast('Upload failed — '+e.message,'error'); }
}
async function loadDocs(){
  try {
    const _duid = window._user?.uid;
    if (!_duid) { if(wrap) wrap.innerHTML='<div class="empty"><div class="empty-icon">📁</div>No documents yet.</div>'; return; }
    const snap = await getDocs(query(collection(window._db,'documents'), window.where('userId','==',_duid)));
    const docs = snap.docs.map(d=>({id:d.id,...d.data()}));
    const wrap = document.getElementById('uploadedDocsWrap');
    if(!wrap) return;
    if(!docs.length){ wrap.innerHTML='<div class="empty"><div class="empty-icon">📁</div>No uploaded documents yet.</div>'; return; }
    const esc = window.nbdEsc || (s => String(s == null ? '' : s));
    wrap.innerHTML = docs.map(d=>{
      // Only allow http(s) URLs — prevents javascript: and data: schemes.
      const safeUrl = /^https?:/i.test(d.url || '') ? d.url : '#';
      return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--br);">
        <div style="font-size:20px;">📄</div>
        <div style="flex:1;"><div style="font-weight:600;font-size:13px;">${esc(d.name)}</div><div style="font-size:10px;color:var(--m);">${esc(d.category)} · ${esc(d.fileName||'')}</div></div>
        <a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="font-size:11px;padding:5px 10px;">Open</a>
      </div>`;
    }).join('');
  } catch(e){ console.error('loadDocs error:',e); }
}


// ══════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════

const THEME_KEYS = [
  // Original 16
  'nbd-original', 'midnight', 'cobalt', 'forest', 'crimson', 'gold', 'plasma', 'arctic', 'rose', 'obsidian', 'neon', 'steel', 'paper', 'slate', 'coffee', 'deep-space',
  // v5 additions
  'matrix','galaxy','ghost','glow','batman','darth-vader','lightsaber','pokemon','mario','zelda','arcade','retro','synthwave','vaporwave','lofi','typewriter','ink','blueprint-art',
  'army','cia','ninja','halloween','christmas','easter','underwater','volcanic','japan','wildwest','samurai',
  'android','ios','ios26','windows','terminal',
  'liquid','metal','translucent','frosted',
  'candlelit','ember','midnight-oil','deep-focus','neon-rain','noir','blood-moon','aurora','obsidian-v5','copper','sakura'
];
const DEFAULT_THEME = 'nbd-original';

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

// Boot the theme immediately on page load
(function() {
  try {
    const saved = localStorage.getItem('nbd-theme');
    if(saved && saved !== '') document.documentElement.setAttribute('data-theme', saved);
    else document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  }
})();

// ── KANBAN DENSITY + HIERARCHY ─────────────────────────────────────────────
// Sets data-density / data-bold attrs on <html>; CSS reacts via :root[data-density="..."]
const KANBAN_DENSITY_KEY = 'nbd-kanban-density';
const KANBAN_BOLD_KEY = 'nbd-kanban-bold';

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

(function bootKanbanPrefs() {
  try {
    const d = localStorage.getItem(KANBAN_DENSITY_KEY) || 'comfortable';
    if (d !== 'comfortable') document.documentElement.setAttribute('data-density', d);
    const bold = localStorage.getItem(KANBAN_BOLD_KEY) === '1';
    if (bold) document.documentElement.setAttribute('data-bold', 'true');
  } catch (e) {}
})();

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
let _nbdAutoThemeInterval = null;

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

// Boot persisted comfort prefs on first load (alongside density
// which already gets applied in bootKanbanPrefs above).
(function bootComfortPrefs() {
  try {
    const size = localStorage.getItem('nbd_text_size');
    if (size && size !== 'medium') document.documentElement.setAttribute('data-text-size', size);
    const motion = localStorage.getItem('nbd_motion');
    if (motion === 'reduce') document.documentElement.setAttribute('data-motion', 'reduce');
    const pro = localStorage.getItem('nbd_professional_mode');
    if (pro === '1') document.body.classList.add('professional-mode');
    // W106: restore color-blind-safe pref on load
    const cbSafe = localStorage.getItem('nbd_cb_safe');
    if (cbSafe === '1') document.documentElement.setAttribute('data-cb-safe', '1');
  } catch (_) {}
})();
// Sync the comfort tab when the picker opens.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(nbdComfortRefresh, 250);
});

// ══════════════════════════════════════════════════════════════════
// PIPELINE PAGE-BREATHE — sidebar collapse, fullscreen, Tools menu,
// FAB visibility, scroll-collapse, ESC handling.
// One self-contained block so future changes touch one place.
// ══════════════════════════════════════════════════════════════════
const SIDEBAR_COLLAPSED_KEY = 'nbd-sidebar-collapsed';

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
const CRM_AUTOCOLLAPSE_KEY = 'nbd-crm-autocollapse';
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

// Boot: restore sidebar collapse state + ESC to exit fullscreen
(function bootPageBreathe() {
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') {
      document.body.classList.add('sidebar-collapsed');
      const btn = document.getElementById('sidebarToggleBtn');
      if (btn) btn.classList.add('active');
    }
  } catch (e) {}
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

// ── DAILY PROGRAM SETTINGS ────────────────────────────────────────────────
const DS_NBD_CFG = 'nbd_user_config';
const DS_THEME_KEY = 'ds-theme';

const DS_THEMES = [
  { key:'nbd-original', label:'NBD Original', dot:'var(--orange)' },
  { key:'midnight',     label:'Midnight',     dot:'#6366f1' },
  { key:'cobalt',       label:'Cobalt',       dot:'#2563eb' },
  { key:'forest',       label:'Forest',       dot:'#16a34a' },
  { key:'crimson',      label:'Crimson',      dot:'#dc2626' },
  { key:'gold',         label:'Gold',         dot:'#d97706' },
  { key:'plasma',       label:'Plasma',       dot:'#a855f7' },
  { key:'arctic',       label:'Arctic',       dot:'#0ea5e9' },
  { key:'rose',         label:'Rose',         dot:'#e11d48' },
  { key:'obsidian',     label:'Obsidian',     dot:'#71717a' },
  { key:'neon',         label:'Neon',         dot:'#00cc6a' },
  { key:'coffee',       label:'Coffee',       dot:'#92400e' },
];

let dsFloors = [];
let dsSelectedTheme = 'nbd-original';

function dsGetConfig() {
  try { return JSON.parse(localStorage.getItem(DS_NBD_CFG)) || null; } catch { return null; }
}

function dsLoadConfig() {
  const cfg = dsGetConfig();
  if (cfg) {
    if (cfg.northStar) {
      const catEl = document.getElementById('ds-cat');
      if (catEl) catEl.value = cfg.northStar.category || 'Other';
      const tEl = document.getElementById('ds-target');
      if (tEl) tEl.value = cfg.northStar.target || '';
      const dEl = document.getElementById('ds-deadline');
      if (dEl) dEl.value = cfg.northStar.deadline || '';
    }
    if (cfg.floors && cfg.floors.length) {
      dsFloors = cfg.floors.map(f => ({...f}));
    } else {
      dsFloors = dsDefaultFloors();
    }
    const gEl = document.getElementById('ds-goose');
    if (gEl) gEl.value = cfg.goose || '';
    const sgEl = document.getElementById('ds-showgoose');
    if (sgEl) sgEl.checked = cfg.showGoose !== false;
  } else {
    dsFloors = dsDefaultFloors();
  }
  // Load daily theme
  try {
    const saved = localStorage.getItem(DS_THEME_KEY);
    dsSelectedTheme = (saved && DS_THEMES.find(t => t.key === saved)) ? saved : 'nbd-original';
  } catch { dsSelectedTheme = 'nbd-original'; }
  dsRenderFloors();
  dsBuildThemeGrid();
}

function dsDefaultFloors() {
  return [
    { id:'df1', label:'Doors knocked', targetValue:50, unit:'doors' },
    { id:'df2', label:'Workout', targetValue:1, unit:'done' },
    { id:'df3', label:'Sleep 7+ hrs', targetValue:7, unit:'hrs' },
    { id:'df4', label:'Protein goal', targetValue:150, unit:'g' },
    { id:'df5', label:'1 big task done', targetValue:1, unit:'done' },
  ];
}

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

function dsAddFloor() {
  if (dsFloors.length >= 7) { showToast('Max 7 floors'); return; }
  dsFloors.push({ id: 'f' + Date.now(), label: '', targetValue: 1, unit: 'done' });
  dsRenderFloors();
}

function dsRemoveFloor(i) {
  dsFloors.splice(i, 1);
  dsRenderFloors();
}

function dsBuildThemeGrid() {
  const grid = document.getElementById('ds-theme-grid');
  if (!grid) return;
  grid.innerHTML = DS_THEMES.map(t => `
    <div onclick="dsPickTheme('${t.key}')" id="ds-tc-${t.key}" style="
      cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;
      padding:10px 6px;border-radius:6px;border:2px solid ${t.key===dsSelectedTheme?'var(--orange)':'var(--br)'};
      background:${t.key===dsSelectedTheme?'rgba(232,114,12,.08)':'var(--s2)'};
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

function dsSaveConfig() {
  const floors = dsFloors.filter(f => (f.label || '').trim());
  if (!floors.length) { showToast('Add at least one floor first'); return; }
  const config = {
    northStar: {
      category: document.getElementById('ds-cat')?.value || 'Other',
      target:   document.getElementById('ds-target')?.value || '',
      deadline: document.getElementById('ds-deadline')?.value || '',
    },
    floors: floors,
    goose:    document.getElementById('ds-goose')?.value || '',
    showGoose: document.getElementById('ds-showgoose')?.checked !== false,
  };
  localStorage.setItem(DS_NBD_CFG, JSON.stringify(config));
  try { localStorage.setItem(DS_THEME_KEY, dsSelectedTheme); } catch {}
  const msg = document.getElementById('ds-save-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
  showToast('Daily Program settings saved ✓');
}

function dsResetDefaults() {
  dsFloors = dsDefaultFloors();
  dsRenderFloors();
  const catEl = document.getElementById('ds-cat');
  if (catEl) catEl.value = 'Roofing Sales';
  const tEl = document.getElementById('ds-target');
  if (tEl) tEl.value = '';
  const dEl = document.getElementById('ds-deadline');
  if (dEl) dEl.value = '';
  const gEl = document.getElementById('ds-goose');
  if (gEl) gEl.value = '30 min of guilt-free screen time';
  const sgEl = document.getElementById('ds-showgoose');
  if (sgEl) sgEl.checked = true;
  dsSelectedTheme = 'nbd-original';
  dsBuildThemeGrid();
  showToast('Reset to defaults — click Save to apply');
}

// Hook into the existing goTo() nav so settings load fresh when the tab opens.
// Forward `arguments` rather than just `view` — the canonical goTo accepts
// (view, params) and downstream callers (admin-manager.js etc.) rely on
// the second arg surviving each wrapper layer.
const _origGoTo = typeof goTo === 'function' ? goTo : null;
window.goTo = function() {
  const view = arguments[0];
  if (_origGoTo) _origGoTo.apply(this, arguments);
  if (view === 'settings') {
    setTimeout(dsLoadConfig, 80);
    setTimeout(restoreSettingsSections, 100);
    // Load CRM secondary header toggle state
    setTimeout(() => {
      const toggle = document.getElementById('crmSecHeaderToggle');
      if (toggle) toggle.checked = getCrmSecHeaderEnabled();
    }, 100);
  }
};
// Also load on page ready in case settings is the first view
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('view-settings')?.classList.contains('active')) {
    dsLoadConfig();
    restoreSettingsSections();
  }
});
// ── END DAILY PROGRAM SETTINGS ────────────────────────────────────────────

// ── MOBILE NAVIGATION ─────────────────────────────────────────────────────
const MOBILE_NAV_TABS = ['dash','map','crm','est'];

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
// ══════════════════════════════════════════════
// MAP ENHANCEMENTS — spyglass, fab bar, zones, stats
// ══════════════════════════════════════════════

// ── Spyglass search ──────────────────────────
async function spyglassSearch() {
  const q = document.getElementById('spyglassInput')?.value?.trim();
  if(!q) return;
  hideAcDrop('spyglassInput');
  const data = await geocode(q);
  if(!data) return;
  if(mainMap) mainMap.setView([parseFloat(data.lat), parseFloat(data.lon)], 18);
  // Also show property card
  window._lastMapSearch = data;
  document.getElementById('propCard').style.display = 'block';
  document.getElementById('propCardInner').innerHTML = `
    <div class="pi-card">
      <div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county"></span></div>
      <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
    </div>
    <button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>`;
  fetchPropertyIntel(data, 'propCardInner');
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

// ── Pin stats overlay ────────────────────────
function updatePinStats() {
  const el = document.getElementById('pinStatsOverlay');
  if(!el || !window._pins) return;
  const pins = window._pins;
  if(!pins.length) { el.innerHTML=''; return; }
  const counts = {};
  pins.forEach(p => { counts[p.status] = (counts[p.status]||0) + 1; });
  const total = pins.length;
  const signed = counts['signed']||0;
  const interested = counts['interested']||0;
  const notHome = counts['not-home']||0;

  el.innerHTML = `
    <div class="pin-stat-pill">
      <span style="font-weight:700;color:var(--t);">${total}</span>
      <span style="font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Doors</span>
    </div>
    ${signed ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:var(--gold);"></div><span style="color:var(--gold);font-weight:700;">${signed} Signed</span></div>` : ''}
    ${interested ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:var(--green);"></div><span style="color:var(--green);font-weight:700;">${interested} Interested</span></div>` : ''}
    ${notHome ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:#9CA3AF;"></div><span style="color:var(--m);">${notHome} Not Home</span></div>` : ''}`;
}

// ── Territory Zones ──────────────────────────
let zones = []; // {id, name, color, points, layer}
let zoneDrawing = false;
let zonePoints = [];
let zoneDots = [];
let zoneTempPoly = null;
let zoneColor = 'var(--blue)';
let zoneDrawLayer = null;

function selectZoneColor(color, el) {
  zoneColor = color;
  document.querySelectorAll('#zoneColorPicker > div').forEach(d => d.style.borderColor = 'transparent');
  el.style.borderColor = '#fff';
}

function startZoneDraw() {
  if(!mainMap) { showToast('Open the map first','error'); return; }
  zoneDrawing = true;
  zonePoints = [];
  zoneDots = [];
  document.getElementById('zonePanel').classList.add('visible');
  showToast('Click map to draw zone boundary. Click Save when done.');
  mainMap.getContainer().style.cursor = 'crosshair';

  // Attach zone click handler
  mainMap._zoneClick = (e) => {
    if(!zoneDrawing) return;
    zonePoints.push(e.latlng);
    const dot = L.circleMarker(e.latlng, {radius:5, color:'#fff', fillColor:zoneColor, fillOpacity:1, weight:2}).addTo(mainMap);
    zoneDots.push(dot);
    if(zoneTempPoly) mainMap.removeLayer(zoneTempPoly);
    if(zonePoints.length >= 3) {
      zoneTempPoly = L.polygon(zonePoints, {
        color: zoneColor, weight:2, fillColor:zoneColor, fillOpacity:.12, dashArray:'6,4'
      }).addTo(mainMap);
    }
  };
  mainMap.on('click', mainMap._zoneClick);
}

function cancelZoneDraw() {
  zoneDrawing = false;
  if(mainMap) {
    mainMap.off('click', mainMap._zoneClick);
    mainMap.getContainer().style.cursor = '';
  }
  zonePoints = [];
  zoneDots.forEach(d => mainMap?.removeLayer(d));
  zoneDots = [];
  if(zoneTempPoly) { mainMap?.removeLayer(zoneTempPoly); zoneTempPoly = null; }
  document.getElementById('zonePanel').classList.remove('visible');
}

function saveZone() {
  if(zonePoints.length < 3) { showToast('Draw at least 3 points to define a zone','error'); return; }
  const name = document.getElementById('zoneNameInput')?.value?.trim() || 'Zone ' + (zones.length+1);
  mainMap.off('click', mainMap._zoneClick);
  mainMap.getContainer().style.cursor = '';
  zoneDrawing = false;
  // Remove temp dots
  zoneDots.forEach(d => mainMap.removeLayer(d));
  if(zoneTempPoly) mainMap.removeLayer(zoneTempPoly);

  const layer = L.polygon(zonePoints, {
    color: zoneColor, weight:2.5, fillColor: zoneColor, fillOpacity:.1
  }).addTo(mainMap);
  layer.bindTooltip(`<div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;">${name}</div>`, {permanent:true, className:'zone-tooltip', direction:'center'});

  const id = Date.now();
  zones.push({id, name, color:zoneColor, points:[...zonePoints], layer});
  zonePoints = []; zoneDots = [];
  document.getElementById('zonePanel').classList.remove('visible');
  if(document.getElementById('zoneNameInput')) document.getElementById('zoneNameInput').value = '';
  renderZoneList();
  showToast(`Zone "${name}" saved ✓`);
}

function deleteZone(id) {
  const idx = zones.findIndex(z => z.id === id);
  if(idx < 0) return;
  if(zones[idx].layer) mainMap?.removeLayer(zones[idx].layer);
  zones.splice(idx, 1);
  renderZoneList();
}

function renderZoneList() {
  const el = document.getElementById('zoneList');
  if(!el) return;
  if(!zones.length) { el.innerHTML=''; return; }
  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  // Only accept hex colors; reject anything else to block style-attr injection.
  const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : 'var(--blue)';
  el.innerHTML = zones.map(z => `
    <div class="zone-item">
      <div class="zone-dot" style="background:${safeColor(z.color)};"></div>
      <span>${esc(z.name)}</span>
      <button class="zone-del nbd-zone-del" data-zone-id="${esc(z.id)}">✕</button>
    </div>`).join('');
  el.querySelectorAll('.nbd-zone-del').forEach(btn => {
    btn.addEventListener('click', () => deleteZone(btn.dataset.zoneId));
  });
}

// ── Load Sample Data (any account) ──────────────────────────
async function loadSampleData() {
  const leads = window._leads || [];
  if(leads.length > 0) {
    if(!confirm(`You already have ${leads.length} leads. Add sample data anyway?`)) return;
  }
  showToast('Loading sample data...');
  const user = window._user;
  if(!user) { showToast('Not logged in','error'); return; }
  try {
    await seedDemoLeads(user.uid);
    await window._loadLeads();
    showToast('Sample data loaded ✓ — check your CRM');
    goTo('crm');
  } catch(e) {
    showToast('Error loading sample data: ' + e.message, 'error');
  }
}

// ── Override damagNearMe to use enhanced location ──────────────
window.damagNearMe = function() { spyglassGoToLocation(); };

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
      document.getElementById('propCard').style.display = 'block';
      document.getElementById('propCardInner').innerHTML = `
        <div class="pi-card">
          <div class="pi-header"><span class="pi-title">🏠 Property Intel</span></div>
          <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
        </div>
        <button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>`;
      fetchPropertyIntel(r, 'propCardInner');
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

// Expose ALL functions to global scope for inline onclick handlers
// (required because type="module" script above affects global scope in some browsers)
window.mobileNav = mobileNav;
window.toggleMobileMore = toggleMobileMore;
window.closeMobileMore = closeMobileMore;
// CRM / Leads - functions exposed by crm.js
// Tasks — these are now defined and exposed in js/tasks.js
// Guard against ReferenceError if tasks.js hasn't loaded yet
if (typeof openTaskModal === 'function') window.openTaskModal = openTaskModal;
if (typeof closeTaskModal === 'function') window.closeTaskModal = closeTaskModal;
if (typeof addTask === 'function') window.addTask = addTask;
if (typeof removeTask === 'function') window.removeTask = removeTask;
// Estimates

// ══ REMOVED: Duplicate QM Import, QuickAddLead, Warranty Cert, Lead Export CSV ══
// Canonical definitions live in js/tools.js and js/warranty-cert.js (both loaded above)
// ══ See audit H2 ═══════════════════════════════════════════════════════════════


// ══ ONBOARDING FLOW ═════════════════════════════════════════════════════
// Legacy modal-based onboarding (checkAndShowOnboarding + onbNext + onbSaveLead
// + onbSkipLead + onbShowFinal + onbFinish) was removed 2026-05-12. Every
// function in the original block referenced DOM (#onboardingModal, #onbStep1,
// #onbCompany, #onbAddr, etc.) that was never built — calling them threw on
// the first getElementById, so a previously-injected stub had to silently
// no-op the whole flow.
//
// Replaced by OnboardingTour (js/onboarding-tour.js) — a self-contained
// spotlight tour that auto-fires for users with zero leads.
// ════════════════════════════════════════════════════════════════════════

if(typeof startNewEstimate==='function'){window.startNewEstimate=startNewEstimate;}else{window.startNewEstimate=function(){console.warn('Estimate module loading...');}}
if(typeof saveEstimate==='function'){window.saveEstimate=saveEstimate;}
if(typeof cancelEstimate==='function'){window.cancelEstimate=cancelEstimate;}
if(typeof viewEstimate==='function'){window.viewEstimate=viewEstimate;}
if(typeof exportEstimate==='function'){window.exportEstimate=exportEstimate;}
if(typeof estNext==='function'){window.estNext=estNext;}
if(typeof estBack==='function'){window.estBack=estBack;}
if(typeof selectTier==='function'){window.selectTier=selectTier;}
// Map functions - exposed by maps.js after it loads (line 8217)
if(typeof searchMap!=='undefined') window.searchMap = searchMap;
if(typeof selectPin!=='undefined') window.selectPin = selectPin;
if(typeof deletePin!=='undefined') window.deletePin = deletePin;
if(typeof clearAllPins!=='undefined') window.clearAllPins = clearAllPins;
if(typeof spyglassGoToLocation!=='undefined') window.damagNearMe = spyglassGoToLocation;
if(typeof damageNearMePhotos!=='undefined') window.damageNearMePhotos = damageNearMePhotos;
if(typeof toggleMapSidebar!=='undefined') window.toggleMapSidebar = toggleMapSidebar;
if(typeof spyglassSearch!=='undefined') window.spyglassSearch = spyglassSearch;
if(typeof spyglassGoToLocation!=='undefined') window.spyglassGoToLocation = spyglassGoToLocation;
if(typeof fabToggle!=='undefined') window.fabToggle = fabToggle;
if(typeof quickStormCheck!=='undefined') window.quickStormCheck = quickStormCheck;
if(typeof updatePinStats!=='undefined') window.updatePinStats = updatePinStats;
if(typeof startZoneDraw!=='undefined') window.startZoneDraw = startZoneDraw;
if(typeof cancelZoneDraw!=='undefined') window.cancelZoneDraw = cancelZoneDraw;
if(typeof saveZone!=='undefined') window.saveZone = saveZone;
if(typeof deleteZone!=='undefined') window.deleteZone = deleteZone;
if(typeof selectZoneColor!=='undefined') window.selectZoneColor = selectZoneColor;
if(typeof loadSampleData!=='undefined') window.loadSampleData = loadSampleData;
if(typeof handleCardClick!=='undefined') window.handleCardClick = handleCardClick; // Exposed by crm.js
// Map Overlay System
if(typeof toggleOverlay!=='undefined') window.toggleOverlay = toggleOverlay;
// ══════════════════════════════════════════════════════════════════
// FORWARD REFERENCES REMOVED - Functions exposed by their own modules
// All assignments below moved to crm.js, maps.js, etc.
// ══════════════════════════════════════════════════════════════════
// Delete confirm - in crm.js
if(typeof cancelDeleteConfirm!=='undefined') window.cancelDeleteConfirm = cancelDeleteConfirm;
if(typeof confirmDeleteLead!=='undefined') window.confirmDeleteLead = confirmDeleteLead;
// Deleted drawer - in crm.js
if(typeof openDeletedDrawer!=='undefined') window.openDeletedDrawer = openDeletedDrawer;
if(typeof closeDeletedDrawer!=='undefined') window.closeDeletedDrawer = closeDeletedDrawer;
if(typeof restoreDeletedLead!=='undefined') window.restoreDeletedLead = restoreDeletedLead;
if(typeof permanentDeleteLead!=='undefined') window.permanentDeleteLead = permanentDeleteLead;
// Pin popup actions - in maps.js
if(typeof goToLeadFromPin!=='undefined') window.goToLeadFromPin = goToLeadFromPin;
if(typeof deleteLeadFromPin!=='undefined') window.deleteLeadFromPin = deleteLeadFromPin;
if(typeof makeLeadFromPin!=='undefined') window.makeLeadFromPin = makeLeadFromPin;
if(typeof deletePinOnly!=='undefined') window.deletePinOnly = deletePinOnly;
if(typeof dropPinByAddress!=='undefined') window.dropPinByAddress = dropPinByAddress;
if(typeof drop!=='undefined') window.drop = drop;
if(typeof openPinConfirm!=='undefined') window.openPinConfirm = openPinConfirm;
if(typeof cancelPinConfirm!=='undefined') window.cancelPinConfirm = cancelPinConfirm;
if(typeof commitPin!=='undefined') window.commitPin = commitPin;
// Autocomplete - in dashboard.html below
if(typeof selectAcItem!=='undefined') window.selectAcItem = selectAcItem;
if(typeof hideAcDrop!=='undefined') window.hideAcDrop = hideAcDrop;
// Make Lead from Map - in maps.js
if(typeof makeLeadFromSearch!=='undefined') window.makeLeadFromSearch = makeLeadFromSearch;
if(typeof fetchPropertyIntel!=='undefined') window.fetchPropertyIntel = fetchPropertyIntel;
if(typeof pullIntelForModal!=='undefined') window.pullIntelForModal = pullIntelForModal;
// Storm - in maps.js
if(typeof loadStorm!=='undefined') window.loadStorm = loadStorm;
// Drawing tool - in maps.js
if(typeof searchDraw!=='undefined') window.searchDraw = searchDraw;
if(typeof selLT!=='undefined') window.selLT = selLT;
if(typeof toggleDraw!=='undefined') window.toggleDraw = toggleDraw;
if(typeof clearDraw!=='undefined') window.clearDraw = clearDraw;
if(typeof undoLine!=='undefined') window.undoLine = undoLine;
if(typeof deleteLine!=='undefined') window.deleteLine = deleteLine;
if(typeof exportDrawReport!=='undefined') window.exportDrawReport = exportDrawReport;
if(typeof importToEstimate!=='undefined') window.importToEstimate = importToEstimate;
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// ALL FORWARD REFERENCES BELOW COMMENTED OUT - FUNCTIONS NOT DEFINED YET
// These assignments will be moved to their respective JS files or
// added AFTER function definitions later in this file
// ══════════════════════════════════════════════════════════════════
// Drawing tool functions - in maps.js
if(typeof setDrawMode!=='undefined') window.setDrawMode = setDrawMode;
if(typeof perimChooseType!=='undefined') window.perimChooseType = perimChooseType;
if(typeof selectLine!=='undefined') window.selectLine = selectLine;
if(typeof deselectLine!=='undefined') window.deselectLine = deselectLine;
if(typeof retypeLine!=='undefined') window.retypeLine = retypeLine;
if(typeof erToggleSegment!=='undefined') window.erToggleSegment = erToggleSegment;
// Photos - defined later in this file
if(typeof openPhotoFor!=='undefined') window.openPhotoFor = openPhotoFor;
if(typeof closePhotoModal!=='undefined') window.closePhotoModal = closePhotoModal;
if(typeof uploadPhotos!=='undefined') window.uploadPhotos = uploadPhotos;
if(typeof renderPhotoLeads!=='undefined') window.renderPhotoLeads = renderPhotoLeads;
if(typeof renderPhotoGrid!=='undefined') window.renderPhotoGrid = renderPhotoGrid;
// Documents - defined later in this file
if(typeof openUploadDoc!=='undefined') window.openUploadDoc = openUploadDoc;
if(typeof closeUploadDoc!=='undefined') window.closeUploadDoc = closeUploadDoc;
if(typeof saveDocUpload!=='undefined') window.saveDocUpload = saveDocUpload;
if(typeof openDocTemplate!=='undefined') window.openDocTemplate = openDocTemplate;
if(typeof printDoc!=='undefined') window.printDoc = printDoc;
if(typeof closeDocViewer!=='undefined') window.closeDocViewer = closeDocViewer;
// Ask Joe AI - in ai.js
if(typeof sendJoeMessage!=='undefined') window.sendJoeMessage = sendJoeMessage;
if(typeof joeQuick!=='undefined') window.joeQuick = joeQuick;
if(typeof saveJoeKey!=='undefined') window.saveJoeKey = saveJoeKey;
if(typeof clearJoeKey!=='undefined') window.clearJoeKey = clearJoeKey;
// Misc - defined later in this file
if(typeof openTips!=='undefined') window.openTips = openTips;
if(typeof closeTips!=='undefined') window.closeTips = closeTips;
if(typeof applyTheme!=='undefined') window.applyTheme = applyTheme;
if(typeof goToWithTheme!=='undefined') window.goToWithTheme = goToWithTheme;
if(typeof showToast!=='undefined') window.showToast = showToast;
// Daily settings - defined later in this file
if(typeof dsAddFloor!=='undefined') window.dsAddFloor = dsAddFloor;
if(typeof dsRemoveFloor!=='undefined') window.dsRemoveFloor = dsRemoveFloor;
if(typeof dsSaveConfig!=='undefined') window.dsSaveConfig = dsSaveConfig;
if(typeof dsResetDefaults!=='undefined') window.dsResetDefaults = dsResetDefaults;
// NBD Unified Appearance Picker - in maps.js or dashboard
if(typeof nbdPickerOpen!=='undefined') window.nbdPickerOpen = nbdPickerOpen;
if(typeof nbdPickerClose!=='undefined') window.nbdPickerClose = nbdPickerClose;
if(typeof nbdPickerTab!=='undefined') window.nbdPickerTab = nbdPickerTab;
if(typeof nbdHowtoOpen!=='undefined') window.nbdHowtoOpen = nbdHowtoOpen;
if(typeof nbdHowtoClose!=='undefined') window.nbdHowtoClose = nbdHowtoClose;
if(typeof nbdApplyTheme!=='undefined') window.nbdApplyTheme = nbdApplyTheme;
if(typeof nbdApplyFont!=='undefined') window.nbdApplyFont = nbdApplyFont;
if(typeof nbdRandom!=='undefined') window.nbdRandom = nbdRandom;
if(typeof nbdSaveCustom!=='undefined') window.nbdSaveCustom = nbdSaveCustom;
if(typeof nbdSetCat!=='undefined') window.nbdSetCat = nbdSetCat;
// Navigation - defined later in this file
if(typeof toggleNavSection!=='undefined') window.toggleNavSection = toggleNavSection;
if(typeof toggleSettingsSection!=='undefined') window.toggleSettingsSection = toggleSettingsSection;
// CRM Search - already in crm.js
if(typeof clearCrmSearch!=='undefined') window.clearCrmSearch = clearCrmSearch;
// Property Intel - defined later in this file
if(typeof executePullPropertyIntel!=='undefined') window.executePullPropertyIntel = executePullPropertyIntel;
if(typeof confirmPropertyIntelPull!=='undefined') window.confirmPropertyIntelPull = confirmPropertyIntelPull;
if(typeof closePropertyIntelModal!=='undefined') window.closePropertyIntelModal = closePropertyIntelModal;
if(typeof closePropertyIntelConfirmModal!=='undefined') window.closePropertyIntelConfirmModal = closePropertyIntelConfirmModal;
// Notifications - defined later in this file
if(typeof markAllNotificationsRead!=='undefined') window.markAllNotificationsRead = markAllNotificationsRead;
if(typeof markNotificationRead!=='undefined') window.markNotificationRead = markNotificationRead;
if(typeof dsPickTheme!=='undefined') window.dsPickTheme = dsPickTheme;
if(typeof renderLeaderboard!=='undefined') window.renderLeaderboard = renderLeaderboard;
// ══════════════════════════════════════════════════════════════════

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
// ── END MOBILE NAVIGATION ──────────────────────────────────────────────────

// ══════════════════════════════════════════════
// TASK SYSTEM
// ══════════════════════════════════════════════
window._taskCache = {};
var _taskModalLeadId = _taskModalLeadId || null;

// ══ TASK SYSTEM (extracted to js/tasks.js) ══════════════════


// ══════════════════════════════════════════════════════════════════════
// CRM SECONDARY HEADER — AUTO-HIDE ON SCROLL + SETTINGS TOGGLE
// ══════════════════════════════════════════════════════════════════════

const CRM_SEC_HEADER_SETTING = 'nbd_crm_sec_header_enabled';

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
let _lastScrollTop = 0;
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
// ══ END CRM SECONDARY HEADER ═════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// KANBAN CARD DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════

window._cardDetailLeadId = null;

function openCardDetailModal(leadId) {
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;

  window._cardDetailLeadId = leadId;

  // Populate modal
  document.getElementById('cardDetailName').textContent =
    `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Lead';
  // Stage chip — use stageLabel() to convert raw keys ("claim_filed")
  // to display labels ("Claim Filed"), and stageColor() to tint the
  // chip so it matches the kanban column it came from.
  const stageEl = document.getElementById('cardDetailStage');
  if (stageEl) {
    const rawStage = lead._stageKey || lead.stage || 'new';
    const label = (typeof window.stageLabel === 'function')
      ? window.stageLabel(rawStage)
      : String(rawStage).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const color = (typeof window.stageColor === 'function')
      ? window.stageColor(rawStage)
      : 'var(--m)';
    stageEl.textContent = label;
    stageEl.style.color = color;
    stageEl.style.borderColor = `color-mix(in srgb, ${color} 50%, var(--br))`;
    stageEl.style.background = `color-mix(in srgb, ${color} 14%, var(--s2))`;
  }
  document.getElementById('cardDetailAddress').textContent = lead.address || '—';
  document.getElementById('cardDetailPhone').textContent = lead.phone || '—';
  document.getElementById('cardDetailDamage').textContent = lead.damageType || '—';
  document.getElementById('cardDetailValue').textContent =
    lead.jobValue ? `$${parseFloat(lead.jobValue).toLocaleString()}` : '—';

  // ─── Prospect promote button + quick actions ───
  // Show a "Promote to Customer" CTA + a row of quick actions
  // (Call/Text/Email/Re-knock/Map/Hide/Delete) at the top of the detail
  // modal when this lead is still a prospect. The actions row is built
  // each time so it reflects the current lead's data (phone, email, lat/lng).
  const promoteBanner = document.getElementById('cardDetailPromoteBanner');
  if (promoteBanner) {
    if (lead.isProspect) {
      promoteBanner.style.display = 'flex';
      populateProspectQuickActions(lead);
    } else {
      promoteBanner.style.display = 'none';
    }
  }
  // Sync the kind label so we don't show "CUSTOMER" on a prospect
  // (and vice versa). Belt-and-suspenders alongside the banner above.
  const kindLabel = document.getElementById('cardDetailKindLabel');
  if (kindLabel) kindLabel.textContent = lead.isProspect ? 'PROSPECT' : 'CUSTOMER';

  // Show modal
  document.getElementById('cardDetailModal').classList.add('open');
}
window.openCardDetailModal = openCardDetailModal;

// Populate the row of quick actions inside the prospect banner. Disabled
// states render for actions whose underlying data isn't on the lead
// (e.g. no phone → Call/Text disabled). Uses programmatic event listeners
// instead of inline onclick attributes so addresses with special chars
// (double-quotes, ampersands, etc.) can't break the HTML.
function populateProspectQuickActions(lead) {
  const wrap = document.getElementById('prospectQuickActions');
  if (!wrap) return;
  const phone = (lead.phone || '').replace(/\D/g, '');
  const email = (lead.email || '').trim();
  const hasGeo = (lead.lat != null && lead.lng != null);
  const isHidden = !!lead.prospectHidden;

  // Build buttons with createElement so user-controlled strings (address,
  // email) never enter the HTML attribute parser.
  wrap.innerHTML = '';
  const make = (icon, label, opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${icon} ${label}`;
    b.disabled = !!opts.disabled;
    const danger = !!opts.danger;
    const color = danger ? 'var(--red)' : 'var(--t)';
    const border = danger ? 'rgba(224,82,82,.35)' : 'var(--br)';
    b.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      padding:6px 11px;border-radius:6px;
      background:${opts.disabled ? 'transparent' : 'var(--s2)'};
      border:1px solid ${border};
      color:${opts.disabled ? 'var(--m)' : color};
      font-family:inherit;font-size:11px;font-weight:600;
      cursor:${opts.disabled ? 'not-allowed' : 'pointer'};
      opacity:${opts.disabled ? '.45' : '1'};
      transition:all .15s;
    `;
    if (!opts.disabled && typeof opts.onClick === 'function') {
      b.addEventListener('click', opts.onClick);
    }
    return b;
  };

  wrap.appendChild(make('📞', 'Call',  { disabled: !phone, onClick: () => { window.location.href = 'tel:' + phone; } }));
  wrap.appendChild(make('💬', 'Text',  { disabled: !phone, onClick: () => { window.location.href = 'sms:' + phone; } }));
  wrap.appendChild(make('✉️', 'Email', { disabled: !email, onClick: () => { window.location.href = 'mailto:' + email; } }));
  wrap.appendChild(make('🚪', 'Re-knock', { onClick: () => {
    closeCardDetailModal();
    if (window.D2D) {
      window.D2D.openQuickKnock({ address: lead.address || '', lat: lead.lat || null, lng: lead.lng || null });
    } else {
      goTo('d2d');
    }
  }}));
  wrap.appendChild(make('🗺️', 'See on Map', {
    disabled: !hasGeo,
    onClick: () => { closeCardDetailModal(); window.viewProspectOnMap(lead.id); }
  }));
  wrap.appendChild(make(isHidden ? '👁️' : '🗄️', isHidden ? 'Unhide' : 'Hide', {
    onClick: () => { window.toggleProspectHidden(lead.id); }
  }));
  wrap.appendChild(make('🗑️', 'Delete', {
    danger: true, onClick: () => { window.absoluteDeleteProspect(lead.id); }
  }));
}

// Async confirm helper that prefers our themed in-app dialog (works in
// iOS PWA standalone where native confirm() can silently no-op) and
// falls back to native confirm only when neither is loaded yet.
async function _prospectConfirm(message, opts) {
  if (window.D2D && typeof window.D2D.uiConfirm === 'function') {
    return await window.D2D.uiConfirm(message, opts || {});
  }
  if (typeof window.uiConfirm === 'function') {
    return await window.uiConfirm(message, opts || {});
  }
  // Last-resort fallback. iOS PWA may suppress this — surface a toast so
  // the user at least knows the action was attempted.
  return confirm(message);
}
async function _prospectPrompt(message) {
  if (window.D2D && typeof window.D2D.uiPrompt === 'function') {
    return await window.D2D.uiPrompt(message);
  }
  if (typeof window.uiPrompt === 'function') {
    return await window.uiPrompt(message);
  }
  return prompt(message);
}

// Confirm-then-promote. Single confirm dialog before flipping isProspect.
window.confirmPromoteProspect = async function(leadId) {
  if (!leadId) return;
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;
  const name = (lead.firstName || lead.lastName)
    ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim()
    : (lead.address || 'this prospect');
  const ok = await _prospectConfirm(
    `Promote ${name} to a full customer?\n\nThis adds them to your kanban as a real lead and removes them from the Prospects page.`,
    { okLabel: 'Promote', cancelLabel: 'Cancel' }
  );
  if (!ok) return;
  if (typeof window.promoteProspect === 'function') {
    await window.promoteProspect(leadId);
    closeCardDetailModal();
  }
};

// Hide / unhide a prospect from the default Prospects view. This is a
// soft-hide (writes prospectHidden:true) — the lead record stays intact
// so we don't lose its history. The Prospects page has a "Show hidden"
// toggle to bring them back.
window.toggleProspectHidden = async function(leadId) {
  if (!leadId) return;
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;
  const next = !lead.prospectHidden;
  try {
    const ref = window.doc(window.db || window._db, 'leads', leadId);
    await window.updateDoc(ref, { prospectHidden: next, updatedAt: window.serverTimestamp() });
    lead.prospectHidden = next;
    if (typeof window.showToast === 'function') {
      window.showToast(next ? 'Prospect hidden' : 'Prospect visible', 'success');
    }
    closeCardDetailModal();
    if (window.Prospects && typeof window.Prospects.refresh === 'function') window.Prospects.refresh();
  } catch (e) {
    if (typeof window.showToast === 'function') window.showToast('Failed: ' + e.message, 'error');
  }
};

// Jump to D2D map view and center on the prospect's coordinates.
window.viewProspectOnMap = function(leadId) {
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead || lead.lat == null || lead.lng == null) {
    if (typeof window.showToast === 'function') window.showToast('No coordinates on this prospect', 'error');
    return;
  }
  goTo('d2d');
  // After the D2D view inits, ask its map to fly to the lead.
  setTimeout(() => {
    if (window.D2D && typeof window.D2D.flyTo === 'function') {
      window.D2D.flyTo(lead.lat, lead.lng);
    } else if (window._d2dMap && typeof window._d2dMap.setView === 'function') {
      window._d2dMap.setView([lead.lat, lead.lng], 17);
    }
  }, 600);
};

// Three-step delete with TYPE 'DELETE' final gate. Permanently removes
// the lead record. Reserved STRICTLY for prospects — regular customers
// go through the soft-delete (trash) flow with recovery. The function
// hard-refuses to run on a non-prospect even if invoked directly.
window.absoluteDeleteProspect = async function(leadId) {
  if (!leadId) return;
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;

  // Hard guard — refuse to nuke a real customer record. The button only
  // appears in the prospect banner, but a stale modal state after promotion
  // could otherwise let this fire on a now-promoted lead.
  if (lead.isProspect !== true) {
    if (typeof window.showToast === 'function') {
      window.showToast('Cannot permanent-delete a customer — use Trash instead', 'error');
    }
    return;
  }

  const name = (lead.firstName || lead.lastName)
    ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim()
    : (lead.address || 'this prospect');

  // Step 1
  const c1 = await _prospectConfirm(
    `Permanently delete ${name}?\n\nThis is for prospects you've decided will never be customers. The record will be ERASED — no recovery from trash. Use Hide if you just want to clear them from the view.`,
    { okLabel: 'Continue', cancelLabel: 'Cancel', danger: true }
  );
  if (!c1) return;

  // Step 2
  const c2 = await _prospectConfirm(
    `Are you ABSOLUTELY sure?\n\nLast chance to back out before the final confirmation. Click Cancel to keep them as a hidden prospect instead.`,
    { okLabel: "I'm sure", cancelLabel: 'Cancel', danger: true }
  );
  if (!c2) return;

  // Step 3 — typed gate
  const typed = await _prospectPrompt(`Final confirmation.\n\nType DELETE in all caps to permanently remove ${name}. Anything else cancels.`);
  if (typed !== 'DELETE') {
    if (typeof window.showToast === 'function') window.showToast('Delete cancelled', 'info');
    return;
  }

  try {
    const ref = window.doc(window.db || window._db, 'leads', leadId);
    await window.deleteDoc(ref);
    // Remove from in-memory cache so kanban + prospects refresh cleanly.
    window._leads = (window._leads || []).filter(l => l.id !== leadId);
    if (typeof window.showToast === 'function') window.showToast(`Permanently deleted ${name}`, 'success');
    closeCardDetailModal();
    if (window.Prospects && typeof window.Prospects.refresh === 'function') window.Prospects.refresh();
    if (typeof window.renderLeads === 'function') window.renderLeads(window._leads);
    // Notify badges + analytics that lead state changed.
    try { document.dispatchEvent(new CustomEvent('leadsChanged')); } catch (e) {}
  } catch (e) {
    if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message, 'error');
  }
};

// ── GDPR Export (Article 20) + Erasure (Article 17) ─
// D6/D7 from the enterprise-hardening sprint landed the server
// callables but no UI called them. These two helpers fix that.
window._gdprExport = async function () {
  if (!window._user) { if (typeof showToast==='function') showToast('Sign in first','error'); return; }
  if (!window.confirm('Download a JSON file containing every record tied to your account (profile, leads, estimates, photos, pins, tasks, documents, api_usage). The download link expires in 24 hours.\n\nProceed?')) return;
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fn = mod.httpsCallable(mod.getFunctions(), 'exportMyData');
    if (typeof showToast==='function') showToast('Building export… this can take up to a minute.', 'info');
    const res = await fn({});
    const url = res && res.data && res.data.url;
    if (!url) throw new Error('No URL returned');
    // Open in a new tab so the user can save the JSON themselves.
    window.open(url, '_blank', 'noopener');
    if (typeof showToast==='function') showToast('✓ Export ready — opening download.', 'success');
  } catch (e) {
    console.error('gdpr export failed', e);
    if (typeof showToast==='function') showToast(e.message || 'Export failed', 'error');
  }
};

window._gdprRequestErasure = async function () {
  if (!window._user) { if (typeof showToast==='function') showToast('Sign in first','error'); return; }
  const warning =
    'PERMANENTLY DELETE YOUR ACCOUNT?\n\n' +
    'This will delete every lead, estimate, photo, pin, task, note, and profile record you own. ' +
    'Your account will be disabled. This CANNOT be undone.\n\n' +
    'We will email you a confirmation link. The deletion only completes when you click it ' +
    'within 24 hours. If the email doesn\'t arrive, check spam.';
  if (!window.confirm(warning)) return;
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fn = mod.httpsCallable(mod.getFunctions(), 'requestAccountErasure');
    await fn({});
    if (typeof showToast==='function') showToast('Confirmation email sent. Click the link within 24h to complete deletion.', 'success');
  } catch (e) {
    console.error('gdpr erasure request failed', e);
    if (typeof showToast==='function') showToast(e.message || 'Request failed', 'error');
  }
};

// ── Revoke &amp; Regenerate Portal Link ─────────────────
// B4 + B5: first call revokePortalToken to invalidate every live
// token for this lead, then mint a fresh one and open the SMS
// prefilled exactly like _sharePortalLink. Use when a rep suspects
// a link was leaked or forwarded.
window._revokePortalLink = async function (leadId) {
  if (!leadId) return;
  if (!window.confirm('Revoke all active portal links for this lead and mint a new one?\n\nThe old URL stops working immediately.')) return;
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fns = mod.getFunctions();
    const revoke = mod.httpsCallable(fns, 'revokePortalToken');
    const r = await revoke({ leadId });
    const n = (r && r.data && r.data.revoked) || 0;
    if (typeof showToast === 'function') showToast('Revoked ' + n + ' link(s). Minting a fresh one...', 'info');
    await window._sharePortalLink(leadId); // immediately issue a new one
  } catch (e) {
    console.error('revoke portal failed', e);
    if (typeof showToast === 'function') showToast('Revoke failed: ' + (e.message || 'unknown'), 'error');
  }
};

// ── Share Homeowner Portal Link ─────────────────────
// Mints a portal token via createPortalToken and produces the
// public URL. Copies to clipboard + opens SMS prefilled with the
// link + the homeowner's first name. Expires in 30 days.
window._sharePortalLink = async function (leadId) {
  if (!leadId) { if (typeof showToast==='function') showToast('No lead selected','error'); return; }
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) { if (typeof showToast==='function') showToast('Lead not found','error'); return; }
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fns = mod.getFunctions();
    const call = mod.httpsCallable(fns, 'createPortalToken');
    const res = await call({ leadId, ttlDays: 30 });
    const token = res && res.data && res.data.token;
    if (!token) throw new Error('No token returned');
    const url = location.origin + '/pro/portal.html?token=' + encodeURIComponent(token);
    // Try clipboard first — falls back to prompt() if denied.
    try { await navigator.clipboard.writeText(url); } catch(e) {}
    if (typeof showToast==='function') showToast('Portal link copied to clipboard', 'success');
    // Offer SMS shortcut if phone on file.
    let usedChannel = 'copy';
    if (lead.phone) {
      const cleanPhone = String(lead.phone).replace(/\D/g, '');
      const first = lead.firstName || lead.fname || '';
      const body = encodeURIComponent(
        `Hi${first ? ' ' + first : ''}, here\'s your project page: ` + url +
        ` — you can see your estimate, sign the contract, or book an inspection time.`
      );
      window.open('sms:' + cleanPhone + '?body=' + body, '_self');
      usedChannel = 'sms';
    } else {
      // No phone — surface the URL so the rep can paste manually.
      window.prompt('Share this link with the homeowner:', url);
    }
    // Audit E: every share entry point must record so W44+ tracking
    // (badges, smart-followup, stale-shares filter, engagement score)
    // actually fires. PortalLinkHelpers patches in-memory cache for
    // instant kanban feedback AND queues the Firestore write.
    if (window.PortalLinkHelpers && typeof window.PortalLinkHelpers.recordShare === 'function') {
      window.PortalLinkHelpers.recordShare(leadId, usedChannel);
    }
  } catch (e) {
    console.error('share portal failed', e);
    if (typeof showToast==='function') showToast('Could not create portal link: ' + (e.message || 'error'), 'error');
  }
};

function closeCardDetailModal() {
  document.getElementById('cardDetailModal').classList.remove('open');
  window._cardDetailLeadId = null;
}
window.closeCardDetailModal = closeCardDetailModal;

// Wave 11 (2026-05-05): hand off the in-memory lead to customer.html
// via sessionStorage so the customer page can render instantly from the
// already-loaded data instead of doing a cold Firestore round-trip.
// This eliminates the "data doesn't load even when leads loaded in
// kanban" failure mode on iOS Safari, where the second page load's
// Firestore connection sometimes hangs.
function _stashLeadForCustomerPage(leadId) {
  try {
    if (!leadId || !Array.isArray(window._leads)) return;
    const lead = window._leads.find(l => l && l.id === leadId);
    if (!lead) return;
    // Strip non-serializable Firestore Timestamp objects — convert to
    // plain millis so JSON.stringify doesn't choke.
    const safe = {};
    for (const k of Object.keys(lead)) {
      const v = lead[k];
      if (v && typeof v === 'object' && typeof v.toMillis === 'function') {
        safe[k] = { __ts: v.toMillis() };
      } else {
        safe[k] = v;
      }
    }
    sessionStorage.setItem('nbd_lead_handoff_' + leadId, JSON.stringify({
      lead: safe,
      stashedAt: Date.now()
    }));
  } catch (e) { /* sessionStorage unavailable — no-op */ }
}
// Wave 18: expose so global-search.js can stash before navigating.
window._stashLeadForCustomerPage = _stashLeadForCustomerPage;

function openPhotosForLead() {
  if (!window._cardDetailLeadId) return;
  _stashLeadForCustomerPage(window._cardDetailLeadId);
  window.location.href = `/pro/customer.html?id=${window._cardDetailLeadId}#photos`;
}
window.openPhotosForLead = openPhotosForLead;

function openDocsForLead() {
  if (!window._cardDetailLeadId) return;
  _stashLeadForCustomerPage(window._cardDetailLeadId);
  window.location.href = `/pro/customer.html?id=${window._cardDetailLeadId}#documents`;
}
window.openDocsForLead = openDocsForLead;

function openFullCustomerDetails() {
  if (!window._cardDetailLeadId) return;
  _stashLeadForCustomerPage(window._cardDetailLeadId);
  window.location.href = `/pro/customer.html?id=${window._cardDetailLeadId}`;
}
window.openFullCustomerDetails = openFullCustomerDetails;

function editCardDetails() {
  if (!window._cardDetailLeadId) return;
  closeCardDetailModal();
  editLead(window._cardDetailLeadId);
}
window.editCardDetails = editCardDetails;

// ══ END KANBAN CARD DETAIL MODAL ══════════════════════════════════════


// ══════════════════════════════════════════════
// ASK JOE AI — extracted to /pro/js/ai.js
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// DEMO DATA SEEDER
// Seeds realistic Cincinnati restoration data for demo@nobigdeal.pro
// Runs once on login if the account has no leads.
// ══════════════════════════════════════════════════════════════════════
const DEMO_EMAIL = 'demo@nobigdeal.pro';

// ══ DEMO SEEDER (extracted to js/demo.js) ════════════════════





