/**
 * NBD Pro — /pro/login.html controller.
 *
 * Extracted from an inline <script type="module"> block so strict CSP can
 * drop 'unsafe-inline' on this page. All previous inline onclick="..."
 * handlers are now wired via addEventListener.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signInWithCustomToken, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const firebaseConfig = {
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  databaseURL: "https://nobigdeal-pro-default-rtdb.firebaseio.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);

const validateAccessCodeFn = httpsCallable(functions, 'validateAccessCode');

// ─────────────────────────────────────────────────
// TAB SWITCHING (wired via addEventListener instead of inline onclick)
// ─────────────────────────────────────────────────
function switchTab(tab) {
  ['member', 'code', 'demo'].forEach(t => {
    document.getElementById('view-' + t).classList.toggle('active', t === tab);
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'code') setTimeout(() => document.getElementById('codeInput').focus(), 50);
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.id; // tab-member | tab-code | tab-demo
    if (id && id.startsWith('tab-')) switchTab(id.slice(4));
  });
});

// ─────────────────────────────────────────────────
// MEMBER LOGIN
// ─────────────────────────────────────────────────
const emailInput    = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn      = document.getElementById('loginBtn');
const loginError    = document.getElementById('loginError');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const rememberMe    = document.getElementById('rememberMe');
const togglePw      = document.getElementById('togglePw');
const mainView      = document.getElementById('mainView');
const resetView     = document.getElementById('resetView');

togglePw.addEventListener('click', () => {
  const isText = passwordInput.type === 'text';
  passwordInput.type = isText ? 'password' : 'text';
  togglePw.textContent = isText ? '👁' : '🙈';
});
[emailInput, passwordInput].forEach(el =>
  el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
);
loginBtn.addEventListener('click', doLogin);

async function doLogin() {
  const email = emailInput.value.trim();
  const pass  = passwordInput.value;
  loginError.classList.remove('show');
  if (!email || !pass) {
    loginErrorMsg.textContent = 'Please enter your email and password.';
    loginError.classList.add('show');
    return;
  }
  setLoading(loginBtn, true);
  try {
    await setPersistence(auth, rememberMe.checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, pass);
    window.location.replace('/pro/dashboard.html');
  } catch (err) {
    loginErrorMsg.textContent = friendlyError(err.code);
    loginError.classList.add('show');
    passwordInput.focus();
  } finally {
    setLoading(loginBtn, false);
  }
}

// RESET PASSWORD
document.getElementById('showResetBtn').addEventListener('click', () => {
  mainView.classList.add('hidden');
  resetView.classList.add('active');
  document.getElementById('resetEmail').value = emailInput.value;
  document.getElementById('resetEmail').focus();
});
document.getElementById('backToLogin').addEventListener('click', () => {
  resetView.classList.remove('active');
  mainView.classList.remove('hidden');
  document.getElementById('resetError').classList.remove('show');
  document.getElementById('resetSuccess').classList.remove('show');
});
document.getElementById('resetEmail').addEventListener('keydown', e => { if (e.key === 'Enter') doReset(); });
document.getElementById('resetBtn').addEventListener('click', doReset);

async function doReset() {
  const email = document.getElementById('resetEmail').value.trim();
  const resetBtn = document.getElementById('resetBtn');
  document.getElementById('resetError').classList.remove('show');
  document.getElementById('resetSuccess').classList.remove('show');
  if (!email) {
    document.getElementById('resetErrorMsg').textContent = 'Please enter your email.';
    document.getElementById('resetError').classList.add('show');
    return;
  }
  setLoading(resetBtn, true);
  try {
    await sendPasswordResetEmail(auth, email);
    document.getElementById('resetSuccess').classList.add('show');
  } catch (err) {
    document.getElementById('resetErrorMsg').textContent = friendlyError(err.code);
    document.getElementById('resetError').classList.add('show');
  } finally {
    setLoading(resetBtn, false);
  }
}

// ─────────────────────────────────────────────────
// ACCESS CODE LOGIN
// ─────────────────────────────────────────────────
const codeInput = document.getElementById('codeInput');
const codeBtn   = document.getElementById('codeBtn');
const codeError = document.getElementById('codeError');
const codeErrorMsg = document.getElementById('codeErrorMsg');

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
});
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') doCodeLogin(); });
codeBtn.addEventListener('click', doCodeLogin);

async function doCodeLogin() {
  const raw = codeInput.value.trim().toUpperCase();
  codeError.classList.remove('show');
  if (!raw) {
    codeErrorMsg.textContent = 'Please enter your access code.';
    codeError.classList.add('show');
    return;
  }
  setLoading(codeBtn, true);
  try {
    const result = await validateAccessCodeFn({ code: raw });
    const data = result.data;
    if (!data?.success || !data.customToken) {
      codeErrorMsg.textContent = data?.error || 'Code not recognized. Check with Joe at (859) 420-7382.';
      codeError.classList.add('show');
      codeInput.focus();
      return;
    }
    // Exchange the server-minted custom token for a Firebase session.
    await signInWithCustomToken(auth, data.customToken);
    window.location.replace('/pro/dashboard.html');
  } catch (err) {
    codeErrorMsg.textContent = 'Authentication error. Contact Joe at (859) 420-7382.';
    codeError.classList.add('show');
  } finally {
    setLoading(codeBtn, false);
  }
}

// ─────────────────────────────────────────────────
// DEMO LOGIN
// ─────────────────────────────────────────────────
const demoBtn   = document.getElementById('demoBtn');
const demoError = document.getElementById('demoError');
const demoErrorMsg = document.getElementById('demoErrorMsg');

demoBtn.addEventListener('click', doDemoLogin);

async function doDemoLogin() {
  demoError.classList.remove('show');
  setLoading(demoBtn, true);
  try {
    const result = await validateAccessCodeFn({ code: 'DEMO' });
    const data = result.data;
    if (!data?.success || !data.customToken) throw new Error(data?.error || 'demo unavailable');
    await signInWithCustomToken(auth, data.customToken);
    window.location.replace('/pro/dashboard.html');
  } catch (err) {
    demoErrorMsg.textContent = 'Demo account unavailable right now. Try the Access Code tab or contact Joe.';
    demoError.classList.add('show');
  } finally {
    setLoading(demoBtn, false);
  }
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────
function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found'        : 'No account with that email. Check or contact Joe.',
    'auth/wrong-password'        : 'Incorrect password. Try again or reset it.',
    'auth/invalid-email'         : 'Please enter a valid email address.',
    'auth/too-many-requests'     : 'Too many attempts. Wait a few minutes and try again.',
    'auth/user-disabled'         : 'Account disabled. Contact Joe for help.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential'    : 'Invalid email or password.',
  };
  return map[code] || 'Something went wrong. Contact Joe at (859) 420-7382.';
}
