(function () {
  'use strict';
  // Localhost-only emulator switch (same Audit #3 rule as
  // nbd-emulator-connect.js): the rep-side pages already point their SDK at
  // the emulators when served from localhost, but the public token pages
  // hardcoded prod — leaving the homeowner surface untestable in the
  // hermetic e2e harness. Any hostname other than localhost/127.0.0.1
  // keeps prod.
  const FUNCTIONS_BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    ? 'http://127.0.0.1:5001/nobigdeal-pro/us-central1'
    : 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('token') || '').trim();
  const estimateId = (params.get('estimateId') || params.get('id') || '').trim();
  const root = document.getElementById('evRoot');

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    const v = Number(n);
    if (!isFinite(v)) return '$0';
    return '$' + Math.round(v).toLocaleString();
  }
  function showError(msg) {
    root.innerHTML = '<div class="ev-error">' + escHtml(msg) + '</div>';
  }

  if (!token || !estimateId) {
    showError('This link is missing required information. Please ask your rep to resend.');
    return;
  }

  fetch(FUNCTIONS_BASE + '/getEstimateForView', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, estimateId: estimateId }),
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || 'Could not load estimate.');
        });
      }
      return res.json();
    })
    .then(function (data) { renderEstimate(data.estimate || {}, data.company || null); })
    .catch(function (err) { showError(err.message || 'Could not load estimate. The link may have expired.'); });

  function renderEstimate(est, company) {
    // Full white-label (2026-07-19): tenant estimates rendered under NBD's
    // identity. company comes from getEstimateForView (server-guarded:
    // tenant-set https logo / hex colors only; null-ish name for NBD).
    var coName = (company && company.name) || 'No Big Deal Home Solutions';
    var isNbd = coName === 'No Big Deal Home Solutions';
    if (!isNbd) {
      try {
        document.title = 'Your Estimate — ' + coName;
        if (company.colors && company.colors.accent) {
          // Certification: body carries .nbd-brand, whose token block SHADOWS
          // an html-only override — set on BOTH roots, override the derived
          // ramp, and pick a readable foreground for accent fills (a light
          // tenant accent would render white-on-light otherwise).
          var acc = company.colors.accent;
          var lum = (function (h) {
            h = h.replace('#', '');
            if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
            var r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
            var f = function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          })(acc);
          var fg = lum > 0.45 ? '#1a1a2e' : '#ffffff';
          var applyAccent = function (st) {
            st.setProperty('--nbd-orange', acc);
            st.setProperty('--nbd-orange-deep', 'color-mix(in srgb, ' + acc + ' 78%, #000)');
            st.setProperty('--nbd-orange-medium', 'color-mix(in srgb, ' + acc + ' 88%, #000)');
            st.setProperty('--nbd-orange-ink', 'color-mix(in srgb, ' + acc + ' 60%, #000)');
            st.setProperty('--nbd-orange-soft', 'color-mix(in srgb, ' + acc + ' 12%, transparent)');
            st.setProperty('--nbd-orange-glow', 'color-mix(in srgb, ' + acc + ' 30%, transparent)');
            st.setProperty('--nbd-ink-on-orange', fg);
          };
          applyAccent(document.documentElement.style);
          if (document.body) applyAccent(document.body.style);
        }
      } catch (e) { /* chrome is best-effort */ }
    }

    const tierName = est.tierName ||
      (est.tier === 'best' ? 'Best — Lifetime' :
       est.tier === 'better' ? 'Better — 30-Year Architectural' :
       est.tier === 'good' ? 'Good — Builder Grade' : 'Estimate');
    const total = est.grandTotal || est.total || 0;
    const lines = Array.isArray(est.lines) ? est.lines : [];
    const tiers = est.tiers || null;

    let html = '';
    html += '<div class="ev-header">';
    html +=   '<div>';
    if (isNbd) {
      html +=   '<div class="ev-brand"><span>NBD</span> · No Big Deal</div>';
      html +=   '<div class="ev-badge">Roofing &amp; Restoration</div>';
    } else if (company && company.logoUrl) {
      html +=   '<img class="ev-brand-logo" src="' + escHtml(company.logoUrl) + '" alt="' + escHtml(coName) + '" style="max-height:44px;max-width:220px;display:block;">';
    } else {
      html +=   '<div class="ev-brand">' + escHtml(coName) + '</div>';
    }
    html +=   '</div>';
    html +=   '<div>';
    html +=     '<div class="ev-doc-title">Estimate</div>';
    html +=     '<div class="ev-doc-meta">' + escHtml(est.number || '') + '</div>';
    html +=   '</div>';
    html += '</div>';

    if (est.owner || est.addr) {
      html += '<div class="ev-customer">';
      if (est.owner) html += '<dt>Prepared for</dt><dd>' + escHtml(est.owner) + '</dd>';
      if (est.addr)  html += '<dt>Property</dt><dd>' + escHtml(est.addr) + '</dd>';
      html += '</div>';
    }

    // Tier comparison cards if the estimate carries a tiers object
    if (tiers && (tiers.good || tiers.better || tiers.best)) {
      html += '<div class="ev-section-title">Choose your tier</div>';
      ['good', 'better', 'best'].forEach(function (k) {
        const t = tiers[k];
        if (!t) return;
        const featured = (k === est.tier);
        const tName = k === 'best' ? 'Best' : k === 'better' ? 'Better' : 'Good';
        html += '<div class="ev-tier-card' + (featured ? ' featured' : '') + '">';
        html +=   '<div class="ev-tier-name">' + tName + '</div>';
        html +=   '<div class="ev-tier-total">' + money(t.grandTotal || t.total || 0) + '</div>';
        html += '</div>';
      });
    } else {
      // Single-tier line-item view
      html += '<div class="ev-section-title">Scope of work</div>';
      if (lines.length) {
        html += '<ul class="ev-line-list">';
        lines.forEach(function (l) {
          html += '<li class="ev-line">';
          html +=   '<span class="ev-line-name">' + escHtml(l.name || l.description || l.code || 'Line item') + '</span>';
          if (l.quantity != null) {
            html += '<span class="ev-line-qty">' + escHtml(String(l.quantity)) + ' ' + escHtml(l.unit || '') + '</span>';
          }
          html +=   '<span class="ev-line-amt">' + money(l.lineTotal || l.amount || 0) + '</span>';
          html += '</li>';
        });
        html += '</ul>';
      } else {
        html += '<p style="color:var(--nbd-ink-muted);font-style:italic;">Detailed line items will be reviewed in person.</p>';
      }
    }

    html += '<div class="ev-grand">';
    html +=   '<span class="ev-grand-lbl">Project Total</span>';
    html +=   '<span class="ev-grand-val">' + money(total) + '</span>';
    html += '</div>';

    html += '<div class="ev-cta-row">';
    html +=   '<button type="button" class="ghost" data-ev-action="print">Print / Save PDF</button>';
    html +=   '<button type="button" class="ghost" data-ev-action="back">Back</button>';
    html += '</div>';

    html += '<div class="ev-foot">';
    html +=   'This estimate is good for 30 days from the date issued. ';
    html +=   'Questions? Reply to your rep&#39;s message or call them directly.';
    html += '</div>';

    root.innerHTML = html;

    // ev-brand-logo error → hide (CSP-blocked/404 tenant logos must not
    // paint the broken-image icon). Property listener, not inline attr (CSP).
    var _bl = root.querySelector('.ev-brand-logo');
    if (_bl) _bl.addEventListener('error', function () { _bl.style.display = 'none'; });

    // Wave 28: button delegates (replaces inline onclick="window.print()" etc.)
    root.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest && ev.target.closest('[data-ev-action]');
      if (!t) return;
      var act = t.getAttribute('data-ev-action');
      if (act === 'print') { window.print(); }
      else if (act === 'back') { history.back(); }
    });
  }
})();
