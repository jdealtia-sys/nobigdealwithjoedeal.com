/**
 * stripe-billing.js — Client-side Stripe billing integration
 *
 * Calls Cloud Functions to create checkout sessions, manage subscriptions,
 * and open the Stripe customer portal. No Stripe.js SDK needed — all
 * payment handling happens server-side via Stripe Checkout redirect.
 */
(function() {
  'use strict';

  const FUNCTIONS_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

  // Plan display info
  const PLANS = {
    foundation: {
      name: 'Foundation',
      price: '$29/mo',
      priceAnnual: '$290/yr',
      tagline: 'Everything you need to run your roofing business',
      features: [
        'Full CRM pipeline & lead management',
        'Door-to-door tracker with GPS',
        'Estimate builder & document generator',
        'Customer portal with project tracking',
        'Storm intel map & weather alerts',
        'Analytics & leaderboard',
        'Offline mode (field-ready)',
        'Push notifications'
      ]
    },
    professional: {
      name: 'NBD Pro',
      price: '$79/mo',
      priceAnnual: '$59/mo ($708/yr)',
      tagline: 'Beta pricing — locks in forever for early adopters',
      features: [
        'Everything in Foundation, plus:',
        'Ask Joe — AI contractor coaching',
        'AI-powered estimate review',
        'AI Usability Tree & Selection Codex',
        'Understanding Tool — deep-dive any software',
        'Advanced reporting & export',
        'Priority support & early access',
        'Custom theme builder'
      ]
    }
  };

  /**
   * Get current user's Firebase ID token
   */
  async function getIdToken() {
    const auth = window._auth;
    if (!auth?.currentUser) throw new Error('Not logged in');
    return await auth.currentUser.getIdToken(true);
  }

  /**
   * Create a Stripe Checkout session and redirect
   */
  async function checkout(plan) {
    if (!PLANS[plan]) throw new Error('Invalid plan: ' + plan);

    try {
      window.showToast?.('Opening checkout...', 'info');

      const token = await getIdToken();
      const resp = await fetch(FUNCTIONS_BASE + '/createCheckoutSession', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ plan })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Checkout failed');
      }

      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (e) {
      console.error('Stripe checkout error:', e);
      window.showToast?.('Checkout failed: ' + e.message, 'error');
    }
  }

  /**
   * Open Stripe Customer Portal for subscription management
   */
  async function openPortal() {
    try {
      window.showToast?.('Opening billing portal...', 'info');

      const token = await getIdToken();
      const resp = await fetch(FUNCTIONS_BASE + '/createCustomerPortalSession', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        }
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Portal failed');
      }

      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error('Billing portal error:', e);
      window.showToast?.('Could not open billing portal: ' + e.message, 'error');
    }
  }

  /**
   * Get current subscription status
   */
  async function getStatus() {
    try {
      const token = await getIdToken();
      const resp = await fetch(FUNCTIONS_BASE + '/getSubscriptionStatus', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!resp.ok) return { status: 'none', plan: null };
      return await resp.json();
    } catch (e) {
      console.warn('Subscription status check failed:', e);
      return { status: 'unknown', plan: null };
    }
  }

  /**
   * Render pricing cards (for landing page or upgrade wall)
   */
  function renderPricingCards(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { highlight = 'professional', showAnnual = false } = options;

    let html = '<div style="display:flex;gap:20px;justify-content:center;flex-wrap:wrap;max-width:800px;margin:0 auto;">';

    Object.entries(PLANS).forEach(([key, plan]) => {
      const isHighlight = key === highlight;
      const price = showAnnual ? plan.priceAnnual : plan.price;
      const border = isHighlight ? 'border:2px solid var(--orange,#e8720c);' : 'border:1px solid var(--br,rgba(255,255,255,.1));';
      const badge = isHighlight ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--orange,#e8720c);color:#fff;padding:4px 14px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Most Popular</div>' : '';

      html += `
        <div style="flex:1;min-width:280px;max-width:360px;background:var(--s,#111);${border}border-radius:14px;padding:32px 24px;position:relative;text-align:center;">
          ${badge}
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;color:var(--t,#fff);margin-bottom:4px;">${plan.name}</div>
          <div style="font-size:36px;font-weight:800;color:${isHighlight ? 'var(--orange,#e8720c)' : 'var(--t,#fff)'};margin-bottom:4px;">${price}</div>
          <div style="font-size:13px;color:var(--m,#888);margin-bottom:20px;">${plan.tagline}</div>
          <ul style="text-align:left;list-style:none;margin-bottom:24px;">
            ${plan.features.map(f => `<li style="padding:6px 0;font-size:13px;color:var(--t,#ddd);display:flex;gap:8px;align-items:flex-start;"><span style="color:var(--green,#2ECC8A);flex-shrink:0;">✓</span>${f}</li>`).join('')}
          </ul>
          <button onclick="window.StripeBilling.checkout('${key}')" style="width:100%;padding:14px;background:${isHighlight ? 'var(--orange,#e8720c)' : 'var(--s2,#222)'};color:#fff;border:${isHighlight ? 'none' : '1px solid var(--br,rgba(255,255,255,.15))'};border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Barlow',sans-serif;letter-spacing:.5px;transition:all .2s;-webkit-tap-highlight-color:transparent;">
            Get ${plan.name} →
          </button>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * Render subscription management panel (for settings page)
   */
  async function renderBillingPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--m);">Loading billing info...</div>';

    const sub = await getStatus();
    const plan = PLANS[sub.plan] || null;

    let html = '<div style="max-width:500px;">';

    if (sub.status === 'active' && plan) {
      html += `
        <div style="background:var(--s);border:1px solid var(--br);border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <div style="font-weight:700;font-size:18px;color:var(--t);">${plan.name} Plan</div>
              <div style="font-size:13px;color:var(--m);">${plan.price}</div>
            </div>
            <div style="background:rgba(46,204,138,.12);color:var(--green,#2ECC8A);padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.5px;">ACTIVE</div>
          </div>
          <button onclick="window.StripeBilling.openPortal()" style="width:100%;padding:12px;background:var(--s2);color:var(--t);border:1px solid var(--br);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Barlow',sans-serif;transition:all .2s;">
            Manage Subscription →
          </button>
        </div>
      `;
    } else if (sub.status === 'past_due') {
      html += `
        <div style="background:rgba(224,82,82,.08);border:1px solid rgba(224,82,82,.2);border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="color:var(--red,#E05252);font-weight:700;margin-bottom:8px;">⚠ Payment Past Due</div>
          <div style="color:var(--m);font-size:13px;margin-bottom:12px;">Your subscription payment failed. Please update your payment method.</div>
          <button onclick="window.StripeBilling.openPortal()" style="width:100%;padding:12px;background:var(--red,#E05252);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
            Update Payment Method →
          </button>
        </div>
      `;
    } else {
      html += `
        <div style="background:var(--s);border:1px solid var(--br);border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;">
          <div style="font-size:15px;color:var(--t);margin-bottom:4px;">Free Plan</div>
          <div style="font-size:13px;color:var(--m);margin-bottom:16px;">Upgrade to unlock the full NBD Pro experience.</div>
        </div>
        <div id="stripePricingCards"></div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    // Render pricing cards if on free plan
    if (sub.status !== 'active') {
      renderPricingCards('stripePricingCards');
    }
  }

  // ── Public API ──
  window.StripeBilling = {
    checkout,
    openPortal,
    getStatus,
    renderPricingCards,
    renderBillingPanel,
    PLANS
  };
})();
