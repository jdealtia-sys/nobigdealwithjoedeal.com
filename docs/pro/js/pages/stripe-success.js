/**
 * NBD Pro — /pro/stripe-success.html controller.
 *
 * Post-phase-1 rewrite. The previous implementation tried to write
 * `subscriptions/{uid}` and `users/{uid}.role` directly from the client, but
 * the hardened firestore.rules now reject both of those writes. The correct
 * flow is: Stripe → stripeWebhook Cloud Function (admin SDK) → writes the
 * subscription doc → this page polls until the document flips to active.
 *
 * Flow:
 *   1. If the user is already signed in, poll getSubscriptionStatus until
 *      the Stripe webhook has activated their subscription.
 *   2. If the user is NOT signed in, collect email + password, create the
 *      account, then wait for the Stripe webhook (keyed off session_id →
 *      client_reference_id = uid) to write the subscription doc.
 *
 * Nothing privileged is ever written by this page.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp({
  apiKey:            "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain:        "nobigdeal-pro.firebaseapp.com",
  projectId:         "nobigdeal-pro",
  storageBucket:     "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId:             "1:717435841570:web:c2338e11052c96fde02e7b"
});
const auth = getAuth(app);
const db   = getFirestore(app);

const params  = new URLSearchParams(window.location.search);
const session = params.get('session_id') || '';
const plan    = params.get('plan') || 'professional';

const show = id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
const err  = msg => { const e = document.getElementById('errorBox');  if (e) { e.textContent = msg; e.style.display = 'block'; } };
const err2 = msg => { const e = document.getElementById('errorBox2'); if (e) { e.textContent = msg; e.style.display = 'block'; } };

// Subscribe to subscriptions/{uid} and resolve once status === 'active'.
// The Stripe webhook writes this doc server-side via admin SDK. We time out
// after ~60 seconds so a user sitting on a stuck webhook doesn't spin forever.
function waitForSubscriptionActive(user, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('timeout'));
    }, timeoutMs);
    const unsub = onSnapshot(doc(db, 'subscriptions', user.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'active') {
        clearTimeout(timer);
        unsub();
        resolve(data);
      }
    }, e => {
      clearTimeout(timer);
      unsub();
      reject(e);
    });
  });
}

async function handleSignedInUser(user) {
  show('stepActivate');
  try {
    await waitForSubscriptionActive(user);
    hide('stepActivate');
    show('stepDone');
  } catch (e) {
    hide('stepActivate');
    if (e && e.message === 'timeout') {
      err('Your payment was received but the subscription is still activating. ' +
          'It usually takes under a minute. Reload this page in a moment, or ' +
          'contact jd@nobigdealwithjoedeal.com if it does not activate.');
    } else {
      err('Activation error: ' + (e.message || 'unknown') + '. ' +
          'Contact jd@nobigdealwithjoedeal.com with your session id: ' + session);
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    await handleSignedInUser(user);
  } else {
    show('stepCreate');
    setTimeout(() => {
      const el = document.getElementById('newEmail');
      if (el) el.focus();
    }, 200);
  }
});

async function createAndActivate() {
  const email = document.getElementById('newEmail').value.trim();
  const pass  = document.getElementById('newPass').value;
  const name  = document.getElementById('newName').value.trim();

  if (!email || !pass) { err2('Email and password are required.'); return; }
  if (pass.length < 8)  { err2('Password must be at least 8 characters.'); return; }

  const btn = document.querySelector('#stepCreate .btn');
  if (btn) { btn.textContent = 'Creating account...'; btn.disabled = true; }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name) await updateProfile(cred.user, { displayName: name });

    // Minimal profile doc — NO plan, NO role, NO accessCode. Rules reject
    // privileged fields; the Stripe webhook writes subscriptions/{uid}.
    const nameParts = name.split(' ');
    await setDoc(doc(db, 'users', cred.user.uid), {
      firstName: nameParts[0] || '',
      lastName:  nameParts.slice(1).join(' ') || '',
      email,
      onboarded: false,
      createdAt: serverTimestamp()
    });

    hide('stepCreate');
    await handleSignedInUser(cred.user);
  } catch (e) {
    if (btn) { btn.textContent = 'Create Account & Activate →'; btn.disabled = false; }
    if (e.code === 'auth/email-already-in-use') {
      err2('That email already has an account. Sign in here: /pro/login.html');
    } else {
      err2(e.message || 'Account creation failed.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('createAndActivateBtn');
  if (btn) btn.addEventListener('click', createAndActivate);
});
