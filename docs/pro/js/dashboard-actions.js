/**
 * dashboard-actions.js — action handlers, lead / prospect ops, zone
 * draw, daily program logic, mobile-action wrappers, card-detail
 * forwarders, and the main goTo() router.
 *
 * Extracted from dashboard-main.js (Step 4a — 2026-05-16). Fifth in
 * the state→api→widgets→ui→actions→main load chain. The shim file
 * (dashboard-main.js) loads after this and owns DOMContentLoaded +
 * hashchange + waitForLeaflet only.
 *
 * Lives here:
 *   - goTo() router (depends on _hydrateViewTemplate from ui.js +
 *     showToast + numerous lazy-init module checks)
 *   - the giant block of `if (typeof X !== 'undefined') window.X = X`
 *     forward references that surface other modules' globals
 *   - all cda* card-detail action wrappers + compound onclick rewrites
 *     (mCreateFabRoute, openDailyProgramFromMore, etc.)
 *   - mobile job-detail / mobile inspection / mobile create-popover
 *     action handlers (_mJdAct, _mJdShare, _mJdSwitchTab, _mCreate,
 *     _mCreatePhotoPicked, openLeadDetail)
 *   - territory zone draw (selectZoneColor, startZoneDraw,
 *     cancelZoneDraw, saveZone, deleteZone)
 *   - prospect/customer page handoff (_stashLeadForCustomerPage,
 *     openPhotosForLead, openDocsForLead, openFullCustomerDetails,
 *     editCardDetails)
 *   - prospect ops (confirmPromoteProspect, toggleProspectHidden,
 *     viewProspectOnMap, absoluteDeleteProspect)
 *   - loadSampleData / damageNearMePhotos
 *   - daily-program config logic (dsGetConfig, dsLoadConfig,
 *     dsDefaultFloors, dsAddFloor, dsRemoveFloor, dsSaveConfig,
 *     dsResetDefaults)
 */

// ══════════════════════════════════════════════
// CARD-DETAIL ACTION WRAPPERS (registered first
// so the data-action delegate can resolve them
// the moment a card-detail modal opens)
// ══════════════════════════════════════════════
// C.4 finale — card-detail action helpers. These wrap the live
// `window._cardDetailLeadId` global (set when a card-detail modal
// opens) and the defensive module-load fallback into single named
// globals that the `call` delegate dispatches.
let _NBD_DA_DELEGATE; // module-local (globals Tranche 1 — was window.*)

