/**
 * dashboard-state.js — module state, constants, and boot-time
 * persistence/hydration for the dashboard surface.
 *
 * Extracted from dashboard-main.js (Step 4a — 2026-05-16) as one
 * of five sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   state → api → widgets → ui → actions → main (shim)
 *
 * This file is loaded FIRST so every later script can rely on
 * - the action delegate allowlists (_NBD_TOGGLE_FNS,
 *   _NBD_MODAL_CLOSE_FNS, _NBD_CALL_ALLOWLIST)
 * - the route config (routeConfig, PRO_ONLY_VIEWS, MOBILE_NAV_TABS)
 * - rates/theme/comfort/density constants
 * - module-state vars (currentPhotoLeadId, _docFile, _piCache,
 *   estimate state, zone state, etc.)
 *
 * Boot IIFEs at the bottom apply persisted prefs to <html>/<body>
 * BEFORE the UI script wires up listeners — that way the first
 * paint already shows the user's preferred theme + density.
 */

// ══════════════════════════════════════════════
// NAVIGATION & URL ROUTING — config and state
// ══════════════════════════════════════════════
const mapInited = {};

// Route configuration: maps view names to display labels and parent routes.
//
// Every `<div id="view-X">` in dashboard.html MUST have a matching entry
// here, otherwise the hashchange handler in dashboard-main.js silently
// ignores `#/X` URLs (it gates on `routeConfig[name]`), leaving the
// previous view active. The 8 entries below "// W160" were missing for
// months — clicking the sidebar item worked (calls goTo directly) but
// hard-refresh / direct URL / browser-back navigation didn't.
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
  'settings': { label: 'Settings', parent: null },
  // W160: missing routes that left direct URLs / hard-refresh broken.
  'reports':      { label: 'Reports',           parent: null },
  'prospects':    { label: 'Prospects',         parent: null },
  'admin':        { label: 'Team Manager',      parent: null },
  'academy':      { label: 'Real Deal Academy', parent: null },
  'aitree':       { label: 'Decision Engine',   parent: null },
  'understand':   { label: 'Deep Dive',         parent: null },
  'projectcodex': { label: 'Project Intel',     parent: null },
  'aiusage':      { label: 'AI Usage',          parent: null },
  // Talk Tank — unified voice-capture inbox (#/talk-tank)
  'talk-tank':    { label: 'Talk Tank',         parent: null }
};

// Pro-only views — Lite users see upgrade prompt instead
const PRO_ONLY_VIEWS = ['photos','docs','map','draw','storm','joe','schedule','board','closeboard','repos','training','academy','talk-tank'];

// ══════════════════════════════════════════════
// data-action DELEGATE ALLOWLISTS
// ══════════════════════════════════════════════
// Explicit registry of which modal IDs can be closed by the
// data-action="closeModal" delegate, and which function to dispatch.
// Adding a new modal? Register it here + use closeModal in markup.
// C.4 cluster 4 — no-arg toggle allowlist. data-target → window.<fn>().
// Add a new toggle? Register here + use data-action="toggle".
const _NBD_TOGGLE_FNS = {
  bulkMode:                'toggleBulkMode',
  debugConsole:            'toggleDebugConsole',
  dismissedNotifications:  'toggleDismissedNotifications',
  drawing:                 'toggleDraw',
  hdrMobileMenu:           'toggleHdrMobileMenu',
  historicalImagery:       'toggleHistoricalImagery',
  kanbanFullscreen:        'toggleKanbanFullscreen',
  mapLayer:                'toggleMapLayer',
  mobileMore:              'toggleMobileMore',
  notifications:           'toggleNotificationDropdown',
  recentDropdown:          'toggleRecentDropdown',
  sidebarCollapse:         'toggleSidebarCollapse',
  voiceControl:            'toggleVoiceControl',
  // Defensive-existence-check toggles — the inline form was
  //   onclick="window.toggleX && window.toggleX()"
  // because these functions live in defer'd scripts that may not be
  // loaded when the user clicks. The delegate naturally handles the
  // "function not yet defined" case via typeof fn === 'function'.
  engagementSort:          'toggleEngagementSort',
  needsAttention:          'toggleNeedsAttention',
  showSnoozed:             'toggleShowSnoozed',
  staleShares:             'toggleStaleShares',
};

