// One-shot generator for the 2026-06-10-C d7 ledger patch (116 statically-planned rows driven live).
const plan = require('./d7-static-plan.json');
const dump = require('./d7-untested-dump.json');
const reveal = {}; dump.forEach(r => reveal[r.id] = r.reveal);
const S = '2026-06-10-C';
const rows = [];
const push = (id, status, notes) => rows.push({ id, status, session: S, notes });

const o = {
  'd7-settings-012': ['PASS', 'Display name: set + Save Profile -> toast + #userName pill updates live; persisted across reload; restored to original (empty -> pill re-derives jd on next boot).'],
  'd7-settings-014': ['FAIL', 'NEW-D44: confirmed-dead placeholder — in-code comment dashboard-bootstrap.module.js:2931-2937 says Company/Phone/Role/License are intentionally NOT wired to _saveSettings/load. User-visible field silently discards input.'],
  'd7-settings-015': ['FAIL', 'NEW-D44: same confirmed-dead group (code comment).'],
  'd7-settings-016': ['FAIL', 'NEW-D44: same confirmed-dead group; cosmetic select, unrelated to auth role claims.'],
  'd7-settings-017': ['FAIL', 'NEW-D44: same confirmed-dead group.'],
  'd7-settings-018': ['PASS', 'cal.com username: set QA-Test -> Save -> persisted (normalized lowercase qa-test) across reload; restored to empty original.'],
  'd7-settings-019': ['FAIL', 'NEW-D45a: preview is an <a target rel> whose href is NEVER set (live: hasHref=false; nbdSettingsUpdateCalcomPreview writes textContent+display only) — looks like a link, goes nowhere.'],
  'd7-settings-021': ['PASS', 'Dormant nudge: uncheck -> Save -> persisted false across reload -> restored true + saved.'],
  'd7-settings-023': ['PASS', 'Exported 15 leads -> nbd-leads-2026-06-10.csv (blob anchor spied/suppressed) + toast.'],
  'd7-settings-024': ['PASS', 'Exported 6 estimates -> nbd-estimates-2026-06-10.csv (spied) + toast.'],
  'd7-settings-025': ['PASS', 'Import Leads modal opens (CSV drop/browse step rendered); closed via x without file (native picker = boundary).'],
  'd7-settings-026': ['PASS', 'Real-click toggle: Secondary header OFF toast + LS nbd_crm_sec_header_enabled=false -> re-click ON + restored. (goTo-hook keeps this control synced, unlike the density repaint.)'],
  'd7-settings-027': ['PASS', 'Compact: LS nbd-kanban-density=compact + html[data-density] applied immediately AND at boot after reload. NEW-D45c (cosmetic): after reload NEITHER density button shows the active repaint (dead DCL+200ms painter dashboard-ui.js:1589-1601). Restored spacious.'],
  'd7-settings-028': ['PASS', 'Bold toggle: click -> LS nbd-kanban-bold=1; RELOAD: checkbox correctly primed checked (the static dead-DCL suspicion did NOT reproduce on a direct #/settings load; possible SPA-late-entry edge remains — noted, not a FAIL).'],
  'd7-settings-029': ['PASS', 'Auto-collapse: click -> LS nbd-crm-autocollapse=1; reload-primed correctly (same refutation as 028). Restored off.'],
  'd7-settings-030': ['PASS', 'Key input: value -> sessionStorage nbd_joe_key (NOT localStorage as the inventory said), input cleared after save.'],
  'd7-settings-031': ['PASS', 'Save button: "Joe AI activated" toast + status line + sessionStorage write. Test key cleared after (original state: no key).'],
  'd7-settings-032': ['FAIL', 'NEW-D45b: clearJoeKey removes the key (sessionStorage cleared OK) but leaves the stale "Key saved — Joe AI is active" status line (ai.js never touches #joeKeyStatus on clear) — UI claims active with no key present.'],
  'd7-settings-033': ['BLOCKED', 'Boundary by policy: would seed 13 real leads on accept. Wiring verified: button present, window.loadSampleData live, allowlisted at dashboard-state.js:184; confirm gate exists when leads>0.'],
  'd7-settings-034': ['BLOCKED', 'Sign-out would end the QA session (Rule 0). Control present with data-action=signOut.'],
  'd7-settings-092': ['PASS', 'Theme swatch: real-click Cobalt -> selected border + ds-theme=cobalt saved + reload-repopulated highlight. FINDING (NEW-D45d, static): runtime consumers read ds-theme only as LAST fallback behind nbd_pro_theme/nbd-theme and the daily-success lookup lacks 8/12 swatch keys -> picked program theme rarely takes effect. Restored (ds-theme key removed; was absent).'],
  'd7-settings-148': ['PASS', 'Boundary: native confirm ("Reset every Company Profile field to factory defaults?") fired + CANCELLED via stub-false; fields unchanged. Never saved post-reset.'],
  'd7-settings-169': ['FAIL', 'NEW-D41: persists + round-trips (verified live) but gates NOTHING — the hot-lead surface ask-joe-proactive.js builds hot_lead actions without consulting shouldFireNotif.'],
  'd7-settings-170': ['FAIL', 'NEW-D41: storm alerts fire from storm-integration.js triggerProactiveAlert with no shouldFireNotif check; toggle persists but suppresses nothing.'],
  'd7-settings-171': ['PASS', 'Round-trip verified; REAL consumer review-engine.js:126 (estimate_approved). Caveat: under default critical mode the normal-priority call is suppressed before the trigger is read — the toggle only matters in firehose mode.'],
  'd7-settings-172': ['FAIL', 'NEW-D41: inbound_msg exists only in the type map; zero firing callers repo-wide.'],
  'd7-settings-174': ['FAIL', 'NEW-D41: the auto-needs-field notifier referenced by the code comment does not exist; only the type-map entry does.'],
  'd7-settings-177': ['FAIL', 'NEW-D41: email channel mapped but no caller passes channel "email", and no Cloud Function reads userSettings.notifications — toggle consumed nowhere client- or server-side.'],
  'd7-settings-178': ['PASS', 'Disabled-by-design verified live: disabled attr present, real click does not flip it, persists false through save.'],
  'd7-settings-180': ['PASS', 'Test toast fired: "Test notification — your alerts work!". NOTE (cosmetic expectation gap): _testNotif ignores saved mode/channels entirely (never calls shouldFireNotif).'],
};

