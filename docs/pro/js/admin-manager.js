/**
 * admin-manager.js — Team Account Manager UI controller
 *
 * Backs the #view-admin pane and its two modals. Calls four callables:
 *   listTeamMembers     → GET roster (with Auth metadata + lead counts)
 *   createTeamMember    → create Firebase Auth user + role claims + invite
 *   updateUserRole      → change role for an existing member
 *   deactivateUser      → disable Auth account (or reactivate)
 *
 * Permission gating:
 *   The view is hidden from non-admins in dashboard.html by default.
 *   We reveal it only when the signed-in user is a global admin,
 *   the company owner (uid == companies/{companyId}.ownerId), or the
 *   solo-operator default (ownerId not yet set — claims companyId is
 *   missing, so this is their own workspace).
 */
(function () {
  'use strict';

  // Role taxonomy:
  //   'admin'         → PLATFORM admin (hidden from UI; set only via
  //                      admin SDK script). Callables refuse to grant
  //                      this — it's shown here only so an owner
  //                      viewing the roster sees what a platform
  //                      admin would look like.
  //   'company_admin' → tenant owner.
  //   'manager'       → team-wide read, per-rep actions.
  //   'sales_rep'     → owns own docs.
  //   'viewer'        → read-only inside own company.
  const ROLE_LABELS = {
    admin:          'Platform Admin',
    company_admin:  'Company Admin',
    manager:        'Manager',
    sales_rep:      'Sales Rep',
    viewer:         'Viewer'
  };
  const ROLE_COLORS = {
    admin:          'var(--red, #ff5c5c)',
    company_admin:  'var(--orange)',
    manager:        'var(--blue, #4b8dff)',
    sales_rep:      'var(--green)',
    viewer:         'var(--m)'
  };

  const state = {
    loaded: false,
    loading: false,
    members: [],
    filter: '',
    editingUid: null,
    editingEmail: null,
    gatedChecked: false,
    canManage: false
  };

  // ── Callable function loader ─────────────────────────────
  // Reuse window._functions if rep-report-generator already bootstrapped it.
  async function callable(name) {
    if (!window._functions || !window._httpsCallable) {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = mod.getFunctions();
      window._httpsCallable = mod.httpsCallable;
    }
    return window._httpsCallable(window._functions, name);
  }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
    else console.log('[admin]', kind || 'info', msg);
  }

  // ── Permission gate ──────────────────────────────────────
  // Reveal the nav entry only for admins/owners. Called on first load
  // and whenever auth state flips. Safe to call multiple times.
  async function applyGate() {
    const navEl = document.getElementById('nav-admin');
    if (!navEl) return;
    if (!window._user) { navEl.style.display = 'none'; state.canManage = false; return; }

    const claims = window._userClaims || {};
    const isGlobalAdmin  = claims.role === 'admin';
    const isCompanyAdmin = claims.role === 'company_admin';
    // Solo operator: no companyId claim → they own their own workspace.
    const isSoloOwner = !claims.companyId;
    // Team member with companyId: we need to check if they're the owner.
    let isCompanyOwner = false;

    if (claims.companyId && window.db && window.doc && window.getDoc) {
      try {
        const snap = await window.getDoc(window.doc(window.db, 'companies', claims.companyId));
        isCompanyOwner = snap.exists() && snap.data().ownerId === window._user.uid;
      } catch (e) { /* rules may deny — treat as non-owner */ }
    }

    state.canManage = isGlobalAdmin || isCompanyAdmin || isSoloOwner || isCompanyOwner;
    navEl.style.display = state.canManage ? '' : 'none';
    state.gatedChecked = true;
  }

  // ── Load roster ──────────────────────────────────────────
  async function loadMembers() {
    if (state.loading) return;
    state.loading = true;
    const container = document.getElementById('adminRosterContainer');
    if (container && !state.loaded) {
      container.innerHTML = '<div class="empty" style="padding:30px;"><div class="empty-icon">⏳</div>Loading team roster…</div>';
    }
    try {
      const fn = await callable('listTeamMembers');
      const res = await fn({});
      state.members = Array.isArray(res?.data?.members) ? res.data.members : [];
      state.loaded = true;
      render();
    } catch (e) {
      console.error('listTeamMembers failed:', e);
      if (container) {
        container.innerHTML = '<div class="empty" style="padding:30px;"><div class="empty-icon">⚠️</div>'
          + 'Failed to load team: ' + (e.message || 'unknown error') + '</div>';
      }
      toast('Could not load team roster', 'error');
    } finally {
      state.loading = false;
    }
  }

  // ── Render ───────────────────────────────────────────────
  function render() {
    const container = document.getElementById('adminRosterContainer');
    if (!container) return;

    const q = (state.filter || '').toLowerCase().trim();
    const filtered = state.members.filter(m => {
      if (!q) return true;
      return (m.email || '').toLowerCase().includes(q)
        || (m.displayName || '').toLowerCase().includes(q)
        || (m.role || '').toLowerCase().includes(q)
        || (m.status || '').toLowerCase().includes(q);
    });

    // Summary cards
    const active = state.members.filter(m => m.status === 'active').length;
    const invited = state.members.filter(m => m.status === 'invited').length;
    const deactivated = state.members.filter(m => m.status === 'deactivated').length;
    setText('adminStatTotal', String(state.members.length));
    setText('adminStatActive', String(active));
    setText('adminStatInvited', String(invited));
    setText('adminStatDeactivated', String(deactivated));

    if (!filtered.length) {
      container.innerHTML = '<div class="empty" style="padding:30px;"><div class="empty-icon">👥</div>'
        + (state.members.length ? 'No members match the filter.' : 'No team members yet — click "+ New User" to get started.')
        + '</div>';
      return;
    }

    const rows = filtered.map(m => {
      const initials = (m.displayName || m.email || '?')
        .split(/\s+/).map(s => s[0] || '').join('').toUpperCase().slice(0, 2);
      const roleColor = ROLE_COLORS[m.role] || 'var(--m)';
      const roleLabel = ROLE_LABELS[m.role] || m.role || 'Rep';
      const lastSeen = m.lastSignInTime
        ? new Date(m.lastSignInTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const statusBadge = statusPill(m.status);
      const rowId = 'admin-row-' + (m.uid || m.email).replace(/[^a-z0-9]/gi, '_');
      const actions = m.isOwner
        ? '<span style="font-size:10px;color:var(--m);padding:5px 10px;">Owner</span>'
        : '<button class="btn btn-ghost" style="font-size:11px;padding:5px 12px;" data-email="'
          + escapeAttr(m.email) + '" data-uid="' + escapeAttr(m.uid || '') + '">Edit</button>';
      return '<div id="' + rowId + '" class="admin-row" style="display:grid;grid-template-columns:40px 2fr 1fr 1fr 1fr 110px 80px;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--br);cursor:pointer;"'
        + ' data-email="' + escapeAttr(m.email) + '" data-uid="' + escapeAttr(m.uid || '') + '">'
        + '<div style="width:36px;height:36px;border-radius:18px;background:var(--s2);border:1px solid var(--br);color:var(--t);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">'
        +   escapeHTML(initials) + '</div>'
        + '<div><div style="font-size:13px;font-weight:600;color:var(--t);">' + escapeHTML(m.displayName || m.email) + '</div>'
        +   '<div style="font-size:11px;color:var(--m);">' + escapeHTML(m.email) + '</div></div>'
        + '<div><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;border:1px solid ' + roleColor + ';color:' + roleColor + ';text-transform:uppercase;letter-spacing:.06em;">' + escapeHTML(roleLabel) + '</span></div>'
        + '<div style="font-size:11px;color:var(--m);">' + statusBadge + '</div>'
        + '<div style="font-size:11px;color:var(--m);">' + escapeHTML(lastSeen) + '</div>'
        + '<div style="font-size:11px;color:var(--t);font-weight:600;">' + (m.leadCount || 0) + ' leads</div>'
        + '<div style="text-align:right;">' + actions + '</div>'
        + '</div>';
    }).join('');

    container.innerHTML =
      '<div style="display:grid;grid-template-columns:40px 2fr 1fr 1fr 1fr 110px 80px;gap:10px;padding:10px 16px;font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--br);background:var(--s2);">'
      + '<div></div><div>Name / Email</div><div>Role</div><div>Status</div><div>Last Login</div><div>Leads</div><div style="text-align:right;">Actions</div>'
      + '</div>'
      + rows;

    // Wire row clicks (activity feed) + edit button (stop propagation).
    container.querySelectorAll('.admin-row').forEach(row => {
      row.addEventListener('click', ev => {
        if (ev.target.closest('button')) return;
        const uid = row.getAttribute('data-uid') || null;
        const email = row.getAttribute('data-email');
        showActivity(email, uid);
      });
    });
    container.querySelectorAll('button[data-email]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const email = btn.getAttribute('data-email');
        const uid = btn.getAttribute('data-uid') || null;
        openEdit(email, uid);
      });
    });
  }

  function statusPill(status) {
    const map = {
      active:      { color: 'var(--green)', label: 'Active' },
      invited:     { color: 'var(--orange)', label: 'Invited' },
      deactivated: { color: 'var(--m)', label: 'Deactivated' }
    };
    const s = map[status] || { color: 'var(--m)', label: status || '—' };
    return '<span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;'
      + 'text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.04);'
      + 'color:' + s.color + ';border:1px solid ' + s.color + ';border-radius:10px;">' + s.label + '</span>';
  }

  // ── Activity feed ────────────────────────────────────────
  // Simple query against the user's own leads (ordered by createdAt desc).
  async function showActivity(email, uid) {
    const feed = document.getElementById('adminActivityFeed');
    const title = document.getElementById('adminActivityTitle');
    if (title) title.textContent = 'Activity — ' + (email || '—');
    if (!feed) return;
    if (!uid) {
      feed.innerHTML = '<div style="color:var(--m);font-size:12px;">This member hasn\'t signed in yet — no activity recorded.</div>';
      return;
    }
    feed.innerHTML = '<div style="color:var(--m);font-size:12px;">Loading activity…</div>';
    try {
      if (!window.db || !window.collection || !window.query || !window.where) {
        feed.innerHTML = '<div style="color:var(--m);font-size:12px;">Firestore SDK not ready.</div>';
        return;
      }
      const q = window.query(
        window.collection(window.db, 'leads'),
        window.where('userId', '==', uid)
      );
      const snap = await window.getDocs(q);
      const leads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0;
          const tb = b.createdAt?.toMillis?.() || 0;
          return tb - ta;
        }).slice(0, 15);

      if (!leads.length) {
        feed.innerHTML = '<div style="color:var(--m);font-size:12px;">No leads logged yet.</div>';
        return;
      }
      feed.innerHTML = leads.map(l => {
        const when = l.createdAt?.toDate?.()?.toLocaleString() || '—';
        const addr = l.address || l.name || l.id;
        return '<div style="padding:10px 0;border-bottom:1px solid var(--br);display:flex;justify-content:space-between;gap:12px;">'
          + '<div><div style="font-size:12px;color:var(--t);font-weight:600;">' + escapeHTML(addr) + '</div>'
          +   '<div style="font-size:10px;color:var(--m);">' + escapeHTML(l.stage || l.status || 'lead') + '</div></div>'
          + '<div style="font-size:10px;color:var(--m);white-space:nowrap;">' + escapeHTML(when) + '</div>'
          + '</div>';
      }).join('');
    } catch (e) {
      console.warn('activity load failed:', e);
      feed.innerHTML = '<div style="color:var(--m);font-size:12px;">Could not load activity: '
        + escapeHTML(e.message || 'unknown error') + '</div>';
    }
  }

  // ── Create user modal ────────────────────────────────────
  function openCreate() {
    const modal = document.getElementById('adminCreateModal');
    if (!modal) return;
    document.getElementById('adminNewEmail').value = '';
    document.getElementById('adminNewName').value = '';
    document.getElementById('adminNewRole').value = 'sales_rep';
    modal.style.display = 'flex';
  }
  function closeCreate() {
    const modal = document.getElementById('adminCreateModal');
    if (modal) modal.style.display = 'none';
  }
  async function submitCreate() {
    const email = (document.getElementById('adminNewEmail').value || '').trim();
    const displayName = (document.getElementById('adminNewName').value || '').trim();
    const role = document.getElementById('adminNewRole').value || 'sales_rep';
    if (!email.includes('@')) { toast('Enter a valid email', 'error'); return; }
    const btn = document.getElementById('adminNewSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    try {
      const fn = await callable('createTeamMember');
      const res = await fn({ email, displayName, role });
      if (res?.data?.success) {
        toast('User created: ' + email, 'success');
        closeCreate();
        loadMembers();
        // Fire password reset so the user can set their own password.
        try {
          if (window.auth && window.sendPasswordResetEmail) {
            await window.sendPasswordResetEmail(window.auth, email);
            toast('Invite email sent', 'success');
          }
        } catch (e) { console.warn('password reset email skipped:', e.message); }
      } else {
        toast('Create failed', 'error');
      }
    } catch (e) {
      console.error('createTeamMember failed:', e);
      toast(e.message || 'Create failed', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create User'; }
    }
  }

  // ── Edit user modal ──────────────────────────────────────
  function openEdit(email, uid) {
    const member = state.members.find(m => m.email === email || m.uid === uid);
    if (!member) { toast('Member not found', 'error'); return; }
    if (member.isOwner) { toast('Cannot edit the company owner here', 'info'); return; }
    state.editingEmail = member.email;
    state.editingUid = member.uid || null;

    const modal = document.getElementById('adminEditModal');
    if (!modal) return;
    document.getElementById('adminEditTitle').textContent = member.displayName || member.email;
    document.getElementById('adminEditSub').textContent = member.email;
    document.getElementById('adminEditRole').value = member.role || 'sales_rep';
    document.getElementById('adminEditStatusText').textContent = member.status || '—';
    const deactBtn = document.getElementById('adminEditDeactivateBtn');
    if (deactBtn) {
      if (member.status === 'deactivated' || member.disabled) {
        deactBtn.textContent = 'Reactivate Account';
        deactBtn.classList.remove('btn-red');
        deactBtn.classList.add('btn-green');
      } else {
        deactBtn.textContent = 'Deactivate Account';
        deactBtn.classList.remove('btn-green');
        deactBtn.classList.add('btn-red');
      }
    }
    modal.style.display = 'flex';
  }
  function closeEdit() {
    const modal = document.getElementById('adminEditModal');
    if (modal) modal.style.display = 'none';
    state.editingEmail = null;
    state.editingUid = null;
  }
  async function submitEdit() {
    if (!state.editingEmail && !state.editingUid) return;
    const role = document.getElementById('adminEditRole').value;
    const btn = document.getElementById('adminEditSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const fn = await callable('updateUserRole');
      const res = await fn({ email: state.editingEmail, uid: state.editingUid, role });
      if (res?.data?.success) {
        toast('Role updated', 'success');
        closeEdit();
        loadMembers();
      } else {
        toast('Update failed', 'error');
      }
    } catch (e) {
      console.error('updateUserRole failed:', e);
      toast(e.message || 'Update failed', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  }
  async function toggleDeactivate() {
    if (!state.editingEmail && !state.editingUid) return;
    const member = state.members.find(m =>
      m.email === state.editingEmail || m.uid === state.editingUid);
    if (!member) return;
    const reactivate = member.status === 'deactivated' || member.disabled;
    const confirmMsg = reactivate
      ? 'Reactivate ' + (member.displayName || member.email) + '?'
      : 'Deactivate ' + (member.displayName || member.email) + '? They will be signed out and unable to log in. Data is preserved.';
    if (!window.confirm(confirmMsg)) return;
    try {
      const fn = await callable('deactivateUser');
      const res = await fn({ email: state.editingEmail, uid: state.editingUid, reactivate });
      if (res?.data?.success) {
        toast(reactivate ? 'Account reactivated' : 'Account deactivated', 'success');
        closeEdit();
        loadMembers();
      } else {
        toast('Operation failed', 'error');
      }
    } catch (e) {
      console.error('deactivateUser failed:', e);
      toast(e.message || 'Operation failed', 'error');
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHTML(s); }

  // ── Boot ─────────────────────────────────────────────────
  function wireFilter() {
    const input = document.getElementById('adminRosterFilter');
    if (!input) return;
    input.addEventListener('input', () => {
      state.filter = input.value || '';
      render();
    });
  }

  function refresh() {
    state.loaded = false;
    loadMembers();
  }

  function init() {
    wireFilter();
    applyGate();
    // Re-check gate on auth-state flips. The main auth listener sets
    // window._user + window._userClaims, so just poll for a change.
    let lastUid = null;
    setInterval(() => {
      const uid = window._user?.uid || null;
      if (uid !== lastUid) {
        lastUid = uid;
        applyGate();
      }
    }, 1000);
  }

  // Hook into goTo so entering view-admin triggers a load.
  function hookNavigation() {
    const origGoTo = window.goTo;
    if (typeof origGoTo !== 'function') { setTimeout(hookNavigation, 200); return; }
    window.goTo = function (name, params) {
      const result = origGoTo.apply(this, arguments);
      if (name === 'admin') {
        if (!state.canManage) {
          toast('Admin access required', 'error');
          origGoTo('dash');
          return result;
        }
        if (!state.loaded) loadMembers();
      }
      return result;
    };
  }

  // Public API
  window.AdminManager = {
    init,
    refresh,
    openCreate,
    closeCreate,
    submitCreate,
    closeEdit,
    submitEdit,
    toggleDeactivate,
    applyGate
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); hookNavigation(); });
  } else {
    init();
    hookNavigation();
  }
})();
