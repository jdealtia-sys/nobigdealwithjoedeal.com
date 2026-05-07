/**
 * review-funnel.js — Wave 166 (review-eligible inbox + smart timing)
 *
 * Surfaces leads that are in the "review sweet spot" — closed-stage
 * jobs aged 2-21 days since stage entry, with no review request
 * sent yet. The existing W56-era ReviewEngine already has the
 * sendReviewRequestSMS / sendReviewRequestEmail / logReviewRequest
 * primitives wired into Firestore; this module is the discovery
 * surface that puts those calls one tap away from the rep without
 * making them dig through notifications.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ ⭐ Reviews to ask for                                      │
 *   │ ──────────────────────────────────────────────────────── │
 *   │ Sarah Mills          Job completed 4 days ago             │
 *   │                                  [💬 Send SMS] [📧 Email] │
 *   │ Tom Reilly           Job completed 11 days ago            │
 *   │                                  [💬 Send SMS] [📧 Email] │
 *   │                                                            │
 *   │              [📤 Send all SMS at once]                     │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Why 2-21 days:
 *   - <2 days: too soon. Crew's still cleaning up, last-mile
 *     issues haven't surfaced yet, the wow factor isn't there.
 *     Asking now risks a 3-star "good but they left a mess" vs a
 *     5-star "everything is perfect" once the dust settles.
 *   - >21 days: they've moved on. Conversion drops sharply.
 *
 * Reuses ReviewEngine.sendReviewRequestSMS/Email when the rep
 * clicks. Each send fires the existing Firestore writes (review
 * request log + lead.reviewRequested flag) so the row drops out
 * of the inbox automatically on next refresh.
 *
 * Bulk "Send all SMS" iterates with a small delay between sms:
 * launches so the rep's messaging app can handle them in sequence
 * — without the delay, only the last one tends to surface.
 *
 * Mounts into a #reviewFunnelPanel slot on dashboard.html (Reports
 * view). Renders nothing if no eligible leads exist.
 *
 * Public API:
 *   window.NBDReviewFunnel.refresh()
 *   window.NBDReviewFunnel.eligibleCount()
 */