const _NBD_MODAL_CLOSE_FNS = {
  leadModal:                   'closeLeadModal',
  taskModal:                   'closeTaskModal',
  photoModal:                  'closePhotoModal',
  quickAddModal:               'closeQuickAddLead',
  docViewerModal:              'closeDocViewer',
  cardDetailModal:             'closeCardDetailModal',
  propertyIntelModal:          'closePropertyIntelModal',
  propertyIntelConfirmModal:   'closePropertyIntelConfirmModal',
  comparisonModal:             'closeComparisonMode',
  mobileJobDetail:             'closeMobileJobDetail',
  mobileInspection:            'closeMobileInspection',
  mobileCreatePopover:         'closeMobileCreatePopover',
  mobileMore:                  'closeMobileMore',
  shortcutsPanel:              'closeShortcutsPanel',
  tipsModal:                   'closeTips',
  cmdPalette:                  'closeCmdPalette',
  deletedDrawer:               'closeDeletedDrawer',
  historicalImagery:           'closeHistoricalImagery',
  uploadDoc:                   'closeUploadDoc',
};

// C.4 finale — allowlist of window-globals the generic `call` action
// is permitted to invoke. Anything not in this Set is silently
// ignored by the delegate. Add functions here only when their inline
// onclick is being migrated to data-action="call" data-fn="...".
const _NBD_CALL_ALLOWLIST = new Set([
  // Mobile job-detail / create-popover internals
  '_mJdSwitchTab', '_mJdAct', '_mJdShare', '_mCreate',
  // CRM kanban + filters
  'tlFilterCat', 'tlToggleCat', 'setKanbanDensity', 'cycleKanbanDensity',
  // Joe AI quick prompts + chat lifecycle
  'joeQuick', 'clearJoeChat', 'clearJoeKey',
  // Draw / zone / pin tools
  'setDrawMode', 'startZoneDraw', 'cancelZoneDraw', 'clearDraw',
  'clearAllPins', 'commitPin', 'cancelPinConfirm',
  // Estimate flow
  'estNext', 'estBack', 'saveEstimate', 'exportEstimate', 'cancelEstimate',
  'importToEstimate', 'startNewEstimate', 'startNewEstimateOriginal', 'selectTier',
  'setDepositOverride', 'toggleInternalView', 'createEstimateRevision',
  'exportXactimateESX', 'exportDrawReport',
  // Photos / damage / drawing
  'setPhotoMode', 'damagNearMe', 'damageNearMePhotos', 'acceptAutoDetect',
  'cancelAutoDetect', 'generateScopeFromDrawing', 'loadDrawingFromCustomer',
  // Customer / lead modals
  // QA 2026-06-07 (C-1 fix): saveLead was dropped from the allowlist during the
  // CSP onclick→data-action sweep, so the Add/Edit Lead modal's Save buttons
  // (data-action="call" data-fn="saveLead") silently no-op'd — no lead could be
  // created or edited via the UI. window._saveLead works directly; only the
  // delegate gate was missing this entry.
  'saveLead',
  'openLeadModal', 'openTaskModal', 'openShortcutsPanel', 'openQMImportModal',
  'openPhotosForLead', 'openFullCustomerDetails', 'openDocsForLead',
  'openDeletedDrawer', 'openComparisonMode', 'openUploadDoc', 'openEstimateV2Builder',
  'editCardDetails', 'confirmDeleteLead', 'confirmPropertyIntelPull',
  'executePullPropertyIntel', 'pullIntelForModal', 'addTask',
  // Bulk operations
  'bulkSnoozeLeads', 'bulkMoveStage', 'bulkDelete', 'bulkAssignSource',
  'bulkAssignJobType', 'bulkAssignDamage', 'bulkAssignCarrier',
  'clearBulkSelection', 'applySmartWaste',
  // Notifications
  'markAllNotificationsRead', 'clearAllNotifications',
  // Misc tools
  'zoomToFit', 'goToMyLocation', 'spyglassGoToLocation', 'dropPinByAddress',
  'quickStormCheck', 'addStructure', 'perimChooseType',
  'copyDebugInfo', 'copyCalLink', 'loadSampleData', 'inviteTeamMember',
  'exportLeadsCSV', 'generateWarrantyCertPDF', 'printDoc', 'clearCrmSearch',
  // Appearance picker
  'nbdSetSize', 'nbdPickerTab', 'nbdComfortSet', 'nbdHowtoOpen', 'nbdHowtoClose',
  'nbdSaveCustom', 'nbdRandom', 'nbdPickerClose', 'nbdNavToggle', 'nbdCopyFS',
  'nbdApplyFont', 'nbdApplyCustom', 'nbdPickerOpen',
  // Display-mode segmented toggle (Light/Dark/Auto) above the theme grid
  'nbdSetModePref',
  'resetCustomTheme', 'resetSidebarCustomizer',
  // FAB / scoreboard tabs
  'fabToggle', 'switchScTab',
  // Daily-success / floors config
  'dsSaveConfig', 'dsResetDefaults', 'dsAddFloor',
  // Misc page-level
  'cancelDeleteConfirm',
  // Settings page private setters (defensive: only fire if loaded)
  '_saveSettings', '_saveNotifSettings', '_saveEstimateDefaultsV2',
  '_saveCompanySettings', '_testNotif', '_sharePortalLink',
  '_revokePortalLink', 'exportLeadsCsv', 'exportEstimatesCsv',
  'confirmPromoteProspect', 'runLeadAction', 'openLeadImport',
  // Quick-add flow
  'closeQuickAddLead',
  // Card-detail action helpers (defined below, glue around _cardDetailLeadId)
  'cdaReport', 'cdaEnrich', 'cdaPhotos', 'cdaInvoice', 'cdaInspection',
  'cdaInspectionDeep',
  // Mobile-more compound rewrites
  'openDailyProgramFromMore', 'openCrewCalendarFromMore',
  // Mobile create-popover routing
  'mCreateFabRoute',
  // Settings page private setters (defensive — delegate's typeof
  // guard makes the && existence-check redundant)
  '_nbdDismissTrial', '_loadCompanySettings', '_resetEstimateDefaultsV2',
  '_gdprRequestErasure', '_gdprExport', '_exportPhotos', '_exportEstimates',
  '_exportAllData',
  // Company Profile tab (doc-constants editable from UI)
  '_loadCompanyProfileSettings', '_saveCompanyProfileSettings',
  '_resetCompanyProfileSettings',
  // Card-detail action wrappers (defined below)
  'cdaMjdAct', 'cdaEditLead', 'cdaOpenMobileInspection', 'cdaVoiceMemo',
  // Draw / misc
  'undoLine', 'testFirestoreRules', 'startShadowPitch', 'startPresentation',
  // Quick-add ternary rewrite
  'mQuickAddRoute',
  // OnboardingTour / DecisionEngine / D2D / ThemeGX / settings ternary rewrites
  'restartOnboardingTour', 'openDecisionPicker', 'openD2DOrGo',
  'clearAccentTheme', 'openSettingsTab', 'openPhotoEngineOrClickProxy',
  // Card-detail share/revoke/promote/task wrappers
  'cdaSharePortalLink', 'cdaRevokePortalLink', 'cdaConfirmPromote',
  'cdaOpenTaskModal',
  // Wave 28: card-detail chip pickers (stage + classification quick-change)
  'cdPickStage', 'cdPickType',
  // Compound rewrites for ~15 remaining one-off handlers
  'openReportGenerator', 'enrichReportData', 'openPhotoEngineCurrentLead',
  'openInspectionBuilderCurrentLead', 'closeInspectionBuilder',
  'hideFollowUpAlerts', 'goToD2DFromMaps', 'openCalBookingUrl',
  'hardResetTest', 'gstaticTest', 'modeLineDraw',
  // Misc directly-callable global referenced in surveyed onclicks
  'goTo',
  // step-3: smart-calendar refresh button
  'loadSmartCalendar',
  // step-4: voicemail open-for-lead wrapper
  'cdaOpenVoicemail',
  // ── CSP onchange/oninput sweep (Phase C.6) ──
  // Toggle wrappers in dashboard-ui-prefs-boot.js that replace inline
  // `onchange="if(window.X)X.f(this.checked)"` with a single function
  // call. Each shows a toast so the user sees the toggle reacting.
  'toggleProfessionalMode',
  'nbdGxSetEnabled', 'nbdGxSetGlow', 'nbdGxSetAnimatedBg', 'nbdGxSetAccent',
  'nbdGxSetIntensityFromSlider',
  'nbdOverlaysSetEnabled', 'nbdSoundsSetEnabled',
  'nbdComfortSetMotion', 'nbdComfortSetProMode', 'nbdComfortSetCbSafe',
  'nbdComfortSetAutoTheme',
  'nbdSetCrmSecHeaderEnabledT', 'nbdSetKanbanBoldHierarchyT', 'nbdSetCrmAutoCollapseT',
  'nbdSelectPhotoLead', 'nbdTogglePhotosOnly',
  'nbdSettingsUpdateCalcomPreview',
  'd2dSetDispoFilter',
  // Pre-existing globals that also fire from inline onchange/oninput
  'recalc', 'updateEstCalc', 'calcTierPrices', 'toggleInsuranceOverlay',
  'applyEstimatePreset', 'applyCustomTheme', 'kanbanFilter', 'kanbanFilterDebounced',
  'filterPhotoLeads', 'handleComparisonFile', 'handleDocUpload',
  'setHistoricalLayer', 'updateHistoryOpacity', 'updateCalEmbed',
  'updateCertPreview', 'updatePropertyIntelCost', 'uploadPhotos',
  '_mCreatePhotoPicked', 'nbdRenderThemes', 'nbdLiveCustom',
  'nbdComfortSetWhisperHotkey', 'nbdComfortSetWhisperKey',
]);

