import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const app = initializeApp({
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
});
const auth = getAuth(app);

// Custom-claims admin gate — no Firestore role field, no email whitelist.
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const result = await user.getIdTokenResult(true);
      if (result.claims.role === 'admin') {
        window.location.href = 'vault.html';
        return;
      }
    } catch (e) { /* fall through to the form */ }
  }
  document.getElementById('loginForm').style.display = 'block';
});

// Real email + password form. The previous implementation read a non-existent
// `#passfield` and sent an empty password, which is how it bypassed password checks.
window.handleLogin = async function(event) {
  event.preventDefault();
  const emailEl = document.getElementById('adminEmail');
  const passEl  = document.getElementById('adminPassword');
  const errorDiv = document.getElementById('errorMsg');
  const btn = document.getElementById('loginBtn');
  const email = (emailEl?.value || '').trim();
  const password = passEl?.value || '';

  errorDiv.textContent = '';
  if (!email || !password) {
    errorDiv.textContent = 'Email and password required.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const result = await cred.user.getIdTokenResult(true);
    if (result.claims.role === 'admin') {
      window.location.href = 'vault.html';
    } else {
      errorDiv.textContent = 'Account does not have admin access.';
      btn.disabled = false;
      btn.textContent = 'Unlock Admin Access';
    }
  } catch (e) {
    errorDiv.textContent = 'Invalid credentials. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Unlock Admin Access';
    passEl && (passEl.value = '');
    emailEl && emailEl.focus();
  }
};

// Admin logout — sign out and reload so the login form shows again.
window.logout = async function() {
  try { await signOut(auth); } catch (_) {}
  window.location.reload();
};

// Wire form submit + logout via addEventListener instead of inline onsubmit/onclick.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  if (form) form.addEventListener('submit', (ev) => window.handleLogin(ev));
  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', () => window.logout());
  });
});
