/**
 * NBD Pro — First-Run Onboarding Tour
 *
 * Lightweight 5-step guided tour for brand-new reps. Detects "no leads
 * yet" + "tour not seen", waits for the dashboard to mount, then walks
 * the rep through:
 *   1. Welcome / orientation
 *   2. Add your first lead
 *   3. Track stages on the kanban
 *   4. D2D tracker is built in
 *   5. Settings + tour restart
 *
 * Self-contained: no third-party tour libraries. Uses absolute-positioned
 * spotlight + tooltip, click outside or X dismisses, Esc dismisses.
 *
 * Storage:
 *   localStorage 'nbd-onboarding-complete' = '1' once dismissed/finished
 *
 * Public API: window.OnboardingTour.start() / stop() / forceRestart()
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'nbd-onboarding-complete';
  let _stepIdx = 0;
  let _overlay = null;

  // Tour steps. Each has:
  //   anchor:       CSS selector for the element to spotlight (or null = centered)
  //   title:        Short headline
  //   body:         One-paragraph explanation
  //   ctaLabel:     Optional CTA button label (e.g. "Add a lead")
  //   ctaAction:    Function called when CTA clicked (closes tour first)
  //   placement:    'top' | 'bottom' | 'left' | 'right' | 'center'
  const STEPS = [
    {
      anchor:    null,
      title:     'Welcome to NBD Pro 👋',
      body:      "You're set up. NBD Pro is built around the idea that a roofing rep should spend 95% of their time talking to homeowners and 5% on a CRM — not the other way around. Quick 30-second tour so you know where everything lives.",
      placement: 'center'
    },
    {
      anchor:    '#nav-crm',
      title:     '1 / 4 — Pipeline is home base',
      body:      "Every lead lives on the kanban here. Drag cards across columns as deals progress — Inspected → Claim Filed → Estimate Sent → Contract Signed → Closed. The pipeline value updates live.",
      placement: 'right'
    },
    {
      anchor:    '#prospectsToggleBtn, #addLeadFab, .crm-hdr-actions .btn-orange',
      title:     '2 / 4 — Add your first lead',
      body:      "Click the orange + button (top right or floating bottom right) to add a lead manually. Name + address is enough to start. You can fill in claim info, damage type, and job value later.",
      ctaLabel:  '＋ Add a lead now',
      ctaAction: () => { if (typeof window.openLeadModal === 'function') window.openLeadModal(); },
      placement: 'left'
    },
    {
      anchor:    '#nav-d2d',
      title:     '3 / 4 — Door-to-Door is built in',
      body:      "Tap a door, log the disposition, and the knock saves with GPS. Storm damage and insurance disposition knocks auto-create CRM leads as Prospects so you don't lose them. Re-knock the same address and photos accumulate.",
      placement: 'right'
    },
    {
      anchor:    '.gear, [onclick*="settings"]',
      title:     '4 / 4 — Make it yours',
      body:      "Settings has 148 themes, three UI sizes, three card densities, and a hierarchy toggle. The connection dot in the top right is also a refresh button — tap it any time to pull fresh data. You can re-run this tour anytime from Settings → Help.",
      placement: 'left'
    }
  ];

  // ────────────────────────────────────────────────────────────────────
  // CSS injection (one-time)
  // ────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nbd-onb-css')) return;
    const css = `
      .nbd-onb-overlay{
        position:fixed; inset:0; z-index:99990;
        background:rgba(0,0,0,.65);
        -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px);
        display:flex; align-items:center; justify-content:center;
        animation:nbd-onb-fade .2s ease;
      }
      @keyframes nbd-onb-fade { from { opacity:0; } to { opacity:1; } }

      .nbd-onb-spotlight{
        position:fixed; pointer-events:none;
        border-radius:10px;
        box-shadow:0 0 0 9999px rgba(0,0,0,.65), 0 0 0 3px var(--orange,#e8720c);
        transition:all .25s cubic-bezier(.4, 0, .2, 1);
        z-index:99991;
      }

      .nbd-onb-tooltip{
        position:fixed;
        max-width:380px; width:calc(100vw - 32px);
        background:var(--s,#16213e); border:1px solid var(--br,#2a2d35);
        border-radius:12px; padding:18px 20px;
        box-shadow:0 14px 44px rgba(0,0,0,.5);
        color:var(--t,#e8eaf0);
        font-family:'Barlow',sans-serif;
        z-index:99992;
        animation:nbd-onb-pop .25s cubic-bezier(.16, 1, .3, 1);
      }
      @keyframes nbd-onb-pop {
        from { opacity:0; transform:translateY(-6px) scale(.98); }
        to   { opacity:1; transform:translateY(0)    scale(1);   }
      }
      .nbd-onb-tooltip-center{ position:relative; max-width:440px; }

      .nbd-onb-step{
        font-size:9px; font-weight:700; letter-spacing:.12em;
        text-transform:uppercase; color:var(--orange,#e8720c);
        margin-bottom:6px;
      }
      .nbd-onb-title{
        font-family:'Barlow Condensed',sans-serif;
        font-size:22px; font-weight:800; letter-spacing:.02em;
        line-height:1.15; margin-bottom:8px;
        color:var(--t,#e8eaf0);
      }
      .nbd-onb-body{
        font-size:13px; line-height:1.55; color:var(--m,#9ca3af);
        margin-bottom:14px;
      }
      .nbd-onb-actions{
        display:flex; align-items:center; gap:10px;
        flex-wrap:wrap;
      }
      .nbd-onb-btn{
        background:var(--orange,#e8720c); color:#fff; border:none;
        padding:9px 16px; border-radius:7px;
        font-family:inherit; font-size:13px; font-weight:700;
        cursor:pointer; transition:all .15s;
      }
      .nbd-onb-btn:hover{ filter:brightness(1.08); transform:translateY(-1px); }
      .nbd-onb-btn-ghost{
        background:transparent; color:var(--m,#9ca3af);
        border:1px solid var(--br,#2a2d35);
      }
      .nbd-onb-btn-ghost:hover{ color:var(--t,#e8eaf0); border-color:var(--t,#e8eaf0); }
      .nbd-onb-skip{
        margin-left:auto;
        background:transparent; border:none;
        color:var(--m,#9ca3af); cursor:pointer;
        font-size:11px; font-weight:600;
        padding:6px 8px; border-radius:4px;
      }
      .nbd-onb-skip:hover{ color:var(--t,#e8eaf0); text-decoration:underline; }

      .nbd-onb-progress{
        display:flex; gap:5px; margin-top:14px;
      }
      .nbd-onb-dot{
        flex:1; height:3px; border-radius:2px;
        background:color-mix(in srgb, var(--m,#9ca3af) 30%, transparent);
        transition:background .2s;
      }
      .nbd-onb-dot.active{ background:var(--orange,#e8720c); }
      .nbd-onb-dot.done{ background:color-mix(in srgb, var(--orange,#e8720c) 50%, transparent); }
    `;
    const style = document.createElement('style');
    style.id = 'nbd-onb-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ────────────────────────────────────────────────────────────────────
  // Spotlight + tooltip positioning
  // ────────────────────────────────────────────────────────────────────
  function findAnchor(selector) {
    if (!selector) return null;
    // Try each comma-separated selector in order; first one that exists + is visible wins.
    for (const sel of selector.split(',').map(s => s.trim()).filter(Boolean)) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function positionSpotlight(target) {
    let spot = document.getElementById('nbd-onb-spotlight');
    if (!spot) {
      spot = document.createElement('div');
      spot.id = 'nbd-onb-spotlight';
      spot.className = 'nbd-onb-spotlight';
      document.body.appendChild(spot);
    }
    if (!target) {
      spot.style.display = 'none';
      return;
    }
    spot.style.display = 'block';
    const r = target.getBoundingClientRect();
    const pad = 8;
    spot.style.top    = (r.top    - pad) + 'px';
    spot.style.left   = (r.left   - pad) + 'px';
    spot.style.width  = (r.width  + pad*2) + 'px';
    spot.style.height = (r.height + pad*2) + 'px';
  }

  function positionTooltip(tip, target, placement) {
    if (!target || placement === 'center') {
      tip.classList.add('nbd-onb-tooltip-center');
      tip.style.position = 'fixed';
      tip.style.top = '50%';
      tip.style.left = '50%';
      tip.style.transform = 'translate(-50%, -50%)';
      return;
    }
    tip.classList.remove('nbd-onb-tooltip-center');
    const r = target.getBoundingClientRect();
    const tipR = tip.getBoundingClientRect();
    const margin = 16;
    let top, left;
    switch (placement) {
      case 'top':
        top  = r.top - tipR.height - margin;
        left = r.left + (r.width / 2) - (tipR.width / 2);
        break;
      case 'bottom':
        top  = r.bottom + margin;
        left = r.left + (r.width / 2) - (tipR.width / 2);
        break;
      case 'right':
        top  = r.top + (r.height / 2) - (tipR.height / 2);
        left = r.right + margin;
        break;
      case 'left':
      default:
        top  = r.top + (r.height / 2) - (tipR.height / 2);
        left = r.left - tipR.width - margin;
        break;
    }
    // Clamp to viewport
    top  = Math.max(8, Math.min(top,  window.innerHeight - tipR.height - 8));
    left = Math.max(8, Math.min(left, window.innerWidth  - tipR.width  - 8));
    tip.style.top  = top  + 'px';
    tip.style.left = left + 'px';
    tip.style.transform = '';
  }

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderStep() {
    const step = STEPS[_stepIdx];
    if (!step) { complete(); return; }
    const target = findAnchor(step.anchor);

    // Build / find the overlay backdrop (shown only on the centered step)
    if (step.placement === 'center') {
      if (!_overlay) {
        _overlay = document.createElement('div');
        _overlay.className = 'nbd-onb-overlay';
        _overlay.id = 'nbd-onb-overlay';
        document.body.appendChild(_overlay);
      } else {
        _overlay.style.display = 'flex';
      }
      positionSpotlight(null);
    } else {
      if (_overlay) _overlay.style.display = 'none';
      positionSpotlight(target);
    }

    // Tooltip
    let tip = document.getElementById('nbd-onb-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'nbd-onb-tooltip';
      tip.className = 'nbd-onb-tooltip';
      document.body.appendChild(tip);
    }
    const isLast = _stepIdx === STEPS.length - 1;
    const isFirst = _stepIdx === 0;
    const dots = STEPS.map((_, i) => {
      const cls = i < _stepIdx ? 'done' : (i === _stepIdx ? 'active' : '');
      return `<div class="nbd-onb-dot ${cls}"></div>`;
    }).join('');

    tip.innerHTML = `
      <div class="nbd-onb-step">${isFirst ? 'GET STARTED' : 'STEP ' + _stepIdx + ' OF ' + (STEPS.length - 1)}</div>
      <div class="nbd-onb-title">${escHtml(step.title)}</div>
      <div class="nbd-onb-body">${escHtml(step.body)}</div>
      <div class="nbd-onb-actions">
        ${!isFirst ? '<button class="nbd-onb-btn nbd-onb-btn-ghost" data-act="back">← Back</button>' : ''}
        ${step.ctaLabel ? `<button class="nbd-onb-btn" data-act="cta">${escHtml(step.ctaLabel)}</button>` : ''}
        <button class="nbd-onb-btn ${step.ctaLabel ? 'nbd-onb-btn-ghost' : ''}" data-act="next">${isLast ? 'Got it' : 'Next →'}</button>
        <button class="nbd-onb-skip" data-act="skip">${isFirst ? 'Skip tour' : 'Skip'}</button>
      </div>
      <div class="nbd-onb-progress">${dots}</div>
    `;

    tip.querySelectorAll('button[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'next')      { _stepIdx++; renderStep(); }
        else if (act === 'back') { _stepIdx = Math.max(0, _stepIdx - 1); renderStep(); }
        else if (act === 'skip') { complete(); }
        else if (act === 'cta')  {
          complete();
          if (typeof step.ctaAction === 'function') {
            try { step.ctaAction(); } catch (e) { console.warn('Tour CTA failed:', e); }
          }
        }
      });
    });

    // Re-position after innerHTML write (next tick so layout settles)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => positionTooltip(tip, target, step.placement));
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────
  function complete() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    document.getElementById('nbd-onb-tooltip')?.remove();
    document.getElementById('nbd-onb-spotlight')?.remove();
    if (_overlay) { _overlay.remove(); _overlay = null; }
    document.removeEventListener('keydown', _onKey, true);
    window.removeEventListener('resize', _onResize);
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowRight') { _stepIdx++; renderStep(); }
    else if (e.key === 'ArrowLeft') { _stepIdx = Math.max(0, _stepIdx - 1); renderStep(); }
  }
  function _onResize() {
    const tip = document.getElementById('nbd-onb-tooltip');
    if (!tip) return;
    const step = STEPS[_stepIdx];
    if (!step) return;
    positionTooltip(tip, findAnchor(step.anchor), step.placement);
    positionSpotlight(findAnchor(step.anchor));
  }

  function start(force) {
    if (!force) {
      try { if (localStorage.getItem(STORAGE_KEY) === '1') return; } catch (e) {}
    }
    _stepIdx = 0;
    injectStyles();
    document.addEventListener('keydown', _onKey, true);
    window.addEventListener('resize', _onResize);
    // Wait one frame so the dashboard layout settles before the first
    // anchor lookup (the kanban + sidebar mount async).
    requestAnimationFrame(() => requestAnimationFrame(renderStep));
  }

  // Auto-trigger: first time, on the dashboard, with no leads.
  function maybeAutoStart() {
    try { if (localStorage.getItem(STORAGE_KEY) === '1') return; } catch (e) { return; }
    // Wait for leads to load before deciding "is this a first-time user"
    let attempts = 0;
    const t = setInterval(() => {
      attempts++;
      // Only auto-start if leads have loaded (or 8s elapsed) AND there
      // are zero leads. If they have any data we don't want to interrupt.
      if (window._leadsLoaded || attempts > 80) {
        clearInterval(t);
        const leads = window._leads || [];
        if (leads.length === 0) {
          // small delay so the user sees the empty dashboard for a moment
          // before the tour kicks in
          setTimeout(() => start(false), 800);
        } else {
          // Has leads — tour shouldn't fire, but mark it complete so we
          // don't keep polling on every page load
          try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
        }
      }
    }, 100);
  }

  window.OnboardingTour = {
    start,
    stop: complete,
    forceRestart: () => { try { localStorage.removeItem(STORAGE_KEY); } catch(e){} start(true); }
  };

  // Auto-boot: wait for DOM + first paint
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }
})();
