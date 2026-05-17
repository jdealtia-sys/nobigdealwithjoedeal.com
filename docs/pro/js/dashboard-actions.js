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
window.cdaReport = function cdaReport() {
  if (window.NBDReports && typeof window.NBDReports.openGenerator === 'function') {
    window.NBDReports.openGenerator(window._cardDetailLeadId);
  } else if (typeof showToast === 'function') {
    showToast('Report module loading...', 'error');
  }
};
window.cdaEnrich = function cdaEnrich() {
  if (window.NBDReports && typeof window.NBDReports.enrichData === 'function') {
    window.NBDReports.enrichData(window._cardDetailLeadId);
  } else if (typeof showToast === 'function') {
    showToast('Report module loading...', 'error');
  }
};
window.cdaPhotos = function cdaPhotos() {
  if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
    if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
    window.PhotoEngine.openCamera(window._cardDetailLeadId);
  } else if (typeof showToast === 'function') {
    showToast('Photo engine loading...', 'error');
  }
};
window.cdaInvoice = function cdaInvoice() {
  if (window.InvoicePipeline && typeof window.InvoicePipeline.createInvoiceUI === 'function') {
    if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
    window.InvoicePipeline.createInvoiceUI(window._cardDetailLeadId);
  } else if (typeof showToast === 'function') {
    showToast('Invoice pipeline loading...', 'error');
  }
};
window.cdaInspection = function cdaInspection() {
  if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
    window.InspectionReportEngine.openBuilder(window._cardDetailLeadId);
  } else if (typeof showToast === 'function') {
    showToast('Inspection engine loading...', 'error');
  }
};
window.cdaInspectionDeep = function cdaInspectionDeep() {
  // The original onclick was: close the card-detail modal, then after 200ms
  // show the inspectionBuilderOverlay and call openBuilder. The setTimeout
  // gives the modal-close animation time to finish.
  if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
    const lid = window._cardDetailLeadId;
    if (typeof closeCardDetailModal === 'function') closeCardDetailModal();
    setTimeout(function(){
      const overlay = document.getElementById('inspectionBuilderOverlay');
      if (overlay) overlay.style.display = 'block';
      window.InspectionReportEngine.openBuilder(lid);
    }, 200);
  } else if (typeof showToast === 'function') {
    showToast('Inspection engine loading...', 'error');
  }
};

// C.4 finale — More-drawer compound rewrites. The original onclicks
// were `mobileNav('home');closeMobileMore()` style chains; we
// consolidate the side-effects here so the markup uses data-action="call".
window.openDailyProgramFromMore = function openDailyProgramFromMore() {
  if (typeof closeMobileMore === 'function') closeMobileMore();
  window.location.href = '/pro/daily-success';
};
window.openCrewCalendarFromMore = function openCrewCalendarFromMore() {
  if (typeof toggleCrewCalendar === 'function') {
    toggleCrewCalendar();
    if (typeof mobileNav === 'function') mobileNav('home');
  }
  if (typeof closeMobileMore === 'function') closeMobileMore();
};

// C.4 finale — mobile FAB create routing. Replaces the ternary
// `window.toggleMobileCreatePopover ? toggleMobileCreatePopover() : openLeadModal()`.
window.mCreateFabRoute = function mCreateFabRoute() {
  if (typeof window.toggleMobileCreatePopover === 'function') {
    window.toggleMobileCreatePopover();
  } else if (typeof openLeadModal === 'function') {
    openLeadModal();
  }
};

// C.4 finale — card-detail-lead-id guarded wrappers. Each replaces
// an inline `window._cardDetailLeadId && fn(window._cardDetailLeadId)`
// short-circuit so the markup only carries data-action="call".
window.cdaMjdAct = function cdaMjdAct(actionType) {
  if (!window._cardDetailLeadId || typeof _mJdAct !== 'function') return;
  _mJdAct(actionType, window._cardDetailLeadId);
};
window.cdaEditLead = function cdaEditLead() {
  if (window._cardDetailLeadId && typeof window.editLead === 'function') {
    window.editLead(window._cardDetailLeadId);
  }
};
window.cdaOpenMobileInspection = function cdaOpenMobileInspection() {
  if (window._cardDetailLeadId && typeof openMobileInspection === 'function') {
    openMobileInspection(window._cardDetailLeadId);
  }
};
window.cdaVoiceMemo = function cdaVoiceMemo() {
  if (window._cardDetailLeadId &&
      window.NBDVoiceMemo &&
      typeof window.NBDVoiceMemo.recordForLead === 'function') {
    window.NBDVoiceMemo.recordForLead(window._cardDetailLeadId);
  }
};
// step-4: opens the voicemail-pipeline modal for the current card-detail lead.
window.cdaOpenVoicemail = function cdaOpenVoicemail() {
  if (window._cardDetailLeadId &&
      window.NBDVoicemail &&
      typeof window.NBDVoicemail.openForLead === 'function') {
    window.NBDVoicemail.openForLead(window._cardDetailLeadId);
  }
};

