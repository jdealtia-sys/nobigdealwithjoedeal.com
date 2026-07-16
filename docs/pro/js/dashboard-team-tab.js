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
        // Resolve the tenant key: a member/admin's companyId claim points at the
        // OWNER's uid (the company doc key); only a solo owner keys by their own
        // uid. Reading companies/{_user.uid}/members was empty for any non-owner
        // member (their uid != companyId). Mirrors company-profile.js's resolver.
        var tenantKey = (window._userClaims && window._userClaims.companyId) || window._user.uid;
        var isOwnerViewer = tenantKey === window._user.uid;
        // Owner card: present the viewer AS owner only when they actually are one;
        // otherwise label generically so a member isn't mispresented as Owner.
        var nameEl = document.getElementById('teamOwnerName');
        var initEl = document.getElementById('teamOwnerInitials');
        if (nameEl) nameEl.textContent = isOwnerViewer ? (window._user.displayName || window._user.email || 'Owner') : 'Company Owner';
        if (initEl) {
          var name = isOwnerViewer ? (window._user.displayName || window._user.email || 'O') : 'Owner';
          initEl.textContent = name.split(' ').map(function(w){return w[0]}).join('').toUpperCase().substring(0,2);
        }
        try {
          var snap = await window.getDocs(window.collection(window.db, 'companies', tenantKey, 'members'));
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
            // 30-day invite TTL (mirrors functions/handlers/invites.js
            // isInviteExpired): expired invites show as such — they've
            // already stopped consuming a seat server-side; Re-send
            // (cancel + re-invite) starts a fresh 30 days.
            var inviteExpired = false;
            if (status === 'invited' && m.invitedAt && typeof m.invitedAt.toMillis === 'function') {
              inviteExpired = (Date.now() - m.invitedAt.toMillis()) > 30 * 24 * 3600 * 1000;
            }
            var statusLabel = inviteExpired ? 'invite expired' : (m.status || 'invited');
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
              + '<div class="meta-10">' + _nbdEscHtml((m.role||'rep').replace(/_/g,' ')) + ' · ' + _nbdEscHtml(statusLabel) + '</div></div>'
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
        // Resolve tenant key like loadTeamMembers (member/admin claim → owner uid).
        // The server callables re-derive the tenant from claims, so this is a
        // presence guard; resolving it correctly keeps non-owner admins working.
        var companyId = (window._userClaims && window._userClaims.companyId) || (window._user && window._user.uid);
        if (!companyId || !email) return;
        var confirms = {
          cancel:  'Cancel the invite for ' + email + '?',
          disable: 'Disable ' + email + '? Their login stops working until re-enabled. Their leads stay.',
          enable:  'Re-enable ' + email + '?',
          remove:  'Remove ' + email + ' from the team? Their access is revoked; their leads stay.'
        };
        if (!confirm(confirms[action] || 'Proceed?')) return;
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        try {
          if (action === 'cancel' || action === 'remove') {
            // removeMember (server) strips the member's companyId/role claims
            // and revokes their tokens before deleting the roster doc — a bare
            // client deleteDoc left a removed user with live tenant access
            // (Firestore authorizes by claim, not roster membership).
            await _teamCallable('removeMember', { email: email });
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

      // ── Manual invite-claim recovery ("Check my invite now") ──
      // Self-serve escape hatch for the invite-flag scenarios (rep signed up
      // before the invite, pre-existing account, shared device): calls
      // claimInvite directly, bypassing the boot-time flag gate entirely.
      // Document-level delegate because the button lives OUTSIDE
      // #teamMembersList; guarded against template re-hydration double-wiring.
      async function checkMyInvite(btn) {
        var out = document.getElementById('inviteCheckResult');
        var say = function (msg, color) {
          if (out) { out.textContent = msg; out.style.color = color || 'var(--m)'; }
        };
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
        try {
          var res = await _teamCallable('claimInvite', {});
          var data = (res && res.data) || {};
          if (data.claimed) {
            say('Invite found! Joining your team — reloading…', 'var(--orange)');
            if (window._user) await window._user.getIdToken(true);
            try {
              localStorage.setItem('nbd_invite_checked_' + (window._user && window._user.uid), '1');
            } catch (_) {}
            window.location.reload();
            return;
          }
          if (data.reason === 'already_member') {
            say('You are already on a team.', 'var(--m)');
          } else {
            say('No pending invite found for your email address. Ask your team owner to send one to the exact email you sign in with.', 'var(--m)');
          }
        } catch (e) {
          // failed-precondition = invite exists but email not verified yet.
          var msg = String((e && e.message) || 'unknown error');
          if (/verify your email/i.test(msg)) {
            say('An invite is waiting — verify your email address first, then try again.', 'var(--orange)');
          } else {
            say('Check failed: ' + msg, '#c53030');
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Check my invite now'; }
        }
      }
      if (!window._NBD_INVITE_CHECK_DELEGATE) {
        window._NBD_INVITE_CHECK_DELEGATE = true;
        document.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-team-action="checkMyInvite"]');
          if (btn) checkMyInvite(btn);
        });
      }
