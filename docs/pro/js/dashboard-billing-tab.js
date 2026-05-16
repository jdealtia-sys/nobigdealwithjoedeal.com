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

        // Plan cards
        var plans = window.NBDBilling.PLANS;
        var cards = document.getElementById('billingPlanCards');
        if (cards) {
          cards.innerHTML = Object.entries(plans).map(function(entry) {
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
      document.addEventListener('DOMContentLoaded', function() {
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
      });
