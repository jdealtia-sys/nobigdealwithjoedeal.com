// ═══════════════════════════════════════════════════════════════════════
// DAILY COMMAND CENTER — Dashboard KPI Widget + Floor Score + Habits
// Replaces standalone Daily Success page with embedded dashboard widget
// Firebase-synced, collapsible, auto-resets at midnight
// ═══════════════════════════════════════════════════════════════════════
(function() {
'use strict';

const DT_VERSION = '1.0';
const DT_LOCAL_KEY = 'nbd_daily_tracker';
const DT_CONFIG_KEY = 'nbd_daily_config';

// ── Default KPIs ──────────────────────────────────────────────────────
const DEFAULT_KPIS = [
  { key: 'doors',    label: 'Doors Knocked',   icon: '🚪', target: 60,   color: '#C8541A' },
  { key: 'contacts', label: 'Contacts Made',   icon: '🤝', target: 20,   color: '#3b82f6' },
  { key: 'appts',    label: 'Appts Set',       icon: '📋', target: 5,    color: '#8b5cf6' },
  { key: 'closes',   label: 'Closes',          icon: '🏆', target: 1,    color: '#10b981' },
  { key: 'revenue',  label: 'Revenue',         icon: '💰', target: 1000, color: '#f59e0b', isCurrency: true }
];

// ── Default Floors (daily non-negotiables) ────────────────────────────
const DEFAULT_FLOORS = [
  { id: 'f1', label: 'Hit door goal',        category: 'sales' },
  { id: 'f2', label: 'Set at least 1 appt',  category: 'sales' },
  { id: 'f3', label: 'Completed workout',     category: 'fitness' },
  { id: 'f4', label: 'Hit protein goal',      category: 'nutrition' },
  { id: 'f5', label: 'Journaled / reflected', category: 'mindset' },
  { id: 'f6', label: 'In bed by 10 PM',       category: 'discipline' }
];

// ── Default Habits ────────────────────────────────────────────────────
const DEFAULT_HABITS = [
  { id: 'h1', label: 'Morning routine done',  icon: '☀️' },
  { id: 'h2', label: 'Drank 3L water',        icon: '💧' },
  { id: 'h3', label: 'No phone first 15 min', icon: '📵' },
  { id: 'h4', label: 'Read / learned 30 min', icon: '📖' },
  { id: 'h5', label: 'Supplements taken',      icon: '💊' }
];

// ── Motivational Quotes ───────────────────────────────────────────────
const QUOTES = [
  'Every door is a chance. Most people don\'t even knock.',
  'Your competition is sleeping. Are you?',
  'Consistency beats intensity every single time.',
  'The rep you don\'t want to do is the one that makes the difference.',
  'Show up. Do the work. Repeat until it\'s yours.',
  'Champions are made on days like today.',
  'One more door. One more set. One more day.',
  'Small daily improvements compound into staggering results.',
  'The gap between who you are and who you want to be is what you do today.',
  'You don\'t rise to your goals — you fall to your systems.'
];

// ── Helpers ───────────────────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getTodayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function dailyQuote() {
  const day = new Date().getDate();
  return QUOTES[day % QUOTES.length];
}

function getConfig() {
  try { return JSON.parse(localStorage.getItem(DT_CONFIG_KEY)) || {}; } catch { return {}; }
}
function saveConfig(cfg) { localStorage.setItem(DT_CONFIG_KEY, JSON.stringify(cfg)); }

function getTodayData() {
  try {
    const all = JSON.parse(localStorage.getItem(DT_LOCAL_KEY)) || {};
    const key = todayKey();
    if (!all[key]) {
      all[key] = { kpis: {}, floors: {}, habits: {}, notes: '', rating: 0, bestLine: '', territory: '', weather: '' };
      localStorage.setItem(DT_LOCAL_KEY, JSON.stringify(all));
    }
    return all[key];
  } catch { return { kpis: {}, floors: {}, habits: {}, notes: '', rating: 0, bestLine: '' }; }
}

function saveTodayData(data) {
  try {
    const all = JSON.parse(localStorage.getItem(DT_LOCAL_KEY)) || {};
    all[todayKey()] = data;
    localStorage.setItem(DT_LOCAL_KEY, JSON.stringify(all));
  } catch(e) { console.error('DT save error:', e); }
  // Async Firestore sync
  syncToFirestore(data);
}

// ── Firestore Sync ────────────────────────────────────────────────────
let _syncTimeout = null;
async function syncToFirestore(data) {
  clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    try {
      const db = window._db || window.db;
      const user = window._user || (window._auth && window._auth.currentUser);
      if (!db || !user) return;

      const { doc, setDoc, serverTimestamp } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

      await setDoc(doc(db, 'dailyTracker', `${user.uid}_${todayKey()}`), {
        userId: user.uid,
        date: todayKey(),
        ...data,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch(e) { console.error('DT Firestore sync error:', e); }
  }, 1500); // Debounce 1.5s
}

async function loadFromFirestore() {
  try {
    const db = window._db || window.db;
    const user = window._user || (window._auth && window._auth.currentUser);
    if (!db || !user) return null;

    const { doc, getDoc } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const snap = await getDoc(doc(db, 'dailyTracker', `${user.uid}_${todayKey()}`));
    if (snap.exists()) return snap.data();
  } catch(e) { console.error('DT Firestore load error:', e); }
  return null;
}

// ── KPI Config ────────────────────────────────────────────────────────
function getKPIs() {
  const cfg = getConfig();
  return cfg.kpis || DEFAULT_KPIS;
}

function getFloors() {
  const cfg = getConfig();
  return cfg.floors || DEFAULT_FLOORS;
}

function getHabits() {
  const cfg = getConfig();
  return cfg.habits || DEFAULT_HABITS;
}

// ═══════════════════════════════════════════════════════════════════════
// RENDER — Main Widget
// ═══════════════════════════════════════════════════════════════════════
function renderDailyTracker() {
  const container = document.getElementById('dailyCommandCenter');
  if (!container) return;

  const data = getTodayData();
  const kpis = getKPIs();
  const floors = getFloors();
  const habits = getHabits();
  const cfg = getConfig();
  const collapsed = cfg.collapsed || false;

  // Calculate floor score
  const floorsHit = floors.filter(f => data.floors[f.id]).length;
  const floorPct = floors.length ? Math.round(floorsHit / floors.length * 100) : 0;
  const allFloorsCleared = floors.length > 0 && floorsHit === floors.length;

  // Calculate habit count
  const habitsHit = habits.filter(h => data.habits[h.id]).length;

  // Score label
  const scoreLabel = allFloorsCleared ? 'PERFECT DAY' : floorPct >= 67 ? 'SOLID' : floorPct >= 34 ? 'GRINDING' : 'START PUSHING';
  const scoreColor = allFloorsCleared ? '#10b981' : floorPct >= 67 ? '#f59e0b' : '#C8541A';

  container.innerHTML = `
    <!-- Header Bar -->
    <div class="dt-header" onclick="window._dailyTracker.toggleCollapse()">
      <div class="dt-header-left">
        <div class="dt-title">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg>
          Daily Command Center
        </div>
        <div class="dt-date">${getTodayLabel()} · "${dailyQuote().substring(0, 50)}…"</div>
      </div>
      <div class="dt-header-right">
        <div class="dt-floor-pill" style="background:${scoreColor}20;color:${scoreColor};border:1px solid ${scoreColor}40;">
          ${allFloorsCleared ? '🏆' : '⬡'} ${floorPct}% · ${scoreLabel}
        </div>
        <div class="dt-habit-pill">${habitsHit}/${habits.length} habits</div>
        <div class="dt-chevron ${collapsed ? '' : 'open'}">${collapsed ? '▸' : '▾'}</div>
      </div>
    </div>

    ${collapsed ? '' : `
    <!-- KPI Counters -->
    <div class="dt-body">
      <div class="dt-kpi-strip">
        ${kpis.map(k => {
          const val = data.kpis[k.key] || 0;
          const pct = k.target ? Math.min(val / k.target * 100, 100) : 0;
          const hit = k.target && val >= k.target;
          return `
            <div class="dt-kpi ${hit ? 'hit' : ''}" style="--kpi-color:${k.color}">
              <div class="dt-kpi-label">${k.icon} ${k.label}</div>
              <div class="dt-kpi-controls">
                <button class="dt-kpi-btn" onclick="event.stopPropagation();window._dailyTracker.adj('${k.key}',-1)">−</button>
                ${k.isCurrency
                  ? `<input type="number" class="dt-kpi-val dt-kpi-input" value="${val || ''}" placeholder="0"
                      onclick="event.stopPropagation()"
                      onchange="window._dailyTracker.setKPI('${k.key}', parseFloat(this.value)||0)">`
                  : `<span class="dt-kpi-val ${hit ? 'hit' : ''}">${val}</span>`
                }
                <button class="dt-kpi-btn" onclick="event.stopPropagation();window._dailyTracker.adj('${k.key}',1)">+</button>
              </div>
              <div class="dt-kpi-bar"><div class="dt-kpi-bar-fill" style="width:${pct}%;background:${k.color}"></div></div>
              ${k.target ? `<div class="dt-kpi-target">${hit ? '✓ Hit!' : val + ' / ' + (k.isCurrency ? '$' : '') + k.target}</div>` : ''}
            </div>`;
        }).join('')}
      </div>

      <!-- Floor Score + Habits Row -->
      <div class="dt-bottom-row">
        <!-- Floors -->
        <div class="dt-floors">
          <div class="dt-section-label">Daily Floors — Non-Negotiables</div>
          <div class="dt-floor-grid">
            ${floors.map(f => {
              const met = data.floors[f.id];
              return `
                <div class="dt-floor-item ${met ? 'met' : ''}" onclick="window._dailyTracker.toggleFloor('${f.id}')">
                  <div class="dt-floor-check">${met ? '✓' : ''}</div>
                  <span>${f.label}</span>
                </div>`;
            }).join('')}
          </div>
          ${allFloorsCleared ? '<div class="dt-egg-earned">🥇 ALL FLOORS CLEARED — Golden Goose Earned</div>' : ''}
        </div>

        <!-- Habits -->
        <div class="dt-habits">
          <div class="dt-section-label">Daily Habits</div>
          <div class="dt-habit-grid">
            ${habits.map(h => {
              const done = data.habits[h.id];
              return `
                <div class="dt-habit-item ${done ? 'done' : ''}" onclick="window._dailyTracker.toggleHabit('${h.id}')">
                  <span class="dt-habit-icon">${h.icon}</span>
                  <span class="dt-habit-text">${h.label}</span>
                  <div class="dt-habit-check">${done ? '✓' : ''}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Quick Notes Row -->
      <div class="dt-notes-row">
        <div class="dt-note-field">
          <label>Territory</label>
          <input type="text" value="${(data.territory||'').replace(/"/g,'&quot;')}" placeholder="Street, subdivision…"
            onchange="window._dailyTracker.setField('territory', this.value)">
        </div>
        <div class="dt-note-field">
          <label>Best Line / Close</label>
          <input type="text" value="${(data.bestLine||'').replace(/"/g,'&quot;')}" placeholder="Write it while it's fresh…"
            onchange="window._dailyTracker.setField('bestLine', this.value)">
        </div>
        <div class="dt-note-field" style="flex:0 0 100px;">
          <label>Day Rating</label>
          <div class="dt-rating">
            ${[1,2,3,4,5,6,7,8,9,10].map(n =>
              `<span class="dt-rating-dot ${(data.rating||0) >= n ? 'active' : ''}"
                    onclick="window._dailyTracker.setField('rating',${n})"
                    title="${n}/10">${n <= (data.rating||0) ? '●' : '○'}</span>`
            ).join('')}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="dt-footer">
        <a href="/pro/daily-success/" target="_blank" style="font-size:10px;color:var(--m);text-decoration:none;opacity:.7;">Full Daily Program ↗</a>
        <button class="dt-config-btn" onclick="window._dailyTracker.openConfig()">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><circle cx="10" cy="10" r="2"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41"/></svg>
          Customize
        </button>
      </div>
    </div>
    `}
  `;
}

// ═══════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════
function adjustKPI(key, delta) {
  const data = getTodayData();
  data.kpis[key] = Math.max(0, (data.kpis[key] || 0) + delta);
  saveTodayData(data);
  renderDailyTracker();
}

function setKPI(key, val) {
  const data = getTodayData();
  data.kpis[key] = val;
  saveTodayData(data);
  renderDailyTracker();
}

function toggleFloor(id) {
  const data = getTodayData();
  data.floors[id] = !data.floors[id];
  saveTodayData(data);
  renderDailyTracker();
  // Auto-check related KPI floors
  autoLinkKPIFloors(data);
}

function toggleHabit(id) {
  const data = getTodayData();
  data.habits[id] = !data.habits[id];
  saveTodayData(data);
  renderDailyTracker();
}

function setField(field, value) {
  const data = getTodayData();
  data[field] = value;
  saveTodayData(data);
  renderDailyTracker();
}

function toggleCollapse() {
  const cfg = getConfig();
  cfg.collapsed = !cfg.collapsed;
  saveConfig(cfg);
  renderDailyTracker();
}

// Auto-link: if door KPI hits target, auto-check "Hit door goal" floor
function autoLinkKPIFloors(data) {
  const kpis = getKPIs();
  const floors = getFloors();
  let changed = false;

  // doors → "Hit door goal"
  const doorKPI = kpis.find(k => k.key === 'doors');
  const doorFloor = floors.find(f => f.label.toLowerCase().includes('door'));
  if (doorKPI && doorFloor && (data.kpis.doors || 0) >= doorKPI.target && !data.floors[doorFloor.id]) {
    data.floors[doorFloor.id] = true; changed = true;
  }

  // appts → "Set at least 1 appt"
  const apptFloor = floors.find(f => f.label.toLowerCase().includes('appt'));
  if (apptFloor && (data.kpis.appts || 0) >= 1 && !data.floors[apptFloor.id]) {
    data.floors[apptFloor.id] = true; changed = true;
  }

  if (changed) { saveTodayData(data); renderDailyTracker(); }
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIG MODAL — Customize KPIs, Floors, Habits
// ═══════════════════════════════════════════════════════════════════════
function openConfig() {
  const cfg = getConfig();
  const kpis = cfg.kpis || DEFAULT_KPIS;
  const floors = cfg.floors || DEFAULT_FLOORS;
  const habits = cfg.habits || DEFAULT_HABITS;

  const modal = document.createElement('div');
  modal.id = 'dtConfigModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:700px;width:95%;max-height:85vh;overflow-y:auto;padding:30px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h2 style="margin:0;font-size:22px;color:var(--t);">⚙️ Daily Command Center Settings</h2>
        <button onclick="document.getElementById('dtConfigModal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--m);">✕</button>
      </div>

      <!-- KPI Targets -->
      <div style="margin-bottom:24px;">
        <h3 style="font-size:14px;color:var(--t);margin:0 0 12px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.08em;">KPI Targets</h3>
        <div style="display:grid;gap:8px;">
          ${kpis.map((k,i) => `
            <div style="display:grid;grid-template-columns:1fr 80px;gap:8px;align-items:center;">
              <input type="text" value="${k.label}" id="dtcfg-kpi-${i}-label" style="padding:8px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;">
              <input type="number" value="${k.target||''}" id="dtcfg-kpi-${i}-target" placeholder="Target" style="padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;text-align:center;">
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Floors -->
      <div style="margin-bottom:24px;">
        <h3 style="font-size:14px;color:var(--t);margin:0 0 12px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.08em;">Daily Floors (Non-Negotiables)</h3>
        <div id="dtcfg-floors" style="display:grid;gap:8px;">
          ${floors.map((f,i) => `
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="text" value="${f.label}" id="dtcfg-floor-${i}" style="flex:1;padding:8px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;">
              <button onclick="this.parentElement.remove()" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;">✕</button>
            </div>
          `).join('')}
        </div>
        <button onclick="window._dailyTracker._addFloorInput()" style="margin-top:8px;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;color:var(--m);">+ Add Floor</button>
      </div>

      <!-- Habits -->
      <div style="margin-bottom:24px;">
        <h3 style="font-size:14px;color:var(--t);margin:0 0 12px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.08em;">Daily Habits</h3>
        <div id="dtcfg-habits" style="display:grid;gap:8px;">
          ${habits.map((h,i) => `
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="text" value="${h.icon}" id="dtcfg-habit-${i}-icon" style="width:40px;padding:8px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:16px;text-align:center;">
              <input type="text" value="${h.label}" id="dtcfg-habit-${i}-label" style="flex:1;padding:8px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;">
              <button onclick="this.parentElement.remove()" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;">✕</button>
            </div>
          `).join('')}
        </div>
        <button onclick="window._dailyTracker._addHabitInput()" style="margin-top:8px;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;color:var(--m);">+ Add Habit</button>
      </div>

      <!-- Save -->
      <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:16px;border-top:1px solid var(--br);">
        <button onclick="document.getElementById('dtConfigModal').remove()" style="padding:10px 20px;background:var(--s2);border:1px solid var(--br);border-radius:6px;cursor:pointer;color:var(--m);font-size:13px;">Cancel</button>
        <button onclick="window._dailyTracker._saveConfig()" style="padding:10px 24px;background:#C8541A;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Save Settings</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function _addFloorInput() {
  const container = document.getElementById('dtcfg-floors');
  if (!container) return;
  const idx = container.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;';
  div.innerHTML = `
    <input type="text" value="" id="dtcfg-floor-${idx}" placeholder="New floor…" style="flex:1;padding:8px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;">
    <button onclick="this.parentElement.remove()" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;">✕</button>
  `;
  container.appendChild(div);
}

function _addHabitInput() {
  const container = document.getElementById('dtcfg-habits');
  if (!container) return;
  const idx = container.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;';
  div.innerHTML = `
    <input type="text" value="✨" id="dtcfg-habit-${idx}-icon" style="width:40px;padding:8px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:16px;text-align:center;">
    <input type="text" value="" id="dtcfg-habit-${idx}-label" placeholder="New habit…" style="flex:1;padding:8px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;">
    <button onclick="this.parentElement.remove()" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;">✕</button>
  `;
  container.appendChild(div);
}

function _saveConfig() {
  const cfg = getConfig();
  const kpis = getKPIs();

  // Save KPI targets
  cfg.kpis = kpis.map((k, i) => {
    const labelEl = document.getElementById(`dtcfg-kpi-${i}-label`);
    const targetEl = document.getElementById(`dtcfg-kpi-${i}-target`);
    return {
      ...k,
      label: labelEl ? labelEl.value : k.label,
      target: targetEl ? (parseFloat(targetEl.value) || null) : k.target
    };
  });

  // Save floors
  const floorContainer = document.getElementById('dtcfg-floors');
  if (floorContainer) {
    cfg.floors = Array.from(floorContainer.children).map((row, i) => {
      const input = row.querySelector('input[type="text"]');
      return { id: 'f' + (i + 1), label: input ? input.value.trim() : '', category: 'custom' };
    }).filter(f => f.label);
  }

  // Save habits
  const habitContainer = document.getElementById('dtcfg-habits');
  if (habitContainer) {
    cfg.habits = Array.from(habitContainer.children).map((row, i) => {
      const inputs = row.querySelectorAll('input[type="text"]');
      const icon = inputs[0] ? inputs[0].value.trim() : '✨';
      const label = inputs[1] ? inputs[1].value.trim() : '';
      return { id: 'h' + (i + 1), label, icon };
    }).filter(h => h.label);
  }

  saveConfig(cfg);
  const modal = document.getElementById('dtConfigModal');
  if (modal) modal.remove();
  renderDailyTracker();
  if (typeof showToast === 'function') showToast('Daily Command Center settings saved ✓');
}

// ═══════════════════════════════════════════════════════════════════════
// HISTORY — Last 7 days mini-chart (for settings tab)
// ═══════════════════════════════════════════════════════════════════════
function getWeekHistory() {
  try {
    const all = JSON.parse(localStorage.getItem(DT_LOCAL_KEY)) || {};
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const dayData = all[key] || { kpis: {}, floors: {}, habits: {} };
      const floors = getFloors();
      const floorsHit = floors.filter(f => dayData.floors[f.id]).length;
      days.push({
        date: d.toLocaleDateString('en-US', { weekday: 'short' }),
        floorPct: floors.length ? Math.round(floorsHit / floors.length * 100) : 0,
        doors: dayData.kpis.doors || 0,
        contacts: dayData.kpis.contacts || 0,
        appts: dayData.kpis.appts || 0,
        closes: dayData.kpis.closes || 0,
        revenue: dayData.kpis.revenue || 0
      });
    }
    return days;
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// INIT — Boot on page load, sync with Firestore
// ═══════════════════════════════════════════════════════════════════════
async function init() {
  // Try to load from Firestore first (merge with local)
  const remote = await loadFromFirestore();
  if (remote) {
    const local = getTodayData();
    // Merge: remote wins for KPI values if higher, local wins for newer toggles
    const merged = { ...local };
    if (remote.kpis) {
      Object.keys(remote.kpis).forEach(k => {
        if ((remote.kpis[k] || 0) > (merged.kpis[k] || 0)) {
          merged.kpis[k] = remote.kpis[k];
        }
      });
    }
    if (remote.floors) {
      Object.keys(remote.floors).forEach(k => {
        if (remote.floors[k]) merged.floors[k] = true;
      });
    }
    if (remote.habits) {
      Object.keys(remote.habits).forEach(k => {
        if (remote.habits[k]) merged.habits[k] = true;
      });
    }
    if (remote.rating && remote.rating > (merged.rating || 0)) merged.rating = remote.rating;
    if (remote.bestLine && !merged.bestLine) merged.bestLine = remote.bestLine;
    if (remote.territory && !merged.territory) merged.territory = remote.territory;
    saveTodayData(merged);
  }

  renderDailyTracker();
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════
window._dailyTracker = {
  render: renderDailyTracker,
  init: init,
  adj: adjustKPI,
  setKPI: setKPI,
  toggleFloor: toggleFloor,
  toggleHabit: toggleHabit,
  setField: setField,
  toggleCollapse: toggleCollapse,
  openConfig: openConfig,
  getWeekHistory: getWeekHistory,
  _addFloorInput: _addFloorInput,
  _addHabitInput: _addHabitInput,
  _saveConfig: _saveConfig
};

// Auto-init when auth is ready
(function waitForAuth() {
  const user = window._user || (window._auth && window._auth.currentUser);
  if (user && document.getElementById('dailyCommandCenter')) {
    init();
  } else {
    setTimeout(waitForAuth, 500);
  }
})();

})();
