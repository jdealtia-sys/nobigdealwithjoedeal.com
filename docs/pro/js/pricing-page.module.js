// pricing-page.module.js — Stripe checkout + FAQ accordion + auth state
//
// Extracted from the inline <script type="module"> formerly inline in
// docs/pro/pricing.html (CSP `script-src 'self'` blocks inline blocks,
// including type="module"; serving as a same-origin .js file passes).
// Wires the data-pr-action delegate that the page's buttons already use.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { connectEmulatorsIfLocal } from './nbd-emulator-connect.js'; // Audit #3: localhost-only, no-op in prod

const app = initializeApp({
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro"
});
const auth = getAuth(app);
await connectEmulatorsIfLocal({ auth }); // Audit #3: localhost-only, no-op in prod

window.subscribe = async function(plan, evt) {
  // Resolve the button from the explicit event arg (preferred) with a fallback
  // to window.event for legacy onclick calls. Never rely on the undeclared
  // global `event` identifier — that silently fails under strict mode.
  const btn = (evt && evt.target) || (typeof window !== 'undefined' && window.event && window.event.target) || null;
  const originalLabel = btn ? btn.textContent : '';

  // Check if user is signed in
  const user = auth.currentUser;
  if (!user) {
    if (confirm('You need to sign in first. Go to login page?')) {
      window.location.href = '/pro/login.html?redirect=pricing&plan=' + plan;
    }
    return;
  }

  // Get ID token
  try {
    if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

    const idToken = await user.getIdToken();
    const response = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/createCheckoutSession', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify({ plan: plan })
    });

    const data = await response.json();

    if (data.url) {
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } else {
      alert('Error: ' + (data.error || 'Could not create checkout session. Try again.'));
      if (btn) { btn.textContent = originalLabel || 'Subscribe'; btn.disabled = false; }
    }
  } catch (e) {
    console.error('Checkout error:', e);
    alert('Connection error. Please try again.');
    if (btn) { btn.textContent = originalLabel || 'Subscribe'; btn.disabled = false; }
  }
};

// CSP-safe data-pr-action delegate. Prod `script-src-attr 'none'` blocks
// inline event-handler attributes silently; addEventListener is unaffected.
document.addEventListener('click', function(e) {
  const t = e.target.closest('[data-pr-action]');
  if (!t) return;
  const action = t.getAttribute('data-pr-action');
  if (action === 'subscribe') {
    e.preventDefault();
    window.subscribe(t.getAttribute('data-plan'), { target: t });
  } else if (action === 'faq-toggle') {
    t.classList.toggle('open');
  }
});

// Update buttons based on auth state
onAuthStateChanged(auth, function(user) {
  document.querySelectorAll('.cta-primary').forEach(function(btn) {
    if (user) {
      btn.style.opacity = '1';
    } else {
      // Still allow clicking — subscribe() will redirect to login
    }
  });
});