// C.4 finale — ternary / compound rewrites for the few one-off handlers
// that don't fit the generic call / module shapes.
window.mQuickAddRoute = function mQuickAddRoute() {
  if (typeof closeQuickAddLead === 'function') closeQuickAddLead();
  if (typeof openLeadModal === 'function') openLeadModal();
};
window.restartOnboardingTour = function restartOnboardingTour() {
  if (window.OnboardingTour && typeof window.OnboardingTour.forceRestart === 'function') {
    window.OnboardingTour.forceRestart();
  } else if (typeof showToast === 'function') {
    showToast('Tour module loading...', 'error');
  }
};
window.openDecisionPicker = function openDecisionPicker() {
  if (window.DecisionEngine && typeof window.DecisionEngine.openPicker === 'function') {
    window.DecisionEngine.openPicker();
  } else if (typeof showToast === 'function') {
    showToast('Decision engine loading...', 'error');
  }
};
window.openD2DOrGo = function openD2DOrGo() {
  if (window.D2D && typeof window.D2D.openQuickKnock === 'function') {
    window.D2D.openQuickKnock();
  } else if (typeof goTo === 'function') {
    goTo('d2d');
  }
};
window.clearAccentTheme = function clearAccentTheme() {
  if (window.ThemeGX && typeof window.ThemeGX.clearAccentOverride === 'function') {
    window.ThemeGX.clearAccentOverride();
  }
  const picker = document.getElementById('customAccentColorPicker');
  if (picker) picker.value = '#e8720c';
};
window.openSettingsTab = function openSettingsTab(tabKey) {
  if (typeof nbdPickerOpen === 'function') {
    nbdPickerOpen();
  } else {
    if (typeof goTo === 'function') goTo('settings');
    setTimeout(function(){
      if (typeof switchSettingsTab === 'function') switchSettingsTab(tabKey);
    }, 200);
  }
};
window.openPhotoEngineOrClickProxy = function openPhotoEngineOrClickProxy(fallbackInputId) {
  if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
    window.PhotoEngine.openCamera();
  } else if (fallbackInputId) {
    document.getElementById(fallbackInputId)?.click();
  }
};
window.cdaSharePortalLink = function cdaSharePortalLink() {
  if (window._cardDetailLeadId && typeof window._sharePortalLink === 'function') {
    window._sharePortalLink(window._cardDetailLeadId);
  }
};
window.cdaRevokePortalLink = function cdaRevokePortalLink() {
  if (window._cardDetailLeadId && typeof window._revokePortalLink === 'function') {
    window._revokePortalLink(window._cardDetailLeadId);
  }
};
window.cdaConfirmPromote = function cdaConfirmPromote() {
  if (window._cardDetailLeadId && typeof window.confirmPromoteProspect === 'function') {
    window.confirmPromoteProspect(window._cardDetailLeadId);
  }
};
window.cdaOpenTaskModal = function cdaOpenTaskModal() {
  if (window._cardDetailLeadId && typeof openTaskModal === 'function') {
    openTaskModal(window._cardDetailLeadId, null);
  }
};
window.openReportGenerator = function openReportGenerator() {
  if (window.NBDReports && typeof window.NBDReports.openGenerator === 'function') {
    window.NBDReports.openGenerator();
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
window.enrichReportData = function enrichReportData() {
  if (window.NBDReports && typeof window.NBDReports.enrichData === 'function') {
    window.NBDReports.enrichData();
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
window.openPhotoEngineCurrentLead = function openPhotoEngineCurrentLead() {
  if (window.PhotoEngine && typeof window.PhotoEngine.openCamera === 'function') {
    window.PhotoEngine.openCamera(window._currentPhotoLeadId || '');
  } else if (typeof showToast === 'function') {
    showToast('Photo engine loading…', 'error');
  }
};
window.openInspectionBuilderCurrentLead = function openInspectionBuilderCurrentLead() {
  if (window.InspectionReportEngine && typeof window.InspectionReportEngine.openBuilder === 'function') {
    window.InspectionReportEngine.openBuilder('inspectionBuilderContainer', window._currentPhotoLeadId || '');
  } else if (typeof showToast === 'function') {
    showToast('Report engine loading…', 'error');
  }
};
window.closeInspectionBuilder = function closeInspectionBuilder() {
  const overlay = document.getElementById('inspectionBuilderOverlay');
  const container = document.getElementById('inspectionBuilderContainer');
  if (overlay) overlay.style.display = 'none';
  if (container) container.innerHTML = '';
};
window.hideFollowUpAlerts = function hideFollowUpAlerts() {
  const wrap = document.getElementById('followUpAlertsWrap');
  if (wrap) wrap.style.display = 'none';
  try { localStorage.setItem('nbd_crm_followup_hidden', '1'); } catch (e) {}
};
window.goToD2DFromMaps = function goToD2DFromMaps() {
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
window.openCalBookingUrl = function openCalBookingUrl() {
  const input = document.getElementById('calBookingUrl');
  if (input && input.value) window.open(input.value, '_blank', 'noopener');
};
window.hardResetTest = function hardResetTest() {
  if (typeof window.__nbdHardReset === 'function') window.__nbdHardReset();
};
window.gstaticTest = function gstaticTest() {
  if (typeof window.__nbdGstaticTest === 'function') window.__nbdGstaticTest();
};
window.modeLineDraw = function modeLineDraw() {
  // The original onclick was setDrawMode('line', document.getElementById('modeLineBtn'))
  // — explicit element ref because the user might activate via keyboard shortcut
  // and we still want the active-state ring on the line button.
  if (typeof setDrawMode === 'function') {
    setDrawMode('line', document.getElementById('modeLineBtn'));
  }
};

// ══════════════════════════════════════════════
// NAVIGATION ROUTER — goTo()
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
// TERRITORY ZONES — draw / save / delete
// ══════════════════════════════════════════════
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
  // zonePanel lives inside tpl-view-map (lazy-hydrated). Use optional
  // chaining so a stray invocation outside #/map doesn't null-deref.
  document.getElementById('zonePanel')?.classList.add('visible');
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
  document.getElementById('zonePanel')?.classList.remove('visible');
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
  document.getElementById('zonePanel')?.classList.remove('visible');
  const _zni = document.getElementById('zoneNameInput');
  if (_zni) _zni.value = '';
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

// ══════════════════════════════════════════════
// DAILY PROGRAM — config logic (load/save/reset/floors)
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
// MOBILE JOB-DETAIL ACTIONS
// ══════════════════════════════════════════════
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
        ? location.origin + '/pro/customer.html?lead=' + encodeURIComponent(id)
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
window._mJdShare = _mJdShare;

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
window.openMobileCreatePopover  = openMobileCreatePopover;
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
window._mCreate = _mCreate;

// Photo create handler — uploads the captured file via the existing
// PhotoEngine if available, otherwise stages it for the next lead
// modal save. Best-effort: we don't want the popover entry point to
// fail loudly if PhotoEngine isn't loaded on this surface.
window._mCreatePhotoPicked = function (event) {
  try {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    if (window.PhotoEngine && typeof window.PhotoEngine.uploadOne === 'function') {
      window.PhotoEngine.uploadOne(file, {
        source: 'mobile-create-popover'
      });
      if (typeof showToast === 'function') showToast('Photo uploaded', 'success');
    } else {
      // Stash on window so the next lead-modal save can attach it.
      window._pendingPhotoUploads = window._pendingPhotoUploads || [];
      window._pendingPhotoUploads.push(file);
      if (typeof showToast === 'function') showToast('Photo queued — attach to a lead to save', 'info');
    }
  } catch (e) {
    console.warn('mobile photo create failed:', e && e.message);
  } finally {
    // Reset input so the same file can be re-picked.
    if (event && event.target) event.target.value = '';
  }
};

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
