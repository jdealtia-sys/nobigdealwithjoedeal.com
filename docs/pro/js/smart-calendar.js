// ============================================================
// NBD Pro — smart-calendar.js
// Today's Schedule view inside view-schedule. Pulls appointments
// from /appointments (Cal.com webhook output) for the current rep,
// cross-references with window._leads to attach jobValue + lat/lng,
// then renders a vertical timeline with travel-time warnings,
// priority badges, and a daily route summary.
//
// Drop-in replacement for the placeholder #calUpcoming panel.
// ============================================================

(function () {
  'use strict';

  // ── tunables ────────────────────────────────────────────────
  // Roofing reps average ~35 mph including stops + traffic in mixed
  // city/suburban driving. This is intentionally conservative: better
  // to warn early than have a rep show up 10 minutes late.
  const AVG_SPEED_MPH = 35;
  // Below this gap-vs-travel-time delta (minutes), flag as tight.
  const TIGHT_BUFFER_MIN = 10;
  // High-value threshold for the $$ badge (jobValue + estimateAmount).
  const HIGH_VALUE = 10000;
  const MED_VALUE = 3000;

  // ── public entry ────────────────────────────────────────────
  async function loadSmartCalendar() {
    const host = document.getElementById('calUpcoming');
    if (!host) return; // panel not in DOM (legacy page or rare standalone)
    const user = window._user;
    if (!user) {
      host.innerHTML = _emptyState('Sign in to see your schedule.');
      return;
    }
    if (!window._db || !window.collection || !window.query || !window.where || !window.getDocs || !window.orderBy) {
      // Firebase not ready — bail without spamming the user. Caller can
      // re-invoke after the auth state settles.
      return;
    }
    _renderLoading(host);

    let appts = [];
    try {
      appts = await _fetchTodaysAppointments(user.uid);
    } catch (e) {
      console.warn('[smart-cal] fetch failed:', e?.message || e);
      host.innerHTML = _emptyState('Could not load appointments. Check your connection.');
      return;
    }

    if (!appts.length) {
      host.innerHTML = _emptyState('No appointments today. Time to knock some doors. 🚪');
      return;
    }

    // Sort by start time ascending so travel-time math is meaningful.
    appts.sort((a, b) => _toMs(a.startTime) - _toMs(b.startTime));

    // Cross-reference leads to attach jobValue + lat/lng. This is
    // best-effort: appointments don't store leadId so we match by
    // attendee email (high confidence) or by attendee name (fuzzy).
    const leads = Array.isArray(window._leads) ? window._leads : [];
    appts = appts.map(a => _attachLead(a, leads));

    // Compute per-segment travel data (between appt[i] and appt[i+1]).
    const segments = _computeSegments(appts);

    // Daily summary for the header.
    const summary = _summarize(appts, segments);

    host.innerHTML = _renderTimeline(appts, segments, summary);
  }

  // ── data fetch ──────────────────────────────────────────────
  async function _fetchTodaysAppointments(uid) {
    const db = window._db;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(); endOfDay.setHours(23, 59, 59, 999);

    // Query by repUid first (matches Cal.com webhook write shape; see
    // functions/integrations/calcom.js). Falls back to userId for
    // legacy/manual appointment docs.
    const apptsCol = window.collection(db, 'appointments');

    const results = [];
    const seen = new Set();

    // ── primary: repUid scope ──
    try {
      const q1 = window.query(
        apptsCol,
        window.where('repUid', '==', uid),
        window.where('startTime', '>=', startOfDay),
        window.where('startTime', '<=', endOfDay),
        window.orderBy('startTime', 'asc')
      );
      const snap1 = await window.getDocs(q1);
      snap1.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
    } catch (e) {
      // Composite-index errors come back when the index isn't deployed
      // — log and keep going so the userId fallback still runs.
      console.warn('[smart-cal] repUid query failed:', e?.code || e?.message);
    }

    // ── fallback: userId scope (older docs) ──
    try {
      const q2 = window.query(
        apptsCol,
        window.where('userId', '==', uid),
        window.where('startTime', '>=', startOfDay),
        window.where('startTime', '<=', endOfDay),
        window.orderBy('startTime', 'asc')
      );
      const snap2 = await window.getDocs(q2);
      snap2.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
    } catch (e) {
      console.warn('[smart-cal] userId fallback failed:', e?.code || e?.message);
    }

    // Filter out cancelled appointments so the timeline doesn't show
    // ghost events. Webhook keeps them in /appointments for audit.
    return results.filter(a => a.status !== 'cancelled');
  }

  function _toMs(t) {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') return new Date(t).getTime();
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return 0;
  }

  // ── lead matching ───────────────────────────────────────────
  function _attachLead(appt, leads) {
    if (!leads.length) return appt;
    const email = (appt.attendeeEmail || '').toLowerCase().trim();
    const name = (appt.attendeeName || '').toLowerCase().trim();
    let match = null;

    if (email) {
      match = leads.find(l => (l.email || '').toLowerCase().trim() === email);
    }
    if (!match && name) {
      match = leads.find(l => {
        const full = `${l.firstName || ''} ${l.lastName || ''}`.toLowerCase().trim();
        return full && full === name;
      });
    }
    if (!match) return appt;

    return {
      ...appt,
      _leadId: match.id,
      _leadValue: (parseFloat(match.jobValue) || 0) + (parseFloat(match.estimateAmount) || 0),
      _leadStage: match.stage || '',
      _leadLat: match.lat || null,
      _leadLng: match.lng || null,
      _leadAddress: match.address || ''
    };
  }

  // ── travel-time + conflict computation ──────────────────────
  function _computeSegments(appts) {
    const out = [];
    for (let i = 0; i < appts.length - 1; i++) {
      const a = appts[i];
      const b = appts[i + 1];
      const gapMin = (_toMs(b.startTime) - _toMs(a.endTime)) / 60000;
      const segment = { gapMin, miles: null, driveMin: null, status: 'ok' };

      // Conflict: B starts before A ends.
      if (gapMin < 0) {
        segment.status = 'conflict';
      } else if (a._leadLat && a._leadLng && b._leadLat && b._leadLng) {
        // hav() returns feet; convert to miles for human-readable display.
        // The function is exposed via maps.js (window.hav).
        if (typeof window.hav === 'function') {
          const feet = window.hav(
            { lat: a._leadLat, lng: a._leadLng },
            { lat: b._leadLat, lng: b._leadLng }
          );
          segment.miles = feet / 5280;
          segment.driveMin = (segment.miles / AVG_SPEED_MPH) * 60;

          if (gapMin < segment.driveMin) segment.status = 'too-tight';
          else if (gapMin - segment.driveMin < TIGHT_BUFFER_MIN) segment.status = 'tight';
        }
      }
      out.push(segment);
    }
    return out;
  }

  function _summarize(appts, segments) {
    const total = appts.length;
    const totalMiles = segments.reduce((s, x) => s + (x.miles || 0), 0);
    const totalDriveMin = segments.reduce((s, x) => s + (x.driveMin || 0), 0);
    const conflicts = segments.filter(s => s.status === 'conflict').length;
    const tooTight  = segments.filter(s => s.status === 'too-tight').length;
    return { total, totalMiles, totalDriveMin, conflicts, tooTight };
  }

  // ── rendering ───────────────────────────────────────────────
  function _renderLoading(host) {
    host.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--m);font-size:12px;">
        <div style="font-size:18px;margin-bottom:6px;">⏳</div>
        Loading today's schedule…
      </div>`;
  }

  function _emptyState(msg) {
    return `
      <div style="text-align:center;padding:24px 16px;color:var(--m);font-size:13px;">
        <div style="font-size:28px;margin-bottom:8px;">📋</div>
        ${_esc(msg)}
      </div>`;
  }

  function _renderTimeline(appts, segments, summary) {
    const head = _renderSummaryHeader(summary);
    const rows = [];
    for (let i = 0; i < appts.length; i++) {
      rows.push(_renderApptRow(appts[i]));
      if (i < segments.length) rows.push(_renderSegmentRow(segments[i]));
    }
    return head + `<div style="display:flex;flex-direction:column;gap:0;margin-top:14px;">${rows.join('')}</div>`;
  }

  function _renderSummaryHeader(s) {
    const miles = s.totalMiles > 0 ? `${s.totalMiles.toFixed(1)} mi` : '—';
    const drive = s.totalDriveMin > 0 ? _fmtMin(s.totalDriveMin) : '—';
    const warnLine = (s.conflicts + s.tooTight) > 0
      ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);border-radius:6px;font-size:11px;color:var(--red);">
           ⚠️ ${s.conflicts ? `${s.conflicts} conflict${s.conflicts>1?'s':''}` : ''}${s.conflicts && s.tooTight ? ' · ' : ''}${s.tooTight ? `${s.tooTight} too tight on travel time` : ''}
         </div>`
      : '';
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;">
        <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;">
          <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);margin-bottom:4px;">Appts</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;color:var(--t);">${s.total}</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;">
          <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);margin-bottom:4px;">Miles</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;color:var(--t);">${_esc(miles)}</div>
        </div>
        <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;">
          <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);margin-bottom:4px;">Drive Time</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;color:var(--t);">${_esc(drive)}</div>
        </div>
      </div>
      ${warnLine}`;
  }

  function _renderApptRow(a) {
    const start = _fmtTime(_toMs(a.startTime));
    const end = _fmtTime(_toMs(a.endTime));
    const title = a.title || a.attendeeName || 'Appointment';
    const where = a.location || a._leadAddress || '';
    const valueBadge = _renderValueBadge(a._leadValue);
    const leadLink = a._leadId
      ? `<button data-sc-action="openCardDetail" data-sc-id="${_esc(a._leadId)}" style="background:none;border:none;color:var(--orange);font-size:11px;cursor:pointer;padding:0;text-decoration:underline;">Open lead →</button>`
      : '';
    return `
      <div style="display:grid;grid-template-columns:88px 1fr auto;gap:10px;align-items:flex-start;padding:10px 12px;background:var(--s2);border:1px solid var(--br);border-radius:7px;">
        <div>
          <div style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:var(--t);">${_esc(start)}</div>
          <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--m);">${_esc(end)}</div>
        </div>
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(title)}</div>
          ${where ? `<div style="font-size:11px;color:var(--m);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 ${_esc(where)}</div>` : ''}
          ${leadLink ? `<div style="margin-top:4px;">${leadLink}</div>` : ''}
        </div>
        <div style="text-align:right;">${valueBadge}</div>
      </div>`;
  }

  function _renderSegmentRow(seg) {
    if (seg.status === 'conflict') {
      return `
        <div style="padding:6px 12px;font-size:11px;color:var(--red);background:rgba(220,38,38,.06);border-left:3px solid var(--red);margin-left:12px;border-radius:0 4px 4px 0;">
          ⚠️ Conflict — appointments overlap
        </div>`;
    }
    const gap = seg.gapMin >= 0 ? _fmtMin(seg.gapMin) : '—';
    const drive = seg.driveMin != null ? _fmtMin(seg.driveMin) : '?';
    const miles = seg.miles != null ? `${seg.miles.toFixed(1)} mi` : '? mi';

    if (seg.status === 'too-tight') {
      return `
        <div style="padding:6px 12px;font-size:11px;color:var(--red);background:rgba(220,38,38,.06);border-left:3px solid var(--red);margin-left:12px;border-radius:0 4px 4px 0;">
          🚗 ${_esc(miles)} · ${_esc(drive)} drive — only ${_esc(gap)} gap. Late risk.
        </div>`;
    }
    if (seg.status === 'tight') {
      return `
        <div style="padding:6px 12px;font-size:11px;color:#D4A017;background:rgba(212,160,23,.06);border-left:3px solid #D4A017;margin-left:12px;border-radius:0 4px 4px 0;">
          🚗 ${_esc(miles)} · ${_esc(drive)} drive · ${_esc(gap)} gap — tight.
        </div>`;
    }
    return `
      <div style="padding:6px 12px;font-size:11px;color:var(--m);margin-left:12px;">
        ${seg.driveMin != null ? `🚗 ${_esc(miles)} · ${_esc(drive)} drive · ${_esc(gap)} gap` : `${_esc(gap)} gap`}
      </div>`;
  }

  function _renderValueBadge(v) {
    if (!v || v <= 0) return '';
    if (v >= HIGH_VALUE) {
      return `<span style="display:inline-block;background:var(--orange);color:var(--t);font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:4px;">$$$</span>`;
    }
    if (v >= MED_VALUE) {
      return `<span style="display:inline-block;background:rgba(232,114,12,.18);color:var(--orange);font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:4px;border:1px solid rgba(232,114,12,.35);">$$</span>`;
    }
    return `<span style="display:inline-block;background:var(--s2);color:var(--m);font-size:10px;font-weight:600;padding:3px 7px;border-radius:4px;border:1px solid var(--br);">$</span>`;
  }

  // ── small utils ─────────────────────────────────────────────
  function _fmtTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function _fmtMin(m) {
    if (!isFinite(m) || m <= 0) return '0 min';
    if (m < 60) return `${Math.round(m)} min`;
    const h = Math.floor(m / 60);
    const r = Math.round(m - h * 60);
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── auto-load on schedule view ──────────────────────────────
  // Re-render whenever the rep navigates to the schedule view. Hooks
  // into the goTo() wrapper if present, otherwise listens for the
  // hashchange/popstate that view switches dispatch.
  function _attachAutoLoad() {
    const refresh = () => {
      const view = document.getElementById('view-schedule');
      if (!view) return;
      // Only refresh when the schedule view is actually visible to
      // avoid wasted Firestore reads on every nav.
      const isActive = view.classList.contains('active') ||
                       getComputedStyle(view).display !== 'none';
      if (isActive) loadSmartCalendar();
    };

    // Patch goTo() to fire after nav. Wrap rather than replace so we
    // don't fight with any other module that might also wrap it.
    const origGoTo = window.goTo;
    if (typeof origGoTo === 'function' && !origGoTo.__smartCalWrapped) {
      window.goTo = function (...args) {
        const r = origGoTo.apply(this, args);
        if (args[0] === 'schedule') setTimeout(refresh, 50);
        return r;
      };
      window.goTo.__smartCalWrapped = true;
    }

    // First paint after leads load — if user landed on /pro/dashboard.html#schedule
    // we want the timeline to populate without requiring a re-nav.
    document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 600));
    // Also retry after leads are loaded so value badges populate.
    window.addEventListener('nbd:leads-loaded', refresh);
  }

  // Expose for cmd palette + manual refresh.
  window.loadSmartCalendar = loadSmartCalendar;
  _attachAutoLoad();
})();


(function(){if(window._NBD_SC_DELEGATE)return;window._NBD_SC_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-sc-action]');if(!t)return;if(t.dataset.scAction==='openCardDetail'&&typeof openCardDetailModal==='function')openCardDetailModal(t.dataset.scId);});})();
