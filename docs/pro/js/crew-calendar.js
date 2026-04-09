/**
 * NBD Pro — Crew Calendar / Scheduling View
 * Visual monthly calendar showing scheduled jobs by crew/date.
 * Uses existing lead fields: scheduledDate, crew, jobType, address.
 * Renders into the Dashboard as a full calendar view with day detail.
 *
 * Exposes: window.CrewCalendar
 */

(function() {
  'use strict';

  const BRAND = { navy: '#1e3a6e', orange: '#C8541A' };
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Crew colors for visual differentiation
  const CREW_COLORS = [
    '#3b82f6','#16a34a','#C8541A','#9b6dff','#eab308',
    '#ec4899','#14b8a6','#f97316','#6366f1','#ef4444'
  ];

  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let crewColorMap = {};

  // ═════════════════════════════════════════════════════════════
  // DATA
  // ═════════════════════════════════════════════════════════════

  function getScheduledJobs() {
    const leads = window._leads || [];
    return leads.filter(l => l.scheduledDate && !l.deleted).map(l => {
      const d = new Date(l.scheduledDate + 'T00:00:00');
      return {
        id: l.id,
        date: d,
        dateStr: l.scheduledDate,
        crew: (l.crew || 'Unassigned').trim(),
        name: ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || 'No Name',
        address: l.address || '',
        jobType: l.jobType || l.damageType || 'Exterior',
        stage: l._stageKey || l.stage || 'new',
        jobValue: parseFloat(l.jobValue) || 0,
        phone: l.phone || ''
      };
    });
  }

  function buildCrewColorMap(jobs) {
    const crews = [...new Set(jobs.map(j => j.crew))].sort();
    crewColorMap = {};
    crews.forEach((c, i) => { crewColorMap[c] = CREW_COLORS[i % CREW_COLORS.length]; });
  }

  function getJobsForDate(jobs, year, month, day) {
    return jobs.filter(j =>
      j.date.getFullYear() === year &&
      j.date.getMonth() === month &&
      j.date.getDate() === day
    );
  }

  // ═════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════

  function renderCalendar(containerId) {
    const el = document.getElementById(containerId || 'crewCalendar');
    if (!el) return;

    const jobs = getScheduledJobs();
    buildCrewColorMap(jobs);

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getMonth() === currentMonth && today.getFullYear() === currentYear;
    const todayDate = today.getDate();

    // Month stats
    const monthJobs = jobs.filter(j => j.date.getMonth() === currentMonth && j.date.getFullYear() === currentYear);
    const monthRevenue = monthJobs.reduce((s, j) => s + j.jobValue, 0);
    const crewCounts = {};
    monthJobs.forEach(j => { crewCounts[j.crew] = (crewCounts[j.crew] || 0) + 1; });

    let html = `
      <div style="background:var(--c,#111827);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:14px;overflow:hidden;">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(135deg,${BRAND.navy},#1a1a2e);border-bottom:1px solid var(--br,rgba(255,255,255,.08));">
          <button onclick="window.CrewCalendar.prev()" style="background:none;border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:16px;">‹</button>
          <div style="text-align:center;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:#fff;">${MONTH_NAMES[currentMonth]} ${currentYear}</div>
            <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;">${monthJobs.length} jobs · $${fmtN(monthRevenue)} scheduled</div>
          </div>
          <button onclick="window.CrewCalendar.next()" style="background:none;border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:16px;">›</button>
        </div>

        <!-- Crew legend -->
        ${Object.keys(crewCounts).length > 0 ? `
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 20px;background:var(--s,rgba(255,255,255,.02));border-bottom:1px solid var(--br,rgba(255,255,255,.06));">
          ${Object.entries(crewCounts).map(([crew, count]) => `
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--m,#9ca3af);">
              <span style="width:8px;height:8px;border-radius:50%;background:${crewColorMap[crew] || '#6b7280'};"></span>
              ${esc(crew)} (${count})
            </span>
          `).join('')}
        </div>` : ''}

        <!-- Day names -->
        <div style="display:grid;grid-template-columns:repeat(7,1fr);background:var(--s,rgba(255,255,255,.02));border-bottom:1px solid var(--br,rgba(255,255,255,.06));">
          ${DAY_NAMES.map(d => `<div style="text-align:center;padding:8px;font-size:11px;font-weight:700;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.06em;">${d}</div>`).join('')}
        </div>

        <!-- Calendar grid -->
        <div style="display:grid;grid-template-columns:repeat(7,1fr);">
    `;

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += `<div style="min-height:90px;padding:6px;border-bottom:1px solid var(--br,rgba(255,255,255,.04));border-right:1px solid var(--br,rgba(255,255,255,.04));background:var(--s,rgba(255,255,255,.01));"></div>`;
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dayJobs = getJobsForDate(jobs, currentYear, currentMonth, d);
      const isToday = isCurrentMonth && d === todayDate;
      const isWeekend = (firstDay + d - 1) % 7 === 0 || (firstDay + d - 1) % 7 === 6;

      html += `
        <div onclick="window.CrewCalendar.showDay(${currentYear},${currentMonth},${d})"
             style="min-height:90px;padding:6px;border-bottom:1px solid var(--br,rgba(255,255,255,.04));border-right:1px solid var(--br,rgba(255,255,255,.04));cursor:pointer;transition:background .15s;${isToday ? `background:rgba(200,84,26,.08);` : isWeekend ? `background:var(--s,rgba(255,255,255,.01));` : ''}"
             onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background='${isToday ? 'rgba(200,84,26,.08)' : isWeekend ? 'var(--s,rgba(255,255,255,.01))' : ''}'">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:13px;font-weight:${isToday ? '800' : '500'};color:${isToday ? '#C8541A' : 'var(--h,#fff)'};">${d}</span>
            ${dayJobs.length > 0 ? `<span style="font-size:10px;background:${BRAND.navy};color:#fff;padding:1px 6px;border-radius:10px;">${dayJobs.length}</span>` : ''}
          </div>
          ${dayJobs.slice(0, 3).map(j => `
            <div style="font-size:10px;padding:2px 5px;margin-bottom:2px;border-radius:4px;background:${crewColorMap[j.crew] || '#6b7280'}22;color:${crewColorMap[j.crew] || '#6b7280'};border-left:2px solid ${crewColorMap[j.crew] || '#6b7280'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(j.name)} — ${esc(j.crew)}">
              ${esc(j.name)}
            </div>
          `).join('')}
          ${dayJobs.length > 3 ? `<div style="font-size:10px;color:var(--m,#9ca3af);padding-left:5px;">+${dayJobs.length - 3} more</div>` : ''}
        </div>
      `;
    }

    // Trailing empty cells
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) {
      html += `<div style="min-height:90px;padding:6px;border-bottom:1px solid var(--br,rgba(255,255,255,.04));border-right:1px solid var(--br,rgba(255,255,255,.04));background:var(--s,rgba(255,255,255,.01));"></div>`;
    }

    html += `</div></div>`;
    el.innerHTML = html;
  }

  // ═════════════════════════════════════════════════════════════
  // DAY DETAIL MODAL
  // ═════════════════════════════════════════════════════════════

  function showDayDetail(year, month, day) {
    const jobs = getScheduledJobs();
    const dayJobs = getJobsForDate(jobs, year, month, day);
    const dateStr = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // Remove existing overlay
    const existing = document.getElementById('calDayOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'calDayOverlay';
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
      <div style="background:var(--c,#111827);border:1px solid var(--br,rgba(255,255,255,.1));border-radius:16px;width:100%;max-width:520px;max-height:80vh;overflow-y:auto;">
        <div style="padding:20px;border-bottom:1px solid var(--br,rgba(255,255,255,.08));display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:var(--h,#fff);">📅 ${dateStr}</div>
            <div style="font-size:12px;color:var(--m,#9ca3af);margin-top:2px;">${dayJobs.length} job${dayJobs.length !== 1 ? 's' : ''} scheduled</div>
          </div>
          <button onclick="document.getElementById('calDayOverlay').remove()" style="background:none;border:none;color:var(--m,#9ca3af);font-size:20px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:16px;">
          ${dayJobs.length === 0 ? `<div style="text-align:center;padding:32px;color:var(--m,#9ca3af);font-size:14px;">No jobs scheduled for this day</div>` :
            dayJobs.map(j => `
              <div style="background:var(--s,rgba(255,255,255,.03));border:1px solid var(--br,rgba(255,255,255,.06));border-left:3px solid ${crewColorMap[j.crew] || '#6b7280'};border-radius:10px;padding:14px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                  <div style="font-weight:700;color:var(--h,#fff);font-size:14px;">${esc(j.name)}</div>
                  <span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${crewColorMap[j.crew] || '#6b7280'}22;color:${crewColorMap[j.crew] || '#6b7280'};font-weight:600;">${esc(j.crew)}</span>
                </div>
                <div style="font-size:12px;color:var(--m,#9ca3af);line-height:1.6;">
                  ${j.address ? `📍 ${esc(j.address)}<br>` : ''}
                  🔧 ${esc(j.jobType)}${j.jobValue > 0 ? ` · $${j.jobValue.toLocaleString()}` : ''}
                </div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                  ${j.phone ? `<a href="tel:${j.phone}" style="font-size:11px;padding:4px 12px;border-radius:6px;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:600;">📞 Call</a>` : ''}
                  <button onclick="document.getElementById('calDayOverlay').remove();if(typeof openCustomerDetail==='function') openCustomerDetail('${j.id}');"
                    style="font-size:11px;padding:4px 12px;border-radius:6px;background:var(--s2,rgba(255,255,255,.06));color:var(--h,#fff);border:1px solid var(--br,rgba(255,255,255,.1));cursor:pointer;font-weight:600;">View Lead</button>
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  // Navigation
  function prevMonth() { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); }
  function nextMonth() { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(); }
  function goToToday() { currentMonth = new Date().getMonth(); currentYear = new Date().getFullYear(); renderCalendar(); }

  function fmtN(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString();
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  window.CrewCalendar = {
    render: renderCalendar,
    showDay: showDayDetail,
    prev: prevMonth,
    next: nextMonth,
    today: goToToday
  };

})();
