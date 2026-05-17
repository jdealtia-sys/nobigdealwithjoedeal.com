function switchScTab(tab, btn) {
  document.getElementById('scTabShortcuts').style.display = tab === 'shortcuts' ? '' : 'none';
  document.getElementById('scTabHowto').style.display = tab === 'howto' ? '' : 'none';
  document.querySelectorAll('.sc-tab').forEach(b => {
    b.classList.remove('active');
    b.style.color = 'var(--m)';
    b.style.borderBottomColor = 'transparent';
  });
  btn.classList.add('active');
  btn.style.color = 'var(--t)';
  btn.style.borderBottomColor = 'var(--orange)';
}