// ══════════════════════════════════════════════
// TOAST state
// ══════════════════════════════════════════════
const toastQueue = [];
let toastActive = false;

// ══════════════════════════════════════════════
// ESTIMATE BUILDER state + rates
// ══════════════════════════════════════════════
let estCurrentStep=0, selectedTier=null, estData={};

// RATES (overrideable from settings)
const R = {
  shingle:185, felt:28, tear:55, starter:1.85, iws:72, drip:2.10,
  ridge:3.20, hip:3.20, pipe:65, deck:95, gutter:8.50, deckPct:0.15
};

// ══════════════════════════════════════════════
// DAMAGE PHOTOS state
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

// Photo search — filters the photo leads list by name/address
window._photoSearchQuery = '';

// PHOTO upload limits
const PHOTO_MAX_SIZE = 15 * 1024 * 1024; // 15 MB per file
const PHOTO_MAX_BATCH = 25; // max photos per upload session (iOS 'Select All' safety cap)
const PHOTO_ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif'];

// ══════════════════════════════════════════════
// PROPERTY INTEL cache
// ══════════════════════════════════════════════
// Cache to avoid repeat lookups on same address
var _piCache = _piCache || {};

// ══════════════════════════════════════════════
// ADDRESS AUTOCOMPLETE caches + USPS data
// ══════════════════════════════════════════════
const _acTimers = {};
const _acCache  = {};

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