(function () {
  'use strict';
  if (window.NBDReviewFunnel
      && window.NBDReviewFunnel.__sentinel === 'nbd-review-funnel-v1') return;

  const PANEL_ID = 'reviewFunnelPanel';
  const SWEET_SPOT_MIN_DAYS = 2;
  const SWEET_SPOT_MAX_DAYS = 21;
  // Leads whose stage flipped to one of these are eligible for
  // a review request once the timing window opens. Mirrors the
  // legacy review-engine list + a few stage variants the rep's
  // pipeline actually uses.
  const CLOSED_STAGES = new Set([
    'closed',
    'completed',
    'install_complete',
    'install-complete',
    'final_payment',
    'final-payment',
    'job_complete',
    'job-complete',
    'Complete',
  ]);

  // ─── Helpers ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch (_) { return 0; }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (v instanceof Date) return v.getTime();
    return 0;
  }
  function _name(lead) {
    if (!lead) return 'Customer';
    const n = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    return n || lead.address || lead.email || 'Customer';
  }
  function _stageEnteredMs(lead) {
    // Best signal of "when the job actually closed":
    //   1. Most-recent stageHistory entry whose `to` is a closed stage
    //   2. lead.completedAt if the dashboard's quick-mark wrote it
    //   3. lead.updatedAt as a final fallback
    if (Array.isArray(lead.stageHistory)) {
      for (let i = lead.stageHistory.length - 1; i >= 0; i--) {
        const h = lead.stageHistory[i];
        if (h && CLOSED_STAGES.has(h.to)) {
          const t = _toMillis(h.timestamp);
          if (t) return t;
        }
      }
    }
    return _toMillis(lead.completedAt) || _toMillis(lead.updatedAt) || 0;
  }
  function _daysAgo(ms) {
    if (!ms) return null;
    return Math.floor((Date.now() - ms) / 86_400_000);
  }

  // ─── Eligibility ──────────────────────────────────────────────
  function _eligible(lead) {
    if (!lead || lead.deleted) return false;
    if (lead.reviewRequested) return false;
    const sk = lead._stageKey || lead.stage || '';
    if (!CLOSED_STAGES.has(sk)) return false;
    const ms = _stageEnteredMs(lead);
    if (!ms) return false;
    const days = _daysAgo(ms);
    if (days == null || days < SWEET_SPOT_MIN_DAYS || days > SWEET_SPOT_MAX_DAYS) return false;
    return true;
  }

  function _findEligible() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const out = [];
    for (const l of leads) {
      if (!_eligible(l)) continue;
      const ms = _stageEnteredMs(l);
      out.push({ lead: l, completedMs: ms, days: _daysAgo(ms) });
    }
    // Soonest-eligible first — the 2-day-old leads are the freshest
    // memories so getting the request out fast matters most.
    out.sort((a, b) => a.days - b.days);
    return out;
  }

  // ─── Render ───────────────────────────────────────────────────
  function _renderRow(entry) {
    const lead = entry.lead;
    const phone = String(lead.phone || '').replace(/\D+/g, '');
    const email = String(lead.email || '').trim();
    const sub = entry.days === 0
      ? 'Job just completed'
      : 'Job completed ' + entry.days + ' day' + (entry.days === 1 ? '' : 's') + ' ago';

    const smsBtn = phone
      ? '<button type="button" class="nbd-rf-btn" data-rf-action="sms" data-leadid="' + _esc(lead.id) + '" ' +
        'style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:5px;' +
        'background:rgba(34,197,94,0.14);color:#86efac;border:1px solid rgba(34,197,94,0.45);' +
        'font:inherit;font-size:11px;font-weight:700;cursor:pointer;">💬 SMS</button>'
      : '<span title="No phone on file" style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:5px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:11px;font-weight:700;cursor:not-allowed;">💬 SMS</span>';
    const emailBtn = email
      ? '<button type="button" class="nbd-rf-btn" data-rf-action="email" data-leadid="' + _esc(lead.id) + '" ' +
        'style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:5px;' +
        'background:rgba(59,130,246,0.14);color:#93c5fd;border:1px solid rgba(59,130,246,0.45);' +
        'font:inherit;font-size:11px;font-weight:700;cursor:pointer;">📧 Email</button>'
      : '<span title="No email on file" style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:5px;background:rgba(148,163,184,0.15);color:#94a3b8;font:inherit;font-size:11px;font-weight:700;cursor:not-allowed;">📧 Email</span>';

    return '<div class="nbd-rf-row" data-leadid="' + _esc(lead.id) + '" ' +
      'style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:6px;border:1px solid var(--border, #2a3344);background:rgba(15,23,42,0.45);">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;color:var(--text, #e2e8f0);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(_name(lead)) + '</div>' +
        '<div style="color:var(--muted, #94a3b8);font-size:11px;margin-top:2px;">' + _esc(sub) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        smsBtn + emailBtn +
      '</div>' +
    '</div>';
  }

  function _renderEmpty() {
    return '<div style="text-align:center;padding:24px 12px;color:var(--muted, #94a3b8);font-size:13px;line-height:1.5;">' +
      '<div style="font-size:28px;margin-bottom:8px;">⭐</div>' +
      'No leads in the review sweet spot right now.<br>' +
      '<span style="font-size:11px;opacity:0.8;">Closed jobs aged 2-21 days appear here automatically.</span>' +
    '</div>';
  }

  function _renderHeader(count) {
    const sub = count === 1
      ? '1 lead is in the 2-21 day sweet spot'
      : count + ' leads are in the 2-21 day sweet spot';
    return '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
      '<div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted, #94a3b8);">Review funnel</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text, #e2e8f0);margin-top:2px;">⭐ Reviews to ask for</div>' +
        '<div style="color:var(--muted, #94a3b8);font-size:11px;margin-top:2px;">' + _esc(sub) + '</div>' +
      '</div>' +
      (count > 1
        ? '<button type="button" data-rf-action="bulk-sms" ' +
          'style="background:rgba(200,84,26,0.18);color:#fcd34d;border:1px solid rgba(200,84,26,0.45);' +
          'border-radius:6px;padding:7px 12px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;">📤 Send all SMS</button>'
        : '') +
    '</div>';
  }

  function _ensureHost() {
    return document.getElementById(PANEL_ID);
  }

  function refresh() {
    const host = _ensureHost();
    if (!host) return;
    const eligible = _findEligible();
    if (!eligible.length) {
      host.innerHTML = _renderEmpty();
      return;
    }
    const rowsHtml = eligible.map(_renderRow).join('');
    host.innerHTML =
      _renderHeader(eligible.length) +
      '<div style="display:flex;flex-direction:column;gap:8px;">' + rowsHtml + '</div>';

    // Wire up buttons.
    host.querySelectorAll('[data-rf-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = el.getAttribute('data-rf-action');
        const leadId = el.getAttribute('data-leadid');
        if (action === 'sms' && leadId) {
          if (window.ReviewEngine && typeof window.ReviewEngine.sendReviewRequestSMS === 'function') {
            window.ReviewEngine.sendReviewRequestSMS(leadId);
          } else {
            console.warn('[review-funnel] ReviewEngine.sendReviewRequestSMS missing');
          }
        } else if (action === 'email' && leadId) {
          if (window.ReviewEngine && typeof window.ReviewEngine.sendReviewRequestEmail === 'function') {
            window.ReviewEngine.sendReviewRequestEmail(leadId);
          } else {
            console.warn('[review-funnel] ReviewEngine.sendReviewRequestEmail missing');
          }
        } else if (action === 'bulk-sms') {
          await _sendAllSMS(eligible);
        }
      });
    });
  }

  // ─── Bulk send ────────────────────────────────────────────────
  async function _sendAllSMS(eligible) {
    const phones = eligible
      .map(e => e.lead)
      .filter(l => String(l.phone || '').replace(/\D+/g, ''));
    if (!phones.length) {
      if (typeof window.showToast === 'function') {
        window.showToast('No phone numbers on file for these leads', 'error');
      }
      return;
    }
    if (typeof window.confirm === 'function') {
      const yes = window.confirm('Send SMS review requests to ' + phones.length + ' customers? Each will open in your messaging app one at a time.');
      if (!yes) return;
    }
    // Fire each with a 600ms gap so the OS messaging app can
    // handle them in sequence. Without the gap, only the last
    // sms: launch typically surfaces (the OS coalesces the
    // intent fires).
    for (let i = 0; i < phones.length; i++) {
      const lead = phones[i];
      try {
        if (window.ReviewEngine && typeof window.ReviewEngine.sendReviewRequestSMS === 'function') {
          window.ReviewEngine.sendReviewRequestSMS(lead.id);
        }
      } catch (e) {
        console.warn('[review-funnel] bulk send failed for', lead.id, e && e.message);
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }

  function eligibleCount() {
    return _findEligible().length;
  }

  // ─── Init ─────────────────────────────────────────────────────
  function _init() {
    refresh();
    document.addEventListener('nbd:data-refreshed', refresh);
    // Light periodic check — eligibility is time-based, so a lead
    // that wasn't eligible at page load (still <48h) becomes
    // eligible an hour or two later. Refresh every 5 minutes
    // catches that without busy-looping.
    const intervalId = setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener('pagehide', () => {
      try { clearInterval(intervalId); } catch (_) {}
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
  } else {
    setTimeout(_init, 0);
  }

  window.NBDReviewFunnel = {
    __sentinel: 'nbd-review-funnel-v1',
    refresh,
    eligibleCount,
  };
})();
