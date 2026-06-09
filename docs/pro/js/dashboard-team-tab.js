      // ── Team management functions ──
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
          // Create or get the company doc
          var companyId = window._user.uid; // solo operator = their own company
          await window.setDoc(window.doc(window.db, 'companies', companyId), {
            ownerId: window._user.uid,
            name: window._user.displayName || 'My Company',
            createdAt: window.serverTimestamp()
          }, { merge: true });
          // Add the invited member
          await window.setDoc(window.doc(window.db, 'companies', companyId, 'members', email.toLowerCase()), {
            email: email.toLowerCase(),
            role: role,
            status: 'invited',
            invitedAt: window.serverTimestamp(),
            invitedBy: window._user.uid
          });
          document.getElementById('inviteRepEmail').value = '';
          if (typeof showToast === 'function') showToast('Invite sent to ' + email, 'success');
          loadTeamMembers();
        } catch (e) {
          console.error('Invite failed:', e);
          if (typeof showToast === 'function') showToast('Invite failed: ' + e.message, 'error');
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
            var roleColors = { sales_rep:'var(--green)', manager:'var(--blue)', viewer:'var(--m)' };
            return '<div style="padding:12px;background:var(--s2);border:1px solid var(--br);border-radius:7px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">'
              + '<div style="width:36px;height:36px;border-radius:18px;background:var(--s3);color:var(--m);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + (m.email||'?')[0].toUpperCase() + '</div>'
              + '<div class="f1"><div style="font-size:13px;font-weight:600;color:var(--t);">' + (m.email||'') + '</div>'
              + '<div class="meta-10">' + (m.role||'rep').replace(/_/g,' ') + ' · ' + (m.status||'invited') + '</div></div>'
              + '<span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:10px;border:1px solid ' + (roleColors[m.role]||'var(--br)') + ';color:' + (roleColors[m.role]||'var(--m)') + ';text-transform:uppercase;letter-spacing:.06em;">' + (m.role||'rep').replace(/_/g,' ') + '</span>'
              + '</div>';
          }).join('');
        } catch(e) { console.warn('loadTeamMembers:', e.message); }
      }
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
