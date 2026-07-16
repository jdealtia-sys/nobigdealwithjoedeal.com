      // ── Billing tab renderer ──
      // Populates the billing settings tab with live plan data
      // from the NBDBilling module when the tab is opened.
      function renderBillingTab() {
        if (!window.NBDBilling) return;
        const info = window.NBDBilling.getPlan();
        const limits = info.limits;

        // Plan status
        document.getElementById('billingPlanTitle').textContent = 'NBD Pro · ' + info.label;
        document.getElementById('billingPlanBadge').textContent = info.isTrialing ? 'TRIAL' : info.label.toUpperCase();
        document.getElementById('billingPlanName').textContent = info.label + (info.isTrialing ? ' (14-day trial)' : '');
        document.getElementById('billingPlanDesc').textContent = info.isActive
          ? (limits.leads === Infinity ? 'Unlimited everything' : limits.leads + ' leads/mo · ' + (limits.reports === Infinity ? '∞' : limits.reports) + ' reports · ' + (limits.aiCalls === Infinity ? '∞' : limits.aiCalls) + ' AI calls')
          : (info.isCancelled ? 'Subscription cancelled — downgraded to Free' : 'No active subscription');
        document.getElementById('billingStatusBadge').textContent = info.isPastDue ? 'PAST DUE' : (info.isActive ? 'ACTIVE' : 'INACTIVE');
        document.getElementById('billingStatusBadge').style.background = info.isPastDue ? '#c53030' : (info.isActive ? 'var(--orange)' : '#666');

        // Usage meters
        var leadsLim = limits.leads === Infinity ? '∞' : limits.leads;
        var reportsLim = limits.reports === Infinity ? '∞' : limits.reports;
        var aiLim = limits.aiCalls === Infinity ? '∞' : limits.aiCalls;
        document.getElementById('billingLeadsUsed').textContent = (info.usage.leads || 0) + ' / ' + leadsLim;
        document.getElementById('billingReportsUsed').textContent = (info.usage.reports || 0) + ' / ' + reportsLim;
        document.getElementById('billingAIUsed').textContent = (info.usage.aiCalls || 0) + ' / ' + aiLim;
        document.getElementById('billingLeadsBar').style.width = Math.min(100, window.NBDBilling.usagePct('leads') * 100) + '%';
        document.getElementById('billingReportsBar').style.width = Math.min(100, window.NBDBilling.usagePct('reports') * 100) + '%';
        document.getElementById('billingAIBar').style.width = Math.min(100, window.NBDBilling.usagePct('aiCalls') * 100) + '%';

        // Plan cards — show the four canonical tiers (Free / Starter /
        // Growth / Enterprise). foundation/professional are legacy alias
        // keys of starter/growth in NBDBilling.PLANS; render the alias
        // entry only when it's the user's current plan (and hide its
        // canonical twin) so the grid never shows duplicate cards.
        var plans = window.NBDBilling.PLANS;
        var aliasOf = { foundation: 'starter', professional: 'growth' };
        var cards = document.getElementById('billingPlanCards');
        if (cards) {
          cards.innerHTML = Object.entries(plans).filter(function(entry) {
            var key = entry[0];
            if (aliasOf[key]) return key === info.plan;
            if (aliasOf[info.plan] === key) return false;
            return true;
          }).map(function(entry) {
            var key = entry[0], p = entry[1];
            var isCurrent = key === info.plan;
            return '<div style="background:' + (isCurrent ? 'color-mix(in srgb, var(--orange) 8%, transparent)' : 'var(--s2)') + ';border:2px solid ' + (isCurrent ? 'var(--orange)' : 'var(--br)') + ';border-radius:8px;padding:14px;text-align:center;">'
              + '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:14px;font-weight:800;color:var(--t);text-transform:uppercase;margin-bottom:4px;">' + p.label + '</div>'
              + '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:24px;font-weight:800;color:' + (isCurrent ? 'var(--orange)' : 'var(--t)') + ';">' + (p.price === null ? 'Custom' : (p.price === 0 ? 'Free' : '$' + p.price)) + '</div>'
              + '<div style="font-size:10px;color:var(--m);margin-top:4px;">' + (p.leads === Infinity ? '∞' : p.leads) + ' leads/mo</div>'
              + (isCurrent ? '<div style="font-size:9px;color:var(--orange);font-weight:700;margin-top:6px;letter-spacing:.08em;">CURRENT PLAN</div>' : '')
              + '</div>';
          }).join('');
        }
      }
      // Auto-render when billing tab is shown. DOMContentLoaded guard
      // for the same reason as the Appearance/Team blocks above — the
      // base switchSettingsTab lives in deferred js/ui.js and isn't
      // available at parse time. Without the wait, billing-tab opens
      // would render whatever was cached last instead of loading the
      // current subscription.
      // readyState guard: this script ships inside the lazily-hydrated
      // tpl-view-settings template and is re-executed at hydration, AFTER
      // DOMContentLoaded has fired — a bare listener never installs the wrapper,
      // leaving the Billing tab stuck on its 'Loading...' placeholder (same trap
      // as dashboard-team-tab.js / dashboard-sidebar-customizer.js).
      function _nbdInstallBillingHook() {
        var _origSwitchSettings = window.switchSettingsTab;
        if (typeof _origSwitchSettings !== 'function') return;
        window.switchSettingsTab = function(tab) {
          _origSwitchSettings(tab);
          if (tab === 'billing') {
            if (window.NBDBilling) {
              window.NBDBilling.loadSubscription().then(renderBillingTab);
            } else {
              renderBillingTab();
            }
          }
          // Sync GX panel controls when Appearance tab opens
          if (tab === 'appearance' && window.ThemeGX) {
            var gxState = window.ThemeGX.getState();
            var el;
            el = document.getElementById('gxMasterToggle');  if (el) el.checked = gxState.enabled;
            el = document.getElementById('gxGlowToggle');    if (el) el.checked = gxState.glowEnabled;
            el = document.getElementById('gxBgToggle');      if (el) el.checked = gxState.animatedBgEnabled;
            el = document.getElementById('gxIntensitySlider');if (el) el.value = Math.round(gxState.intensity * 100);
            el = document.getElementById('gxIntensityVal');   if (el) el.textContent = Math.round(gxState.intensity * 100) + '%';
            el = document.getElementById('gxAccentPicker');   if (el) el.value = gxState.accentOverride || gxState.currentAccent || '#e8720c';
            // Also render font grid + sync size buttons
            if (typeof nbdRenderFontGrid === 'function') nbdRenderFontGrid();
          }
        };
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _nbdInstallBillingHook);
      } else {
        _nbdInstallBillingHook();
      }

      // ── Stripe customer portal opener ──
      // Delegate for the billing tab's "Manage Subscription" button
      // (data-billing-action="managePortal" in dashboard.html). Creates a
      // portal session server-side (createCustomerPortalSession resolves the
      // subscription by companyId claim) and redirects; a 404 means no paid
      // subscription — route those users to the pricing page instead.
      // Guarded so template re-hydration can't double-install the listener.
      async function openCustomerPortalSession(btn) {
        var user = window._user || (window.auth && window.auth.currentUser);
        if (!user || typeof user.getIdToken !== 'function') {
          if (typeof showToast === 'function') showToast('Sign in again to manage billing', 'error');
          return;
        }
        var origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
        try {
          var token = await user.getIdToken();
          var res = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/createCustomerPortalSession', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          });
          if (res.status === 404) { window.location.href = '/pro/pricing.html'; return; }
          var data = await res.json().catch(function () { return {}; });
          if (res.ok && data.url) { window.location.href = data.url; return; }
          throw new Error(data.error || ('HTTP ' + res.status));
        } catch (e) {
          if (typeof showToast === 'function') showToast('Could not open billing portal: ' + e.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
      }
      if (!window._NBD_BILLING_PORTAL_DELEGATE) {
        window._NBD_BILLING_PORTAL_DELEGATE = true;
        document.addEventListener('click', function (ev) {
          var t = ev.target.closest && ev.target.closest('[data-billing-action="managePortal"]');
          if (t) openCustomerPortalSession(t);
        });
      }
