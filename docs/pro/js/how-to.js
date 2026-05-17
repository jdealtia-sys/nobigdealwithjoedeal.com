/* /pro/how-to page logic — extracted from inline <script> because CSP
   `script-src-elem 'self'` blocks inline blocks. */

// ── Reveal page once styles paint ──
document.documentElement.style.visibility = 'visible';

// ── Restart-tour button ──
document.getElementById('restartTourBtn').addEventListener('click', () => {
  try { localStorage.removeItem('nbd-onboarding-complete'); } catch (e) {}
  // Tour lives on the dashboard. Send the user there and let it auto-fire.
  window.location.href = 'dashboard.html';
});

// ── Sticky TOC active-section tracking ──
const tocLinks = document.querySelectorAll('.toc a[href^="#"]');
const sections = Array.from(document.querySelectorAll('.section[id]'));
function updateActiveSection() {
  const scrollPos = window.scrollY + 100;
  let active = sections[0];
  for (const s of sections) {
    if (s.offsetTop <= scrollPos) active = s;
  }
  tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + active.id));
}
window.addEventListener('scroll', updateActiveSection, { passive: true });
updateActiveSection();

// ── Client-side search ──
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const noResults = document.getElementById('noResults');

function clearHighlights() {
  document.querySelectorAll('mark.hl').forEach(m => {
    const parent = m.parentNode;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
}

function highlightInNode(node, query) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    const mark = document.createElement('mark');
    mark.className = 'hl';
    mark.textContent = match;
    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));
    node.parentNode.replaceChild(frag, node);
  } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT','STYLE','MARK'].includes(node.tagName)) {
    Array.from(node.childNodes).forEach(child => highlightInNode(child, query));
  }
}

function runSearch(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  clearHighlights();

  if (!query) {
    sections.forEach(s => s.classList.remove('dim'));
    noResults.classList.remove('show');
    searchClear.classList.remove('show');
    return;
  }
  searchClear.classList.add('show');

  let matchCount = 0;
  sections.forEach(s => {
    const haystack = (s.textContent + ' ' + (s.dataset.keywords || '')).toLowerCase();
    const matches = haystack.includes(query);
    s.classList.toggle('dim', !matches);
    if (matches) {
      matchCount++;
      highlightInNode(s, query);
      // Auto-open details that contain matches so the user sees them
      s.querySelectorAll('details').forEach(d => {
        if (d.textContent.toLowerCase().includes(query)) d.open = true;
      });
    }
  });
  noResults.classList.toggle('show', matchCount === 0);
}

let _searchDebounce;
searchInput.addEventListener('input', e => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => runSearch(e.target.value), 120);
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  runSearch('');
});

// Keyboard: '/' focuses search, Esc clears
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    runSearch('');
    searchInput.blur();
  }
});

// Honor ?q=foo in URL on load
const params = new URLSearchParams(window.location.search);
const qParam = params.get('q');
if (qParam) { searchInput.value = qParam; runSearch(qParam); }
