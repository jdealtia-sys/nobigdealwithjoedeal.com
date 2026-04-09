ds-firebase-sync.js// NBD Pro — Daily Success Firebase Sync v1.0
// Add to bottom of pro/daily-success/index.html:
// <script type="module" src="/pro/daily-success/ds-firebase-sync.js"></script>

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDocs,
  collection, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
};

const fbApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

let _uid = null, _syncTimer = null, _badge = null;
const DEBOUNCE = 2000;

function injectBadge() {
  if (document.getElementById('ds-sync-badge')) return;
  const b = document.createElement('div');
  b.id = 'ds-sync-badge';
  b.style.cssText = 'position:fixed;top:10px;right:16px;z-index:9999;font-family:Montserrat,sans-serif;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:20px;background:rgba(232,114,12,.12);border:1px solid rgba(232,114,12,.3);color:#e8720c;transition:opacity .4s;opacity:0;pointer-events:none;';
  document.body.appendChild(b);
  _badge = b;
}

function showBadge(text, color) {
  if (!_badge) return;
  _badge.textContent = text;
  _badge.style.color = color || '#e8720c';
  _badge.style.opacity = '1';
  setTimeout(() => { _badge.style.opacity = '0'; }, 2400);
}

function computeStreaks(pages) {
  let runD = 0, runW = 0, runWin = 0, maxD = 0, maxW = 0, maxWin = 0;
  let totalDoors = 0, totalCloses = 0, totalRevenue = 0;
  const sorted = [...pages].sort((a, b) => a.dk > b.dk ? 1 : -1);
  for (const p of sorted) {
    const d = p.data || {}, kpi = p.kpi || {};
    const doors = kpi.doors || 0;
    const floors = ['l-sleep','l-workout','l-protein','l-task','l-journal'];
    const pct = floors.filter(f => d[f] === '1').length / floors.length;
    runD = doors >= 60 ? runD + 1 : 0;
    runW = d['habit-1-0'] === '1' ? runW + 1 : 0;
    runWin = pct >= 0.67 ? runWin + 1 : 0;
    if (runD > maxD) maxD = runD;
    if (runW > maxW) maxW = runW;
    if (runWin > maxWin) maxWin = runWin;
    totalDoors += doors;
    totalCloses += kpi.closes || 0;
    totalRevenue += parseFloat(d['s-revenue'] || 0) || 0;
  }
  return { runD, runW, runWin, maxD, maxW, maxWin, totalDoors, totalCloses, totalRevenue };
}

async function pushToFirestore(pages) {
  if (!_uid) return;
  const streaks = computeStreaks(pages);
  const batch = writeBatch(db);
  for (const page of pages) {
    batch.set(doc(db, 'users', _uid, 'ds_pages', String(page.id)), { ...page, _uid, _updatedAt: serverTimestamp() }, { merge: true });
  }
  batch.set(doc(db, 'users', _uid, 'ds_meta', 'streaks'), { ...streaks, _updatedAt: serverTimestamp() });
  const user = auth.currentUser;
  batch.set(doc(db, 'leaderboard', _uid), {
    uid: _uid,
    displayName: user?.displayName || user?.email?.split('@')[0] || 'Anonymous',
    door_streak: streaks.runD, workout_streak: streaks.runW, win_streak: streaks.runWin,
    best_door_streak: streaks.maxD, total_doors: streaks.totalDoors,
    total_closes: streaks.totalCloses, total_revenue: streaks.totalRevenue,
    page_count: pages.length, _updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
  showBadge('Synced', '#2ECC8A');
}

async function pullFromFirestore() {
  if (!_uid) return null;
  try {
    const snap = await getDocs(collection(db, 'users', _uid, 'ds_pages'));
    if (snap.empty) return null;
    const pages = [];
    snap.forEach(d => { const data = d.data(); delete data._uid; delete data._updatedAt; pages.push(data); });
    return pages.sort((a, b) => a.dk > b.dk ? 1 : -1);
  } catch(e) { return null; }
}

function installInterceptor() {
  const orig = window.savePages;
  if (!orig) { setTimeout(installInterceptor, 500); return; }
  window.savePages = function() {
    orig.apply(this, arguments);
    if (!_uid) return;
    clearTimeout(_syncTimer);
    showBadge('Saving...');
    _syncTimer = setTimeout(() => {
      try {
        const pages = JSON.parse(localStorage.getItem('nbd_dsp_v1')) || [];
        pushToFirestore(pages).catch(() => showBadge('Sync failed'));
      } catch(e) {}
    }, DEBOUNCE);
  };
}

injectBadge();

onAuthStateChanged(auth, async user => {
  if (!user) { showBadge('Offline mode'); return; }
  _uid = user.uid;
  installInterceptor();
  showBadge('Loading...');
  try {
    const cloud = await pullFromFirestore();
    if (cloud?.length) {
      const local = JSON.parse(localStorage.getItem('nbd_dsp_v1') || '[]');
      const map = new Map(local.map(p => [String(p.id), p]));
      for (const cp of cloud) map.set(String(cp.id), cp);
      const merged = [...map.values()].sort((a, b) => a.dk > b.dk ? 1 : -1);
      localStorage.setItem('nbd_dsp_v1', JSON.stringify(merged));
      if (typeof window.loadPages === 'function') window.loadPages();
      if (typeof window.renderTabs === 'function') window.renderTabs();
      if (typeof window.renderDash === 'function') window.renderDash();
      showBadge(merged.length + ' days loaded', '#2ECC8A');
    } else {
      const local = JSON.parse(localStorage.getItem('nbd_dsp_v1') || '[]');
      if (local.length) { await pushToFirestore(local); showBadge('Backed up', '#2ECC8A'); }
      else showBadge('Ready');
    }
  } catch(e) { showBadge('Sync error'); }
});