// ══════════════════════════════════════════════
// DOCUMENT LIBRARY state
// ══════════════════════════════════════════════
let _docFile = null;

// ══════════════════════════════════════════════
// THEME SYSTEM constants
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

// Declare that this surface (the dashboard) owns theming via the modern
// ThemeEngine. Set before maps.js executes (defer order: dashboard-state.js
// loads before maps.js) so maps.js's legacy boot defers to the engine instead
// of force-applying inline vars that fight it (audit F-1).
window.NBD_THEME_ENGINE = true;

// Boot the theme immediately on page load — before any UI render happens so the
// first paint is themed. Canonical key first (nbd_pro_theme), then the legacy
// mirror (nbd-theme), matching the <head> preboot + ThemeEngine (audit F-1/F-2).
(function() {
  try {
    const saved = localStorage.getItem('nbd_pro_theme') || localStorage.getItem('nbd-theme');
    if(saved && saved !== '') document.documentElement.setAttribute('data-theme', saved);
    else document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  }
})();

// ══════════════════════════════════════════════
// KANBAN DENSITY + HIERARCHY constants + boot
// ══════════════════════════════════════════════
// Sets data-density / data-bold attrs on <html>; CSS reacts via :root[data-density="..."]
const KANBAN_DENSITY_KEY = 'nbd-kanban-density';
const KANBAN_BOLD_KEY = 'nbd-kanban-bold';