// ══════════════════════════════════════════════
// ONE-OFF OPENERS + MOBILE-ROUTE TAIL — Globals Tranche 2c-4c (2026-07-07)
// ══════════════════════════════════════════════
// 20 markup-dispatched compound-rewrite openers (+ the two 2c-4b mobile-route
// tail names mCreateFabRoute/mQuickAddRoute), consolidated OFF window into this
// IIFE and registered in __NBD_CALL_REGISTRY (resolved first by the
// dashboard-ui.js `call` delegate). All markup-only — none has a window/bare/
// dynamic cross-boundary consumer, so none is re-exported and all 20 leave
// _NBD_CALL_ALLOWLIST. Bare callees (goTo, showToast, closeMobileMore,
// openLeadModal, nbdPickerOpen, switchSettingsTab, setDrawMode) and the
// window.* module APIs resolve up-scope, unaffected by the wrap. See
// docs/dev/dashboard-actions-globals-audit.md.
(function () {

// C.4 finale — More-drawer compound rewrites. The original onclicks
// were `mobileNav('home');closeMobileMore()` style chains; we
// consolidate the side-effects here so the markup uses data-action="call".
function openDailyProgramFromMore() {
  if (typeof closeMobileMore === 'function') closeMobileMore();
  window.location.href = '/pro/daily-success';
};

// C.4 finale — mobile FAB create routing. Replaces the ternary
// `window.toggleMobileCreatePopover ? toggleMobileCreatePopover() : openLeadModal()`.
function mCreateFabRoute() {
  if (typeof window.toggleMobileCreatePopover === 'function') {
    window.toggleMobileCreatePopover();
  } else if (typeof openLeadModal === 'function') {
    openLeadModal();
  }
};


// C.4 finale — ternary / compound rewrites for the few one-off handlers
// that don't fit the generic call / module shapes.
function mQuickAddRoute() {
  if (typeof closeQuickAddLead === 'function') closeQuickAddLead();
  if (typeof openLeadModal === 'function') openLeadModal();
};
function restartOnboardingTour() {
  if (window.OnboardingTour && typeof window.OnboardingTour.forceRestart === 'function') {
    window.OnboardingTour.forceRestart();
  } else if (typeof showToast === 'function') {
    showToast('Tour module loading...', 'error');
  }
};
function openDecisionPicker() {
  // NEW-D15: the decision-engine bundle is lazy and wired (in script-loader's
  // VIEW_BUNDLES) only to aitree/understand — never to #/joe, where the
  // "⚡ Scenarios" button lives. Load the 'decision' bundle on demand before
  // opening, mirroring the estimate/photo lazy stubs below.
  const _open = function () {
    if (window.DecisionEngine && typeof window.DecisionEngine.openPicker === 'function') {
      window.DecisionEngine.openPicker();
    } else if (typeof showToast === 'function') {
      showToast('Decision engine loading...', 'error');
    }
  };
  if (window.DecisionEngine && typeof window.DecisionEngine.openPicker === 'function') {
    _open();
  } else if (window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function') {
    window.ScriptLoader.loadBundle('decision').then(_open);
  } else {
    _open();
  }
};
function openD2DOrGo() {
  if (window.D2D && typeof window.D2D.openQuickKnock === 'function') {
    window.D2D.openQuickKnock();
  } else if (typeof goTo === 'function') {
    goTo('d2d');
  }
};
function clearAccentTheme() {
  if (window.ThemeGX && typeof window.ThemeGX.clearAccentOverride === 'function') {
    window.ThemeGX.clearAccentOverride();
  }
  const picker = document.getElementById('customAccentColorPicker');
  if (picker) picker.value = '#e8720c';
};
function openSettingsTab(tabKey) {
  if (typeof nbdPickerOpen === 'function') {
    nbdPickerOpen();
  } else {
    if (typeof goTo === 'function') goTo('settings');
    setTimeout(function(){
      if (typeof switchSettingsTab === 'function') switchSettingsTab(tabKey);
    }, 200);
  }
};
function openPhotoEngineOrClickProxy(fallbackInputId) {
  if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
    window.PhotoEngine.openCamera();
  } else if (fallbackInputId) {
    document.getElementById(fallbackInputId)?.click();
  }
};
function openReportGenerator() {
  if (window.NBDReports && typeof window.NBDReports.openGenerator === 'function') {
    window.NBDReports.openGenerator();
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
function enrichReportData() {
  if (window.NBDReports && typeof window.NBDReports.enrichData === 'function') {
    window.NBDReports.enrichData();
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
function openPhotoEngineCurrentLead() {
  if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
    window.PhotoEngine.openCamera(window._currentPhotoLeadId || '');
  } else if (typeof showToast === 'function') {
    showToast('Photo engine loading…', 'error');
  }
};
function openInspectionBuilderCurrentLead() {
  if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
    window.InspectionReportEngine.openBuilder('inspectionBuilderContainer', window._currentPhotoLeadId || window._leadId || window._currentLeadId || '');
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
function closeInspectionBuilder() {
  const overlay = document.getElementById('inspectionBuilderOverlay');
  const container = document.getElementById('inspectionBuilderContainer');
  if (overlay) overlay.style.display = 'none';
  if (container) container.innerHTML = '';
};
function hideFollowUpAlerts() {
  const wrap = document.getElementById('followUpAlertsWrap');
  if (wrap) wrap.style.display = 'none';
  try { localStorage.setItem('nbd_crm_followup_hidden', '1'); } catch (e) {}
};
function goToD2DFromMaps() {
  if (typeof goTo === 'function') goTo('d2d');
  try {
    if (!localStorage.getItem('nbd_maps_redirect_seen')) {
      if (typeof showToast === 'function') {
        showToast('Maps features are now part of D2D Tracker — use the layer toggles on the map', 'info');
      }
      localStorage.setItem('nbd_maps_redirect_seen', '1');
    }
  } catch (e) {}
};
function openCalBookingUrl() {
  const input = document.getElementById('calBookingUrl');
  if (input && input.value) window.open(input.value, '_blank', 'noopener');
};
function hardResetTest() {
  if (typeof window.__nbdHardReset === 'function') window.__nbdHardReset();
};
function gstaticTest() {
  if (typeof window.__nbdGstaticTest === 'function') window.__nbdGstaticTest();
};
function modeLineDraw() {
  // The original onclick was setDrawMode('line', document.getElementById('modeLineBtn'))
  // — explicit element ref because the user might activate via keyboard shortcut
  // and we still want the active-state ring on the line button.
  if (typeof setDrawMode === 'function') {
    setDrawMode('line', document.getElementById('modeLineBtn'));
  }
};

  // Registration IS the security opt-in; all 20 are markup-dispatched only
  // (no window re-export — none has a cross-boundary consumer).
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, {
    openDailyProgramFromMore: openDailyProgramFromMore,
    mCreateFabRoute: mCreateFabRoute,
    mQuickAddRoute: mQuickAddRoute,
    restartOnboardingTour: restartOnboardingTour,
    openDecisionPicker: openDecisionPicker,
    openD2DOrGo: openD2DOrGo,
    clearAccentTheme: clearAccentTheme,
    openSettingsTab: openSettingsTab,
    openPhotoEngineOrClickProxy: openPhotoEngineOrClickProxy,
    openReportGenerator: openReportGenerator,
    enrichReportData: enrichReportData,
    openPhotoEngineCurrentLead: openPhotoEngineCurrentLead,
    openInspectionBuilderCurrentLead: openInspectionBuilderCurrentLead,
    closeInspectionBuilder: closeInspectionBuilder,
    hideFollowUpAlerts: hideFollowUpAlerts,
    goToD2DFromMaps: goToD2DFromMaps,
    openCalBookingUrl: openCalBookingUrl,
    hardResetTest: hardResetTest,
    gstaticTest: gstaticTest,
    modeLineDraw: modeLineDraw,
  });
})();

// ══════════════════════════════════════════════
// NAVIGATION ROUTER — goTo()
// ══════════════════════════════════════════════
function goTo(name, params = {}) {
  // ── Lite tier gate: block Pro-only views ──
  if (window._userPlan === 'lite' && PRO_ONLY_VIEWS.includes(name)) {
    showToast('Upgrade to access this feature — plans start at $99/mo', 'error');
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
  // NEW-E1 hardening: an unknown route key (a stale bookmark, a renamed view,
  // or a hand-typed #/<garbage> hash) has no `view-<name>` element at all —
  // _hydrateViewTemplate no-ops on it — so the .view deactivation above would
  // leave a blank screen with no view active. Fall back to the always-present
  // CRM pipeline instead. The `name !== 'crm'` guard prevents infinite
  // recursion in the impossible case that view-crm itself is missing.
  if (!view && name !== 'crm') { goTo('crm'); return; }
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
  if(name==='dash') {
    // QA 2026-06-21 #9: the ops-overview KPI tiles (statLeads / statVal /
    // statClosed / statEsts) are populated only as a side-effect of
    // renderLeads / renderEstimatesList during BOOT. SPA route-enter to #/dash
    // never refreshed them, so the overview showed the $0 HTML defaults until a
    // full reload. Repopulate from the in-memory sets on every dash entry.
    // renderEstimatesList runs first (it also writes statVal = estimate total),
    // then renderLeads runs LAST so statVal ends as the pipeline value (matches
    // boot). _filteredLeads is passed through so the hidden CRM filter state is
    // preserved (renderLeads keeps it when the 2nd arg is the current filter).
    try {
      if (typeof window.renderEstimatesList === 'function') window.renderEstimatesList(window._estimates || []);
      if (typeof window.renderLeads === 'function' && Array.isArray(window._leads)) window.renderLeads(window._leads, window._filteredLeads);
    } catch (e) { console.warn('dash KPI refresh failed:', e); }
    // QA 2026-06-21 #9b: the dashboard widget SECTIONS (hot-leads, smart-followup
    // briefing, almost-there, stale-shares, engagement-cohort, bottleneck) render
    // off the 'nbd:data-refreshed' signal, which fires during boot — BEFORE the
    // view-dash template is hydrated, so their body elements didn't exist yet and
    // the sections stayed stuck on 'Loading…' when reached via SPA route-enter
    // (only a full page load fixed them). The template is hydrated by this point
    // (_hydrateViewTemplate ran above), so re-emit the signal to make every
    // widget re-render into its now-present body. Idempotent + already fires
    // frequently in normal use (task/snooze/lead-load), so no new churn.
    try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'dash-enter' } })); } catch (e) {}
  }
  if(name==='est') {
    // Same QA #9b pattern as view-dash above: the estimate-analytics band
    // (#estStats, estimate-analytics.js) renders off 'nbd:data-refreshed',
    // which mostly fires during boot — before the est template is hydrated
    // (Rock 4 Phase 4 templated the last raw view). Re-emit post-hydration
    // so the band renders on first open instead of waiting for the next
    // natural data event. Idempotent; the renderer null-guards #estStats.
    try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'est-enter' } })); } catch (e) {}
  }
  if(name==='map') {
    if (!mapInited.map) {
      waitForLeaflet(()=>{ waitForMapFn('initMainMap', ()=>{
        (()=>{ initMainMap(); mapInited.map=true; ensureMapSize(mainMap); });
      }); });
    } else if (typeof mainMap !== 'undefined' && mainMap) {
      ensureMapSize(mainMap);
    }
  }
  if(name==='draw') {
    if (!mapInited.draw) {
      waitForLeaflet(()=>{ waitForMapFn('initDrawMap', ()=>{
        (()=>{ initDrawMap(); mapInited.draw=true; ensureMapSize(drawMap); });
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
  if(name==='expenses')   { _lazyPreload.then(() => { if (window.Expenses)    window.Expenses.init();    }); }
  if(name==='money')      { _lazyPreload.then(() => { if (window.MoneyDashboard) window.MoneyDashboard.init(); }); }
  if(name==='refrewards') { if (window.ReferralRewards) window.ReferralRewards.render(); }
  if(name==='repos')      { _lazyPreload.then(() => { if (window.RepOS)       window.RepOS.init();       }); }
  if(name==='talk-tank')  { if (window.TalkTank)  window.TalkTank.init();  }
  if(name==='board') { if(window.AnalyticsKPI) window.AnalyticsKPI.render('analyticsContainer'); if(window.AiTextingStatsCard) window.AiTextingStatsCard.render(); renderLeaderboard(); }
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
          if (c) c.innerHTML = '<div class="empty"><div class="empty-icon">😕</div><p style="color:var(--m);font-size:14px;margin:8px 0 16px;">D2D Tracker failed to load.<br>Check your connection and try again.</p><button data-da-action="reload" style="background:var(--orange);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;">Reload</button></div>';
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
      //
      // Direct call (not requestAnimationFrame) — RAF is the only timing
      // primitive Chrome FULLY PAUSES on hidden/occluded tabs. If the
      // user's window briefly loses focus (alt-tab, another window covers
      // it, multi-monitor switch), an RAF callback queued moments before
      // never fires, leaving the map blank until the user does something
      // that forces re-init. initD2D's own setTimeout(initD2DMap, 200)
      // handles the "wait for paint before Leaflet measures" need
      // without depending on tab visibility.
      window.D2D.init();

      // Belt-and-suspenders watchdog: independent of d2d-tracker.js. If
      // #d2dContent still shows the static "Loading…" placeholder after
      // 14 seconds (8s Firestore timeout + padding), something inside
      // initD2D() hung silently. Replace with a user-visible retry UI so
      // the spinner never stays forever regardless of root cause.
      setTimeout(() => {
        const c = document.getElementById('d2dContent');
        if (c && c.textContent.includes('Loading Door-to-Door')) {
          console.error('[d2d-watchdog] initD2D hung — replacing spinner with retry UI');
          c.innerHTML = '<div class="empty"><div class="empty-icon">😕</div><p style="color:var(--m);font-size:14px;margin:8px 0 16px;">D2D Tracker took too long to load.<br>Check your connection and try again.</p><button data-da-action="reload" style="background:var(--orange);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;">Reload</button></div>';
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
    // PR 2c: product-library ships in the lazy 'estimates' bundle, which the
    // products view preloads (VIEW_BUNDLES). Chain the render on that preload
    // so window._productLib exists when we read it.
    _lazyPreload.then(function () {
      const pc = document.getElementById('productLibraryContainer');
      if (pc && window._productLib) { pc.innerHTML = window._productLib.render(); }
      else if (pc && typeof window.renderProductLibrary === 'function') { pc.innerHTML = window.renderProductLibrary(); }
    });
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

// ══════════════════════════════════════════════
// TERRITORY ZONES — draw / save / delete
// ══════════════════════════════════════════════
function selectZoneColor(color, el) {
  zoneColor = color;
  document.querySelectorAll('#zoneColorPicker > div').forEach(d => d.style.borderColor = 'transparent');
  el.style.borderColor = '#fff';
}

// Fill the zone rep picker from the shared rep palette (maps-customers). Keeps
// the leading "no rep" option; each rep option carries its palette colour in a
// data attribute so saveZone can shade the zone without re-deriving.
function _populateZoneReps() {
  const sel = document.getElementById('zoneRepSelect');
  if (!sel) return;
  const reps = (typeof window.nbdRepList === 'function') ? (window.nbdRepList() || []) : [];
  const prev = sel.value;
  let html = '<option value="">Assign to rep (optional)…</option>';
  reps.forEach(function (r) {
    html += '<option value="' + String(r.key).replace(/"/g, '&quot;') + '" data-color="' + r.color + '">'
      + String(r.label).replace(/</g, '&lt;') + '</option>';
  });
  sel.innerHTML = html;
  if (prev) sel.value = prev;
}

function startZoneDraw() {
  if(!mainMap) { showToast('Open the map first','error'); return; }
  zoneDrawing = true;
  zonePoints = [];
  zoneDots = [];
  // zonePanel lives inside tpl-view-map (lazy-hydrated). Use optional
  // chaining so a stray invocation outside #/map doesn't null-deref.
  document.getElementById('zonePanel')?.classList.add('visible');
  // Populate the rep picker so a zone can be assigned to (and shaded by) a rep.
  _populateZoneReps();
  showToast('Click map to draw zone boundary. Click Save when done.');
  mainMap.getContainer().style.cursor = 'crosshair';

  // Attach zone click handler. Re-entering zone-draw overwrites
  // _zoneClick before cancel/save can off() it, leaving the orphaned
  // handler attached — each click then adds 2+ points (NEW-D38).
  if (mainMap._zoneClick) mainMap.off('click', mainMap._zoneClick);
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
  document.getElementById('zonePanel')?.classList.remove('visible');
}

async function saveZone() {
  if(zonePoints.length < 3) { showToast('Draw at least 3 points to define a zone','error'); return; }
  const name = document.getElementById('zoneNameInput')?.value?.trim() || 'Zone ' + (zones.length+1);
  mainMap.off('click', mainMap._zoneClick);
  mainMap.getContainer().style.cursor = '';
  zoneDrawing = false;
  // Remove temp dots
  zoneDots.forEach(d => mainMap.removeLayer(d));
  if(zoneTempPoly) mainMap.removeLayer(zoneTempPoly);

  // Rep assignment (optional) — a rep-owned territory is shaded in that rep's
  // colour and labelled with their name, for dividing canvassing areas.
  const repSel = document.getElementById('zoneRepSelect');
  const repKey = repSel && repSel.value ? repSel.value : '';
  const repOpt = repSel && repSel.selectedOptions && repSel.selectedOptions[0];
  // Persist a NON-viewer-relative label: nbdRepList returns "Me" for the
  // assigner's own uid, and storing that into the team-shared /zones doc would
  // show "Me" to every teammate. Store the assigner's real name for self;
  // renderSavedZones re-resolves the label per-viewer anyway (audit round 2).
  let repLabel = repKey && repOpt ? repOpt.textContent : '';
  if (repKey && window._user && repKey === window._user.uid) {
    repLabel = window._user.displayName || window._user.email || repKey;
  }
  const repColor = repKey && repOpt ? (repOpt.getAttribute('data-color') || zoneColor) : '';
  const fillColor = repColor || zoneColor;
  const _esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  // Serialize points to plain {lat,lng} for Firestore (L.LatLng isn't storable).
  const pts = zonePoints.map(p => ({ lat: p.lat, lng: p.lng }));

  const layer = L.polygon(zonePoints, {
    color: fillColor, weight:2.5, fillColor: fillColor, fillOpacity:.1
  }).addTo(mainMap);
  const _tipName = repLabel ? `${name} · ${repLabel}` : name;
  // Team-shared zones render another user's name in my browser — escape it.
  layer.bindTooltip(`<div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;">${_esc(_tipName)}</div>`, {permanent:true, className:'zone-tooltip', direction:'center'});
  _bindZoneInsights(layer, { name, repLabel, points: pts, rep: repKey });

  // Persist so the territory survives reload + syncs to the team (fall back to
  // a local id if the write is unavailable — the zone still shows this session).
  let id = 'd-' + Date.now();
  if (typeof window._saveZone === 'function') {
    try { id = await window._saveZone({ name, color: fillColor, points: pts, rep: repKey, repLabel }); } catch (_) {}
  }
  zones.push({id, name, color:fillColor, points:pts, layer, rep:repKey, repLabel});
  zonePoints = []; zoneDots = [];
  document.getElementById('zonePanel')?.classList.remove('visible');
  const _zni = document.getElementById('zoneNameInput');
  if (_zni) _zni.value = '';
  const _zrs = document.getElementById('zoneRepSelect');
  if (_zrs) _zrs.value = '';
  renderZoneList();
  showToast(`Zone "${name}" saved ✓`);
}

async function deleteZone(id) {
  // Ids are Firestore doc strings (or a 'd-' local fallback); compare loosely so
  // a numeric-vs-string mismatch from the list's data attr still matches.
  const idx = zones.findIndex(z => String(z.id) === String(id));
  if(idx < 0) return;
  const zone = zones[idx];
  // Confirm the server delete BEFORE touching the UI — a team reader sees a
  // teammate's zone in the list, but the /zones rule denies deleting it. The
  // old code removed it optimistically and it silently reappeared on reload.
  let ok = true;
  if (typeof window._deleteZone === 'function') { try { ok = await window._deleteZone(zone.id); } catch (_) { ok = false; } }
  if (!ok) { if (typeof showToast === 'function') showToast('Could not delete — only the owner or a company admin can remove this zone', 'error'); return; }
  if (zone.layer) mainMap?.removeLayer(zone.layer);
  // Recompute the index by identity AFTER the await — a second concurrent
  // delete may have spliced the array while our server round-trip was in
  // flight, so the `idx` captured before the await is now stale and would drop
  // the wrong zone.
  const realIdx = zones.findIndex(z => String(z.id) === String(zone.id));
  if (realIdx >= 0) zones.splice(realIdx, 1);
  renderZoneList();
}

// ── ZONE INSIGHTS — what's inside a drawn territory ──────────────
// Ray-casting point-in-polygon (poly = [{lat,lng}]). Local roofing territories
// don't cross the antimeridian, so the simple form is fine.
function _pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// Aggregate the leads whose coords fall inside the zone: count, pipeline $,
// role breakdown, top damage type. Uses the live pipeline engine for roles so
// custom stages classify correctly.
function _zoneInsights(zone) {
  const poly = (zone.points || []).filter(p => p && p.lat != null && p.lng != null);
  const roles = { new: 0, active: 0, job: 0, won: 0, lost: 0 };
  const dmg = {};
  let total = 0, count = 0;
  if (poly.length >= 3) {
    (window._leads || []).forEach(l => {
      if (!l || l.deleted || l.lat == null || l.lng == null) return;
      if (!_pointInPolygon(parseFloat(l.lat), parseFloat(l.lng), poly)) return;
      count++;
      total += parseFloat(l.jobValue || l.value || l.contractValue || 0) || 0;
      const r = (typeof window.stageRole === 'function') ? window.stageRole(l._stageKey || l.stage) : (l._stageRole || 'active');
      if (roles[r] != null) roles[r]++;
      const d = String(l.damageType || '').trim();
      if (d) dmg[d] = (dmg[d] || 0) + 1;
    });
  }
  let topDmg = '', topN = 0;
  Object.keys(dmg).forEach(k => { if (dmg[k] > topN) { topN = dmg[k]; topDmg = k; } });
  return { count, total, roles, topDmg };
}
// Resolve a zone's rep label in the CURRENT viewer's context (so a viewer sees
// "Me" for their own zone + colleagues' real names), rather than the label the
// assigner happened to persist. Falls back to the stored real-name label when
// the rep has no leads in this viewer's book.
function _zoneRepLabel(zoneData) {
  if (!zoneData) return '';
  if (zoneData.rep && typeof window.nbdRepList === 'function') {
    const r = (window.nbdRepList() || []).find(x => x && x.key === zoneData.rep);
    if (r && r.label) {
      // nbdRepList's last-resort label is a uid-slice (String(uid).slice(0,6))
      // when the rep has no leads in THIS viewer's book. Don't let that
      // degenerate slice clobber the real name the assigner persisted —
      // prefer the stored repLabel whenever the live label is just the slice.
      const isUidSlice = r.label === String(zoneData.rep).slice(0, 6);
      if (!isUidSlice || !zoneData.repLabel) return r.label;
    }
  }
  return zoneData.repLabel || '';
}
function _zonePopupHTML(zone) {
  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const s = _zoneInsights(zone);
  const money = '$' + Math.round(s.total).toLocaleString();
  const repLbl = _zoneRepLabel(zone);
  return `<div style="font-family:sans-serif;min-width:184px;">`
    + `<div style="font-weight:800;font-size:13px;margin-bottom:3px;">${esc(zone.name || 'Zone')}${repLbl ? ` · ${esc(repLbl)}` : ''}</div>`
    + `<div style="font-size:12px;color:var(--t,#111);">${s.count} customer${s.count === 1 ? '' : 's'} · <b>${esc(money)}</b> pipeline</div>`
    + `<div style="font-size:11px;color:var(--m,#6b7280);margin-top:4px;">Won ${s.roles.won} · Active ${s.roles.active} · Job ${s.roles.job} · New ${s.roles.new} · Lost ${s.roles.lost}</div>`
    + (s.topDmg ? `<div style="font-size:11px;color:var(--m,#6b7280);">Top damage: ${esc(s.topDmg)}</div>` : '')
    + `</div>`;
}
// Bind a click-popup that recomputes on each open (leads change over time).
function _bindZoneInsights(layer, zoneData) {
  if (!layer || typeof layer.bindPopup !== 'function') return;
  layer.bindPopup(() => _zonePopupHTML(zoneData), { maxWidth: 240, minWidth: 190 });
}

// Draw the persisted, team-shared zones (window._zones) onto the map and
// rebuild the in-memory `zones` list. Idempotent — clears prior zone layers
// first — so it's safe to call on map init AND after loadZones resolves.
function renderSavedZones() {
  if (!mainMap || !Array.isArray(window._zones)) return;
  const _esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#4A9EFF';
  zones.forEach(z => { if (z.layer && mainMap) { try { mainMap.removeLayer(z.layer); } catch (_) {} } });
  zones.length = 0;
  window._zones.forEach(zd => {
    const pts = (zd.points || []).filter(p => p && p.lat != null && p.lng != null).map(p => [p.lat, p.lng]);
    if (pts.length < 3) return;
    const color = safeColor(zd.color);
    const layer = L.polygon(pts, { color, weight:2.5, fillColor:color, fillOpacity:.1 }).addTo(mainMap);
    const _rl = _zoneRepLabel(zd); // per-viewer (not the stored "Me")
    const tip = _rl ? (zd.name + ' · ' + _rl) : (zd.name || 'Zone');
    layer.bindTooltip(`<div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;">${_esc(tip)}</div>`, {permanent:true, className:'zone-tooltip', direction:'center'});
    _bindZoneInsights(layer, { name: zd.name, repLabel: zd.repLabel, points: zd.points, rep: zd.rep });
    zones.push({ id: zd.id, name: zd.name, color, points: zd.points, layer, rep: zd.rep, repLabel: zd.repLabel });
  });
  if (typeof renderZoneList === 'function') renderZoneList();
}

// ══════════════════════════════════════════════
// SAMPLE DATA + damage-near-me overrides
// ══════════════════════════════════════════════
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

function damageNearMePhotos(){
  navigator.geolocation?.getCurrentPosition(async pos=>{
    showToast('Finding nearby inspections...');
    goTo('map');
    if(mainMap) mainMap.setView([pos.coords.latitude,pos.coords.longitude],14);
  },()=>showToast('Location access denied','error'));
}

// ── Override damagNearMe to use enhanced location ──────────────
window.damagNearMe = function() { spyglassGoToLocation(); };

// ══════════════════════════════════════════════
// FORWARD-REFERENCE BLOCK — surface other modules' globals onto window
// ══════════════════════════════════════════════
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

// PR 2c: the estimate engine is lazy (ScriptLoader 'estimates' bundle).
// startNewEstimate / openEstimateV2Builder can be invoked (lead-card chips,
// command palette, 'E' shortcut, maps) before the bundle loads, so install
// load-then-run stubs. estimates.js / estimate-v2-ui.js overwrite these with
// the real functions when the bundle finishes loading.
if (typeof startNewEstimate === 'function') {
  window.startNewEstimate = startNewEstimate;
} else {
  const _lazyEstimate = function (fnName, args) {
    if (!(window.ScriptLoader && window.ScriptLoader.loadBundle)) {
      if (typeof showToast === 'function') showToast('Estimate builder is still loading — try again in a moment', 'warning');
      return;
    }
    window.ScriptLoader.loadBundle('estimates').then(function () {
      const fn = window[fnName];
      if (typeof fn === 'function' && !fn.__nbdLazyEstimateStub) { fn.apply(null, args); }
      else if (typeof showToast === 'function') { showToast('Estimate builder is still loading — try again in a moment', 'warning'); }
    });
  };
  window.startNewEstimate = function () { _lazyEstimate('startNewEstimate', arguments); };
  window.startNewEstimate.__nbdLazyEstimateStub = true;
  if (typeof window.openEstimateV2Builder !== 'function') {
    window.openEstimateV2Builder = function () { _lazyEstimate('openEstimateV2Builder', arguments); };
    window.openEstimateV2Builder.__nbdLazyEstimateStub = true;
  }
}
if(typeof saveEstimate==='function'){window.saveEstimate=saveEstimate;}
if(typeof cancelEstimate==='function'){window.cancelEstimate=cancelEstimate;}
if(typeof viewEstimate==='function'){window.viewEstimate=viewEstimate;}

// PR 2d: the photo + inspection engine is lazy (ScriptLoader 'photos' bundle).
// Install load-then-run stubs for the entry points (camera, gallery, upload,
// inspection builder, photo report) so a click before the bundle loads still
// works. photo-engine.js / inspection-report-engine.js / photo-report.js
// overwrite these globals (unconditionally) when the bundle finishes loading.
if (typeof window.PhotoEngine === 'undefined' || typeof window.InspectionReportEngine === 'undefined' || typeof window.generatePhotoReport !== 'function') {
  const _lazyPhotos = function (run) {
    if (!(window.ScriptLoader && window.ScriptLoader.loadBundle)) {
      if (typeof showToast === 'function') showToast('Photos are still loading — try again in a moment', 'warning');
      return;
    }
    window.ScriptLoader.loadBundle('photos').then(run);
  };
  if (typeof window.PhotoEngine === 'undefined') {
    const _peStub = { __nbdLazyPhotosStub: true };
    ['openCamera', 'openGallery', 'uploadFromFile', 'renderGallery', 'openLightbox'].forEach(function (m) {
      _peStub[m] = function () {
        const a = arguments;
        _lazyPhotos(function () {
          if (window.PhotoEngine && window.PhotoEngine !== _peStub && typeof window.PhotoEngine[m] === 'function') window.PhotoEngine[m].apply(window.PhotoEngine, a);
          else if (typeof showToast === 'function') showToast('Photos are still loading — try again in a moment', 'warning');
        });
      };
    });
    window.PhotoEngine = _peStub;
  }
  if (typeof window.InspectionReportEngine === 'undefined') {
    window.InspectionReportEngine = {
      __nbdLazyPhotosStub: true,
      openBuilder: function () {
        const a = arguments;
        _lazyPhotos(function () {
          if (window.InspectionReportEngine && !window.InspectionReportEngine.__nbdLazyPhotosStub && typeof window.InspectionReportEngine.openBuilder === 'function') window.InspectionReportEngine.openBuilder.apply(window.InspectionReportEngine, a);
          else if (typeof showToast === 'function') showToast('Photos are still loading — try again in a moment', 'warning');
        });
      }
    };
  }
  if (typeof window.generatePhotoReport !== 'function') {
    window.generatePhotoReport = function () {
      const a = arguments;
      _lazyPhotos(function () {
        if (typeof window.generatePhotoReport === 'function' && !window.generatePhotoReport.__nbdLazyPhotosStub) window.generatePhotoReport.apply(null, a);
        else if (typeof showToast === 'function') showToast('Photos are still loading — try again in a moment', 'warning');
      });
    };
    window.generatePhotoReport.__nbdLazyPhotosStub = true;
  }
}
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
if(typeof renderSavedZones!=='undefined') window.renderSavedZones = renderSavedZones;
// spyglassSearch / spyglassGoToLocation / fabToggle / quickStormCheck →
// __NBD_CALL_REGISTRY (dashboard-ui.js, Tranche 2c-4h Slice H2) — re-exports removed.
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
// Delete confirm + deleted drawer: owned by crm-portal-bridge.js, which
// loads AFTER this file — so these typeof-guards were always 'undefined'
// here and no-op'd (dead since the crm.js split). Globals Tranche 2c-3
// wrapped that module: cancelDeleteConfirm/confirmDeleteLead/openDeletedDrawer
// register in __NBD_CALL_REGISTRY, closeDeletedDrawer re-exports itself —
// none need a forward-reference here. (restoreDeletedLead/permanentDeleteLead
// remain crm.js window aliases; their guards stay below.)
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
// pullIntelForModal → __NBD_CALL_REGISTRY via property-intel.js (Tranche 2c-4h Slice H2 pt2) — re-export removed.
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
// openUploadDoc → __NBD_CALL_REGISTRY (dashboard-ui.js, Tranche 2c-4h Slice H2) — re-export removed.
if(typeof closeUploadDoc!=='undefined') window.closeUploadDoc = closeUploadDoc;
if(typeof saveDocUpload!=='undefined') window.saveDocUpload = saveDocUpload;
if(typeof openDocTemplate!=='undefined') window.openDocTemplate = openDocTemplate;
// printDoc → __NBD_CALL_REGISTRY (dashboard-ui.js, Tranche 2c-4h Slice H2) — re-export removed.
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
// Daily settings — the ds* cluster is IIFE-wrapped (Globals Tranche 2c-4d,
// 2026-07-07); its window exports moved INSIDE that IIFE (dsRemoveFloor stays,
// the rest go to the registry). This load-time typeof block would read
// 'undefined' post-wrap (the decls are module-local now), so it is gone.
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
// executePullPropertyIntel / confirmPropertyIntelPull → __NBD_CALL_REGISTRY via
// property-intel.js (Tranche 2c-4h Slice H2 pt2) — re-exports removed.
if(typeof closePropertyIntelModal!=='undefined') window.closePropertyIntelModal = closePropertyIntelModal;
if(typeof closePropertyIntelConfirmModal!=='undefined') window.closePropertyIntelConfirmModal = closePropertyIntelConfirmModal;
// Notifications - defined later in this file
if(typeof markAllNotificationsRead!=='undefined') window.markAllNotificationsRead = markAllNotificationsRead;
if(typeof markNotificationRead!=='undefined') window.markNotificationRead = markNotificationRead;
if(typeof dsPickTheme!=='undefined') window.dsPickTheme = dsPickTheme;
if(typeof renderLeaderboard!=='undefined') window.renderLeaderboard = renderLeaderboard;
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════
// DAILY PROGRAM — config logic — Globals Tranche 2c-4d (2026-07-07)
// ══════════════════════════════════════════════
// The cluster AND its callers (the goTo settings-hook + the DOMContentLoaded
// handler, both of which call dsLoadConfig) are wrapped in this one IIFE so the
// internal helpers (dsGetConfig/dsLoadConfig/dsDefaultFloors) go module-local.
// dsAddFloor/dsSaveConfig/dsResetDefaults register in __NBD_CALL_REGISTRY;
// dsRemoveFloor keeps a window re-export (bare-called at dashboard-ui.js:2208).
// Shared state (dsFloors, DS_* consts) lives in dashboard-state.js up-scope and
// dsRenderFloors/dsBuildThemeGrid in dashboard-ui.js — all resolve up-scope,
// unaffected by the wrap. See docs/dev/dashboard-actions-globals-audit.md.
(function () {
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

function dsAddFloor() {
  if (dsFloors.length >= 7) { showToast('Max 7 floors'); return; }
  dsFloors.push({ id: 'f' + Date.now(), label: '', targetValue: 1, unit: 'done' });
  dsRenderFloors();
}

function dsRemoveFloor(i) {
  dsFloors.splice(i, 1);
  dsRenderFloors();
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
  // NEW-4: mirror into the derived 'nbd_ds_config' key that the Home widgets
  // read (north-star / daily-floors / golden-goose in js/widgets.js). Without
  // this, a North Star set here saves to nbd_user_config but the Home widget
  // (which reads nbd_ds_config) never sees it and stays on the placeholder.
  // Uses the EXACT shape transform as daily-success/js/app.js syncToWidgetKeys()
  // so the two save paths stay byte-consistent.
  try {
    const widgetCfg = {
      northStar: config.northStar.target || config.northStar.category || '',
      northStarDeadline: config.northStar.deadline || '',
      floors: config.floors.map(f => ({ label: f.label, target: parseFloat(f.targetValue) || 1, unit: f.unit || '' })),
      goldenGoose: config.goose || '',
    };
    localStorage.setItem('nbd_ds_config', JSON.stringify(widgetCfg));
  } catch {}
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

  // dsRemoveFloor is bare-called from dashboard-ui.js:2208 (the floor-row delete
  // button) — MUST keep a window export. The other three convert to the registry;
  // dsGetConfig/dsLoadConfig/dsDefaultFloors are private (intra-IIFE callers only).
  window.dsRemoveFloor = dsRemoveFloor;
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, {
    dsAddFloor: dsAddFloor,
    dsSaveConfig: dsSaveConfig,
    dsResetDefaults: dsResetDefaults,
  });
})();

// ══════════════════════════════════════════════
// MOBILE JOB-DETAIL / CREATE-POPOVER CLUSTER — Globals Tranche 2c-4b (2026-07-07)
// ══════════════════════════════════════════════
// This whole contiguous block is wrapped in one in-file IIFE so its top-level
// `function` declarations become module-local instead of auto-globals. The
// three markup-dispatched (data-fn=) convertibles — _mJdSwitchTab, _mJdShare,
// _mCreate — register in __NBD_CALL_REGISTRY (block at the bottom of the IIFE),
// which the dashboard-ui.js `call` delegate resolves first. Every name with a
// cross-boundary consumer keeps its explicit `window.X = X` re-export (those
// exports are now load-bearing — the function decl no longer globals itself):
//   _mJdSwitchTab        → dashboard-widgets.js:1176 bare call
//   _mJdAct              → 2c-4a cdaMjdAct calls window._mJdAct
//   openMobileInspection → 2c-4a cdaOpenMobileInspection calls window.openMobileInspection
//   closeMobileInspection, closeMobileCreatePopover → _NBD_MODAL_CLOSE_FNS window[fn] dispatch
//   toggleMobileCreatePopover → mCreateFabRoute (outside this IIFE) calls window.toggleMobileCreatePopover
//   openLeadDetail       → crm-pipeline.js:1267 bare call
// openMobileCreatePopover is fully PRIVATE — its only caller (toggleMobileCreatePopover)
// is co-located in this IIFE. See docs/dev/dashboard-actions-globals-audit.md.
(function () {
function _mJdSwitchTab(tab) {
  document.querySelectorAll('.m-jd-tab').forEach(t => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const map = { activity:'mJdTabActivity', photos:'mJdTabPhotos', details:'mJdTabDetails' };
  for (const [k, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.hidden = (k !== tab);
  }
}
window._mJdSwitchTab = _mJdSwitchTab;

// ══════════════════════════════════════════════════════════════════════
// Wave 2D — Mobile inspection overlay
//
// Reuses the existing InspectionReportEngine (docs/pro/js/
// inspection-report-engine.js, ~2,300 lines) but hosts it in a full-
// screen mobile shell. Same engine the desktop uses → reports
// generated on phone are byte-identical to desktop-generated ones,
// no fork to maintain.
// ══════════════════════════════════════════════════════════════════════
function openMobileInspection(leadId) {
  if (!leadId) return;
  const root = document.getElementById('mInspection');
  if (!root) return;
  window._cardDetailLeadId = leadId;

  // Title — show customer name for context.
  const lead = (window._leads || []).find(l => l.id === leadId);
  const name = lead
    ? (((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || lead.name || 'Inspection')
    : 'Inspection';
  const titleEl = document.getElementById('mInspTitle');
  if (titleEl) titleEl.textContent = name;

  // Mount the engine into the mobile container. The engine itself
  // handles loading state, template picker, photo capture, and PDF
  // generation — we just hand it a container and a lead.
  const container = document.getElementById('mInspectionContainer');
  if (container) container.innerHTML = '<div class="m-jd-empty">Loading inspection builder…</div>';

  root.hidden = false;
  root.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
    // The engine's openBuilder is async — fire-and-forget so we don't
    // block the slide-up animation.
    Promise.resolve(window.InspectionReportEngine.openBuilder('mInspectionContainer', leadId))
      .catch(err => {
        console.warn('inspection engine open failed:', err && err.message);
        if (container) container.innerHTML = '<div class="m-jd-empty">Inspection builder failed to load — try again in a moment.</div>';
      });
  } else {
    if (container) container.innerHTML = '<div class="m-jd-empty">Inspection engine not loaded on this page.</div>';
  }
}
window.openMobileInspection = openMobileInspection;

function closeMobileInspection() {
  const root = document.getElementById('mInspection');
  if (!root) return;
  root.classList.remove('open');
  root.hidden = true;
  // Clear the engine's contents so a stale render doesn't flash on
  // next open of a different lead.
  const container = document.getElementById('mInspectionContainer');
  if (container) container.innerHTML = '';
  // If the mobile job-detail is also open underneath, body-scroll
  // stays locked. Otherwise restore.
  const jd = document.getElementById('mJobDetail');
  if (!jd || jd.hidden) document.body.style.overflow = '';
}
window.closeMobileInspection = closeMobileInspection;

// Wave 2C.2 — Mobile share, native first.
//
// Tapping the share icon in the mobile job-detail top bar invokes
// navigator.share() with the lead's name + portal URL when both are
// available. If navigator.share is missing (desktop, some older
// Android browsers) we fall back to copying the portal link to the
// clipboard and toasting; if there's no portal link yet we toast the
// rep with a helpful next step. CompanyCam invokes the OS share sheet
// for this exact pattern — we mirror it but stay branded.
function _mJdShare() {
  const id = window._cardDetailLeadId;
  if (!id) return;
  const lead = (window._leads || []).find(l => l.id === id);
  if (!lead) return;
  const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim()
    || lead.name || 'Lead';
  // Prefer the portal short link if the rep already minted one;
  // otherwise the customer-page URL with leadId.
  const portal = lead.portalShortUrl || lead.portalUrl
    || (lead.portalToken
        ? location.origin + ((window.NBDUrl && window.NBDUrl.customer(id))
            || ('/pro/customer.html?id=' + encodeURIComponent(id)))
            + '&t=' + encodeURIComponent(lead.portalToken)
        : '');
  const text = lead.address ? (name + ' — ' + lead.address) : name;

  if (navigator && typeof navigator.share === 'function' && portal) {
    navigator.share({ title: name, text: text, url: portal })
      .catch(() => {/* user cancel or share denied — silent */});
    return;
  }
  // Fallback: copy to clipboard.
  if (portal && navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(portal)
      .then(() => { if (typeof showToast === 'function') showToast('Portal link copied', 'success'); })
      .catch(() => { if (typeof showToast === 'function') showToast('Copy failed — long-press the address to share', 'error'); });
    return;
  }
  if (typeof showToast === 'function') {
    showToast(portal ? 'Sharing not supported here' : 'No portal link yet — generate one from the lead detail', 'info');
  }
}

function _mJdAct(kind) {
  const id = window._cardDetailLeadId;
  if (!id) return;
  const lead = (window._leads || []).find(l => l.id === id);
  if (!lead) return;
  switch (kind) {
    case 'call':
      if (lead.phone) location.href = 'tel:' + String(lead.phone).replace(/[^0-9+]/g, '');
      break;
    case 'text':
      if (lead.phone) location.href = 'sms:' + String(lead.phone).replace(/[^0-9+]/g, '');
      break;
    case 'email':
      if (lead.email) location.href = 'mailto:' + lead.email;
      break;
    case 'photos':
      closeMobileJobDetail();
      window._currentPhotoLeadId = id;
      goTo('photos');
      break;
    case 'estimate':
      closeMobileJobDetail();
      window._currentEstimateLeadId = id;
      goTo('est');
      break;
  }
}
window._mJdAct = _mJdAct;

// ══════════════════════════════════════════════════════════════════════
// Wave 2C.1 — Mobile create popover behind the bottom-nav "+" FAB
//
// Opens a bottom-sheet with 5 entry points (Lead / Photo / Task /
// Knock / Note). Each row hands off to an existing flow rather than
// duplicating modals. The popover closes itself before firing the
// handler so the destination modal isn't competing with our backdrop.
// ══════════════════════════════════════════════════════════════════════
function openMobileCreatePopover() {
  const bd = document.getElementById('mCreateBackdrop');
  const pop = document.getElementById('mCreatePopover');
  if (!bd || !pop) return;
  bd.hidden = false; pop.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeMobileCreatePopover() {
  const bd = document.getElementById('mCreateBackdrop');
  const pop = document.getElementById('mCreatePopover');
  if (!bd || !pop) return;
  bd.hidden = true; pop.hidden = true;
  document.body.style.overflow = '';
}
function toggleMobileCreatePopover() {
  const pop = document.getElementById('mCreatePopover');
  if (!pop) { if (typeof openLeadModal === 'function') openLeadModal(); return; }
  if (pop.hidden) openMobileCreatePopover();
  else closeMobileCreatePopover();
}
// openMobileCreatePopover is PRIVATE (Tranche 2c-4b) — sole caller
// toggleMobileCreatePopover is co-located in this IIFE; no window export.
window.closeMobileCreatePopover = closeMobileCreatePopover;
window.toggleMobileCreatePopover = toggleMobileCreatePopover;

function _mCreate(kind) {
  closeMobileCreatePopover();
  switch (kind) {
    case 'lead':
      if (typeof openLeadModal === 'function') openLeadModal();
      break;
    case 'photo':
      // Trigger the device camera via the hidden <input capture>.
      // Browsers that don't honor `capture` open the photo picker — fine.
      const input = document.getElementById('mCreatePhotoInput');
      if (input) input.click();
      break;
    case 'task':
      if (typeof openTaskModal === 'function') openTaskModal();
      else if (typeof openLeadModal === 'function') openLeadModal();
      break;
    case 'knock':
      // D2D entry. Tracker module exposes openKnock() (no args = new
      // knock at current GPS). Falls back to navigating to view-d2d
      // so reps without geolocation still get somewhere usable.
      if (typeof openKnock === 'function') { openKnock(); break; }
      if (window.D2D && typeof window.D2D.openNewKnock === 'function') {
        window.D2D.openNewKnock(); break;
      }
      goTo('d2d');
      break;
    case 'note':
      // No standalone note modal yet — open the lead modal which
      // surfaces a note field on save. Replaced with a proper quick-
      // note flow in a follow-up.
      if (typeof openLeadModal === 'function') openLeadModal();
      break;
  }
}

// Mobile-aware router. Card clicks (handleCardClick / openLeadDetail
// callers) go here; we pick mobile overlay vs desktop modal at click
// time so changing viewport (tablet rotation) just works.
function openLeadDetail(leadId) {
  const mobile = (typeof matchMedia === 'function')
    && matchMedia('(max-width: 768px)').matches;
  if (mobile && typeof openMobileJobDetail === 'function') {
    openMobileJobDetail(leadId);
  } else {
    openCardDetailModal(leadId);
  }
}
window.openLeadDetail = openLeadDetail;

  // Registration IS the security opt-in. The three markup-dispatched (data-fn=)
  // convertibles register here; the window re-exports above stay for the
  // cross-boundary consumers. tests/smoke/dashboard.test.js pins both sides.
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, {
    _mJdSwitchTab: _mJdSwitchTab,
    _mJdShare: _mJdShare,
    _mCreate: _mCreate,
  });
})();

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

// ══════════════════════════════════════════════
// CUSTOMER-PAGE HANDOFF + CARD-DETAIL ACTIONS
// ══════════════════════════════════════════════
// Wave 11 (2026-05-05): hand off the in-memory lead to customer.html
// via sessionStorage so the customer page can render instantly from the
// already-loaded data instead of doing a cold Firestore round-trip.
// This eliminates the "data doesn't load even when leads loaded in
// kanban" failure mode on iOS Safari, where the second page load's
// Firestore connection sometimes hangs.
// ── Globals Tranche 2c-4e (2026-07-07): the customer-page handoff cluster is
// wrapped in this IIFE. The 4 openers register in __NBD_CALL_REGISTRY;
// _stashLeadForCustomerPage keeps its window export (7 typeof-guarded widget
// callers: activity-feed, almost-there, global-search, hot-leads,
// smart-followup-briefing, stale-shares, dashboard-bootstrap.module).
// editCardDetails' bare editLead/closeCardDetailModal resolve up-scope via the
// global object. See docs/dev/dashboard-actions-globals-audit.md.
(function () {
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

function openDocsForLead() {
  if (!window._cardDetailLeadId) return;
  _stashLeadForCustomerPage(window._cardDetailLeadId);
  window.location.href = `/pro/customer.html?id=${window._cardDetailLeadId}#documents`;
}

function openFullCustomerDetails() {
  if (!window._cardDetailLeadId) return;
  _stashLeadForCustomerPage(window._cardDetailLeadId);
  window.location.href = `/pro/customer.html?id=${window._cardDetailLeadId}`;
}

function editCardDetails() {
  if (!window._cardDetailLeadId) return;
  closeCardDetailModal();
  editLead(window._cardDetailLeadId);
}

  // _stashLeadForCustomerPage keeps its window export above (7 widget callers).
  // The 4 openers are markup-only → registry, off window.
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, {
    openPhotosForLead: openPhotosForLead,
    openDocsForLead: openDocsForLead,
    openFullCustomerDetails: openFullCustomerDetails,
    editCardDetails: editCardDetails,
  });
})();


(function(){if(_NBD_DA_DELEGATE)return;_NBD_DA_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-da-action]');if(!t)return;if(t.dataset.daAction==='reload')window.location.reload();});})();

// ══════════════════════════════════════════════
// CARD-DETAIL ACTION CLUSTER — Globals Tranche 2c-4a (2026-07-07)
// ══════════════════════════════════════════════
// The 18 card-detail action wrappers + chip pickers + the mobile photo-picker,
// consolidated OFF `window` into this IIFE and registered in
// window.__NBD_CALL_REGISTRY — which the dashboard-ui.js `call` delegate
// resolves FIRST (registration is the security opt-in that the
// _NBD_CALL_ALLOWLIST entry used to be; these names are removed from that
// allowlist in dashboard-state.js). Each wraps window._cardDetailLeadId and
// delegates to another module (NBDReports, PhotoEngine, InvoicePipeline,
// InspectionReportEngine, KanbanContextMenu, NBDVoiceMemo, NBDVoicemail) or a
// window-scoped helper — no shared top-level lexical state, so consolidating
// the scattered defs here is safe. Cross-slice calls to _mJdAct /
// openMobileInspection go through `window.*` so they survive when the mobile
// cluster (Tranche 2c-4b) goes module-local. See
// docs/dev/dashboard-actions-globals-audit.md.
(function () {
  function cdaReport() {
    if (window.NBDReports && typeof window.NBDReports.openGenerator === 'function') {
      window.NBDReports.openGenerator(window._cardDetailLeadId);
    } else if (typeof showToast === 'function') {
      showToast('Report module loading...', 'error');
    }
  }
  function cdaEnrich() {
    if (window.NBDReports && typeof window.NBDReports.enrichData === 'function') {
      window.NBDReports.enrichData(window._cardDetailLeadId);
    } else if (typeof showToast === 'function') {
      showToast('Report module loading...', 'error');
    }
  }
  function cdaPhotos() {
    if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
      if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
      window.PhotoEngine.openCamera(window._cardDetailLeadId);
    } else if (typeof showToast === 'function') {
      showToast('Photo engine loading...', 'error');
    }
  }
  function cdaInvoice() {
    if (window.InvoicePipeline && typeof window.InvoicePipeline.createInvoiceUI === 'function') {
      if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
      window.InvoicePipeline.createInvoiceUI(window._cardDetailLeadId);
    } else if (typeof showToast === 'function') {
      showToast('Invoice pipeline loading...', 'error');
    }
  }
  function cdaInspection() {
    if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
      // openBuilder(containerId, leadId) — the containerId MUST be first. The
      // original inline onclick passed 'inspectionBuilderContainer'; the CSP
      // extraction dropped it, so the builder never rendered (leadId was read as
      // the container id → getElementById miss → silent return).
      window.InspectionReportEngine.openBuilder('inspectionBuilderContainer', window._cardDetailLeadId);
    } else if (typeof showToast === 'function') {
      showToast('Inspection engine loading...', 'error');
    }
  }
  // Wave 28: card-detail chip pickers. Clicking either chip in the card-
  // detail modal opens the same floating menu the kanban right-click flow
  // uses — no full edit form needed to move a card or relabel its track.
  // Anchors below the chip so the menu drops down into view. The picker
  // implementation lives in kanban-context-menu.js (window.KanbanContextMenu).
  function cdPickStage(el) {
    const id = window._cardDetailLeadId;
    if (!id || !window.KanbanContextMenu) return;
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const anchor = r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 };
    window.KanbanContextMenu.openStagePicker(id, anchor);
  }
  function cdPickType(el) {
    const id = window._cardDetailLeadId;
    if (!id || !window.KanbanContextMenu) return;
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const anchor = r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 };
    window.KanbanContextMenu.openTypePicker(id, anchor);
  }
  function cdaInspectionDeep() {
    // The original onclick was: close the card-detail modal, then after 200ms
    // show the inspectionBuilderOverlay and call openBuilder. The setTimeout
    // gives the modal-close animation time to finish.
    if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
      const lid = window._cardDetailLeadId;
      if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
      setTimeout(function(){
        const overlay = document.getElementById('inspectionBuilderOverlay');
        if (overlay) overlay.style.display = 'block';
        // openBuilder(containerId, leadId) — container first. The CSP extraction of
        // the original inline onclick dropped 'inspectionBuilderContainer', so the
        // card-detail "Report" button silently never opened the builder.
        window.InspectionReportEngine.openBuilder('inspectionBuilderContainer', lid);
      }, 200);
    } else if (typeof showToast === 'function') {
      showToast('Inspection engine loading...', 'error');
    }
  }
  // card-detail-lead-id guarded wrappers. cdaMjdAct / cdaOpenMobileInspection
  // call the mobile cluster (Tranche 2c-4b) via `window.*` so they keep
  // resolving once those callees go module-local.
  function cdaMjdAct(actionType) {
    if (!window._cardDetailLeadId || typeof window._mJdAct !== 'function') return;
    window._mJdAct(actionType, window._cardDetailLeadId);
  }
  function cdaEditLead() {
    if (window._cardDetailLeadId && typeof window.editLead === 'function') {
      const id = window._cardDetailLeadId;
      // Close the mobile job-detail overlay first. It sits at z-index 2100,
      // above the lead-edit modal's .modal-bg (z-index 2000), so without this
      // the edit modal opens *behind* the still-visible panel and the Edit
      // button appears to do nothing on mobile. (Matches cdaInspectionDeep,
      // which also closes the detail surface before opening its sub-flow.)
      if (typeof window.closeMobileJobDetail === 'function') window.closeMobileJobDetail();
      window.editLead(id);
    }
  }
  function cdaOpenMobileInspection() {
    if (window._cardDetailLeadId && typeof window.openMobileInspection === 'function') {
      window.openMobileInspection(window._cardDetailLeadId);
    }
  }
  function cdaVoiceMemo() {
    if (window._cardDetailLeadId &&
        window.NBDVoiceMemo &&
        typeof window.NBDVoiceMemo.recordForLead === 'function') {
      window.NBDVoiceMemo.recordForLead(window._cardDetailLeadId);
    }
  }
  // step-4: opens the voicemail-pipeline modal for the current card-detail lead.
  function cdaOpenVoicemail() {
    if (window._cardDetailLeadId &&
        window.NBDVoicemail &&
        typeof window.NBDVoicemail.openForLead === 'function') {
      window.NBDVoicemail.openForLead(window._cardDetailLeadId);
    }
  }
  function cdaSharePortalLink() {
    if (window._cardDetailLeadId && typeof window._sharePortalLink === 'function') {
      window._sharePortalLink(window._cardDetailLeadId);
    }
  }
  function cdaRevokePortalLink() {
    if (window._cardDetailLeadId && typeof window._revokePortalLink === 'function') {
      window._revokePortalLink(window._cardDetailLeadId);
    }
  }
  function cdaConfirmPromote() {
    if (window._cardDetailLeadId && typeof window.confirmPromoteProspect === 'function') {
      window.confirmPromoteProspect(window._cardDetailLeadId);
    }
  }
  function cdaOpenTaskModal() {
    if (window._cardDetailLeadId && typeof openTaskModal === 'function') {
      openTaskModal(window._cardDetailLeadId, null);
    }
  }
  // Photo capture handler — shared by the mobile "+" create popover and the
  // view-photos shutter FAB's no-lead fallback. Both fire BEFORE any lead
  // exists, but a photo can only be stored against a lead
  // (PhotoEngine.uploadFromFile requires a leadId) and there is no
  // standalone-upload path. So route the rep to create/open a lead and add
  // photos from its gallery. (Previously called window.PhotoEngine.uploadOne —
  // not a real method — or pushed to window._pendingPhotoUploads, which
  // nothing consumed, silently dropping the photo behind a false success toast.)
  function _mCreatePhotoPicked(event) {
    try {
      const file = event && event.target && event.target.files && event.target.files[0];
      if (!file) return;
      if (typeof openLeadModal === 'function') openLeadModal();
      if (typeof showToast === 'function') showToast('Create or open a lead, then add photos from its gallery', 'info');
    } catch (e) {
      console.warn('mobile photo create reroute failed:', e && e.message);
    } finally {
      // Reset input so the same file can be re-picked next time.
      if (event && event.target) event.target.value = '';
    }
  }

  // Registration IS the security opt-in (the role the _NBD_CALL_ALLOWLIST
  // entry used to play). tests/smoke/dashboard.test.js pins registration +
  // off-window status for every name below.
  window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
  Object.assign(window.__NBD_CALL_REGISTRY, {
    cdaReport: cdaReport,
    cdaEnrich: cdaEnrich,
    cdaPhotos: cdaPhotos,
    cdaInvoice: cdaInvoice,
    cdaInspection: cdaInspection,
    cdPickStage: cdPickStage,
    cdPickType: cdPickType,
    cdaInspectionDeep: cdaInspectionDeep,
    cdaMjdAct: cdaMjdAct,
    cdaEditLead: cdaEditLead,
    cdaOpenMobileInspection: cdaOpenMobileInspection,
    cdaVoiceMemo: cdaVoiceMemo,
    cdaOpenVoicemail: cdaOpenVoicemail,
    cdaSharePortalLink: cdaSharePortalLink,
    cdaRevokePortalLink: cdaRevokePortalLink,
    cdaConfirmPromote: cdaConfirmPromote,
    cdaOpenTaskModal: cdaOpenTaskModal,
    _mCreatePhotoPicked: _mCreatePhotoPicked,
  });
})();
