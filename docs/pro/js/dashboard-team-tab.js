      // ── Team management functions ──
      // Hardening 2026-06-09: member docs are semi-external strings — today
      // they're owner-typed invites, but any signup/import path that writes
      // the same companies/<uid>/members collection feeds this renderer too.
      // Every member field that lands in the row template's innerHTML goes
      // through _nbdEscHtml (same fix shape as widgets.js esc(), PR #595;
      // that copy is IIFE-scoped, so this hydrated-template script defines
      // its own).
      function _nbdEscHtml(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      async function inviteTeamMember() {
        var email = (document.getElementById('inviteRepEmail')?.value || '').trim();
        var role = document.getElementById('inviteRepRole')?.value || 'sales_rep';
        if (!email || !email.includes('@')) {
          if (typeof showToast === 'function') showToast('Enter a valid email address', 'error');
          return;
        }
        if (!window._user?.uid) {
          if (typeof showToast === 'function') showToast('Not signed in', 'error');
          return;
        }
        try {
          // Pillar 4: invites go through the createTeamInvite callable —
          // firestore.rules denies client member CREATEs now so plan seat
          // limits are enforced server-side. The callable also ensures the
          // companies/{uid} doc exists (the setDoc that used to live here).
          // Self-provision the functions SDK globals (billing-gate pattern) —
          // they're set lazily and may not exist at click time.
          if (!(window._functions && window._httpsCallable)) {
            var mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
            window._functions = window._functions || mod.getFunctions();
            window._httpsCallable = window._httpsCallable || mod.httpsCallable;
          }
          var inviteFn = window._httpsCallable(window._functions, 'createTeamInvite');
          var res = await inviteFn({ email: email.toLowerCase(), role: role });
          var out = (res && res.data) || {};
          document.getElementById('inviteRepEmail').value = '';
          // showToast (dashboard-ui.js) renders msg via innerHTML — escape
          // the typed email before it rides along.
          // Phase 3: the teamInviteEmail trigger now actually emails the
          // invitee signup steps — the old copy said "sent" when nothing was.
          if (typeof showToast === 'function') {
            var seatNote = (out.seatsLimit != null) ? ' (' + out.seatsUsed + ' of ' + out.seatsLimit + ' seats)' : '';
            showToast(
              out.invited
                ? (out.resent ? 'Invite re-sent to ' : 'Invite created — ') + _nbdEscHtml(email) + (out.resent ? '' : ' will get an email with signup steps') + seatNote
                : _nbdEscHtml(email) + ' is already on your team',
              out.invited ? 'success' : 'error'
            );
          }
          loadTeamMembers();
        } catch (e) {
          console.error('Invite failed:', e);
          // Callable errors carry a human message (seat limit, bad role…).
          if (typeof showToast === 'function') showToast('Invite failed: ' + _nbdEscHtml(e.message || 'unknown error'), 'error');
        }
      }
      async function loadTeamMembers() {
        var list = document.getElementById('teamMembersList');
        if (!list || !window._user?.uid) return;
        // Populate owner card
        var nameEl = document.getElementById('teamOwnerName');
        var initEl = document.getElementById('teamOwnerInitials');
        if (nameEl) nameEl.textContent = window._user.displayName || window._user.email || 'Owner';
        if (initEl) {
          var name = window._user.displayName || window._user.email || 'O';
          initEl.textContent = name.split(' ').map(function(w){return w[0]}).join('').toUpperCase().substring(0,2);
        }
        try {
          var snap = await window.getDocs(window.collection(window.db, 'companies', window._user.uid, 'members'));
          if (snap.empty) { list.innerHTML = ''; return; }
          list.innerHTML = snap.docs.map(function(d) {
            var m = d.data();
            // roleColors lookups stay unescaped: unknown keys fall back to
            // a fixed CSS-var literal, so the output set is closed.
            var roleColors = { sales_rep:'var(--green)', manager:'var(--blue)', viewer:'var(--m)' };
            // Per-status management actions (Pillar 5 settings round). Invite
            // cancel = client delete (rules allow owner update/delete on
            // members; only CREATE is server-only). Disable/re-enable route
            // through the deactivateUser callable so the rep's Auth account
            // and sessions actually flip, not just the roster row.
            var status = m.status || 'invited';
            var email = String(m.email || d.id || '');
            var btnBase = 'background:none;border:1px solid var(--br);color:var(--m);border-radius:6px;padding:4px 9px;font-size:10px;cursor:pointer;';
            var actions = '';
            if (status === 'invited') {
              actions = '<button style="' + btnBase + '" data-team-action="cancel" data-email="' + _nbdEscHtml(email) + '">Cancel invite</button>';
            } else if (status === 'active') {
              actions = '<button style="' + btnBase + '" data-team-action="disable" data-email="' + _nbdEscHtml(email) + '">Disable</button>';
            } else {
              actions = '<button style="' + btnBase + '" data-team-action="enable" data-email="' + _nbdEscHtml(email) + '">Re-enable</button>'
                + '<button style="' + btnBase + 'margin-left:6px;color:var(--red,#e05252);border-color:var(--red,#e05252);" data-team-action="remove" data-email="' + _nbdEscHtml(email) + '">Remove</button>';
            }
            return '<div style="padding:12px;background:var(--s2);border:1px solid var(--br);border-radius:7px;margin-bottom:6px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
              + '<div style="width:36px;height:36px;border-radius:18px;background:var(--s3);color:var(--m);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + _nbdEscHtml((m.email||'?')[0].toUpperCase()) + '</div>'
              + '<div class="f1"><div style="font-size:13px;font-weight:600;color:var(--t);">' + _nbdEscHtml(m.email||'') + '</div>'
              + '<div class="meta-10">' + _nbdEscHtml((m.role||'rep').replace(/_/g,' ')) + ' · ' + _nbdEscHtml(m.status||'invited') + '</div></div>'
              + '<span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:10px;border:1px solid ' + (roleColors[m.role]||'var(--br)') + ';color:' + (roleColors[m.role]||'var(--m)') + ';text-transform:uppercase;letter-spacing:.06em;">' + _nbdEscHtml((m.role||'rep').replace(/_/g,' ')) + '</span>'
              + '<div>' + actions + '</div>'
              + '</div>';
          }).join('');
        } catch(e) { console.warn('loadTeamMembers:', e.message); }
      }

      // ── Member row actions (delegated; no inline handlers under strict CSP) ──
      async function _teamCallable(name, payload) {
        if (!(window._functions && window._httpsCallable)) {
          var mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
          window._functions = window._functions || mod.getFunctions();
          window._httpsCallable = window._httpsCallable || mod.httpsCallable;
        }
        return window._httpsCallable(window._functions, name)(payload);
      }
      async function handleTeamAction(action, email, btn) {
        var companyId = window._user && window._user.uid;
        if (!companyId || !email) return;
        var confirms = {
          cancel:  'Cancel the invite for ' + email + '?',
          disable: 'Disable ' + email + '? Their login stops working until re-enabled. Their leads stay.',
          enable:  'Re-enable ' + email + '?',
          remove:  'Remove ' + email + ' from the roster? (Their account stays disabled; their leads stay.)'
        };
        if (!confirm(confirms[action] || 'Proceed?')) return;
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        try {
          if (action === 'cancel' || action === 'remove') {
            await window.deleteDoc(window.doc(window.db, 'companies', companyId, 'members', email.toLowerCase()));
          } else {
            await _teamCallable('deactivateUser', { email: email, reactivate: action === 'enable' });
          }
          if (typeof showToast === 'function') showToast('✓ Done', 'success');
        } catch (e) {
          console.warn('team action failed:', e);
          if (typeof showToast === 'function') showToast('Failed: ' + _nbdEscHtml(e.message || 'unknown error'), 'error');
        }
        loadTeamMembers();
      }
      (function _wireTeamActions() {
        var list = document.getElementById('teamMembersList');
        if (!list || list._nbdTeamActionsWired) return;
        list._nbdTeamActionsWired = true;
        list.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-team-action]');
          if (!btn) return;
          handleTeamAction(btn.getAttribute('data-team-action'), btn.getAttribute('data-email') || '', btn);
        });
      })();
      // Load team when tab opens. This script ships INSIDE the lazily-
      // hydrated tpl-view-settings template, so it is re-executed by
      // _hydrateViewTemplate() on the first goTo('settings') — AFTER
      // DOMContentLoaded has already fired. A bare DOMContentLoaded
      // listener therefore never fires, the wrapper never installs, and
      // the owner card stays stuck on its 'JD'/'Loading...' placeholder.
      // Use a readyState guard (same idiom as dashboard-accessory-panel-init.js).
      function _installTeamTabHook() {
        var _prev = window.switchSettingsTab;
        if (typeof _prev !== 'function') return;
        window.switchSettingsTab = function(tab) {
          _prev(tab);
          if (tab === 'team') loadTeamMembers();
        };
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installTeamTabHook);
      } else {
        _installTeamTabHook();
      }