(function bootKanbanPrefs() {
  try {
    const d = localStorage.getItem(KANBAN_DENSITY_KEY) || 'comfortable';
    if (d !== 'comfortable') document.documentElement.setAttribute('data-density', d);
    const bold = localStorage.getItem(KANBAN_BOLD_KEY) === '1';
    if (bold) document.documentElement.setAttribute('data-bold', 'true');
  } catch (e) {}
})();

// ══════════════════════════════════════════════
// AUTO-THEME state (Wave 107)
// ══════════════════════════════════════════════
let _nbdAutoThemeInterval = null;

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

// ══════════════════════════════════════════════
// SIDEBAR / FULLSCREEN / SCROLL-COLLAPSE keys
// ══════════════════════════════════════════════
const SIDEBAR_COLLAPSED_KEY = 'nbd-sidebar-collapsed';
const CRM_AUTOCOLLAPSE_KEY = 'nbd-crm-autocollapse';

// Boot: restore sidebar collapse state so first paint shows the
// rep's preferred rail width.
(function bootSidebarCollapsed() {
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') {
      document.body.classList.add('sidebar-collapsed');
      const btn = document.getElementById('sidebarToggleBtn');
      if (btn) btn.classList.add('active');
    }
  } catch (e) {}
})();

// ══════════════════════════════════════════════
// DAILY PROGRAM SETTINGS constants + state
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
// MOBILE NAVIGATION constants
// ══════════════════════════════════════════════
const MOBILE_NAV_TABS = ['dash','map','crm','est'];

// ══════════════════════════════════════════════
// TERRITORY ZONES state
// ══════════════════════════════════════════════
let zones = []; // {id, name, color, points, layer}
let zoneDrawing = false;
let zonePoints = [];
let zoneDots = [];
let zoneTempPoly = null;
let zoneColor = 'var(--blue)';
let zoneDrawLayer = null;

// ══════════════════════════════════════════════
// TASK SYSTEM state
// ══════════════════════════════════════════════
window._taskCache = {};
var _taskModalLeadId = _taskModalLeadId || null;

// ══════════════════════════════════════════════
// CRM SECONDARY HEADER setting
// ══════════════════════════════════════════════
const CRM_SEC_HEADER_SETTING = 'nbd_crm_sec_header_enabled';

// Auto-hide on scroll within kanban board — module-level scroll tracker
let _lastScrollTop = 0;

// ══════════════════════════════════════════════
// KANBAN CARD DETAIL MODAL state
// ══════════════════════════════════════════════
window._cardDetailLeadId = null;

// ══════════════════════════════════════════════
// DEMO DATA SEEDER constant
// ══════════════════════════════════════════════
const DEMO_EMAIL = 'demo@nobigdeal.pro';
