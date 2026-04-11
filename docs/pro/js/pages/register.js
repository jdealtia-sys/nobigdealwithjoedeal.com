/**
 * NBD Pro — /pro/register.html controller.
 *
 * Extracted from inline <script type="module"> + inline event handlers so
 * strict CSP can drop 'unsafe-inline' on this page. The register and
 * googleRegister flows are identical to the previous implementation —
 * only the binding changed (addEventListener instead of onclick=/onsubmit=).
 */
import { initializeApp }                                         from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, sendEmailVerification }
                                                                from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable }                           from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain:        "nobigdeal-pro.firebaseapp.com",
  projectId:         "nobigdeal-pro",
  storageBucket:     "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId:             "1:717435841570:web:c2338e11052c96fde02e7b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const validateAccessCodeFn = httpsCallable(functions, 'validateAccessCode');

// ─────────────────────────────────────────────────
// PASSWORD STRENGTH METER
// ─────────────────────────────────────────────────
function updateStrength(val) {
  const bar = document.getElementById('strengthBar');
  if (!bar) return;
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const pct = [0, 25, 50, 75, 100][score];
  const color = ['', '#E05252', '#EAB308', '#4A9EFF', '#2ECC8A'][score];
  bar.style.width = pct + '%';
  bar.style.background = color;
}

// ─────────────────────────────────────────────────
// PASSWORD VISIBILITY TOGGLE
// ─────────────────────────────────────────────────
function togglePass(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (btn) btn.textContent = show ? '🙈' : '👁';
}

// ─────────────────────────────────────────────────
// REGISTER FLOW
// ─────────────────────────────────────────────────
async function register(e) {
  e.preventDefault();
  const btn   = document.getElementById('regBtn');
  const errEl = document.getElementById('regErr');
  const okEl  = document.getElementById('regOk');
  errEl.textContent = ''; okEl.textContent = '';

  const firstName = document.getElementById('regFirst').value.trim();
  const lastName  = document.getElementById('regLast').value.trim();
  const company   = document.getElementById('regCompany').value.trim();
  const email     = document.getElementById('regEmail').value.trim();
  const password  = document.getElementById('regPass').value;
  const confirm   = document.getElementById('regConfirm').value;
  const code      = document.getElementById('regCode').value.trim();

  if (!firstName || !email || !password) { errEl.textContent = 'First name, email and password are required.'; return; }
  if (password.length < 8)                { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (password !== confirm)               { errEl.textContent = 'Passwords do not match.'; return; }

  if (!code) {
    // No access code — free account; Stripe Checkout upgrades via webhook.
    btn.disabled = true;
    btn.textContent = 'Creating free account...';
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: `${firstName} ${lastName}`.trim() });
      try { await sendEmailVerification(cred.user); } catch (_) { /* non-fatal */ }
      await setDoc(doc(db, 'users', cred.user.uid), {
        firstName, lastName, company: company || '', email,
        createdAt: serverTimestamp(), onboarded: false
      });
      window.location.replace('/pro/dashboard.html');
      return;
    } catch (e2) {
      errEl.textContent = e2.code === 'auth/email-already-in-use'
        ? 'This email is already registered. Try logging in.'
        : (e2.message || 'Registration failed');
      btn.disabled = false; btn.textContent = 'Create Account';
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: `${firstName} ${lastName}`.trim() });
    try { await sendEmailVerification(cred.user); } catch (_) {}
    await setDoc(doc(db, 'users', cred.user.uid), {
      firstName, lastName, company: company || '', email,
      createdAt: serverTimestamp(), onboarded: false
    });

    const result = await validateAccessCodeFn({ code });
    if (!result?.data?.success) {
      errEl.textContent = (result?.data?.error) || 'That access code is not valid.';
      btn.disabled = false; btn.textContent = 'Create Account';
      return;
    }
    if (result.data.customToken) {
      await signInWithCustomToken(auth, result.data.customToken);
    }
    okEl.textContent = 'Account created! Taking you to your dashboard...';
    btn.textContent = '✓ Done';
    setTimeout(() => { window.location.href = '/pro/dashboard.html'; }, 1200);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    const msg = err.code === 'auth/email-already-in-use' ? 'That email already has an account. Try logging in instead.'
              : err.code === 'auth/invalid-email'        ? 'That email address is not valid.'
              : err.code === 'auth/weak-password'        ? 'Password is too weak. Use at least 8 characters.'
              : 'Something went wrong: ' + (err.message || err.code);
    errEl.textContent = msg;
  }
}

// ─────────────────────────────────────────────────
// GOOGLE REGISTER FLOW
// ─────────────────────────────────────────────────
async function googleRegister() {
  const errEl = document.getElementById('regErr');
  const code  = document.getElementById('regCode').value.trim();
  errEl.textContent = '';

  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const user = cred.user;

    const existing = await getDoc(doc(db, 'users', user.uid));
    if (!existing.exists()) {
      const nameParts = (user.displayName || '').split(' ');
      await setDoc(doc(db, 'users', user.uid), {
        firstName: nameParts[0] || '',
        lastName:  nameParts.slice(1).join(' ') || '',
        company:   '',
        email:     user.email,
        createdAt: serverTimestamp(),
        onboarded: false
      });
    }

    if (code) {
      const result = await validateAccessCodeFn({ code });
      if (!result?.data?.success) {
        errEl.textContent = (result?.data?.error) || 'That access code is not valid.';
        return;
      }
      if (result.data.customToken) {
        await signInWithCustomToken(auth, result.data.customToken);
      }
    }

    document.getElementById('regOk').textContent = 'Signed in! Taking you to your dashboard...';
    setTimeout(() => { window.location.href = '/pro/dashboard.html'; }, 1200);
  } catch (err) {
    errEl.textContent = err.code === 'auth/popup-closed-by-user'
      ? 'Sign-in cancelled.'
      : 'Google sign-in failed: ' + (err.message || err.code);
  }
}

// ─────────────────────────────────────────────────
// WIRE DOM EVENTS
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('regForm');
  if (form) form.addEventListener('submit', register);

  const gbtn = document.getElementById('googleRegBtn');
  if (gbtn) gbtn.addEventListener('click', googleRegister);

  const codeInput = document.getElementById('regCode');
  if (codeInput) codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

  const passInput = document.getElementById('regPass');
  if (passInput) passInput.addEventListener('input', () => updateStrength(passInput.value));

  document.querySelectorAll('.pass-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) togglePass(target, btn);
    });
  });
});
