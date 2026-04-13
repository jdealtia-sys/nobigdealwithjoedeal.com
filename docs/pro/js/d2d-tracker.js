(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS & DISPOSITIONS
  // ============================================================================
  const DISPOSITIONS = {
    not_home:       { label: 'Not Home',                color: '#6B7280', icon: '🏠', short: 'NH',   autoFollowUp: 1 },
    not_interested: { label: 'Not Interested',          color: '#E05252', icon: '✋', short: 'NI',   autoFollowUp: null },
    interested:     { label: 'Interested',              color: '#EAB308', icon: '👍', short: 'INT',  autoFollowUp: 3 },
    appointment:    { label: 'Appointment Set',         color: '#2ECC8A', icon: '📅', short: 'APT',  autoFollowUp: null },
    come_back:      { label: 'Come Back Later',         color: '#4A9EFF', icon: '🔄', short: 'CBL',  autoFollowUp: null },
    storm_damage:   { label: 'Storm Damage Noted',      color: '#e8720c', icon: '⛈️', short: 'DMG', autoFollowUp: 1 },
    ins_has_claim:  { label: 'Insurance - Has Claim',   color: '#9B6DFF', icon: '📋', short: 'CLM',  autoFollowUp: 2 },
    ins_needs_file: { label: 'Insurance - Needs Filing', color: '#D946EF', icon: '📝', short: 'FIL', autoFollowUp: 1 },
    ins_denied:     { label: 'Insurance - Denied',      color: '#78350F', icon: '❌', short: 'DEN',  autoFollowUp: 3 },
    do_not_knock:   { label: 'Do Not Knock',            color: '#1F2937', icon: '🚫', short: 'DNK',  autoFollowUp: null },
    cold_dead:      { label: 'Cold / Dead Lead',        color: '#374151', icon: '💀', short: 'DEAD', autoFollowUp: null },
    // ── New dispositions (April 2026) ──
    left_material:  { label: 'Left Material',           color: '#0EA5E9', icon: '📬', short: 'MAT',  autoFollowUp: 3 },
    callback:       { label: 'Callback Requested',      color: '#14B8A6', icon: '📞', short: 'CBR',  autoFollowUp: 1 },
    tenant:         { label: 'Tenant (Not Owner)',       color: '#94A3B8', icon: '🔑', short: 'TNT',  autoFollowUp: null },
    vacant:         { label: 'Vacant Property',          color: '#475569', icon: '🏚️', short: 'VAC', autoFollowUp: 7 }
  };

  const DISPO_ORDER = [
    'appointment','interested','storm_damage','come_back','callback',
    'left_material','ins_has_claim','ins_needs_file','ins_denied',
    'not_home','tenant','vacant','not_interested','do_not_knock','cold_dead'
  ];

  const INS_DISPOSITIONS = ['ins_has_claim','ins_needs_file','ins_denied'];

  const CARRIERS = [
    'State Farm','Allstate','Progressive','USAA','Liberty Mutual','Nationwide',
    'Farmers','Travelers','American Family','Erie Insurance','Cincinnati Insurance',
    'Auto-Owners','Safeco','Westfield','Grange','Other'
  ];

  const MAX_ATTEMPTS = 5;
  const CINCINNATI = [39.10, -84.51];
  const GOOGLE_SAT_TILES = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
  const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1';
  const WEATHER_KEY_STORE = 'nbd_weather_key';
  const SYNC_QUEUE_KEY = 'nbd_d2d_sync_queue';
  const PAGE_SIZE = 200;

  // SMS templates
  const SMS_TEMPLATES = {
    interested: { label: 'Thanks for Chatting', body: 'Hey {name}! This is {rep} from NBD Home Solutions. Great chatting today — I\'d love to take a closer look at your roof. Let me know a good time!' },
    appointment: { label: 'Appointment Confirmation', body: 'Hi {name}! {rep} from NBD confirming our upcoming roof inspection. Looking forward to it!' },
    storm_damage: { label: 'Storm Damage Alert', body: 'Hi {name}, {rep} from NBD. I noticed some storm damage on your roof today. I offer free inspections — would you like me to come take a closer look?' },
    ins_has_claim: { label: 'Insurance Help', body: 'Hi {name}, {rep} from NBD. I can help guide you through your insurance claim process. Want to set up a time to chat?' },
    follow_up: { label: 'General Follow-up', body: 'Hi {name}! {rep} from NBD checking in. We chatted recently about your roof — any updates on your end? Happy to answer any questions.' },
    not_home: { label: 'Missed You', body: 'Hi {name}, {rep} from NBD Home Solutions. I stopped by {address} today but missed you. I noticed a few things on your roof I\'d love to discuss. When works best for a quick chat?' }
  };

  // Gamification challenges
  const DAILY_CHALLENGES = [
    { id: 'knock_30', label: 'Knock 30 Doors', target: 30, metric: 'today', icon: '🚪' },
    { id: 'appt_3', label: 'Set 3 Appointments', target: 3, metric: 'appointments_today', icon: '📅' },
    { id: 'ins_5', label: 'Log 5 Insurance Leads', target: 5, metric: 'insurance_today', icon: '📋' },
    { id: 'conv_3', label: 'Get 3 Conversations', target: 3, metric: 'conversations_today', icon: '💬' },
    { id: 'photo_5', label: 'Take 5 Roof Photos', target: 5, metric: 'photos_today', icon: '📷' }
  ];

  const STREAK_MILESTONES = [
    { days: 3, label: 'Getting Started', badge: '🔥' },
    { days: 7, label: 'One Week Warrior', badge: '⚡' },
    { days: 14, label: 'Two Week Titan', badge: '💪' },
    { days: 30, label: 'Monthly Master', badge: '🏆' },
    { days: 60, label: 'Relentless', badge: '👑' },
    { days: 100, label: 'Century Club', badge: '💎' }
  ];

  // ============================================================================
  // STATE
  // ============================================================================
  let knocks = [];
  let d2dMap = null;
  let d2dCluster = null;
  let d2dHeat = null;
  let d2dInited = false;
  let locationMarker = null;
  let accuracyCircle = null;
  let watchId = null;
  let currentLocation = null;
  let currentKnockEntry = null;
  let filterDispo = null;
  let filterDateRange = 'today';
  let showHeat = false;
  let currentRep = null;
  let teamMode = false;
  let teamKnocks = [];
  let territories = [];
  let walkingRoute = null;
  let walkingRouteLine = null;
  let streetSequences = {};
  let weatherData = null;
  let neighborhoodScores = {};
  let offlineQueue = [];
  let isOnline = navigator.onLine;
  let autocompleteTimeout = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceBlob = null;
  let currentTab = 'feed'; // 'feed' | 'routes' | 'gamify' | 'analytics'

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  function esc(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function timeAgo(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : (d.toDate ? d.toDate() : new Date(d));
    const now = new Date();
    const sec = Math.floor((now - date) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    return formatDate(date);
  }

  function formatTime(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : (d.toDate ? d.toDate() : new Date(d));
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function formatDate(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : (d.toDate ? d.toDate() : new Date(d));
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toDate(d) {
    if (!d) return null;
    if (d instanceof Date) return d;
    if (d.toDate) return d.toDate();
    return new Date(d);
  }

  function isToday(d) {
    const date = toDate(d);
    if (!date) return false;
    return date.toDateString() === new Date().toDateString();
  }

  function isThisWeek(d) {
    const date = toDate(d);
    if (!date) return false;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return date >= weekAgo && date <= now;
  }

  function isThisMonth(d) {
    const date = toDate(d);
    if (!date) return false;
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }

  function normalizeAddress(addr) {
    return (addr || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function getAttemptCount(address) {
    const norm = normalizeAddress(address);
    return knocks.filter(k => normalizeAddress(k.address) === norm).length;
  }

  function getAddressHistory(address) {
    const norm = normalizeAddress(address);
    return knocks
      .filter(k => normalizeAddress(k.address) === norm)
      .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  }

  function parseHouseNumber(address) {
    const m = (address || '').match(/^(\d+)\s/);
    return m ? parseInt(m[1]) : 0;
  }

  function parseStreetName(address) {
    return (address || '').replace(/^\d+\s+/, '').split(',')[0].trim().toLowerCase();
  }

  // ============================================================================
  // OFFLINE SYNC QUEUE
  // ============================================================================
  function loadOfflineQueue() {
    try {
      offlineQueue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    } catch(e) { offlineQueue = []; }
  }

  function saveOfflineQueue() {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(offlineQueue));
  }

  function enqueueOffline(action, data) {
    offlineQueue.push({ action, data, timestamp: Date.now() });
    saveOfflineQueue();
    window.showToast?.('Saved offline — will sync when connected', 'warning');
  }

  async function flushOfflineQueue() {
    if (offlineQueue.length === 0) return;
    const queue = [...offlineQueue];
    offlineQueue = [];
    saveOfflineQueue();

    let synced = 0;
    for (const item of queue) {
      try {
        if (item.action === 'submitKnock') {
          await submitKnock(item.data, true);
          synced++;
        } else if (item.action === 'updateKnock') {
          await updateKnock(item.data.id, item.data.fields);
          synced++;
        } else if (item.action === 'deleteKnock') {
          await deleteKnock(item.data.id);
          synced++;
        }
      } catch(e) {
        offlineQueue.push(item);
      }
    }
    saveOfflineQueue();
    if (synced > 0) window.showToast?.(`Synced ${synced} offline knock${synced !== 1 ? 's' : ''}`, 'success');
  }

  window.addEventListener('online', () => {
    isOnline = true;
    renderD2D();
    flushOfflineQueue();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    renderD2D();
  });

  // Register background sync for offline knocks (if SW supports it)
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => {
      window.addEventListener('online', () => {
        reg.sync.register('nbd-d2d-sync').catch(() => {});
      });
    });
  }

  // Listen for SW flush message
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') {
        flushOfflineQueue();
      }
    });
  }

  // ============================================================================
  // REVERSE GEOCODING & ADDRESS AUTOCOMPLETE
  // ============================================================================
  async function reverseGeocode(lat, lng) {
    try {
      const resp = await fetch(`${NOMINATIM_REVERSE}&lat=${lat}&lon=${lng}`);
      const data = await resp.json();
      if (data.address) {
        const num = data.address.house_number || '';
        const road = data.address.road || '';
        const city = data.address.city || data.address.town || data.address.village || '';
        const st = data.address.state || '';
        return `${num} ${road}${city ? ', ' + city : ''}${st ? ', ' + st : ''}`.trim();
      }
    } catch (e) { console.warn('Geocode failed:', e); }
    return '';
  }

  async function searchAddresses(query) {
    if (!query || query.length < 3) return [];
    try {
      const resp = await fetch(NOMINATIM_SEARCH + encodeURIComponent(query));
      return await resp.json();
    } catch(e) { return []; }
  }

  function setupAddressAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    let dropdown = document.getElementById(inputId + '-ac');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = inputId + '-ac';
      dropdown.className = 'd2d-ac-dropdown';
      dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--s);border:1px solid var(--br);border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,.15);';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(dropdown);
    }

    input.addEventListener('input', () => {
      clearTimeout(autocompleteTimeout);
      autocompleteTimeout = setTimeout(async () => {
        const val = input.value.trim();
        if (val.length < 3) { dropdown.style.display = 'none'; return; }

        // Search local knocks first
        const localMatches = knocks
          .filter(k => k.address && normalizeAddress(k.address).includes(normalizeAddress(val)))
          .slice(0, 3)
          .map(k => ({ display_name: k.address, lat: k.lat, lon: k.lng, local: true }));

        // Then Nominatim
        const remoteMatches = await searchAddresses(val);
        const allMatches = [...localMatches, ...remoteMatches.slice(0, 5 - localMatches.length)];

        if (allMatches.length === 0) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = allMatches.map((r, i) => {
          const label = r.local ? '📍 ' + esc(r.display_name) : esc(r.display_name);
          return `<div class="d2d-ac-item" data-idx="${i}" style="padding:8px 12px;cursor:pointer;font-size:12px;color:var(--t);border-bottom:1px solid var(--br);transition:background .1s;" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background='var(--s)'">${label}</div>`;
        }).join('');
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.d2d-ac-item').forEach((el, i) => {
          el.onclick = () => {
            const match = allMatches[i];
            input.value = match.display_name?.split(',').slice(0, 3).join(',').trim() || match.display_name;
            if (currentKnockEntry) {
              currentKnockEntry.lat = parseFloat(match.lat) || null;
              currentKnockEntry.lng = parseFloat(match.lon) || null;
            }
            dropdown.style.display = 'none';
          };
        });
      }, 350);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.style.display = 'none'; }, 200);
    });
  }

  // ============================================================================
  // WEATHER INTEGRATION
  // ============================================================================
  async function loadWeather() {
    const key = localStorage.getItem(WEATHER_KEY_STORE);
    if (!key) return;
    const loc = currentLocation || CINCINNATI;
    try {
      const resp = await fetch(`https://api.openweathermap.org/data/2.5/onecall?lat=${loc[0]}&lon=${loc[1]}&exclude=minutely,hourly&appid=${key}&units=imperial`);
      if (resp.ok) {
        weatherData = await resp.json();
      }
    } catch(e) { console.warn('Weather load failed:', e); }
  }

  function getWeatherAlerts() {
    if (!weatherData) return [];
    const alerts = [];
    if (weatherData.alerts) {
      weatherData.alerts.forEach(a => {
        if (/hail|wind|storm|tornado|thunder/i.test(a.event)) {
          alerts.push({ event: a.event, description: a.description?.substring(0, 200), start: new Date(a.start * 1000), end: new Date(a.end * 1000) });
        }
      });
    }
    // Check recent weather for storm indicators
    const recent = weatherData.daily?.slice(0, 3) || [];
    recent.forEach(day => {
      if (day.wind_speed > 30 || day.weather?.some(w => /storm|hail|thunder/i.test(w.main))) {
        alerts.push({ event: 'Recent Storm Activity', description: `Wind: ${Math.round(day.wind_speed)}mph — ${day.weather?.[0]?.description || ''}`, start: new Date(day.dt * 1000) });
      }
    });
    return alerts;
  }

  // ============================================================================
  // NEIGHBORHOOD SCORING
  // ============================================================================
  function calculateNeighborhoodScores() {
    // Group knocks by approximate neighborhood (0.005 degree grid ~500m)
    const grid = {};
    knocks.forEach(k => {
      if (!k.lat || !k.lng) return;
      const key = `${(Math.round(k.lat / 0.005) * 0.005).toFixed(3)},${(Math.round(k.lng / 0.005) * 0.005).toFixed(3)}`;
      if (!grid[key]) grid[key] = { lat: k.lat, lng: k.lng, knocks: [], appointments: 0, stormDmg: 0, conversations: 0 };
      grid[key].knocks.push(k);
      if (k.disposition === 'appointment') grid[key].appointments++;
      if (k.disposition === 'storm_damage') grid[key].stormDmg++;
      if (!['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition)) grid[key].conversations++;
    });

    const scores = {};
    Object.keys(grid).forEach(key => {
      const g = grid[key];
      const totalKnocks = g.knocks.length;
      const convRate = totalKnocks > 0 ? g.conversations / totalKnocks : 0;
      const apptRate = totalKnocks > 0 ? g.appointments / totalKnocks : 0;
      const stormFactor = g.stormDmg > 0 ? 20 : 0;
      const densityFactor = Math.min(totalKnocks / 20, 1) * 15;
      const convFactor = convRate * 40;
      const apptFactor = apptRate * 25;
      const score = Math.min(Math.round(densityFactor + convFactor + apptFactor + stormFactor), 100);
      scores[key] = { ...g, score };
    });
    neighborhoodScores = scores;
    return scores;
  }

  // ============================================================================
  // STREET SEQUENCING
  // ============================================================================
  function buildStreetSequences() {
    const streets = {};
    knocks.forEach(k => {
      if (!k.address) return;
      const street = parseStreetName(k.address);
      if (!street || street.length < 3) return;
      if (!streets[street]) streets[street] = [];
      const num = parseHouseNumber(k.address);
      const existing = streets[street].find(d => d.address === k.address);
      if (!existing) {
        streets[street].push({ address: k.address, houseNum: num, lat: k.lat, lng: k.lng, knocked: true, disposition: k.disposition, knockId: k.id });
      }
    });

    // Sort each street by house number
    Object.keys(streets).forEach(st => {
      streets[st].sort((a, b) => a.houseNum - b.houseNum);
      // Fill in gaps (even numbers on one side, odd on the other)
      const nums = streets[st].map(d => d.houseNum).filter(n => n > 0);
      if (nums.length >= 2) {
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const step = nums.every(n => n % 2 === 0) || nums.every(n => n % 2 === 1) ? 2 : 2;
        for (let n = min; n <= max; n += step) {
          if (!streets[st].find(d => d.houseNum === n)) {
            streets[st].push({ address: `${n} ${st}`, houseNum: n, lat: null, lng: null, knocked: false, disposition: null, knockId: null });
          }
        }
        streets[st].sort((a, b) => a.houseNum - b.houseNum);
      }
    });

    streetSequences = streets;
    return streets;
  }

  // ============================================================================
  // WALKING ROUTE OPTIMIZATION (nearest-neighbor)
  // ============================================================================
  function calculateWalkingRoute() {
    const unvisited = [];
    const addrSet = new Set(knocks.map(k => normalizeAddress(k.address)));

    // Get latest knock per address for pins
    const addrMap = new Map();
    knocks.forEach(k => {
      if (!k.lat || !k.lng) return;
      const norm = normalizeAddress(k.address);
      if (!addrMap.has(norm) || k.createdAt > addrMap.get(norm).createdAt) {
        addrMap.set(norm, k);
      }
    });

    // Filter to "not home" / "come back" that haven't been fully resolved
    addrMap.forEach(k => {
      if (['not_home', 'come_back'].includes(k.disposition) && getAttemptCount(k.address) < MAX_ATTEMPTS) {
        unvisited.push({ lat: k.lat, lng: k.lng, address: k.address, disposition: k.disposition });
      }
    });

    if (unvisited.length < 2) {
      walkingRoute = unvisited;
      return unvisited;
    }

    // Nearest-neighbor from current location or first point
    const start = currentLocation ? { lat: currentLocation[0], lng: currentLocation[1] } : unvisited[0];
    const route = [];
    const remaining = [...unvisited];
    let current = start;

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      remaining.forEach((p, i) => {
        const dist = Math.sqrt(Math.pow(p.lat - current.lat, 2) + Math.pow(p.lng - current.lng, 2));
        if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
      });
      const next = remaining.splice(nearestIdx, 1)[0];
      route.push(next);
      current = next;
    }

    walkingRoute = route;
    return route;
  }

  function drawWalkingRoute() {
    if (walkingRouteLine && d2dMap) d2dMap.removeLayer(walkingRouteLine);
    if (!walkingRoute || walkingRoute.length < 2 || !d2dMap) return;

    const coords = walkingRoute.map(p => [p.lat, p.lng]);
    if (currentLocation) coords.unshift(currentLocation);

    walkingRouteLine = L.polyline(coords, {
      color: '#4A9EFF',
      weight: 3,
      opacity: 0.7,
      dashArray: '10, 8',
      className: 'd2d-route-line'
    }).addTo(d2dMap);

    // Number markers
    walkingRoute.forEach((p, i) => {
      const numIcon = L.divIcon({
        html: `<div style="background:#4A9EFF;color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;">${i + 1}</div>`,
        iconSize: [20, 20],
        className: ''
      });
      L.marker([p.lat, p.lng], { icon: numIcon }).addTo(d2dMap).bindPopup(`<b>Stop ${i + 1}</b><br>${esc(p.address)}`);
    });
  }

  function clearWalkingRoute() {
    if (walkingRouteLine && d2dMap) d2dMap.removeLayer(walkingRouteLine);
    walkingRouteLine = null;
    walkingRoute = null;
  }

  // ============================================================================
  // FIRESTORE CRUD
  // ============================================================================
  async function loadRepProfile() {
    try {
      const docSnap = await window.getDoc(window.doc(window._db, 'reps', window._user.uid));
      if (docSnap.exists()) {
        currentRep = docSnap.data();
      } else {
        const initials = (window._user.displayName || 'R').split(' ').map(n => n[0]).join('').toUpperCase();
        const {setDoc} = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(window.doc(window._db, 'reps', window._user.uid), {
          userId: window._user.uid,
          name: window._user.displayName || 'Rep',
          initials: initials,
          role: 'rep',
          companyId: 'default',
          createdAt: window.serverTimestamp()
        });
        currentRep = { userId: window._user.uid, name: window._user.displayName || 'Rep', initials, role: 'rep', companyId: 'default' };
      }
    } catch (e) {
      console.error('loadRepProfile failed:', e);
      currentRep = { userId: window._user.uid, name: window._user.displayName || 'Rep', companyId: 'default' };
    }
  }

  async function loadKnocks() {
    try {
      let q;
      if (teamMode && currentRep?.role === 'manager') {
        q = window.query(window.collection(window._db, 'knocks'), window.where('companyId', '==', currentRep.companyId));
      } else {
        q = window.query(window.collection(window._db, 'knocks'), window.where('userId', '==', window._user.uid));
      }
      const snap = await window.getDocs(q);
      knocks = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: toDate(data.createdAt) || new Date(0),
          updatedAt: toDate(data.updatedAt) || new Date(0),
          followUpDate: toDate(data.followUpDate) || null
        };
      }).sort((a, b) => b.createdAt - a.createdAt);

      // Rebuild derived data
      buildStreetSequences();
      calculateNeighborhoodScores();
      updateNavBadge();
    } catch (e) {
      console.error('loadKnocks failed:', e);
      window.showToast?.('Failed to load knocks', 'error');
    }
  }

  async function submitKnock(data, fromSync) {
    if (!isOnline && !fromSync) {
      enqueueOffline('submitKnock', data);
      return null;
    }

    try {
      const attemptNumber = getAttemptCount(data.address) + 1;
      let disposition = data.disposition;

      if (attemptNumber > MAX_ATTEMPTS && disposition === 'not_home') {
        disposition = 'cold_dead';
        window.showToast?.('5 attempts reached — marked as Cold/Dead', 'warning');
      }

      let followUpDate = null;
      const fupInput = data.followUpDate;
      if (fupInput) {
        followUpDate = new Date(fupInput);
      } else {
        const autoDays = DISPOSITIONS[disposition]?.autoFollowUp;
        if (autoDays) {
          followUpDate = new Date();
          followUpDate.setDate(followUpDate.getDate() + autoDays);
        }
      }

      let stage = 'knock';
      if (disposition === 'appointment') stage = 'appointment';
      else if (INS_DISPOSITIONS.includes(disposition)) stage = 'insurance';

      const knockDoc = {
        userId: window._user.uid,
        repId: window._user.uid,
        companyId: currentRep?.companyId || 'default',
        address: data.address,
        lat: data.lat || null,
        lng: data.lng || null,
        homeowner: data.homeowner || '',
        phone: data.phone || '',
        email: data.email || '',
        disposition: disposition,
        notes: data.notes || '',
        stage: stage,
        attemptNumber: attemptNumber,
        createdAt: window.serverTimestamp(),
        updatedAt: window.serverTimestamp(),
        convertedToLead: false,
        estimateValue: data.estimateValue || 0,
        closedDealValue: data.closedDealValue || 0,
        insCarrier: data.insCarrier || '',
        claimNumber: data.claimNumber || '',
        photoUrls: data.photoUrls || [],
        voiceUrl: data.voiceUrl || '',
        followUpTime: data.followUpTime || ''
      };

      if (followUpDate) knockDoc.followUpDate = followUpDate;

      const ref = await window.addDoc(window.collection(window._db, 'knocks'), knockDoc);
      await loadKnocks();
      renderD2D();
      refreshMapMarkers();
      window.showToast?.(`${DISPOSITIONS[disposition].icon} ${DISPOSITIONS[disposition].label} — ${data.address}`, 'success');

      // ── Auto-convert hot dispositions into CRM leads ──
      // Appointment/Interested/Storm Damage/Insurance dispositions auto-create
      // a CRM lead with pre-filled data + auto-assigned follow-up.
      // This fixes the D2D→CRM gap: D2D is the primary lead source but knocks
      // did not flow into the pipeline automatically.
      if (HOT_DISPOSITIONS.includes(disposition)) {
        // Non-blocking — don't fail the knock if lead creation has issues
        convertToLead(ref.id).catch(err => {
          console.warn('Auto-convert to lead failed:', err);
        });
      }
      return ref.id;
    } catch (e) {
      console.error('submitKnock failed:', e);
      window.showToast?.('Failed to save knock', 'error');
      return null;
    }
  }

  async function updateKnock(id, data) {
    try {
      await window.updateDoc(window.doc(window._db, 'knocks', id), {
        ...data,
        updatedAt: window.serverTimestamp()
      });
      await loadKnocks();
    } catch (e) {
      console.error('updateKnock failed:', e);
      window.showToast?.('Failed to update knock', 'error');
    }
  }

  async function deleteKnock(id) {
    if (!confirm('Delete this knock?')) return;
    if (!isOnline) { enqueueOffline('deleteKnock', { id }); return; }
    try {
      await window.deleteDoc(window.doc(window._db, 'knocks', id));
      closeKnockDetail();
      await loadKnocks();
      renderD2D();
      refreshMapMarkers();
      window.showToast?.('Knock deleted', 'info');
    } catch (e) {
      console.error('deleteKnock failed:', e);
      window.showToast?.('Failed to delete knock', 'error');
    }
  }

  // Dispositions that should auto-offer lead conversion
  const HOT_DISPOSITIONS = ['appointment', 'interested', 'storm_damage', 'ins_has_claim', 'ins_needs_file', 'callback'];

  async function convertToLead(knockId) {
    try {
      const knock = knocks.find(k => k.id === knockId);
      if (!knock || knock.convertedToLead) return;

      const firstName = (knock.homeowner || '').split(' ')[0] || 'D2D';
      const lastName = (knock.homeowner || '').split(' ').slice(1).join(' ') || 'Lead';

      // Map D2D disposition → CRM stage key (snake_case, matches crm-stages.js)
      let stage = 'new';
      if (knock.disposition === 'appointment') stage = 'inspected';
      else if (knock.disposition === 'interested') stage = 'contacted';
      else if (knock.disposition === 'callback') stage = 'contacted';
      else if (knock.disposition === 'left_material') stage = 'contacted';
      else if (INS_DISPOSITIONS.includes(knock.disposition)) stage = 'claim_filed';
      else if (knock.disposition === 'storm_damage') stage = 'contacted';

      // Map D2D disposition → CRM job type
      let jobType = '';
      if (INS_DISPOSITIONS.includes(knock.disposition)) jobType = 'insurance';

      // Map D2D disposition → claim status
      let claimStatus = 'No Claim';
      if (knock.disposition === 'ins_has_claim') claimStatus = 'Has Claim';
      else if (knock.disposition === 'ins_needs_file') claimStatus = 'Needs Filing';
      else if (knock.disposition === 'ins_denied') claimStatus = 'Denied';

      // Auto-assign follow-up date — use the knock's follow-up if set, otherwise
      // smart defaults per disposition (Interested: 2d, Appointment: 1d, Storm: 3d)
      let followUpStr = '';
      if (knock.followUpDate) {
        followUpStr = (typeof knock.followUpDate === 'object' && knock.followUpDate.toISOString
          ? knock.followUpDate.toISOString().split('T')[0]
          : String(knock.followUpDate));
      } else {
        const defaultDays = (
          knock.disposition === 'appointment' ? 1 :
          knock.disposition === 'interested' ? 2 :
          knock.disposition === 'storm_damage' ? 3 :
          INS_DISPOSITIONS.includes(knock.disposition) ? 2 : 0
        );
        if (defaultDays > 0) {
          const d = new Date();
          d.setDate(d.getDate() + defaultDays);
          followUpStr = d.toISOString().split('T')[0];
        }
      }

      // ─── Prospect segregation (April 2026) ───
      // Appointment dispositions become full customers immediately
      // (isProspect: false) because a set meeting is already a
      // qualified customer worth tracking in the kanban.
      // All other hot dispositions (interested, storm_damage, ins_*)
      // become PROSPECTS — they auto-create a lead record for data
      // integrity, but the lead is hidden from the kanban by default
      // until the user explicitly promotes it via the CRM lead detail
      // modal (Promote to Customer button).
      const isAppointment = knock.disposition === 'appointment';
      const leadData = {
        firstName,
        lastName,
        address: knock.address || '',
        phone: knock.phone || '',
        email: knock.email || '',
        stage,
        jobType,
        source: 'Door-to-Door',
        damageType: knock.disposition === 'storm_damage' ? 'Storm Damage' : '',
        insCarrier: knock.insCarrier || '',
        claimNumber: knock.claimNumber || '',
        claimStatus,
        notes: `D2D Knock #${knock.attemptNumber || 1}: ${DISPOSITIONS[knock.disposition]?.label || ''}${knock.notes ? '\n' + knock.notes : ''}`,
        d2dKnockId: knockId,
        lat: knock.lat || null,
        lng: knock.lng || null,
        followUp: followUpStr,
        // Prospect flag: appointments land in the kanban immediately,
        // everything else waits for manual promotion.
        isProspect: !isAppointment
      };

      // Use _saveLead which also creates map pin and geocodes
      if (typeof window._saveLead === 'function') {
        await window._saveLead(leadData);
      } else {
        // Fallback: direct Firestore write
        await window.addDoc(window.collection(window._db, 'leads'), {
          ...leadData,
          userId: window._user.uid,
          createdAt: window.serverTimestamp()
        });
        if (typeof window._loadLeads === 'function') await window._loadLeads();
      }

      await updateKnock(knockId, { convertedToLead: true });
      closeKnockDetail();
      renderD2D();
      window.showToast?.('✅ Converted to CRM Lead — visible in your pipeline', 'success');
    } catch (e) {
      console.error('convertToLead failed:', e);
      window.showToast?.('Failed to convert to lead', 'error');
    }
  }

  // Quick-convert: open lead modal pre-filled from a knock (for manual editing before save)
  function convertToLeadWithEdit(knockId) {
    const knock = knocks.find(k => k.id === knockId);
    if (!knock) return;

    closeKnockDetail();

    // Open the CRM lead modal
    if (typeof openLeadModal === 'function') openLeadModal();
    else if (typeof window.openLeadModal === 'function') window.openLeadModal();
    else { document.getElementById('leadModal')?.classList.add('open'); }

    // Pre-fill fields from knock data
    setTimeout(() => {
      const firstName = (knock.homeowner || '').split(' ')[0] || '';
      const lastName = (knock.homeowner || '').split(' ').slice(1).join(' ') || '';

      const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
      fill('lFname', firstName);
      fill('lLname', lastName);
      fill('lAddr', knock.address);
      fill('lPhone', knock.phone);
      fill('lEmail', knock.email);
      fill('lInsCarrier', knock.insCarrier);
      fill('lClaimNumber', knock.claimNumber);
      fill('lNotes', `D2D Knock: ${DISPOSITIONS[knock.disposition]?.label || ''}${knock.notes ? '\n' + knock.notes : ''}`);

      // Set source to Door-to-Door
      const sourceEl = document.getElementById('lSource');
      if (sourceEl) {
        const opt = Array.from(sourceEl.options).find(o => o.value.toLowerCase().includes('door'));
        if (opt) sourceEl.value = opt.value;
        else sourceEl.value = 'Door-to-Door';
      }

      // Set stage based on disposition
      const stageEl = document.getElementById('lStage');
      if (stageEl) {
        if (knock.disposition === 'appointment') stageEl.value = 'Inspection';
        else if (knock.disposition === 'interested') stageEl.value = 'Contacted';
        else stageEl.value = 'New';
      }

      // Set job type for insurance dispositions
      if (INS_DISPOSITIONS.includes(knock.disposition)) {
        const jtEl = document.getElementById('lJobType');
        if (jtEl) jtEl.value = 'insurance';
      }

      // Mark knock as converted after modal is open (will be finalized on save)
      window._pendingD2DConvertId = knockId;
    }, 150);
  }

  async function loadTeamKnocks() {
    if (!teamMode || !currentRep) return;
    try {
      const q = window.query(window.collection(window._db, 'knocks'), window.where('companyId', '==', currentRep.companyId));
      const snap = await window.getDocs(q);
      teamKnocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('loadTeamKnocks failed:', e); }
  }

  async function loadTerritories() {
    try {
      const q = window.query(window.collection(window._db, 'territories'), window.where('companyId', '==', currentRep?.companyId || 'default'));
      const snap = await window.getDocs(q);
      territories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('loadTerritories failed:', e); }
  }

  async function saveTerritory(data) {
    try {
      const territoryData = { ...data, companyId: currentRep?.companyId || 'default', userId: window._user.uid, updatedAt: window.serverTimestamp() };
      if (data.id) {
        await window.updateDoc(window.doc(window._db, 'territories', data.id), territoryData);
      } else {
        await window.addDoc(window.collection(window._db, 'territories'), { ...territoryData, createdAt: window.serverTimestamp() });
      }
      await loadTerritories();
    } catch (e) { console.error('saveTerritory failed:', e); }
  }

  // ============================================================================
  // NAV BADGE (follow-ups due)
  // ============================================================================
  function updateNavBadge() {
    const followUpsDue = knocks.filter(k => {
      const fup = toDate(k.followUpDate);
      return fup && fup <= new Date() && !k.convertedToLead;
    });
    const navEl = document.getElementById('nav-d2d');
    if (!navEl) return;
    let badge = navEl.querySelector('.d2d-badge');
    if (followUpsDue.length > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'd2d-badge';
        badge.style.cssText = 'position:absolute;top:4px;right:4px;background:var(--red, #E05252);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;min-width:16px;text-align:center;';
        navEl.style.position = 'relative';
        navEl.appendChild(badge);
      }
      badge.textContent = followUpsDue.length;
    } else if (badge) {
      badge.remove();
    }
  }

  // ============================================================================
  // FILTERING
  // ============================================================================
  function applyFilters() {
    let filtered = knocks;
    if (filterDateRange === 'today') filtered = filtered.filter(k => isToday(k.createdAt));
    else if (filterDateRange === 'week') filtered = filtered.filter(k => isThisWeek(k.createdAt));
    else if (filterDateRange === 'month') filtered = filtered.filter(k => isThisMonth(k.createdAt));
    if (filterDispo) filtered = filtered.filter(k => k.disposition === filterDispo);
    return filtered;
  }

  function setDateFilter(range) { filterDateRange = range; renderD2D(); }
  function setDispoFilter(val) { filterDispo = val || null; renderD2D(); }

  // ============================================================================
  // METRICS
  // ============================================================================
  function getMetrics() {
    const today = knocks.filter(k => isToday(k.createdAt));
    const week = knocks.filter(k => isThisWeek(k.createdAt));
    const month = knocks.filter(k => isThisMonth(k.createdAt));
    const uniqueAddrs = new Set(knocks.map(k => normalizeAddress(k.address)));
    const appointments = knocks.filter(k => k.disposition === 'appointment');
    const appointmentsToday = today.filter(k => k.disposition === 'appointment');
    const insuranceToday = today.filter(k => INS_DISPOSITIONS.includes(k.disposition));
    const conversations = knocks.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition));
    const conversationsToday = today.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition));

    let streak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    let found = true;
    while (found) {
      const dayStr = checkDate.toDateString();
      found = knocks.some(k => {
        const kd = toDate(k.createdAt) || new Date(0);
        return kd.toDateString() === dayStr;
      });
      if (found) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    }

    const followUpsDue = knocks.filter(k => {
      const fup = toDate(k.followUpDate);
      return fup && fup <= new Date() && !k.convertedToLead;
    });

    return {
      today: today.length,
      week: week.length,
      month: month.length,
      all: knocks.length,
      uniqueAddrs: uniqueAddrs.size,
      appointments: appointments.length,
      appointments_today: appointmentsToday.length,
      insurance_today: insuranceToday.length,
      conversations_today: conversationsToday.length,
      photos_today: today.filter(k => k.photoUrls?.length > 0).length,
      interested: knocks.filter(k => k.disposition === 'interested').length,
      stormDmg: knocks.filter(k => k.disposition === 'storm_damage').length,
      conversations: conversations.length,
      conversionRate: week.length > 0 ? Math.round(appointments.length / week.length * 100) : 0,
      knocksPerAppt: appointments.length > 0 ? Math.round(week.length / appointments.length) : '—',
      followUpsDue,
      streak
    };
  }

  function getRevenueMetrics() {
    const doorsKnocked = new Set(knocks.map(k => normalizeAddress(k.address))).size;
    const conversations = knocks.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition)).length;
    const appointments = knocks.filter(k => k.disposition === 'appointment').length;
    const estimates = knocks.filter(k => k.estimateValue > 0).length;
    const closed = knocks.filter(k => k.closedDealValue > 0).length;
    const revenue = knocks.reduce((sum, k) => sum + (k.closedDealValue || 0), 0);

    return {
      totalDoorsKnocked: doorsKnocked,
      totalConversations: conversations,
      totalAppointments: appointments,
      totalEstimates: estimates,
      totalClosed: closed,
      totalRevenue: revenue,
      revenuePerDoor: doorsKnocked > 0 ? Math.round(revenue / doorsKnocked) : 0,
      avgDealSize: closed > 0 ? Math.round(revenue / closed) : 0,
      conversionFunnel: { doors: doorsKnocked, conversations, appointments, estimates, closed }
    };
  }

  function getDispositionBreakdown() {
    const filtered = applyFilters();
    const breakdown = {};
    DISPO_ORDER.forEach(key => { breakdown[key] = 0; });
    filtered.forEach(k => { if (breakdown.hasOwnProperty(k.disposition)) breakdown[k.disposition]++; });
    return breakdown;
  }

  function getTimeOfDayStats() {
    const hourCounts = new Array(24).fill(0);
    const hourConversions = new Array(24).fill(0);
    const dayHour = {};
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    knocks.forEach(k => {
      const kdate = toDate(k.createdAt) || new Date(0);
      const hr = kdate.getHours();
      const day = kdate.getDay();
      hourCounts[hr]++;
      const key = `${day}-${hr}`;
      if (!dayHour[key]) dayHour[key] = { total: 0, conversions: 0 };
      dayHour[key].total++;
      if (['appointment', 'interested', 'storm_damage'].includes(k.disposition)) {
        hourConversions[hr]++;
        dayHour[key].conversions++;
      }
    });

    let bestStart = 0, bestCount = 0;
    for (let i = 8; i <= 19; i++) {
      const windowCount = (hourConversions[i] || 0) + (hourConversions[i + 1] || 0) + (hourConversions[i + 2] || 0);
      if (windowCount > bestCount) { bestCount = windowCount; bestStart = i; }
    }
    return { hourCounts, hourConversions, dayHour, days, bestWindow: { start: bestStart, end: bestStart + 3, conversions: bestCount } };
  }

  function getInsuranceMetrics() {
    const insKnocks = knocks.filter(k => INS_DISPOSITIONS.includes(k.disposition));
    const carrierMap = {};
    insKnocks.forEach(k => {
      const carrier = k.insCarrier || 'Unknown';
      if (!carrierMap[carrier]) carrierMap[carrier] = { total: 0, hasClaim: 0, needsFiling: 0, denied: 0 };
      carrierMap[carrier].total++;
      if (k.disposition === 'ins_has_claim') carrierMap[carrier].hasClaim++;
      if (k.disposition === 'ins_needs_file') carrierMap[carrier].needsFiling++;
      if (k.disposition === 'ins_denied') carrierMap[carrier].denied++;
    });
    return { total: insKnocks.length, carriers: carrierMap };
  }

  // ============================================================================
  // GAMIFICATION
  // ============================================================================
  function getGamificationData() {
    const metrics = getMetrics();
    const revenue = getRevenueMetrics();

    // Daily challenges
    const challenges = DAILY_CHALLENGES.map(ch => {
      let current = 0;
      if (ch.metric === 'today') current = metrics.today;
      else if (ch.metric === 'appointments_today') current = metrics.appointments_today;
      else if (ch.metric === 'insurance_today') current = metrics.insurance_today;
      else if (ch.metric === 'conversations_today') current = metrics.conversations_today;
      else if (ch.metric === 'photos_today') current = metrics.photos_today;
      return { ...ch, current, pct: Math.min(Math.round(current / ch.target * 100), 100), complete: current >= ch.target };
    });

    // Streak milestone
    const currentMilestone = STREAK_MILESTONES.filter(m => metrics.streak >= m.days).pop();
    const nextMilestone = STREAK_MILESTONES.find(m => metrics.streak < m.days);

    // Commission projection (based on avg deal size and conversion rate)
    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
    const avgKnocksPerDay = metrics.month > 0 ? metrics.month / new Date().getDate() : metrics.today || 0;
    const projectedKnocks = metrics.month + (avgKnocksPerDay * daysLeft);
    const projectedAppts = metrics.conversionRate > 0 ? Math.round(projectedKnocks * metrics.conversionRate / 100) : 0;
    const projectedRevenue = projectedAppts * (revenue.avgDealSize || 8500);

    return {
      challenges,
      streak: metrics.streak,
      currentMilestone,
      nextMilestone,
      projectedKnocks: Math.round(projectedKnocks),
      projectedAppts,
      projectedRevenue,
      completedChallenges: challenges.filter(c => c.complete).length,
      totalChallenges: challenges.length
    };
  }

  // ============================================================================
  // MAP INITIALIZATION
  // ============================================================================
  function initD2DMap() {
    const mapEl = document.getElementById('d2dMap');
    if (!mapEl) return;

    if (d2dMap) { d2dMap.invalidateSize(); return; }

    // Leaflet 1.9+ fixed the iOS standalone ghost-click bug, so we
    // no longer need to disable the tap handler. Re-enabled for full
    // touch interactivity in both browser and PWA modes.
    const isStandalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    d2dMap = L.map('d2dMap', {
      tap: true,                    // re-enabled — Leaflet 1.9 fixed iOS tap bug
      bounceAtZoomLimits: false     // smoother UX on iOS
    }).setView(CINCINNATI, 13);

    L.tileLayer(GOOGLE_SAT_TILES, { subdomains: '0123', attribution: '© Google', maxNativeZoom: 22, maxZoom: 23 }).addTo(d2dMap);

    // Force map to recalculate size after standalone viewport settles
    if (isStandalone) {
      setTimeout(() => { if (d2dMap) d2dMap.invalidateSize(); }, 500);
      setTimeout(() => { if (d2dMap) d2dMap.invalidateSize(); }, 1500);
    }

    d2dCluster = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 17 });
    d2dMap.addLayer(d2dCluster);

    d2dMap.on('click', function(e) {
      openQuickKnock({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    watchLocationAndCenter();
    refreshMapMarkers();
    createLayerPanel();
  }

  function watchLocationAndCenter() {
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      function(pos) {
        currentLocation = [pos.coords.latitude, pos.coords.longitude];
        if (locationMarker) d2dMap.removeLayer(locationMarker);
        if (accuracyCircle) d2dMap.removeLayer(accuracyCircle);

        accuracyCircle = L.circle(currentLocation, { radius: pos.coords.accuracy, color: '#4A9EFF', fillColor: '#4A9EFF', fillOpacity: 0.1, weight: 1 }).addTo(d2dMap);
        locationMarker = L.circleMarker(currentLocation, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#4A9EFF', fillOpacity: 1, className: 'd2d-location-pulse' }).addTo(d2dMap);
      },
      function(err) { console.warn('Geolocation error:', err); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function centerOnMe() {
    if (currentLocation && d2dMap) {
      d2dMap.setView(currentLocation, 16);
      window.showToast?.('Centered on your location', 'info');
    }
  }

  function refreshMapMarkers() {
    if (!d2dMap || !d2dCluster) return;
    d2dCluster.clearLayers();
    if (d2dHeat) d2dMap.removeLayer(d2dHeat);

    const addrMap = new Map();
    knocks.forEach(k => {
      const norm = normalizeAddress(k.address);
      if (!addrMap.has(norm) || k.createdAt > addrMap.get(norm).createdAt) {
        addrMap.set(norm, k);
      }
    });

    const heatData = [];
    addrMap.forEach(knock => {
      if (!knock.lat || !knock.lng) return;
      const dispo = DISPOSITIONS[knock.disposition];
      const attempts = getAttemptCount(knock.address);
      const label = document.createElement('div');
      label.style.cssText = `background:${dispo?.color || '#666'};width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;border:2px solid white;`;
      label.textContent = dispo?.short || '?';

      const icon = L.divIcon({ html: label.outerHTML, iconSize: [30, 30], className: '' });

      // Build popup with data-attributes + touchend listeners instead of inline onclick
      // (iOS Safari standalone swallows inline onclick in Leaflet popups)
      const popupDiv = document.createElement('div');
      popupDiv.style.cssText = 'font-size:12px;';
      popupDiv.innerHTML = `<strong>${esc(knock.address)}</strong><br/>${dispo?.icon} ${dispo?.label}<br/>Knock #${attempts}/${MAX_ATTEMPTS}<br/><small>${timeAgo(knock.createdAt)}</small><br/>`;

      const detailBtn = document.createElement('button');
      detailBtn.textContent = 'Details';
      detailBtn.style.cssText = 'margin-top:8px;padding:4px 8px;background:var(--blue, #4A9EFF);color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
      detailBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.D2D.openKnockDetail(knock.id); });
      detailBtn.addEventListener('touchend', function(ev) { ev.stopPropagation(); ev.preventDefault(); window.D2D.openKnockDetail(knock.id); });

      const reknockBtn = document.createElement('button');
      reknockBtn.textContent = 'Re-Knock';
      reknockBtn.style.cssText = 'margin-top:8px;margin-left:4px;padding:4px 8px;background:var(--orange, #e8720c);color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
      reknockBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.D2D.openQuickKnock({address:knock.address, lat:knock.lat, lng:knock.lng}); });
      reknockBtn.addEventListener('touchend', function(ev) { ev.stopPropagation(); ev.preventDefault(); window.D2D.openQuickKnock({address:knock.address, lat:knock.lat, lng:knock.lng}); });

      popupDiv.appendChild(detailBtn);
      popupDiv.appendChild(reknockBtn);

      const marker = L.marker([knock.lat, knock.lng], { icon }).bindPopup(popupDiv);
      d2dCluster.addLayer(marker);
      heatData.push([knock.lat, knock.lng, 0.5]);
    });

    if (showHeat && heatData.length > 0) {
      d2dHeat = L.heatLayer(heatData, { radius: 30, blur: 20, maxZoom: 17 }).addTo(d2dMap);
    }

    // Draw neighborhood score overlay
    if (Object.keys(neighborhoodScores).length > 0) {
      Object.values(neighborhoodScores).forEach(n => {
        if (n.score > 30 && n.knocks.length >= 3) {
          const scoreColor = n.score >= 70 ? '#2ECC8A' : n.score >= 40 ? '#EAB308' : '#E05252';
          L.circle([n.lat, n.lng], { radius: 250, color: scoreColor, fillColor: scoreColor, fillOpacity: 0.08, weight: 1 }).addTo(d2dMap).bindPopup(`<b>Neighborhood Score: ${n.score}/100</b><br>${n.knocks.length} knocks · ${n.appointments} apts · ${n.stormDmg} storm dmg`);
        }
      });
    }
  }

  function toggleHeatMap() {
    showHeat = !showHeat;
    refreshMapMarkers();
    window.showToast?.(showHeat ? 'Heat map enabled' : 'Heat map disabled', 'info');
    updateLayerPanel();
  }

  // ════════════════════════════════════════════════════════════
  // FLOATING LAYER TOGGLE PANEL (April 2026)
  //
  // A small panel that floats over the D2D map. Each toggle
  // controls a visual layer: Knocks, Jobs, Weather, Heatmap.
  // This replaces the separate Maps & Pins view — all map
  // features are now consolidated into D2D.
  //
  // Layers:
  //   Knocks  — the default knock markers (disposition circles)
  //   Jobs    — active CRM leads with $ value labels (green/blue)
  //   Weather — NOAA NEXRAD radar overlay
  //   Heat    — knock density heatmap
  // ════════════════════════════════════════════════════════════
  let d2dLayerState = { knocks: true, jobs: false, weather: false, heat: false, territory: false };
  let d2dJobMarkers = [];
  let d2dStormLayer = null;
  let d2dWeatherLayer = null;
  let d2dDrawControl = null;
  let d2dTerritoryGroup = null;  // L.featureGroup holding drawn polygons

  function createLayerPanel() {
    if (!d2dMap) return;
    // Don't re-create if it already exists
    if (document.getElementById('d2d-layer-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'd2d-layer-panel';
    panel.style.cssText = 'position:absolute;top:10px;right:10px;z-index:1000;'
      + 'background:rgba(10,12,15,.92);border:1px solid rgba(232,114,12,.3);'
      + 'border-radius:10px;padding:8px;display:flex;gap:4px;'
      + '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);'
      + 'box-shadow:0 4px 20px rgba(0,0,0,.5);';

    const layers = [
      { key: 'knocks',    icon: '📍', label: 'Knocks' },
      { key: 'jobs',      icon: '💰', label: 'Jobs' },
      { key: 'weather',   icon: '⛈️', label: 'Radar' },
      { key: 'heat',      icon: '🔥', label: 'Heat' },
      { key: 'territory', icon: '🗺️', label: 'Zone' }
    ];

    layers.forEach(ly => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'd2d-layer-' + ly.key;
      btn.title = ly.label;
      btn.style.cssText = 'background:' + (d2dLayerState[ly.key] ? 'rgba(232,114,12,.2)' : 'transparent') + ';'
        + 'border:1px solid ' + (d2dLayerState[ly.key] ? '#e8720c' : 'rgba(255,255,255,.12)') + ';'
        + 'color:' + (d2dLayerState[ly.key] ? '#fff' : '#8b8e96') + ';'
        + 'padding:6px 10px;border-radius:6px;cursor:pointer;'
        + "font-family:'Barlow Condensed',sans-serif;font-size:11px;"
        + 'font-weight:700;letter-spacing:.04em;display:flex;align-items:center;'
        + 'gap:4px;transition:all .15s;-webkit-tap-highlight-color:transparent;'
        + 'min-height:36px;';
      btn.innerHTML = ly.icon + ' ' + ly.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLayer(ly.key);
      });
      panel.appendChild(btn);
    });

    // Append to the map container (not the map tiles) so it floats above
    const mapEl = document.getElementById('d2dMap');
    if (mapEl) {
      mapEl.style.position = 'relative';
      mapEl.appendChild(panel);
    }
  }

  function updateLayerPanel() {
    Object.keys(d2dLayerState).forEach(key => {
      const btn = document.getElementById('d2d-layer-' + key);
      if (!btn) return;
      const on = d2dLayerState[key];
      btn.style.background = on ? 'rgba(232,114,12,.2)' : 'transparent';
      btn.style.borderColor = on ? '#e8720c' : 'rgba(255,255,255,.12)';
      btn.style.color = on ? '#fff' : '#8b8e96';
    });
  }

  function toggleLayer(key) {
    d2dLayerState[key] = !d2dLayerState[key];
    switch (key) {
      case 'knocks':
        if (d2dLayerState.knocks) {
          d2dMap.addLayer(d2dCluster);
        } else {
          d2dMap.removeLayer(d2dCluster);
        }
        break;
      case 'jobs':
        if (d2dLayerState.jobs) {
          buildD2DJobsLayer();
        } else {
          d2dJobMarkers.forEach(m => d2dMap.removeLayer(m));
        }
        break;
      case 'weather':
        if (d2dLayerState.weather) {
          showD2DWeatherLayer();
        } else {
          if (d2dStormLayer) d2dMap.removeLayer(d2dStormLayer);
          if (d2dWeatherLayer) d2dMap.removeLayer(d2dWeatherLayer);
        }
        break;
      case 'heat':
        showHeat = d2dLayerState.heat;
        refreshMapMarkers();
        break;
      case 'territory':
        if (d2dLayerState.territory) {
          showTerritoryDrawing();
        } else {
          hideTerritoryDrawing();
        }
        break;
    }
    updateLayerPanel();
    window.showToast?.((d2dLayerState[key] ? 'Showing ' : 'Hiding ') + key, 'info');
  }

  // ── Jobs layer (ported from maps.js) ──
  // Shows active CRM leads as markers with $ value labels.
  // Uses lead lat/lng directly if available (from D2D knock
  // auto-convert or manual entry), falling back to Nominatim
  // geocoding for leads that only have an address string.
  async function buildD2DJobsLayer() {
    if (!d2dMap) return;
    d2dJobMarkers.forEach(m => d2dMap.removeLayer(m));
    d2dJobMarkers = [];

    const leads = window._leads || [];
    const JOB_STAGES = new Set([
      'contract_signed', 'job_created', 'permit_pulled', 'materials_ordered',
      'materials_delivered', 'crew_scheduled', 'install_in_progress',
      'install_complete', 'final_photos', 'deductible_collected',
      'final_payment', 'closed', 'In Progress', 'Complete', 'Finalizing'
    ]);
    const active = leads.filter(l => {
      const sk = l._stageKey || l.stage || '';
      return JOB_STAGES.has(sk);
    });

    for (const lead of active) {
      let lat = Number(lead.lat);
      let lng = Number(lead.lng);
      // If no coords, try Nominatim geocoding (rate-limited)
      if (!lat || !lng) {
        const addr = lead.address || '';
        if (!addr) continue;
        try {
          const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(addr) + '&limit=1',
            { headers: { 'User-Agent': 'NBDPro/1.0' } });
          const data = await res.json();
          if (data && data[0]) { lat = parseFloat(data[0].lat); lng = parseFloat(data[0].lon); }
          await new Promise(r => setTimeout(r, 200)); // rate limit
        } catch (e) { continue; }
      }
      if (!lat || !lng) continue;

      const val = parseFloat(lead.jobValue || lead.contractValue || lead.value || 0);
      const label = val > 0 ? '$' + val.toLocaleString() : (lead.stage || 'Job');
      const stageLower = (lead._stageKey || lead.stage || '').toLowerCase();
      const color = stageLower.includes('complete') || stageLower === 'closed' ? '#34D399'
        : stageLower.includes('install') ? '#4A9EFF' : '#EAB308';
      const name = esc([lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.address || 'Lead');

      const icon = L.divIcon({
        html: '<div style="background:' + color + ';color:#0A0C0F;font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:800;padding:3px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.2);">\ud83d\udcb0 ' + label + '</div>',
        iconAnchor: [0, 0], className: ''
      });
      const marker = L.marker([lat, lng], { icon })
        .bindPopup('<div style="font-family:sans-serif;min-width:160px;">'
          + '<b style="font-size:13px;color:' + color + ';">' + name + '</b>'
          + '<p style="font-size:11px;color:#666;margin:4px 0;">' + esc(lead.address || '') + '</p>'
          + '<p style="font-size:11px;margin:2px 0;"><b>Stage:</b> ' + esc(lead.stage || '') + '</p>'
          + (val > 0 ? '<p style="font-size:12px;font-weight:700;color:' + color + ';">$' + val.toLocaleString() + '</p>' : '')
          + '</div>');
      d2dJobMarkers.push(marker);
      marker.addTo(d2dMap);
    }
    if (d2dJobMarkers.length === 0) {
      window.showToast?.('No active jobs with locations to display', 'info');
    }
  }

  // ── Weather layer (ported from maps.js) ──
  // NOAA NEXRAD radar composite + RainViewer precipitation
  function showD2DWeatherLayer() {
    if (!d2dMap) return;
    if (!d2dStormLayer) {
      d2dStormLayer = L.tileLayer(
        'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
        { opacity: 0.6, attribution: 'NOAA/IEM', maxZoom: 20, tms: false }
      );
    }
    d2dStormLayer.addTo(d2dMap);
    // RainViewer layer
    if (!d2dWeatherLayer) {
      const now = Math.floor(Date.now() / 600000) * 600;
      d2dWeatherLayer = L.tileLayer(
        'https://tilecache.rainviewer.com/v2/radar/' + now + '/256/{z}/{x}/{y}/2/1_1.png',
        { opacity: 0.45, attribution: 'RainViewer', maxZoom: 20 }
      );
    }
    d2dWeatherLayer.addTo(d2dMap);
    window.showToast?.('Storm radar + precipitation loaded', 'info');
  }

  // ── Territory drawing (Leaflet.Draw) ──
  // Lets the user draw polygons on the map to define "zones" (territories).
  // Saved polygons persist to the Firestore 'territories' collection via
  // the existing saveTerritory() function that was already in the codebase.
  // Drawn polygons are orange-outlined so they're visually distinct from
  // knock markers and job overlays.
  function showTerritoryDrawing() {
    if (!d2dMap) return;
    if (typeof L.Draw === 'undefined') {
      window.showToast?.('Drawing library not loaded — refresh and try again', 'error');
      return;
    }

    // Create the feature group that holds drawn shapes
    if (!d2dTerritoryGroup) {
      d2dTerritoryGroup = new L.FeatureGroup();
      d2dMap.addLayer(d2dTerritoryGroup);
    }

    // Load existing territories from Firestore and render them
    renderSavedTerritories();

    // Add the Leaflet.Draw control if not already present
    if (!d2dDrawControl) {
      d2dDrawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
          polygon: {
            allowIntersection: false,
            shapeOptions: {
              color: '#e8720c',
              weight: 3,
              fillColor: '#e8720c',
              fillOpacity: 0.08
            }
          },
          rectangle: {
            shapeOptions: {
              color: '#e8720c',
              weight: 3,
              fillColor: '#e8720c',
              fillOpacity: 0.08
            }
          },
          // Disable non-polygon shapes — territories are areas
          polyline: false,
          circle: false,
          circlemarker: false,
          marker: false
        },
        edit: {
          featureGroup: d2dTerritoryGroup,
          remove: true
        }
      });
      d2dMap.addControl(d2dDrawControl);

      // Listen for new shapes drawn
      d2dMap.on(L.Draw.Event.CREATED, async function (e) {
        const layer = e.layer;
        d2dTerritoryGroup.addLayer(layer);

        // Prompt for a name
        const name = window.prompt('Name this territory zone:', 'Zone ' + (territories.length + 1));
        if (!name) {
          d2dTerritoryGroup.removeLayer(layer);
          return;
        }

        // Extract GeoJSON coordinates for Firestore storage
        const geoJSON = layer.toGeoJSON();
        await saveTerritory({
          name: name.trim().substring(0, 80),
          type: e.layerType,
          geoJSON: geoJSON,
          bounds: layer.getBounds ? {
            north: layer.getBounds().getNorth(),
            south: layer.getBounds().getSouth(),
            east: layer.getBounds().getEast(),
            west: layer.getBounds().getWest()
          } : null
        });
        window.showToast?.('✓ Territory "' + name + '" saved', 'success');

        // Add label to the polygon
        addTerritoryLabel(layer, name);
      });

      // Listen for deleted shapes
      d2dMap.on(L.Draw.Event.DELETED, function (e) {
        // For now, removing from the map only — Firestore deletion
        // would need matching the layer to its territory ID. We can
        // add that when territory management becomes a full feature.
        window.showToast?.('Territory removed from map', 'info');
      });
    }

    window.showToast?.('Draw a polygon to define your territory zone', 'info');
  }

  function hideTerritoryDrawing() {
    if (d2dDrawControl && d2dMap) {
      d2dMap.removeControl(d2dDrawControl);
      d2dDrawControl = null;
    }
    if (d2dTerritoryGroup && d2dMap) {
      d2dMap.removeLayer(d2dTerritoryGroup);
      d2dTerritoryGroup = null;
    }
  }

  // Render previously saved territories from Firestore
  async function renderSavedTerritories() {
    if (!d2dMap || !d2dTerritoryGroup) return;
    // Load if not already loaded
    if (territories.length === 0) await loadTerritories();

    territories.forEach(t => {
      if (!t.geoJSON) return;
      try {
        const layer = L.geoJSON(t.geoJSON, {
          style: {
            color: '#e8720c',
            weight: 2,
            fillColor: '#e8720c',
            fillOpacity: 0.06,
            dashArray: '6,4'
          }
        });
        layer.addTo(d2dTerritoryGroup);
        // Add a label tooltip with the territory name
        layer.eachLayer(function (l) {
          if (l.getBounds) {
            addTerritoryLabel(l, t.name || 'Zone');
          }
        });
      } catch (e) {
        console.warn('Failed to render territory:', t.name, e.message);
      }
    });
  }

  // Add a text label at the center of a territory polygon
  function addTerritoryLabel(layer, name) {
    if (!layer.getBounds) return;
    const center = layer.getBounds().getCenter();
    const label = L.divIcon({
      html: '<div style="background:rgba(232,114,12,.85);color:#fff;font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;letter-spacing:.04em;text-transform:uppercase;">' + esc(name) + '</div>',
      className: '',
      iconAnchor: [0, 0]
    });
    L.marker(center, { icon: label, interactive: false }).addTo(d2dTerritoryGroup);
  }

  // ============================================================================
  // PHOTO CAPTURE + FIREBASE STORAGE
  // ============================================================================
  function capturePhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    // Accept iPhone HEIC + modern formats. 'image/*' alone drops HEIC
    // on desktop Chrome; explicit extensions fix that.
    input.accept = 'image/*,.heic,.heif,.avif';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      if (!currentKnockEntry.photoFiles) currentKnockEntry.photoFiles = [];
      currentKnockEntry.photoFiles.push(...files);

      const preview = document.getElementById('d2d-photo-preview');
      if (preview) {
        preview.innerHTML = '';
        currentKnockEntry.photoFiles.forEach((f, i) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            preview.innerHTML += `<img src="${ev.target.result}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:2px solid var(--green);margin:2px;">`;
          };
          reader.readAsDataURL(f);
        });
      }
      window.showToast?.(`${files.length} photo${files.length > 1 ? 's' : ''} attached`, 'success');
    };
    input.click();
  }

  async function uploadPhotos(files, knockId) {
    if (!files || !files.length) return [];
    const urls = [];
    // Storage rules only permit photos under `photos/{uid}/...`.
    // Route door-knock photos through `photos/{uid}/d2d/{knockId}/...`
    // so they inherit the existing photos rule instead of hitting
    // the default-deny that d2d_photos/{uid}/... falls under.
    const { ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
    const uid = window._user && window._user.uid;
    if (!uid) {
      console.error('d2d photo upload: not signed in');
      return [];
    }
    for (const file of files) {
      try {
        const safeName = String(file.name || 'knock').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 120);
        const storageRef = ref(window._storage, `photos/${uid}/d2d/${knockId}/${Date.now()}_${safeName}`);
        await window.uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        urls.push(url);
      } catch(e) { console.error('Photo upload failed:', e); }
    }
    return urls;
  }

  // ============================================================================
  // VOICE MEMO RECORDING
  // ============================================================================
  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceRecorder = new MediaRecorder(stream);
      voiceChunks = [];
      voiceRecorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunks.push(e.data); };
      voiceRecorder.onstop = () => {
        voiceBlob = new Blob(voiceChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        const btn = document.getElementById('d2d-voice-btn');
        if (btn) {
          btn.innerHTML = '🎙️ Recorded';
          btn.style.background = 'var(--green, #2ECC8A)';
        }
        const playback = document.getElementById('d2d-voice-playback');
        if (playback) {
          playback.innerHTML = `<audio controls src="${URL.createObjectURL(voiceBlob)}" style="height:32px;width:100%;margin-top:4px;"></audio>`;
        }
        window.showToast?.('Voice memo recorded', 'success');
      };
      voiceRecorder.start();
      setTimeout(() => { if (voiceRecorder?.state === 'recording') stopVoiceRecording(); }, 30000);

      const btn = document.getElementById('d2d-voice-btn');
      if (btn) {
        btn.innerHTML = '⏹️ Recording...';
        btn.style.background = 'var(--red, #E05252)';
        btn.onclick = stopVoiceRecording;
      }
    } catch(e) {
      console.error('Voice recording failed:', e);
      window.showToast?.('Microphone access denied', 'error');
    }
  }

  function stopVoiceRecording() {
    if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
  }

  async function uploadVoiceMemo(blob, knockId) {
    if (!blob) return '';
    try {
      const { ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
      const storageRef = ref(window._storage, `d2d_voice/${window._user.uid}/${knockId}_${Date.now()}.webm`);
      await window.uploadBytes(storageRef, blob);
      return await getDownloadURL(storageRef);
    } catch(e) { console.error('Voice upload failed:', e); return ''; }
  }

  // ============================================================================
  // SMS / EMAIL TEMPLATES
  // ============================================================================
  function sendFollowUpSMS(knock, templateKey) {
    const phone = knock.phone;
    if (!phone) { window.showToast?.('No phone number for this contact', 'error'); return; }
    const repName = currentRep?.name || window._user?.displayName || 'your local roofer';
    const tmpl = SMS_TEMPLATES[templateKey] || SMS_TEMPLATES[knock.disposition] || SMS_TEMPLATES.follow_up;
    const body = tmpl.body
      .replace(/\{name\}/g, knock.homeowner || 'there')
      .replace(/\{rep\}/g, repName)
      .replace(/\{address\}/g, knock.address || '')
      .replace(/\{follow_up_date\}/g, knock.followUpDate ? formatDate(knock.followUpDate) : 'soon');

    // Try NBDComms first
    if (window.NBDComms && typeof window.NBDComms.sendSMS === 'function') {
      window.NBDComms.sendSMS(phone, body, knock.id).then(result => {
        if (result.success) {
          const nameDisplay = knock.homeowner || 'contact';
          window.showToast?.(`Text sent to ${nameDisplay}`, 'ok');
        } else {
          // Fallback on failure
          const cleanPhone = phone.replace(/[^0-9+]/g, '');
          window.open(`sms:${cleanPhone}?body=${encodeURIComponent(body)}`, '_blank');
          window.showToast?.('Opening SMS...', 'info');
        }
      });
    } else {
      // Fallback: sms: link
      const cleanPhone = phone.replace(/[^0-9+]/g, '');
      window.open(`sms:${cleanPhone}?body=${encodeURIComponent(body)}`, '_blank');
      window.showToast?.('Opening SMS...', 'info');
    }
  }

  function sendFollowUpEmail(knock, templateKey) {
    if (!knock.email) { window.showToast?.('No email for this contact', 'error'); return; }
    const repName = currentRep?.name || window._user?.displayName || 'NBD Home Solutions';
    const tmpl = SMS_TEMPLATES[templateKey] || SMS_TEMPLATES[knock.disposition] || SMS_TEMPLATES.follow_up;
    const body = tmpl.body
      .replace(/\{name\}/g, knock.homeowner || 'there')
      .replace(/\{rep\}/g, repName)
      .replace(/\{address\}/g, knock.address || '');
    window.open(`mailto:${knock.email}?subject=NBD Home Solutions — ${tmpl.label}&body=${encodeURIComponent(body)}`, '_blank');
  }

  function openSMSTemplateChooser(knock) {
    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-sms-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.style.maxWidth = '400px';
    modal.innerHTML = `
      <div class="d2d-modal-hdr">
        <div class="d2d-modal-title">Send Follow-up</div>
        <button class="d2d-modal-close" onclick="document.getElementById('d2d-sms-overlay')?.remove()">×</button>
      </div>
      <div style="padding:var(--s2);">
        <p style="color:var(--m);font-size:12px;margin-bottom:12px;">Choose a template:</p>
        ${Object.entries(SMS_TEMPLATES).map(([key, tmpl]) => `
          <div style="padding:10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;margin-bottom:8px;cursor:pointer;transition:border-color .15s;" onmouseenter="this.style.borderColor='var(--blue)'" onmouseleave="this.style.borderColor='var(--br)'" onclick="window.D2D.sendFollowUpSMS(${JSON.stringify({phone:knock.phone,homeowner:knock.homeowner,address:knock.address,disposition:knock.disposition,followUpDate:knock.followUpDate}).replace(/"/g,'&quot;')},'${key}');document.getElementById('d2d-sms-overlay')?.remove()">
            <div style="font-weight:600;font-size:13px;color:var(--t);">${tmpl.label}</div>
            <div style="font-size:11px;color:var(--m);margin-top:4px;">${tmpl.body.substring(0, 80)}...</div>
          </div>
        `).join('')}
        ${knock.email ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--br);"><button onclick="window.D2D.sendFollowUpEmail(${JSON.stringify({email:knock.email,homeowner:knock.homeowner,address:knock.address,disposition:knock.disposition}).replace(/"/g,'&quot;')});document.getElementById('d2d-sms-overlay')?.remove()" style="width:100%;padding:10px;background:var(--blue, #4A9EFF);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">📧 Send Email Instead</button></div>` : ''}
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ============================================================================
  // CSV EXPORT
  // ============================================================================
  function exportKnocksCSV() {
    const data = applyFilters();
    if (!data.length) { window.showToast?.('No knocks to export', 'error'); return; }

    const headers = ['Address','Homeowner','Phone','Email','Disposition','Notes','Attempt #','Insurance Carrier','Claim #','Stage','Follow-up','Created','Lat','Lng'];
    const rows = data.map(k => [
      k.address || '', k.homeowner || '', k.phone || '', k.email || '',
      DISPOSITIONS[k.disposition]?.label || k.disposition || '',
      (k.notes || '').replace(/,/g, ';').replace(/\n/g, ' '),
      k.attemptNumber || '', k.insCarrier || '', k.claimNumber || '', k.stage || '',
      k.followUpDate ? formatDate(k.followUpDate) : '',
      k.createdAt ? formatDate(k.createdAt) + ' ' + formatTime(k.createdAt) : '',
      k.lat || '', k.lng || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`));

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `NBD-D2D-Knocks-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    window.showToast?.(`Exported ${data.length} knocks to CSV`, 'success');
  }

  // ============================================================================
  // QUICK KNOCK MODAL
  // ============================================================================
  function openQuickKnock(opts) {
    opts = opts || {};
    const address = opts.address || '';

    currentKnockEntry = {
      address: address,
      lat: opts.lat || null,
      lng: opts.lng || null,
      homeowner: '', phone: '', email: '', notes: '',
      disposition: null, photoFiles: [],
      insCarrier: '', claimNumber: '',
      followUpDate: '', followUpTime: ''
    };

    // Pre-populate from history
    if (address) {
      const history = getAddressHistory(address);
      if (history.length > 0) {
        const last = history[0];
        if (last.homeowner) currentKnockEntry.homeowner = last.homeowner;
        if (last.phone) currentKnockEntry.phone = last.phone;
        if (last.email) currentKnockEntry.email = last.email;
      }
    }

    // Reverse geocode if no address
    if (!address && opts.lat && opts.lng) {
      reverseGeocode(opts.lat, opts.lng).then(addr => {
        if (addr) {
          currentKnockEntry.address = addr;
          const addrInput = document.getElementById('d2d-qk-address');
          if (addrInput) addrInput.value = addr;
        }
      });
    }

    const attemptNum = address ? getAttemptCount(address) + 1 : 1;
    voiceBlob = null;

    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-quick-knock-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeQuickKnock(); };

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.innerHTML = `
      <div class="d2d-modal-hdr">
        <div class="d2d-modal-title">Knock #${attemptNum}/${MAX_ATTEMPTS}${!isOnline ? ' <span style="color:var(--gold)">⚡ Offline</span>' : ''}</div>
        <button class="d2d-modal-close" onclick="window.D2D.closeQuickKnock()">×</button>
      </div>
      <div class="d2d-modal-body">
        <div class="d2d-field">
          <label class="d2d-field-label">Address *</label>
          <input type="text" id="d2d-qk-address" class="d2d-input" value="${esc(address)}" placeholder="123 Main St, Cincinnati, OH">
        </div>

        <div class="d2d-field-label" style="margin-top:12px;">Select Disposition:</div>
        <div class="d2d-dispo-grid">
          ${DISPO_ORDER.map(key => {
            const d = DISPOSITIONS[key];
            return `<button class="d2d-dispo-btn" data-dispo="${key}" onclick="window.D2D.selectDispo('${key}',this)" style="--dc:${d.color};">
              <span class="d2d-dispo-icon">${d.icon}</span>
              <span class="d2d-dispo-label">${d.label}</span>
            </button>`;
          }).join('')}
        </div>

        <!-- Insurance carrier -->
        <div id="d2d-ins-section" class="d2d-ins-section">
          <label class="d2d-field-label" style="font-weight:600;">Insurance Details</label>
          <select id="d2d-qk-carrier" class="d2d-input d2d-select">
            <option value="">Select Carrier...</option>
            ${CARRIERS.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input type="text" id="d2d-qk-claim" class="d2d-input" placeholder="Claim # (optional)" style="margin-top:8px;">
        </div>

        <details class="d2d-details">
          <summary class="d2d-details-summary">📋 Contact & Notes</summary>
          <div class="d2d-extras-body">
            <div class="d2d-field">
              <label class="d2d-field-label">Homeowner Name</label>
              <input type="text" id="d2d-qk-homeowner" class="d2d-input" value="${esc(currentKnockEntry.homeowner)}" placeholder="John Doe">
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Phone</label>
              <input type="tel" id="d2d-qk-phone" class="d2d-input" value="${esc(currentKnockEntry.phone)}" placeholder="555-123-4567">
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Email</label>
              <input type="email" id="d2d-qk-email" class="d2d-input" value="${esc(currentKnockEntry.email)}" placeholder="john@example.com">
            </div>
            <div class="d2d-field-row">
              <div class="d2d-field" style="flex:1;">
                <label class="d2d-field-label">Follow-up Date</label>
                <input type="date" id="d2d-qk-followup" class="d2d-input">
              </div>
              <div class="d2d-field" style="flex:1;">
                <label class="d2d-field-label">Follow-up Time</label>
                <input type="time" id="d2d-qk-followup-time" class="d2d-input">
              </div>
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Notes</label>
              <textarea id="d2d-qk-notes" class="d2d-textarea" placeholder="Add any notes..."></textarea>
            </div>
            <div class="d2d-media-btns">
              <button class="d2d-action-btn" style="flex:1;background:var(--orange);" onclick="window.D2D.capturePhoto()">📷 Photo</button>
              <button class="d2d-action-btn" style="flex:1;background:var(--blue);" id="d2d-voice-btn" onclick="window.D2D.startVoice()">🎙️ Voice Memo</button>
            </div>
            <div id="d2d-photo-preview" class="d2d-photo-grid"></div>
            <div id="d2d-voice-playback"></div>
          </div>
        </details>

        <button id="d2d-qk-save" class="d2d-save-btn" onclick="window.D2D.submitKnock()" disabled>
          Select Disposition
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Setup autocomplete after DOM insertion
    setTimeout(() => setupAddressAutocomplete('d2d-qk-address'), 100);
  }

  function selectDispo(key, btn) {
    currentKnockEntry.disposition = key;
    const dispo = DISPOSITIONS[key];

    document.querySelectorAll('.d2d-dispo-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const saveBtn = document.getElementById('d2d-qk-save');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.background = dispo.color;
      saveBtn.style.color = 'white';
      saveBtn.style.cursor = 'pointer';
      saveBtn.textContent = `${dispo.icon} ${dispo.label}`;
    }

    // Show/hide insurance section
    const insSection = document.getElementById('d2d-ins-section');
    if (insSection) insSection.style.display = INS_DISPOSITIONS.includes(key) ? 'block' : 'none';

    // Auto-set follow-up
    if (dispo.autoFollowUp) {
      const fupInput = document.getElementById('d2d-qk-followup');
      if (fupInput) {
        const d = new Date();
        d.setDate(d.getDate() + dispo.autoFollowUp);
        fupInput.valueAsDate = d;
      }
      document.querySelector('.d2d-details')?.setAttribute('open', '');
    }
  }

  function closeQuickKnock() {
    const overlay = document.getElementById('d2d-quick-knock-overlay');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 300); }
    currentKnockEntry = null;
    voiceBlob = null;
  }

  async function handleSubmitKnock() {
    const address = (document.getElementById('d2d-qk-address')?.value || '').trim();
    if (!address) { window.showToast?.('Address required', 'error'); return; }
    if (!currentKnockEntry?.disposition) { window.showToast?.('Disposition required', 'error'); return; }

    currentKnockEntry.address = address;
    currentKnockEntry.homeowner = document.getElementById('d2d-qk-homeowner')?.value || '';
    currentKnockEntry.phone = document.getElementById('d2d-qk-phone')?.value || '';
    currentKnockEntry.email = document.getElementById('d2d-qk-email')?.value || '';
    currentKnockEntry.notes = document.getElementById('d2d-qk-notes')?.value || '';
    currentKnockEntry.followUpDate = document.getElementById('d2d-qk-followup')?.value || '';
    currentKnockEntry.followUpTime = document.getElementById('d2d-qk-followup-time')?.value || '';
    currentKnockEntry.insCarrier = document.getElementById('d2d-qk-carrier')?.value || '';
    currentKnockEntry.claimNumber = document.getElementById('d2d-qk-claim')?.value || '';

    const saveBtn = document.getElementById('d2d-qk-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    // Upload photos and voice before saving
    let photoUrls = [];
    let voiceUrl = '';
    const tempId = Date.now().toString();

    if (currentKnockEntry.photoFiles?.length > 0 && isOnline) {
      photoUrls = await uploadPhotos(currentKnockEntry.photoFiles, tempId);
    }
    if (voiceBlob && isOnline) {
      voiceUrl = await uploadVoiceMemo(voiceBlob, tempId);
    }

    currentKnockEntry.photoUrls = photoUrls;
    currentKnockEntry.voiceUrl = voiceUrl;

    const savedDispo = currentKnockEntry.disposition;
    const savedPhone = currentKnockEntry.phone;
    const knockId = await submitKnock(currentKnockEntry);
    closeQuickKnock();

    if (!knockId) return;

    // Auto-offer lead conversion for hot dispositions
    if (HOT_DISPOSITIONS.includes(savedDispo)) {
      setTimeout(() => {
        const dispoLabel = DISPOSITIONS[savedDispo]?.label || savedDispo;
        showConversionPrompt(knockId, dispoLabel);
      }, 400);
    }
    // Offer SMS follow-up for relevant dispositions (if not already converting)
    else if (savedPhone && ['interested', 'appointment', 'storm_damage', 'ins_has_claim'].includes(savedDispo)) {
      setTimeout(() => {
        if (confirm('Send follow-up text?')) {
          const knock = knocks.find(k => k.id === knockId);
          if (knock) openSMSTemplateChooser(knock);
        }
      }, 500);
    }
  }

  // Show a branded prompt to convert knock → CRM lead
  function showConversionPrompt(knockId, dispoLabel) {
    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-convert-prompt';
    overlay.style.zIndex = '10002';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.style.maxWidth = '360px';
    modal.innerHTML = `
      <div class="d2d-modal-body" style="text-align:center;padding:28px 20px;">
        <div style="font-size:36px;margin-bottom:10px;">🔥</div>
        <div style="font-size:15px;font-weight:700;color:var(--t);margin-bottom:6px;">Hot Lead Detected</div>
        <div style="font-size:13px;color:var(--m);margin-bottom:20px;">"${esc(dispoLabel)}" — convert this knock into a CRM lead so it shows up in your pipeline?</div>
        <div style="display:flex;gap:10px;">
          <button style="flex:1;padding:12px;border:none;border-radius:8px;background:#2ECC8A;color:white;font-weight:700;font-size:14px;cursor:pointer;" onclick="window.D2D.convertToLead('${knockId}');document.getElementById('d2d-convert-prompt')?.remove();">
            ✅ Convert Now
          </button>
          <button style="flex:1;padding:12px;border:none;border-radius:8px;background:var(--s2);color:var(--t);font-weight:600;font-size:14px;cursor:pointer;border:1px solid var(--br);" onclick="window.D2D.convertToLeadWithEdit('${knockId}');document.getElementById('d2d-convert-prompt')?.remove();">
            ✏️ Edit First
          </button>
        </div>
        <button style="margin-top:12px;background:none;border:none;color:var(--m);font-size:12px;cursor:pointer;text-decoration:underline;" onclick="document.getElementById('d2d-convert-prompt')?.remove();">Skip for now</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ============================================================================
  // KNOCK DETAIL MODAL
  // ============================================================================
  function openKnockDetail(knockId) {
    const knock = knocks.find(k => k.id === knockId);
    if (!knock) {
      if (typeof window.showToast === 'function') window.showToast('Knock not found — it may have been deleted', 'error');
      return;
    }

    const dispo = DISPOSITIONS[knock.disposition];
    const attempts = getAttemptCount(knock.address);
    const history = getAddressHistory(knock.address);
    // Escape the knock id for interpolation into inline onclick
    // handlers below. Firestore doc IDs are alphanumeric today but
    // this guards against any future ID scheme that includes quotes.
    const safeId = esc(knock.id);

    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-detail-overlay';
    // Esc to close — user said everything has to be accessible.
    overlay.onclick = (e) => { if (e.target === overlay) closeKnockDetail(); };
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeKnockDetail();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.innerHTML = `
      <div class="d2d-modal-hdr">
        <div class="d2d-modal-title">${esc(knock.address)}</div>
        <button class="d2d-modal-close" onclick="window.D2D.closeKnockDetail()">×</button>
      </div>
      <div class="d2d-modal-body">
        <div class="d2d-detail-badge" style="background:${dispo?.color};">
          ${dispo?.icon} ${dispo?.label} · Knock #${attempts}/${MAX_ATTEMPTS}
        </div>

        <div class="d2d-detail-grid">
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Homeowner</label>
            <div class="d2d-detail-value">${esc(knock.homeowner || '—')}</div>
          </div>
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Phone</label>
            <div class="d2d-detail-value">${knock.phone ? `<a href="tel:${esc(knock.phone)}" class="d2d-detail-link">${esc(knock.phone)}</a>` : '—'}</div>
          </div>
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Email</label>
            <div class="d2d-detail-value">${knock.email ? `<a href="mailto:${esc(knock.email)}" class="d2d-detail-link">${esc(knock.email)}</a>` : '—'}</div>
          </div>
          ${knock.insCarrier ? `<div class="d2d-detail-field">
            <label class="d2d-detail-label">Insurance</label>
            <div class="d2d-detail-value">${esc(knock.insCarrier)}${knock.claimNumber ? ` · #${esc(knock.claimNumber)}` : ''}</div>
          </div>` : ''}
        </div>

        ${knock.notes ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Notes</label><div class="d2d-detail-notes">${esc(knock.notes)}</div></div>` : ''}

        ${knock.followUpDate ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Follow-up</label><div class="d2d-detail-value">${formatDate(knock.followUpDate)}</div></div>` : ''}

        ${knock.photoUrls?.length ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Photos (${knock.photoUrls.length})</label><div class="d2d-photo-grid">${knock.photoUrls.map(url => `<img src="${esc(url)}" class="d2d-photo-thumb" loading="lazy" onclick="window.open('${esc(url)}','_blank')" onerror="this.parentNode.replaceChild(Object.assign(document.createElement('div'),{className:'d2d-photo-broken',textContent:'\ud83d\udcf7 Photo unavailable',style:'background:var(--s2);border:1px dashed var(--br);color:var(--m);padding:16px 12px;border-radius:6px;font-size:11px;text-align:center;'}),this);">`).join('')}</div></div>` : ''}

        ${knock.voiceUrl ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Voice Memo</label><audio controls src="${esc(knock.voiceUrl)}" class="d2d-audio-player"></audio></div>` : ''}

        <div class="d2d-detail-section">
          <label class="d2d-detail-label">📍 Address History (${history.length})</label>
          <div class="d2d-history-list">
            ${history.slice(0, 5).map(h => `
              <div class="d2d-history-item">
                <div class="d2d-history-dispo">${DISPOSITIONS[h.disposition]?.icon} ${DISPOSITIONS[h.disposition]?.label}</div>
                <div class="d2d-history-time">${formatDate(h.createdAt)} at ${formatTime(h.createdAt)}</div>
                ${h.notes ? `<div class="d2d-history-notes">${esc(h.notes.substring(0, 100))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="d2d-detail-actions">
          ${!knock.convertedToLead ? `
            <button class="d2d-action-btn" style="background:#2ECC8A;" onclick="window.D2D.convertToLead('${safeId}')" aria-label="Convert knock to lead">✓ Convert to Lead</button>
          ` : `
            <button class="d2d-action-btn" disabled style="background:var(--br);color:var(--m);" aria-label="Already converted to lead">✓ Lead Created</button>
          `}
          <button class="d2d-action-btn" style="background:var(--orange);" onclick="window.D2D.openQuickKnock({address:'${esc(knock.address)}',lat:${Number(knock.lat) || 'null'},lng:${Number(knock.lng) || 'null'}})" aria-label="Re-knock this address">↻ Re-Knock</button>
          ${knock.phone ? `<button class="d2d-action-btn" style="background:var(--blue);" onclick="window.D2D.openSMSChooser('${safeId}')" aria-label="Send SMS follow-up">📱 Follow Up</button>` : ''}
          <button class="d2d-action-btn" style="background:#E05252;" onclick="window.D2D.deleteKnock('${safeId}')" aria-label="Delete this knock">🗑️ Delete</button>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function closeKnockDetail() {
    const overlay = document.getElementById('d2d-detail-overlay');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 300); }
  }

  // ============================================================================
  // TAB SWITCHING
  // ============================================================================
  function setTab(tab) {
    currentTab = tab;
    renderD2D();
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  function renderD2D() {
    const container = document.getElementById('d2dContent');
    if (!container) return;

    const metrics = getMetrics();
    const revenue = getRevenueMetrics();
    const timeOfDay = getTimeOfDayStats();
    const breakdown = getDispositionBreakdown();
    const filtered = applyFilters();
    const gamify = getGamificationData();
    const insMetrics = getInsuranceMetrics();
    const weatherAlerts = getWeatherAlerts();

    const funnel = revenue.conversionFunnel;
    const maxFunnelVal = Math.max(funnel.doors, funnel.conversations, funnel.appointments, funnel.estimates, funnel.closed, 1);

    let revenuePerDoorText = '$' + revenue.revenuePerDoor;
    if (revenue.totalClosed === 0) revenuePerDoorText = '~$12.50 (industry avg)';

    const tabBtn = (id, label, icon) => `<button onclick="window.D2D.setTab('${id}')" style="flex:1;padding:12px 8px;border:none;border-bottom:3px solid ${currentTab === id ? 'var(--orange)' : 'transparent'};background:none;color:${currentTab === id ? 'var(--t)' : 'var(--m)'};cursor:pointer;font-size:13px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.03em;min-height:44px;-webkit-tap-highlight-color:transparent;">${icon} ${label}</button>`;

    let html = `
      <div style="padding:12px 14px;">

        ${!isOnline ? `<div style="background:color-mix(in srgb, var(--gold, #EAB308) 20%, var(--s));padding:12px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;font-weight:600;color:var(--t);border-left:4px solid var(--gold);">⚡ Offline — ${offlineQueue.length} queued</div>` : ''}

        ${weatherAlerts.length > 0 ? `<div style="background:color-mix(in srgb, var(--red, #E05252) 15%, var(--s));padding:12px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;border-left:4px solid var(--red);"><strong style="color:var(--t);">⛈️ Storm Alert:</strong> <span style="color:var(--m);">${esc(weatherAlerts[0].event)} — knock now!</span></div>` : ''}

        <!-- Revenue Banner -->
        <div class="d2d-revenue-banner">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div class="d2d-revenue-label">Value Per Door</div>
              <div class="d2d-revenue-amount">${revenuePerDoorText}</div>
            </div>
            <div class="d2d-streak">
              <div class="d2d-streak-num">${gamify.streak}</div>
              <div class="d2d-streak-lbl">Day Streak ${gamify.currentMilestone ? gamify.currentMilestone.badge : ''}</div>
            </div>
          </div>
          <div style="font-size:10px;opacity:0.7;margin-top:4px;color:var(--m,#9ca3af);">
            ${revenue.totalClosed > 0 ? `${revenue.totalClosed} closed · $${revenue.avgDealSize} avg` : 'Track deals to see projections'}
            ${gamify.projectedRevenue > 0 ? ` · $${gamify.projectedRevenue.toLocaleString()}/mo` : ''}
          </div>
        </div>

        <!-- Action Bar -->
        <div class="d2d-action-bar">
          <button onclick="window.D2D.openQuickKnock()" class="d2d-big-btn">🚪 Knock</button>
          <button onclick="window.D2D.toggleHeatMap()" class="d2d-big-btn d2d-big-btn-sec">${showHeat ? '🔥' : '❄️'} Heat</button>
          <button onclick="window.D2D.centerOnMe()" class="d2d-big-btn d2d-big-btn-sec">📍 Me</button>
          <button onclick="window.D2D.exportCSV()" class="d2d-big-btn d2d-big-btn-sec">📥 CSV</button>
        </div>

        <!-- Tab Bar -->
        <div style="display:flex;margin-bottom:12px;border-bottom:2px solid var(--br);">
          ${tabBtn('feed', 'Feed', '📋')}
          ${tabBtn('routes', 'Routes', '🗺️')}
          ${tabBtn('gamify', 'Challenges', '🏆')}
          ${tabBtn('analytics', 'Stats', '📊')}
        </div>
    `;

    // ─── FEED TAB ───
    if (currentTab === 'feed') {
      html += `
        <!-- Follow-ups Due — Full Interactive List -->
        ${metrics.followUpsDue.length > 0 ? `
          <div class="d2d-followups-banner">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div class="d2d-followups-title">📋 ${metrics.followUpsDue.length} Follow-up${metrics.followUpsDue.length !== 1 ? 's' : ''} Due</div>
              <button style="background:none;border:1px solid var(--br);color:var(--m);padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;" onclick="this.closest('.d2d-followups-banner').style.display='none'">Dismiss</button>
            </div>
            <div class="d2d-followups-list" style="max-height:300px;overflow-y:auto;">
              ${metrics.followUpsDue.map(k => {
                const dispo = DISPOSITIONS[k.disposition];
                const fDate = k.followUpDate ? new Date(k.followUpDate instanceof Date ? k.followUpDate : (k.followUpDate.seconds ? k.followUpDate.seconds * 1000 : k.followUpDate)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                return `
                <div class="d2d-followup-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--s);border:1px solid var(--br);border-radius:6px;margin-bottom:4px;cursor:pointer;" onclick="window.D2D.openKnockDetail('${esc(k.id)}')">
                  <div style="font-size:18px;flex-shrink:0;">${dispo?.icon || '📋'}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:var(--t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(k.address?.substring(0, 50) || 'No address')}</div>
                    <div style="font-size:10px;color:var(--m);margin-top:2px;">${dispo?.label || ''} ${fDate ? '· Due ' + fDate : ''} ${k.homeowner ? '· ' + esc(k.homeowner) : ''}</div>
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    ${k.phone ? `<button style="background:var(--blue);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;" onclick="event.stopPropagation();window.open('tel:'+encodeURIComponent('${esc(k.phone)}'))">📞</button>` : ''}
                    <button style="background:var(--orange);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;" onclick="event.stopPropagation();window.D2D.openQuickKnock({address:'${esc(k.address || '')}',lat:${Number(k.lat) || 'null'},lng:${Number(k.lng) || 'null'}})">↻</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Metrics Grid -->
        <div class="d2d-metrics-grid">
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--blue, #4A9EFF);">${metrics.today}</div>
            <div class="d2d-metric-lbl">Today</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--blue, #4A9EFF);">${metrics.week}</div>
            <div class="d2d-metric-lbl">Week</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--green, #2ECC8A);">${metrics.appointments}</div>
            <div class="d2d-metric-lbl">Appts</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--gold, #EAB308);">${metrics.conversionRate}%</div>
            <div class="d2d-metric-lbl">Conv</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--orange, #e8720c);">${revenue.revenuePerDoor > 0 ? '$' + revenue.revenuePerDoor : '—'}</div>
            <div class="d2d-metric-lbl">Rev/Door</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:#9B6DFF;">$${revenue.avgDealSize || 0}</div>
            <div class="d2d-metric-lbl">Avg Deal</div>
          </div>
        </div>

        <!-- Conversion Funnel -->
        <div class="d2d-funnel">
          <div class="d2d-funnel-step" style="flex:${funnel.doors / maxFunnelVal};background:#6B7280;">
            <div class="d2d-funnel-count">${funnel.doors}</div>
            <div class="d2d-funnel-label">Doors</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.conversations / maxFunnelVal};background:#EAB308;color:#1a1a1a;">
            <div class="d2d-funnel-count">${funnel.conversations}</div>
            <div class="d2d-funnel-label">Convos</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.appointments / maxFunnelVal};background:#4A9EFF;">
            <div class="d2d-funnel-count">${funnel.appointments}</div>
            <div class="d2d-funnel-label">Apts</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.estimates / maxFunnelVal};background:#2ECC8A;">
            <div class="d2d-funnel-count">${funnel.estimates}</div>
            <div class="d2d-funnel-label">Ests</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.closed / maxFunnelVal};background:#e8720c;">
            <div class="d2d-funnel-count">${funnel.closed}</div>
            <div class="d2d-funnel-label">Closed</div>
          </div>
        </div>

        <!-- Disposition Bar -->
        <div class="d2d-dispo-bar-wrap">
          <div class="d2d-dispo-bar-header">Disposition Breakdown</div>
          <div class="d2d-dispo-bar">
            ${DISPO_ORDER.filter(k => breakdown[k] > 0).map(key => {
              const d = DISPOSITIONS[key];
              const pct = filtered.length > 0 ? (breakdown[key] / filtered.length * 100) : 0;
              return `<div style="flex:${pct};background:${d.color};" class="d2d-dispo-bar-segment" onclick="window.D2D.setDispoFilter('${key}')" title="${d.label}: ${breakdown[key]}">${breakdown[key]}</div>`;
            }).join('')}
          </div>
          <div class="d2d-dispo-legend">
            ${DISPO_ORDER.filter(k => breakdown[k] > 0).slice(0, 6).map(key => {
              const d = DISPOSITIONS[key];
              return `<span class="d2d-legend-item" onclick="window.D2D.setDispoFilter('${key}')"><span class="d2d-knock-dot" style="background:${d.color};"></span>${d.short}</span>`;
            }).join('')}
          </div>
        </div>

        <!-- Filters -->
        <div class="d2d-feed-header">
          <div class="d2d-date-pills">
            ${['today', 'week', 'month', 'all'].map(range => `
              <button class="d2d-pill ${filterDateRange === range ? 'active' : ''}" onclick="window.D2D.setDateFilter('${range}')">
                ${range === 'today' ? 'Today' : range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'All'}
              </button>
            `).join('')}
          </div>
          <select class="d2d-select" onchange="window.D2D.setDispoFilter(this.value)">
            <option value="">All Dispositions</option>
            ${DISPO_ORDER.map(key => `<option value="${key}" ${filterDispo === key ? 'selected' : ''}>${DISPOSITIONS[key].label}</option>`).join('')}
          </select>
        </div>

        <!-- Knock Feed -->
        <div class="d2d-knock-feed">
          ${filtered.length === 0 ? `
            <div class="d2d-empty">
              <div style="font-size:32px;margin-bottom:8px;">📍</div>
              <div>No knocks yet for this filter</div>
              <div style="font-size:12px;margin-top:4px;">Tap the map or press "Knock" to start</div>
            </div>
          ` : filtered.slice(0, PAGE_SIZE).map(knock => {
            const dispo = DISPOSITIONS[knock.disposition];
            const attempts = getAttemptCount(knock.address);
            return `
              <div class="d2d-knock-card" onclick="window.D2D.openKnockDetail('${knock.id}')">
                <div class="d2d-knock-body">
                  <div>
                    <div class="d2d-knock-addr">${esc(knock.address)}</div>
                    <div class="d2d-knock-meta">
                      <span>${formatTime(knock.createdAt)}</span>
                      <span class="d2d-knock-attempt ${dispo?.color === '#e8720c' ? 'warning' : ''}" style="background:${dispo?.color || '#ccc'};">Knock #${attempts}/${MAX_ATTEMPTS}</span>
                      ${knock.insCarrier ? `<span>🏢 ${esc(knock.insCarrier)}</span>` : ''}
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    ${knock.photoUrls?.length ? '<span style="font-size:12px;">📷</span>' : ''}
                    ${knock.voiceUrl ? '<span style="font-size:12px;">🎙️</span>' : ''}
                    <span style="font-size:20px;">${dispo?.icon || ''}</span>
                    <div style="text-align:right;">
                      <div style="font-size:11px;font-weight:600;color:var(--t);">${dispo?.label || ''}</div>
                      <div class="d2d-knock-time">${timeAgo(knock.createdAt)}</div>
                    </div>
                  </div>
                </div>
                ${knock.notes ? `<div style="font-size:12px;color:var(--m);margin-top:6px;padding-top:6px;border-top:1px solid var(--br);">${esc(knock.notes.substring(0, 80))}</div>` : ''}
                ${!knock.convertedToLead && HOT_DISPOSITIONS.includes(knock.disposition) ? `
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--br);display:flex;gap:6px;" onclick="event.stopPropagation();">
                    <button style="flex:1;padding:8px;border:none;border-radius:6px;background:#2ECC8A;color:white;font-size:12px;font-weight:700;cursor:pointer;" onclick="event.stopPropagation();window.D2D.convertToLead('${knock.id}')">✅ Convert to Lead</button>
                    <button style="padding:8px 12px;border:none;border-radius:6px;background:var(--s2);color:var(--t);font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--br);" onclick="event.stopPropagation();window.D2D.convertToLeadWithEdit('${knock.id}')">✏️</button>
                  </div>
                ` : ''}
                ${knock.convertedToLead ? `<div style="margin-top:6px;font-size:11px;color:#2ECC8A;font-weight:600;">✓ In CRM Pipeline</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // ─── ROUTES TAB ───
    if (currentTab === 'routes') {
      const route = walkingRoute || [];
      const streets = Object.entries(streetSequences).filter(([st, doors]) => doors.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 10);

      html += `
        <div class="d2d-routes-section">
          <div class="d2d-route-actions">
            <button class="d2d-action-btn" style="flex:1;background:var(--blue);" onclick="window.D2D.calcRoute()">🗺️ Calculate Walking Route</button>
            ${route.length > 0 ? `<button class="d2d-action-btn" style="background:var(--s2);color:var(--t);border:1px solid var(--br);" onclick="window.D2D.clearRoute()">Clear</button>` : ''}
          </div>
          ${route.length > 0 ? `
            <div class="d2d-section-title">Optimized Route (${route.length} stops)</div>
            <div class="d2d-route-list">
              ${route.map((p, i) => `
                <div class="d2d-route-stop" onclick="window.D2D.openQuickKnock({address:'${esc(p.address)}',lat:${p.lat},lng:${p.lng}})">
                  <div class="d2d-route-num">${i + 1}</div>
                  <div class="d2d-route-addr">${esc(p.address)}</div>
                  <span class="d2d-route-icon" style="color:${DISPOSITIONS[p.disposition]?.color || 'var(--m)'};">${DISPOSITIONS[p.disposition]?.icon || ''}</span>
                </div>
              `).join('')}
            </div>
          ` : `<div class="d2d-empty" style="padding:20px;">Hit "Calculate" to find the best route through your unvisited doors (Not Home / Come Back)</div>`}
        </div>

        <div class="d2d-streets-section">
          <div class="d2d-section-title">🏘️ Street Sequences</div>
          ${streets.length === 0 ? '<div class="d2d-empty">No streets with enough data yet</div>' : streets.map(([street, doors]) => {
            const knocked = doors.filter(d => d.knocked).length;
            const total = doors.length;
            const pct = Math.round(knocked / total * 100);
            return `
              <div class="d2d-street-card">
                <div class="d2d-street-header">
                  <div class="d2d-street-name">${esc(street)}</div>
                  <div class="d2d-street-stat">${knocked}/${total} (${pct}%)</div>
                </div>
                <div class="d2d-street-doors">
                  ${doors.slice(0, 30).map(d => {
                    const col = d.knocked ? (DISPOSITIONS[d.disposition]?.color || '#6B7280') : 'var(--br)';
                    return `<div class="d2d-door-chip" style="background:${col};" title="${d.address}" ${d.knockId ? `onclick="window.D2D.openKnockDetail('${d.knockId}')"` : `onclick="window.D2D.openQuickKnock({address:'${esc(d.address)}'})"` }>${d.houseNum || ''}</div>`;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // ─── GAMIFY TAB ───
    if (currentTab === 'gamify') {
      html += `
        <!-- Streak -->
        <div class="d2d-streak-hero">
          <div class="d2d-streak-badge">${gamify.currentMilestone?.badge || '🔥'}</div>
          <div class="d2d-streak-days">${gamify.streak} Day Streak</div>
          <div class="d2d-streak-sub">${gamify.currentMilestone?.label || 'Start your streak!'}</div>
          ${gamify.nextMilestone ? `<div class="d2d-streak-next">Next: ${gamify.nextMilestone.badge} ${gamify.nextMilestone.label} (${gamify.nextMilestone.days - gamify.streak} days)</div>` : ''}
        </div>

        <!-- Daily Challenges -->
        <div class="d2d-section-title">Daily Challenges (${gamify.completedChallenges}/${gamify.totalChallenges})</div>
        <div class="d2d-challenges">
          ${gamify.challenges.map(ch => `
            <div class="d2d-challenge-card ${ch.complete ? 'd2d-challenge-done' : ''}">
              <div class="d2d-challenge-header">
                <div class="d2d-challenge-label">${ch.icon} ${ch.label}</div>
                <div class="d2d-challenge-progress" style="color:${ch.complete ? 'var(--green)' : 'var(--m)'};">${ch.current}/${ch.target} ${ch.complete ? '✓' : ''}</div>
              </div>
              <div class="d2d-progress-track">
                <div class="d2d-progress-fill" style="width:${ch.pct}%;background:${ch.complete ? 'var(--green, #2ECC8A)' : 'var(--blue, #4A9EFF)'};"></div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Commission Projection -->
        <div class="d2d-projection-card">
          <div class="d2d-section-title">💰 Monthly Projection</div>
          <div class="d2d-projection-grid">
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--blue);">${gamify.projectedKnocks}</div>
              <div class="d2d-metric-lbl">Proj. Knocks</div>
            </div>
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--green);">${gamify.projectedAppts}</div>
              <div class="d2d-metric-lbl">Proj. Appts</div>
            </div>
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--orange);">$${gamify.projectedRevenue.toLocaleString()}</div>
              <div class="d2d-metric-lbl">Proj. Revenue</div>
            </div>
          </div>
        </div>
      `;
    }

    // ─── ANALYTICS TAB ───
    if (currentTab === 'analytics') {
      const tod = timeOfDay;
      const maxHour = Math.max(...tod.hourCounts, 1);

      html += `
        <!-- Golden Hours -->
        <div class="d2d-golden-hours">
          🕐 Golden Hours: <strong>${tod.bestWindow.start}:00 - ${tod.bestWindow.end}:00</strong> (${tod.bestWindow.conversions} conversions)
        </div>

        <!-- Time of Day Heatmap -->
        <div class="d2d-section-title">Hourly Activity (8am-9pm)</div>
        <div class="d2d-hourly-chart">
          ${Array.from({length: 14}, (_, i) => i + 8).map(hr => {
            const h = tod.hourCounts[hr] || 0;
            const c = tod.hourConversions[hr] || 0;
            const pct = h / maxHour * 100;
            return `<div class="d2d-hour-col" title="${hr}:00 — ${h} knocks, ${c} conversions">
              <div class="d2d-hour-bar" style="height:${pct}%;min-height:${h > 0 ? 2 : 0}px;">
                ${c > 0 ? `<div class="d2d-hour-conv" style="height:${h > 0 ? c/h*100 : 0}%;"></div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="d2d-hour-labels">
          ${Array.from({length: 14}, (_, i) => `<div class="d2d-hour-lbl">${(i + 8) % 12 || 12}${i + 8 < 12 ? 'a' : 'p'}</div>`).join('')}
        </div>

        <!-- Insurance Metrics -->
        ${insMetrics.total > 0 ? `
          <div class="d2d-section-title">🏢 Insurance Breakdown (${insMetrics.total} total)</div>
          <div class="d2d-ins-list">
            ${Object.entries(insMetrics.carriers).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([carrier, data]) => `
              <div class="d2d-ins-row">
                <span class="d2d-ins-name">${esc(carrier)}</span>
                <span class="d2d-ins-stats">${data.total} leads · ${data.hasClaim} claims · ${data.denied} denied</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Neighborhood Scores -->
        ${Object.keys(neighborhoodScores).length > 0 ? `
          <div class="d2d-section-title" style="margin-top:14px;">🏘️ Top Neighborhoods</div>
          <div class="d2d-hood-list">
            ${Object.values(neighborhoodScores).sort((a, b) => b.score - a.score).slice(0, 5).map(n => {
              const col = n.score >= 70 ? 'var(--green)' : n.score >= 40 ? 'var(--gold)' : 'var(--red)';
              return `<div class="d2d-hood-row">
                <div class="d2d-hood-score" style="background:${col};">${n.score}</div>
                <div class="d2d-hood-info">
                  <div class="d2d-hood-primary">${n.knocks.length} knocks · ${n.appointments} apts</div>
                  <div class="d2d-hood-secondary">${n.conversations} conversations · ${n.stormDmg} storm dmg</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      `;
    }

    html += '</div>';
    html += `<button class="d2d-fab" onclick="window.D2D.openQuickKnock()" aria-label="Quick Knock">🚪</button>`;
    container.innerHTML = html;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  async function initD2D() {
    if (d2dInited) {
      renderD2D();
      if (d2dMap) setTimeout(() => d2dMap.invalidateSize(), 100);
      return;
    }

    try {
      loadOfflineQueue();
      await loadRepProfile();
      await loadKnocks();
      renderD2D();
      setTimeout(() => initD2DMap(), 200);
      d2dInited = true;

      // Async background tasks
      if (isOnline) {
        flushOfflineQueue();
        loadWeather();
      }
    } catch (e) {
      console.error('initD2D failed:', e);
      window.showToast?.('Failed to initialize D2D', 'error');
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  window.D2D = {
    init: initD2D,
    renderD2D,
    loadKnocks,
    openQuickKnock,
    closeQuickKnock,
    selectDispo,
    submitKnock: handleSubmitKnock,
    openKnockDetail,
    closeKnockDetail,
    convertToLead,
    convertToLeadWithEdit,
    deleteKnock,
    toggleHeatMap,
    setDateFilter,
    setDispoFilter,
    setTab,
    refreshMapMarkers,
    getMetrics,
    getRevenueMetrics,
    getTimeOfDayStats,
    getInsuranceMetrics,
    centerOnMe,
    capturePhoto,
    startVoice: startVoiceRecording,
    stopVoice: stopVoiceRecording,
    sendFollowUpSMS,
    sendFollowUpEmail,
    openSMSChooser: (knockId) => { const k = knocks.find(x => x.id === knockId); if (k) openSMSTemplateChooser(k); },
    exportCSV: exportKnocksCSV,
    calcRoute: () => { calculateWalkingRoute(); drawWalkingRoute(); renderD2D(); window.showToast?.(`Route calculated: ${walkingRoute?.length || 0} stops`, 'info'); },
    clearRoute: () => { clearWalkingRoute(); renderD2D(); },
    loadRepProfile,
    loadTeamKnocks,
    loadTerritories,
    saveTerritory,
    toggleTeamMode: () => { teamMode = !teamMode; loadKnocks().then(() => renderD2D()); },
    DISPOSITIONS,
    DISPO_ORDER,
    CARRIERS
  };
})();
