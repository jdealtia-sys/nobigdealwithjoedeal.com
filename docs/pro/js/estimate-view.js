(function () {
  'use strict';
  const FUNCTIONS_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
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
    .then(function (data) { renderEstimate(data.estimate || {}); })
    .catch(function (err) { showError(err.message || 'Could not load estimate. The link may have expired.'); });

  function renderEstimate(est) {
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
    html +=     '<div class="ev-brand"><span>NBD</span> · No Big Deal</div>';
    html +=     '<div class="ev-badge">Roofing &amp; Restoration</div>';
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
        html += '<p style="color:#666;font-style:italic;">Detailed line items will be reviewed in person.</p>';
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
