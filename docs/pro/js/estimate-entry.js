// ============================================================
// NBD Pro — estimate-entry.js
// The New-Estimate front door: startNewEstimate() + the
// template-or-blank chooser sheet.
// ============================================================
//
// Rock 2 PR 6 (2026-08-06): split out of estimates.js verbatim.
// This code is NOT part of the classic engine — it is pure V2
// routing (job-template picker or the V2 builder) and outlives the
// classic wizard. Keeping it here means the eventual deletion of
// estimates.js is a pure classic-wizard deletion with no keeper
// code tangled into it.
//
// Loads inside the lazy `estimates` ScriptLoader bundle, after
// estimates.js. The load-then-run stubs in dashboard-actions.js
// resolve window.startNewEstimate once the bundle settles, so the
// file this function lives in is not observable to callers.

function startNewEstimate(leadId) {
  // Phase 2 (RoofLink rebuild, 2026-07-27): template-FIRST front door.
  // W145 made V2 the unconditional default; this keeps everything V2
  // (Classic stays deprecated for new estimates — V2-only per Jo,
  // 2026-07-04) but leads with the fastest path: pick a job template,
  // measurements auto-fill the quantities, land in a nearly-done
  // estimate. "Start Blank" remains one tap away for oddball jobs.
  //
  // leadId is EXPLICIT here so the customer-scoped entry points (the
  // lead-edit-modal "Send Estimate" / "Send Service Quote" / "Revise
  // Estimate" chips) attach the estimate to their lead. Those chips call
  // startNewEstimate(leadId) but the chooser only ever read
  // window._cardDetailLeadId — which is null unless a card-detail modal is
  // open — so they opened a builder with no customer on it. Falling back to
  // the global keeps the card-detail + toolbar callers (which pass nothing)
  // behaving exactly as before.
  showNewEstimateChooser(leadId || window._cardDetailLeadId);
}

// Template-or-blank chooser — mobile bottom sheet (centered ≥720px),
// built via createElement (CSP-safe, no inline handlers, matches the
// assign-picker pattern in estimate-crm-ops.js).
function showNewEstimateChooser(leadId) {
  let overlay = document.getElementById('est-new-chooser');
  if (overlay) overlay.remove(); // rebuild fresh — matchMedia layout may differ

  const desktop = window.matchMedia && window.matchMedia('(min-width: 720px)').matches;
  overlay = document.createElement('div');
  overlay.id = 'est-new-chooser';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.72);'
    + 'display:flex;justify-content:center;align-items:' + (desktop ? 'center' : 'flex-end') + ';'
    + (desktop ? 'padding:24px;' : '');

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--s,#14181f);border:1px solid var(--br,#2a2d35);'
    + 'width:100%;max-width:520px;padding:20px 18px calc(18px + env(safe-area-inset-bottom, 0));'
    + (desktop ? 'border-radius:14px;' : 'border-radius:16px 16px 0 0;border-bottom:none;');

  const title = document.createElement('div');
  title.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;"
    + 'color:var(--t,#fff);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;';
  title.textContent = 'New Estimate';
  sheet.appendChild(title);

  const makeOption = (opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'display:flex;align-items:center;gap:14px;width:100%;text-align:left;'
      + 'background:var(--s2,#1b2028);border:2px solid ' + (opts.accent || 'var(--br,#2a2d35)') + ';'
      + 'border-radius:12px;padding:16px;margin-bottom:10px;cursor:pointer;font-family:inherit;'
      + 'color:var(--t,#fff);-webkit-tap-highlight-color:transparent;';
    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:26px;flex:none;';
    icon.textContent = opts.icon;
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:800;"
      + 'text-transform:uppercase;letter-spacing:.04em;';
    name.textContent = opts.name;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:var(--m,#888);line-height:1.5;margin-top:3px;';
    desc.textContent = opts.desc;
    body.appendChild(name);
    body.appendChild(desc);
    b.appendChild(icon);
    b.appendChild(body);
    b.addEventListener('click', () => { overlay.remove(); opts.onClick(); });
    return b;
  };

  sheet.appendChild(makeOption({
    icon: '🧰',
    name: 'From Template — Fastest',
    accent: 'var(--green, #2ecc8a)',
    desc: 'Pick a job package. Measurements auto-fill the quantities and you land in a nearly-done estimate.',
    onClick: () => {
      // Job Templates ride the estimates ScriptLoader bundle — normally
      // already loaded by the time this chooser is reachable, but a
      // direct dashboard-tile tap can race the bundle, so load-then-run.
      const openJT = () => {
        if (window.JobTemplatesUI && typeof window.JobTemplatesUI.openPicker === 'function') {
          window.JobTemplatesUI.openPicker(leadId ? { leadId: leadId } : {});
        } else if (typeof showToast === 'function') {
          showToast('Templates unavailable — starting a blank estimate instead', 'info');
          if (typeof window.openEstimateV2Builder === 'function') window.openEstimateV2Builder(leadId ? { leadId: leadId } : {});
        }
      };
      if (window.JobTemplatesUI) openJT();
      else if (window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function') {
        window.ScriptLoader.loadBundle('estimates').then(openJT).catch(openJT);
      } else openJT();
    }
  }));

  sheet.appendChild(makeOption({
    icon: '✏️',
    name: 'Start Blank',
    desc: 'Open the V2 builder empty — full 270-item catalog, presets, tiers.',
    onClick: () => {
      // opts.leadId (estimate-v2-ui.js open()) prefills from the lead and
      // suppresses the stale-draft restore prompt — blank of LINE ITEMS, not
      // blank of customer.
      if (typeof window.openEstimateV2Builder === 'function') window.openEstimateV2Builder(leadId ? { leadId: leadId } : {});
      // Defense-in-depth: V2 not loaded (mid-deploy SW cache miss) →
      // legacy picker so the rep isn't blocked. Window-qualified because
      // showEstimateTypeSelector lives in estimates.js, a sibling file.
      else if (typeof window.showEstimateTypeSelector === 'function') window.showEstimateTypeSelector();
    }
  }));

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'width:100%;background:none;border:1px solid var(--br,#2a2d35);'
    + 'color:var(--m,#888);padding:12px;border-radius:10px;cursor:pointer;'
    + "font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;"
    + 'letter-spacing:.08em;text-transform:uppercase;';
  cancel.addEventListener('click', () => overlay.remove());
  sheet.appendChild(cancel);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const escH = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); } };
  document.addEventListener('keydown', escH);
}

// ══ Window Scope Exposures ══════════════════════════════════
window.startNewEstimate = startNewEstimate;
