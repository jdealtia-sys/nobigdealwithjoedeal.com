      // ── Stripe Connect (payouts) card — Settings → Billing ──
      // Phase 2 of Connect. Phase 1 (#1143) shipped the five callables with no
      // caller at all; this file is that caller and nothing else calls them.
      //
      // ═══ OWNER-ONLY, ON PURPOSE ═══
      // The #1123 platform-only payment gate is STILL CLOSED, so finishing
      // Stripe onboarding grants a contractor exactly nothing today — while
      // Express onboarding asks them for SSN + bank details. Collecting that
      // for a capability that doesn't work yet is a bad trade and a support
      // burden, so phase 2 renders this card for the PLATFORM OWNER only, which
      // is enough to walk the whole flow end-to-end in TEST mode.
      // Phase 3 flips _nbdConnectVisible() and the payment gate TOGETHER — they
      // must move in the same PR, or one of them is a lie.
      //
      // This script ships inside the lazily-hydrated tpl-view-settings template
      // and is RE-EXECUTED at hydration, after DOMContentLoaded. Two
      // consequences, both load-bearing:
      //   • no top-level let/const (re-execution would throw on redeclaration),
      //   • every listener install is flag-guarded, and the readyState branch is
      //     required or the tab hook never installs (same trap as
      //     dashboard-billing-tab.js / dashboard-team-tab.js).
      function _nbdConnectVisible() {
        return !!(window._userClaims && window._userClaims.owner === true);
      }

      // Own copy: the widgets.js/team-tab escapers are IIFE-scoped and this is a
      // separate hydrated script. Stripe strings (disabledReason, requirement
      // field names) are not user input, but they still land in innerHTML.
      function _nbdConnectEsc(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }

      // 'individual.ssn_last_4' -> 'Individual · ssn last 4'
      function _nbdConnectPrettyReq(name) {
        var parts = String(name || '').split('.');
        var head = parts.shift() || '';
        var rest = parts.join(' ').replace(/_/g, ' ');
        head = head.charAt(0).toUpperCase() + head.slice(1).replace(/_/g, ' ');
        return rest ? head + ' · ' + rest : head;
      }

      // The functions SDK globals are set lazily and may not exist at click
      // time (billing-gate / team-tab pattern). These callables all set
      // enforceAppCheck:true — dashboard.html initialises App Check
      // (js/dashboard-appcheck-config.js), and the callable SDK attaches the
      // token itself. A raw fetch() would 401.
      async function _nbdConnectCallable(name) {
        if (!(window._functions && window._httpsCallable)) {
          var mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
          window._functions = window._functions || mod.getFunctions();
          window._httpsCallable = window._httpsCallable || mod.httpsCallable;
        }
        return window._httpsCallable(window._functions, name);
      }

      function _nbdConnectBtn(action, label, kind) {
        var css = 'border:none;border-radius:6px;padding:8px 14px;font-size:11px;font-weight:700;'
          + 'cursor:pointer;letter-spacing:.04em;margin-right:8px;margin-top:4px;';
        css += (kind === 'primary')
          ? 'background:var(--orange);color:var(--accent-fg);'
          : 'background:var(--s3);color:var(--t);';
        return '<button type="button" data-connect-action="' + _nbdConnectEsc(action) + '" style="' + css + '">'
          + _nbdConnectEsc(label) + '</button>';
      }

      function _nbdConnectReqList(list, heading) {
        var items = (list || []).filter(Boolean);
        if (!items.length) return '';
        return '<div style="margin-top:10px;padding:10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;">'
          + '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--m);margin-bottom:6px;">'
          + _nbdConnectEsc(heading) + '</div>'
          + '<ul style="margin:0;padding-left:16px;font-size:11px;color:var(--t);">'
          + items.map(function (r) { return '<li>' + _nbdConnectEsc(_nbdConnectPrettyReq(r)) + '</li>'; }).join('')
          + '</ul></div>';
      }

      // The honest note. Every "connected" state must carry it: onboarding
      // finishing does NOT mean money starts routing, and the card must not
      // imply otherwise while #1123 stands.
      function _nbdConnectGateNote() {
        return '<div style="margin-top:12px;padding:10px;border-left:3px solid var(--orange);'
          + 'background:color-mix(in srgb, var(--orange) 7%, transparent);font-size:11px;color:var(--t);">'
          + '<strong>Online card payments are still switched off</strong> for every account, '
          + 'including this one. Connecting is step one — invoices are collected by '
          + 'check/cash via <em>Mark Paid</em> until routing is turned on.'
          + '</div>';
      }

      function renderConnectCard() {
        var card = document.getElementById('connectPayoutsCard');
        if (!card) return;
        if (!_nbdConnectVisible()) { card.style.display = 'none'; return; }
        card.style.display = '';

        var body = document.getElementById('connectPayoutsBody');
        if (!body) return;
        var st = window._nbdConnectState || null;

        if (window._nbdConnectBusy) {
          body.innerHTML = '<div style="padding:14px;color:var(--m);font-size:12px;">'
            + _nbdConnectEsc(window._nbdConnectBusy) + '</div>';
          return;
        }
        if (window._nbdConnectError) {
          body.innerHTML = '<div style="padding:12px;border-left:3px solid var(--red);'
            + 'background:color-mix(in srgb, var(--red) 8%, transparent);font-size:12px;color:var(--t);">'
            + _nbdConnectEsc(window._nbdConnectError) + '</div>'
            + '<div style="margin-top:10px;">' + _nbdConnectBtn('refresh', 'Try again', 'secondary') + '</div>';
          return;
        }
        if (!st) {
          body.innerHTML = '<div style="padding:14px;color:var(--m);font-size:12px;">Loading payout status…</div>';
          return;
        }

        // TEST vs LIVE matters here: the runbook says do test mode first, and a
        // test-mode account can never satisfy the live gate.
        var mode = st.connected
          ? (st.livemode ? 'LIVE' : 'TEST')
          : '';
        var modeBadge = mode
          ? '<span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:3px;letter-spacing:.1em;'
            + 'background:' + (st.livemode ? 'var(--orange)' : 'var(--s3)') + ';'
            + 'color:' + (st.livemode ? 'var(--accent-fg)' : 'var(--m)') + ';">' + mode + '</span>'
          : '';

        var expired = window._nbdConnectLinkExpired
          ? '<div style="margin-bottom:10px;padding:10px;border-left:3px solid var(--red);'
            + 'background:color-mix(in srgb, var(--red) 8%, transparent);font-size:11px;color:var(--t);">'
            + 'Your Stripe setup link expired before it was used. Start it again below.'
            + '</div>'
          : '';

        var head = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">'
          + '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:20px;font-weight:800;color:var(--t);line-height:1;">'
          + _nbdConnectEsc(st.label || '—') + '</div>' + modeBadge + '</div>';

        var blurb = '';
        var actions = '';
        var extra = '';

        if (st.status === 'not_started') {
          blurb = 'Connect a Stripe account so that, once online payments are switched on, '
            + 'a homeowner\'s card payment settles into your bank instead of ours.';
          actions = _nbdConnectBtn('start', 'Set up payouts', 'primary');
        } else if (st.status === 'onboarding_incomplete') {
          blurb = 'Stripe still needs some details before this account can be used.';
          extra = _nbdConnectReqList(st.requirementsCurrentlyDue, 'Stripe still needs');
          actions = _nbdConnectBtn('link', 'Finish setup', 'primary')
            + _nbdConnectBtn('refresh', 'Refresh', 'secondary');
        } else if (st.status === 'verifying') {
          blurb = 'Stripe is reviewing the details that were submitted. This usually takes '
            + 'minutes, occasionally a day or two. Nothing else is needed right now.';
          extra = _nbdConnectReqList(st.requirementsCurrentlyDue, 'Stripe may still ask for')
            + _nbdConnectGateNote();
          actions = _nbdConnectBtn('refresh', 'Refresh status', 'primary')
            + _nbdConnectBtn('dashboard', 'Open Stripe dashboard', 'secondary');
        } else if (st.status === 'payouts_paused') {
          blurb = 'This account can be charged but Stripe has paused its payouts, so money '
            + 'would pile up in Stripe instead of reaching the bank.';
          extra = (st.disabledReason
              ? '<div style="margin-top:8px;font-size:11px;color:var(--m);">Stripe reason: <code>'
                + _nbdConnectEsc(st.disabledReason) + '</code></div>'
              : '')
            + _nbdConnectReqList(st.requirementsPastDue, 'Past due — fix these first')
            + _nbdConnectGateNote();
          actions = _nbdConnectBtn('dashboard', 'Open Stripe dashboard', 'primary')
            + _nbdConnectBtn('refresh', 'Refresh status', 'secondary');
        } else if (st.status === 'ready') {
          blurb = 'This Stripe account is fully onboarded and able to take card payments and receive payouts.';
          extra = _nbdConnectGateNote();
          actions = _nbdConnectBtn('dashboard', 'Open Stripe dashboard', 'primary')
            + _nbdConnectBtn('refresh', 'Refresh status', 'secondary');
        } else {
          // Unknown code from a newer server. Don't invent a state — say so and
          // offer the one safe action.
          blurb = 'Payout status could not be interpreted by this page.';
          actions = _nbdConnectBtn('refresh', 'Refresh status', 'secondary');
        }

        var acct = st.accountId
          ? '<div style="margin-top:10px;font-size:10px;color:var(--m);">Stripe account <code>'
            + _nbdConnectEsc(st.accountId) + '</code></div>'
          : '';

        body.innerHTML = expired + head
          + '<div style="font-size:12px;color:var(--m);line-height:1.5;">' + blurb + '</div>'
          + extra
          + '<div style="margin-top:12px;">' + actions + '</div>'
          + acct;
      }
      window.renderConnectCard = renderConnectCard;

      // Claims arrive asynchronously. If the Billing tab is opened before
      // _userClaims is populated, _nbdConnectVisible() is false for a reason
      // that has nothing to do with who the user is — the owner would silently
      // get no card at all and no error, until they happened to switch tabs
      // again. "Loaded" and "absent" are different answers; wait for the real
      // one before deciding.
      async function _nbdConnectAwaitClaims() {
        for (var i = 0; i < 40; i++) {
          if (window._userClaims) return true;
          await new Promise(function (r) { setTimeout(r, 150); });
        }
        return !!window._userClaims;
      }

      // Load (or reload) status. `force` bypasses the cache — used by the
      // onboarding return, where the account.updated webhook may not have
      // landed yet, so the mirror can legitimately be stale.
      async function loadConnectStatus(force) {
        await _nbdConnectAwaitClaims();
        if (!_nbdConnectVisible()) { renderConnectCard(); return; }
        if (!force && window._nbdConnectState) { renderConnectCard(); return; }
        window._nbdConnectError = null;
        window._nbdConnectBusy = 'Checking payout status…';
        renderConnectCard();
        try {
          var fn = await _nbdConnectCallable('getConnectStatus');
          var res = await fn({});
          window._nbdConnectState = (res && res.data) || null;
        } catch (e) {
          window._nbdConnectError = 'Could not read payout status: ' + (e && e.message ? e.message : 'unknown error');
        } finally {
          window._nbdConnectBusy = null;
          renderConnectCard();
        }
      }
      window.loadConnectStatus = loadConnectStatus;

      async function _nbdConnectGoToOnboarding() {
        var fn = await _nbdConnectCallable('createConnectOnboardingLink');
        var res = await fn({});
        var url = res && res.data && res.data.url;
        if (!url) throw new Error('Stripe did not return a setup link');
        // Single-use and short-lived: redirect immediately, never store it.
        window.location.href = url;
      }

      async function _nbdConnectAction(action) {
        window._nbdConnectError = null;
        try {
          if (action === 'refresh') {
            window._nbdConnectLinkExpired = false;
            await loadConnectStatus(true);
            return;
          }
          if (action === 'start') {
            window._nbdConnectBusy = 'Creating your Stripe account…';
            renderConnectCard();
            var mk = await _nbdConnectCallable('createConnectAccount');
            var out = await mk({});
            window._nbdConnectState = (out && out.data) || null;
            window._nbdConnectLinkExpired = false;
            // Already fully onboarded (idempotent re-click) — don't bounce them
            // back through Stripe for nothing.
            if (window._nbdConnectState && window._nbdConnectState.status === 'ready') {
              window._nbdConnectBusy = null;
              renderConnectCard();
              return;
            }
            window._nbdConnectBusy = 'Opening Stripe…';
            renderConnectCard();
            await _nbdConnectGoToOnboarding();
            return;
          }
          if (action === 'link') {
            window._nbdConnectBusy = 'Opening Stripe…';
            renderConnectCard();
            window._nbdConnectLinkExpired = false;
            await _nbdConnectGoToOnboarding();
            return;
          }
          if (action === 'dashboard') {
            window._nbdConnectBusy = 'Opening Stripe dashboard…';
            renderConnectCard();
            var dfn = await _nbdConnectCallable('createConnectDashboardLink');
            var dres = await dfn({});
            var durl = dres && dres.data && dres.data.url;
            if (!durl) throw new Error('Stripe did not return a dashboard link');
            window.location.href = durl;
            return;
          }
        } catch (e) {
          var msg = (e && e.message) ? e.message : 'unknown error';
          // createConnectAccount's generic "try again" is misleading when the
          // real cause is that Connect isn't enabled on the platform account —
          // which is the expected state until the dashboard checklist is done.
          if (action === 'start') {
            msg += ' — if this keeps failing, Connect may not be enabled on the '
              + 'Stripe platform account yet (docs/deploy/10-stripe-connect.md).';
          }
          window._nbdConnectError = msg;
          if (typeof showToast === 'function') showToast(_nbdConnectEsc(msg), 'error');
        } finally {
          window._nbdConnectBusy = null;
          renderConnectCard();
        }
      }

      // CSP: /pro allows no inline handlers, so this is a delegated listener
      // (same shape as the billing tab's managePortal/checkout delegates). The
      // flag stops template re-hydration double-installing it, which would fire
      // every action twice — and "create my Stripe account" twice is exactly
      // the race phase 1's idempotency key exists to survive.
      if (!window._NBD_CONNECT_DELEGATE) {
        window._NBD_CONNECT_DELEGATE = true;
        document.addEventListener('click', function (ev) {
          var t = ev.target.closest && ev.target.closest('[data-connect-action]');
          if (!t) return;
          if (t.disabled) return;
          t.disabled = true;
          _nbdConnectAction(t.getAttribute('data-connect-action'));
        });
      }

      // Render when the Billing tab opens. Wraps the previous
      // switchSettingsTab rather than replacing it — six other modules chain
      // onto the same function.
      function _nbdInstallConnectHook() {
        var _prevSwitch = window.switchSettingsTab;
        if (typeof _prevSwitch !== 'function') return;
        if (window._NBD_CONNECT_TAB_HOOK) return;
        window._NBD_CONNECT_TAB_HOOK = true;
        window.switchSettingsTab = function (tab) {
          _prevSwitch(tab);
          if (tab !== 'billing') return;
          // A pending refresh is set by the ?connect=return|refresh deep link
          // before this module has necessarily loaded, so it's consumed here
          // rather than pushed — load order between bootstrap and a lazily
          // hydrated template script is not guaranteed.
          var force = !!window._nbdConnectPendingRefresh;
          window._nbdConnectPendingRefresh = false;
          loadConnectStatus(force);
        };
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _nbdInstallConnectHook);
      } else {
        _nbdInstallConnectHook();
      }
      // _nbdInstallConnectHook bails (without claiming the guard) when
      // switchSettingsTab isn't defined yet. If that's the state at hydration
      // and nothing calls it again, the hook NEVER installs and the card sits on
      // "Loading payout status…" forever with no error in the console — the
      // exact silent-failure shape this repo keeps shipping. Bounded retry, one
      // interval ever, self-clearing.
      if (!window._NBD_CONNECT_TAB_HOOK && !window._NBD_CONNECT_HOOK_RETRY) {
        window._NBD_CONNECT_HOOK_RETRY = true;
        var _nbdConnectHookTries = 0;
        var _nbdConnectHookIv = setInterval(function () {
          _nbdConnectHookTries++;
          _nbdInstallConnectHook();
          if (window._NBD_CONNECT_TAB_HOOK || _nbdConnectHookTries > 40) {
            clearInterval(_nbdConnectHookIv);
          }
        }, 150);
      }
