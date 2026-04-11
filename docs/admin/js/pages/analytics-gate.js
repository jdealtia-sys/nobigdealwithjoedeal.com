/**
 * NBD Admin — /admin/analytics.html auth gate.
 * Extracted from an inline <script type="module"> for strict CSP.
 * Uses Firebase custom claims, not a Firestore role field.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('/pro/login.html?redirect=/admin/analytics.html');
    return;
  }
  try {
    const result = await user.getIdTokenResult(true);
    if (result.claims.role !== 'admin') {
      window.location.replace('/pro/dashboard.html');
      return;
    }
  } catch (e) {
    window.location.replace('/pro/login.html?redirect=/admin/analytics.html');
    return;
  }
  window._currentUser = user;
  window.dispatchEvent(new Event('auth-ready'));
});
