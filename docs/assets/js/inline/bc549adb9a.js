/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: bc549adb9a.  Do not edit by hand. */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.cat;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.project').forEach(p => {
      p.classList.toggle('hidden', !(cat === 'all' || p.dataset.cat === cat));
    });
  });
});