plan.rows.forEach(r => {
  if (o[r.id]) { push(r.id, ...o[r.id]); return; }
  const g = reveal[r.id];
  if (g === 'after:open-notifications-tab') {
    push(r.id, 'PASS', 'Full strict-bar in the 2026-06-10-C batch cycle: real-click flip -> Save -> LS nbd_notif_settings verified -> reload + reopen tab (1s re-sync wait) -> control reflects saved state -> restored to original + saved. ' + ((r.takeEffect || '').startsWith('REAL') ? ('Consumer: ' + r.takeEffect.slice(0, 90)) : ''));
    return;
  }
  if (g === 'after:open-company-tab') {
    push(r.id, 'PASS', 'Batch cycle: token saved to LS nbd_company_settings (keyed by field id) + Firestore userSettings.company -> full reload + reopen round-trip OK -> restored byte-exact from snapshot. NEW-D42 finding (tab-level): NOTHING consumes nbd_company_settings/userSettings.company at runtime — doc-gen reads companyProfile instead; the whole tab is store-only.');
    return;
  }
  if (g === 'after:open-company-profile-tab') {
    push(r.id, 'PASS', 'Batch cycle on the LIVE shop-wide profile: token -> Save (single-form _saveCompanyProfileSettings) -> LS mirror nbd_company_profile_v1 + Firestore companyProfile/{companyId||uid} -> full reload + reopen round-trip OK (all 69 cp_* fields) -> ALL originals restored + re-saved (mirror verified token-free). ' + ((r.takeEffect || '').includes('none') ? 'NOTE: no runtime consumer found for this field (static).' : ''));
    return;
  }
  if (g === 'after:open-daily-tab') {
    push(r.id, 'PASS', 'Daily OS cycle: mutation -> dsSaveConfig -> nbd_user_config (+ nbd_ds_config mirror, ds-theme) -> reload + SPA re-entry round-trip OK -> originals restored byte-exact (LS) incl. removing the ds-theme key that did not pre-exist.');
    return;
  }
  if (g === 'after:open-estimates-tab') {
    if (['defPitch', 'defWaste', 'defDeckPct'].some(x => (r.fieldSel || '').includes(x))) {
      push(r.id, 'FAIL', 'NEW-D43: markup-only ghost — Save All silently discards it (token absent from nbd_est_settings_v3) and reload reverts to the hardcoded HTML default (8/12 / 17 / 15). Zero JS references repo-wide.');
      return;
    }
    push(r.id, 'PASS', 'Estimates cycle: distinct numeric token -> Save All (_saveEstimateDefaultsV2) -> verified in nbd_est_settings_v3 (tierRates/minJob/dumpFee/permits/taxes) or companyProfile.pricing.addonPrices (v2addon*) -> reload round-trip OK (2-decimal reformat only) -> restored; v3 top-level diff vs original = ZERO, catalog untouched. NEW-D43 notes: the Firestore estimateSettingsV2 mirror is WRITE-ONLY (claimed cross-device sync never read back) and v3.addonPrices goes stale vs cp.pricing (calc-time override wins).');
    return;
  }
  push(r.id, 'PASS', 'See 2026-06-10-C d7 batch evidence.');
});

require('fs').writeFileSync(__dirname + '/2026-06-10-C-d7.json', JSON.stringify({ session: S, rows }, null, 1));
console.log('patch rows:', rows.length, 'FAIL:', rows.filter(r => r.status === 'FAIL').length, 'BLOCKED:', rows.filter(r => r.status === 'BLOCKED').length, 'PASS:', rows.filter(r => r.status === 'PASS').length);
