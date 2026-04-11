(function() {
  try {
    const path = window.location.pathname;
    const pageMap = {
      '/pro/': 'home', '/pro/dashboard.html': 'dashboard',
      '/pro/daily-success/': 'daily-success', '/pro/daily-success/index.html': 'daily-success',
      '/pro/ai-tree.html': 'ai-tree', '/pro/codex.html': 'codex',
      '/pro/project-codex.html': 'project-codex', '/pro/understand.html': 'understand',
      '/pro/demo.html': 'demo',
    };
    const activePage = pageMap[path] || '';
    if (activePage) {
      document.querySelectorAll('.nnav-link, .nnav-drawer-link').forEach(link => {
        if (link.dataset.page === activePage) link.classList.add('active');
      });
    }
    const user = window._auth?.currentUser || window.auth?.currentUser;
    if (user) {
      const label = user.email || user.displayName || '';
      document.getElementById('nnav-user-label').textContent = label;
      const dd = document.getElementById('nnav-drawer-user');
      if (dd) dd.textContent = label;
      ['nnav-auth-btn','nnav-drawer-auth-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.textContent = 'Logout'; btn.classList.add('logout'); btn.href = '#'; btn.onclick = () => { window._auth?.signOut(); location.href = '/pro/login.html'; }; }
      });
    }
  } catch(e) {}
})();

function nbdNavToggle() {
  const drawer = document.getElementById('nbd-nav-drawer');
  const burger = document.getElementById('nnav-burger');
  const open = drawer.classList.toggle('open');
  burger.style.opacity = open ? '0.6' : '1';
  document.body.style.overflow = open ? 'hidden' : '';
}
document.querySelectorAll('.nnav-drawer-link').forEach(l => {
  l.addEventListener('click', () => { document.getElementById('nbd-nav-drawer').classList.remove('open'); document.body.style.overflow = ''; });
});
document.addEventListener('click', e => {
  const drawer = document.getElementById('nbd-nav-drawer');
  const burger = document.getElementById('nnav-burger');
  const nav = document.getElementById('nbd-pro-nav');
  if (drawer.classList.contains('open') && !nav.contains(e.target) && !drawer.contains(e.target)) {
    drawer.classList.remove('open'); document.body.style.overflow = '';
  }
});
window.nbdNavToggle = nbdNavToggle;
