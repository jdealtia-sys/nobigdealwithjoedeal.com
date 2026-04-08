// ============================================================
// NBD Pro — ui.js
// Command Palette, Keyboard Shortcuts, Skeleton Screens,
// Toast Notifications, Settings/Nav UI, Navigation
// Extracted from dashboard.html for maintainability
// ============================================================

// COMMAND PALETTE (Cmd+K)
// ══════════════════════════════════════════════

let cmdSelectedIndex = 0;
let cmdCurrentResults = [];

// Open command palette
function openCmdPalette() {
  const palette = document.getElementById('cmdPalette');
  const input = document.getElementById('cmdInput');
  palette.style.display = 'flex';
  input.value = '';
  input.focus();
  cmdSelectedIndex = 0;
  renderCmdResults(getCmdActions());
  loadCmdRecents();
}

// Close command palette
function closeCmdPalette() {
  const palette = document.getElementById('cmdPalette');
  palette.style.display = 'none';
  cmdCurrentResults = [];
}

// Get quick actions
function getCmdActions() {
  return [
    { type: 'action', icon: '➕', title: 'New Lead', meta: 'Create a new customer lead', action: () => { closeCmdPalette(); openLeadModal(); } },
    { type: 'action', icon: '📋', title: 'New Estimate', meta: 'Build a new estimate', action: () => { closeCmdPalette(); goTo('est'); if(typeof startNewEstimate==='function')startNewEstimate(); } },
    { type: 'action', icon: '🗺️', title: 'Go to Map', meta: 'View leads on map', action: () => { closeCmdPalette(); goTo('map'); } },
    { type: 'action', icon: '📸', title: 'Go to Photos', meta: 'Manage project photos', action: () => { closeCmdPalette(); goTo('photos'); } },
    { type: 'action', icon: '📊', title: 'Go to Dashboard', meta: 'View overview stats', action: () => { closeCmdPalette(); goTo('dash'); } },
    { type: 'action', icon: '⚙️', title: 'Settings', meta: 'Manage account settings', action: () => { closeCmdPalette(); goTo('settings'); } },
    { type: 'action', icon: '💾', title: 'Export CSV', meta: 'Download leads as CSV', action: () => { closeCmdPalette(); if(typeof exportLeadsCSV==='function')exportLeadsCSV(); } },
    { type: 'action', icon: '🎨', title: 'Change Theme', meta: 'Customize appearance', action: () => { closeCmdPalette(); nbdPickerOpen(); } },
  ];
}

// Fuzzy search
function cmdFuzzySearch(query) {
  const results = [];
  const q = query.toLowerCase();
  
  // Search actions
  getCmdActions().forEach(action => {
    if (action.title.toLowerCase().includes(q) || action.meta.toLowerCase().includes(q)) {
      results.push({ ...action, score: cmdScoreMatch(q, action.title.toLowerCase()) });
    }
  });
  
  // Search leads
  if (window.allLeads && window.allLeads.length > 0) {
    window.allLeads.forEach(lead => {
      const searchText = `${lead.name} ${lead.address || ''} ${lead.phone || ''}`.toLowerCase();
      if (searchText.includes(q)) {
        results.push({
          type: 'lead',
          icon: '👤',
          title: lead.name,
          meta: lead.address || lead.phone || 'No details',
          action: () => { closeCmdPalette(); openCardDetailModal(lead); },
          score: cmdScoreMatch(q, lead.name.toLowerCase())
        });
      }
    });
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 10);
}

// Score match quality
function cmdScoreMatch(query, text) {
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  return 50;
}

// Load recent items
function loadCmdRecents() {
  const recents = JSON.parse(localStorage.getItem('cmd-recents') || '[]');
  if (recents.length === 0) return;
  
  cmdCurrentResults = [
    ...recents.slice(0, 5).map(r => ({ ...r, badge: 'Recent' })),
    ...cmdCurrentResults
  ];
  renderCmdResults(cmdCurrentResults);
}

// Save recent item
function saveCmdRecent(item) {
  const recents = JSON.parse(localStorage.getItem('cmd-recents') || '[]');
  const filtered = recents.filter(r => r.title !== item.title);
  filtered.unshift({ type: item.type, icon: item.icon, title: item.title, meta: item.meta });
  localStorage.setItem('cmd-recents', JSON.stringify(filtered.slice(0, 10)));
}

// Render results
function renderCmdResults(results) {
  const container = document.getElementById('cmdResults');
  if (results.length === 0) {
    container.innerHTML = '<div class="cmd-empty"><div class="cmd-empty-icon">🔍</div><div class="cmd-empty-text">No results found</div></div>';
    return;
  }
  
  const grouped = {};
  results.forEach(r => {
    const group = r.type || 'other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(r);
  });
  
  let html = '';
  const groupLabels = { 'action': 'Actions', 'lead': 'Leads', 'estimate': 'Estimates' };
  
  Object.keys(grouped).forEach(group => {
    if (grouped[group].length === 0) return;
    if (groupLabels[group]) {
      html += `<div class="cmd-group"><div class="cmd-group-label">${groupLabels[group]}</div>`;
    }
    grouped[group].forEach((item, idx) => {
      const globalIdx = results.indexOf(item);
      const selected = globalIdx === cmdSelectedIndex ? 'selected' : '';
      html += `
        <div class="cmd-item ${selected}" onclick="cmdExecuteItem(${globalIdx})" onmouseenter="cmdSelectedIndex=${globalIdx};renderCmdResults(cmdCurrentResults);">
          <div class="cmd-item-icon">${item.icon}</div>
          <div class="cmd-item-content">
            <div class="cmd-item-title">${item.title}</div>
            <div class="cmd-item-meta">${item.meta || ''}</div>
          </div>
          ${item.badge ? `<div class="cmd-item-badge">${item.badge}</div>` : ''}
        </div>
      `;
    });
    if (groupLabels[group]) html += `</div>`;
  });
  
  container.innerHTML = html;
}

// Execute selected item
function cmdExecuteItem(index) {
  const item = cmdCurrentResults[index];
  if (!item || !item.action) return;
  saveCmdRecent(item);
  item.action();
}

// Handle search input
function handleCmdSearch(query) {
  if (!query.trim()) {
    cmdCurrentResults = getCmdActions();
    cmdSelectedIndex = 0;
    renderCmdResults(cmdCurrentResults);
    loadCmdRecents();
    return;
  }
  
  cmdCurrentResults = cmdFuzzySearch(query);
  cmdSelectedIndex = 0;
  renderCmdResults(cmdCurrentResults);
}

// Keyboard navigation
function cmdSelectNext() {
  if (cmdCurrentResults.length === 0) return;
  cmdSelectedIndex = (cmdSelectedIndex + 1) % cmdCurrentResults.length;
  renderCmdResults(cmdCurrentResults);
}

function cmdSelectPrev() {
  if (cmdCurrentResults.length === 0) return;
  cmdSelectedIndex = (cmdSelectedIndex - 1 + cmdCurrentResults.length) % cmdCurrentResults.length;
  renderCmdResults(cmdCurrentResults);
}

// Global keyboard listener
document.addEventListener('keydown', (e) => {
  const palette = document.getElementById('cmdPalette');
  const isOpen = palette && palette.style.display === 'flex';
  
  // Cmd+K or Ctrl+K to open
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (!isOpen) openCmdPalette();
  }
  
  // Escape to close
  if (e.key === 'Escape' && isOpen) {
    closeCmdPalette();
  }
  
  // Arrow navigation when open
  if (isOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdSelectNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdSelectPrev();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      cmdExecuteItem(cmdSelectedIndex);
    }
  }
});

// Add input listener
window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('cmdInput');
  if (input) {
    input.addEventListener('input', (e) => handleCmdSearch(e.target.value));
  }
});

// Expose functions to window
window.openCmdPalette = openCmdPalette;
window.closeCmdPalette = closeCmdPalette;


// ══════════════════════════════════════════════
// KEYBOARD SHORTCUTS SYSTEM
// ══════════════════════════════════════════════

// Open/close shortcuts reference panel
function openShortcutsPanel() {
  const panel = document.getElementById('shortcutsPanel');
  panel.style.display = 'flex';
}

function closeShortcutsPanel() {
  const panel = document.getElementById('shortcutsPanel');
  panel.style.display = 'none';
}

function toggleShortcutsPanel() {
  const panel = document.getElementById('shortcutsPanel');
  if (panel.style.display === 'flex') {
    closeShortcutsPanel();
  } else {
    openShortcutsPanel();
  }
}

// Scroll to kanban column
function scrollToColumn(columnIndex) {
  const columns = ['new', 'contacted', 'est-sent', 'negotiating', 'approved', 'won', 'lost'];
  if (columnIndex < 1 || columnIndex > columns.length) return;
  
  const columnId = 'col-' + columns[columnIndex - 1];
  const column = document.getElementById(columnId);
  
  if (column) {
    column.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    // Flash highlight
    column.style.transition = 'background 0.3s';
    const originalBg = column.style.background;
    column.style.background = 'rgba(200,84,26,0.1)';
    setTimeout(() => {
      column.style.background = originalBg;
    }, 600);
  }
}

// Check if we should ignore keyboard shortcuts (typing in input)
function shouldIgnoreShortcut() {
  const activeEl = document.activeElement;
  if (!activeEl) return false;
  
  const tagName = activeEl.tagName.toLowerCase();
  return (
    tagName === 'input' || 
    tagName === 'textarea' || 
    activeEl.contentEditable === 'true' ||
    activeEl.isContentEditable
  );
}

// Global keyboard shortcuts handler
document.addEventListener('keydown', (e) => {
  const cmdPalette = document.getElementById('cmdPalette');
  const shortcutsPanel = document.getElementById('shortcutsPanel');
  const isCmdPaletteOpen = cmdPalette && cmdPalette.style.display === 'flex';
  const isShortcutsPanelOpen = shortcutsPanel && shortcutsPanel.style.display === 'flex';
  
  // ? key - Toggle shortcuts panel (works anytime, even in modals)
  if (e.key === '?' && !shouldIgnoreShortcut()) {
    e.preventDefault();
    toggleShortcutsPanel();
    return;
  }
  
  // Esc key - Close any open modals
  if (e.key === 'Escape') {
    if (isShortcutsPanelOpen) {
      closeShortcutsPanel();
      return;
    }
    // Command palette Esc is handled in its own listener
  }
  
  // Don't process other shortcuts if typing in input or if modal is open
  if (shouldIgnoreShortcut() || isCmdPaletteOpen || isShortcutsPanelOpen) {
    return;
  }
  
  // C - New Lead
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (typeof openLeadModal === 'function') {
      openLeadModal();
    }
    return;
  }
  
  // E - New Estimate
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    goTo('est');
    if (typeof startNewEstimate === 'function') {
      setTimeout(() => startNewEstimate(), 100);
    }
    return;
  }
  
  // / - Focus search bar (if exists)
  if (e.key === '/') {
    e.preventDefault();
    const searchBar = document.querySelector('input[type="search"], input[placeholder*="Search"]');
    if (searchBar) {
      searchBar.focus();
      searchBar.select();
    }
    return;
  }
  
  // 1-7 - Jump to kanban columns
  if (e.key >= '1' && e.key <= '7') {
    e.preventDefault();
    const columnNum = parseInt(e.key);
    scrollToColumn(columnNum);
    return;
  }
});

// Expose functions
window.openShortcutsPanel = openShortcutsPanel;
window.closeShortcutsPanel = closeShortcutsPanel;
window.toggleShortcutsPanel = toggleShortcutsPanel;


// ══════════════════════════════════════════════
// SKELETON SCREENS (Loading States)
// ══════════════════════════════════════════════

// Show skeleton loading state in kanban
function showKanbanSkeleton() {
  const stages = ['New', 'Inspected', 'Estimate Sent', 'Approved', 'In Progress', 'Complete', 'Lost'];
  
  stages.forEach(stage => {
    const body = document.getElementById('kbody-' + stage);
    if (!body) return;
    
    // Create 3 skeleton cards per column
    const skeletonHTML = `
      <div class="k-card-skeleton">
        <div class="skeleton k-card-skeleton-header"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="k-card-skeleton-footer">
          <div class="skeleton k-card-skeleton-tag"></div>
          <div class="skeleton k-card-skeleton-tag"></div>
        </div>
      </div>
      <div class="k-card-skeleton">
        <div class="skeleton k-card-skeleton-header"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="k-card-skeleton-footer">
          <div class="skeleton k-card-skeleton-tag"></div>
          <div class="skeleton k-card-skeleton-tag"></div>
        </div>
      </div>
      <div class="k-card-skeleton">
        <div class="skeleton k-card-skeleton-header"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="skeleton k-card-skeleton-line"></div>
        <div class="k-card-skeleton-footer">
          <div class="skeleton k-card-skeleton-tag"></div>
          <div class="skeleton k-card-skeleton-tag"></div>
        </div>
      </div>
    `;
    
    body.innerHTML = skeletonHTML;
  });
}

// Show skeleton loading state for photos grid
function showPhotosSkeleton() {
  const photosContainer = document.getElementById('photoLeadsContainer');
  if (!photosContainer) return;
  
  const skeletonHTML = `
    <div class="photo-skeleton-grid">
      ${Array(12).fill(0).map(() => `
        <div class="skeleton photo-skeleton-item"></div>
      `).join('')}
    </div>
  `;
  
  photosContainer.innerHTML = skeletonHTML;
}

// Hide all skeletons (will be replaced by actual content)
function hideSkeleton() {
  document.querySelectorAll('.skeleton-card, .skeleton-grid').forEach(el => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  });
}

// Expose functions
window.showKanbanSkeleton = showKanbanSkeleton;
window.showPhotosSkeleton = showPhotosSkeleton;
window.hideSkeleton = hideSkeleton;


// ══════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM (for optimistic updates)
// ══════════════════════════════════════════════

let toastIdCounter = 0;
const activeToasts = new Map();

// Show toast notification with optional undo action
function showToast(msgOrOptions, typeArg) {
  // Support both signatures:
  // showToast('message', 'success')  — simple, used 80+ times
  // showToast({message, type, ...})  — fancy with undo/actions
  let options;
  if (typeof msgOrOptions === 'string') {
    options = { message: msgOrOptions, type: typeArg || 'info' };
  } else {
    options = msgOrOptions;
  }
  
  const {
    message,
    type = 'info',
    duration = 5000,
    undoAction = null,
    undoText = 'Undo'
  } = options;
  
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toastId = `toast-${toastIdCounter++}`;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.id = toastId;
  
  const icon = {
    'success': '✓',
    'error': '⚠️',
    'info': 'ℹ️',
    'warning': '⚠️'
  }[type] || 'ℹ️';
  
  let actionsHTML = '';
  if (undoAction) {
    actionsHTML = `
      <div class="toast-actions">
        <button class="toast-btn toast-btn-primary" onclick="window._toastUndo('${toastId}')">
          ${undoText}
        </button>
      </div>
    `;
  }
  
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-message">${message}</div>
      ${actionsHTML}
    </div>
    <button class="toast-close" onclick="window._closeToast('${toastId}')">✕</button>
  `;
  
  container.appendChild(toast);
  
  // Store undo action
  if (undoAction) {
    activeToasts.set(toastId, undoAction);
  }
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => closeToast(toastId), duration);
  }
  
  return toastId;
}

// Close specific toast
function closeToast(toastId) {
  const toast = document.getElementById(toastId);
  if (toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(400px)';
    setTimeout(() => {
      toast.remove();
      activeToasts.delete(toastId);
    }, 300);
  }
}

// Execute undo action
function toastUndo(toastId) {
  const undoAction = activeToasts.get(toastId);
  if (undoAction && typeof undoAction === 'function') {
    undoAction();
  }
  closeToast(toastId);
}

// Expose functions
window.showToast = showToast;
window._closeToast = closeToast;
window._toastUndo = toastUndo;


// COLLAPSIBLE NAV SECTIONS
function toggleNavSection(section) {
  const content = document.getElementById('section-'+section);
  const toggle = document.getElementById('toggle-'+section);
  const isOpen = content.classList.contains('open');
  
  if(isOpen) {
    content.classList.remove('open');
    toggle.classList.remove('open');
  } else {
    content.classList.add('open');
    toggle.classList.add('open');
  }
  
  // Save state to localStorage
  localStorage.setItem('nav-'+section, isOpen ? 'closed' : 'open');
}

// SETTINGS PAGE COLLAPSIBLE SECTIONS
function switchSettingsTab(tab) {
  // Hide all panels
  document.querySelectorAll('.stab-panel').forEach(p => p.style.display = 'none');
  // Deactivate all tab buttons
  document.querySelectorAll('.stab-btn').forEach(b => b.classList.remove('stab-active'));
  // Show selected panel
  const panel = document.getElementById('stab-panel-' + tab);
  if (panel) panel.style.display = 'block';
  // Activate selected tab button
  const btn = document.getElementById('stab-' + tab);
  if (btn) btn.classList.add('stab-active');

  // Lazy-load appearance tab content — render theme/font grids
  if (tab === 'appearance') {
    // === ThemeEngine: filter buttons + flat grid ===
    const teGrid = document.getElementById('te-theme-grid');
    const teCatBar = document.getElementById('te-cat-bar');
    if (teGrid && teCatBar && !teGrid.dataset.loaded) {
      window._teActiveCat = 'all';
      window._teRenderSettingsGrid = function(cat) {
        window._teActiveCat = cat || 'all';
        const TE = window.ThemeEngine;
        const current = TE ? TE.getCurrent() : (document.documentElement.getAttribute('data-theme') || 'nbd-original');

        // Update active button state
        document.querySelectorAll('.te-filter-btn').forEach(b => {
          const isSel = b.dataset.cat === window._teActiveCat;
          b.style.background = isSel ? 'var(--orange)' : 'var(--s2)';
          b.style.color = isSel ? '#fff' : 'var(--m)';
        });

        if (!TE) {
          // Legacy: render from THEME_KEYS
          const keys = typeof THEME_KEYS !== 'undefined' ? THEME_KEYS : [];
          teGrid.innerHTML = keys.map(k => {
            const isAct = k === current;
            return `<div onclick="applyTheme('${k}')" style="background:var(--s2);border:2px solid ${isAct?'var(--orange)':'var(--br)'};border-radius:8px;padding:8px;cursor:pointer;transition:all .15s;">
              <div style="font-size:10px;font-weight:700;color:var(--t);font-family:'Barlow Condensed',sans-serif;text-transform:capitalize;">${k.replace(/-/g,' ')}${isAct?' ✓':''}</div></div>`;
          }).join('');
          return;
        }

        // ThemeEngine: render themed cards
        const allThemes = TE.getAll();
        let entries = Object.entries(allThemes);
        if (cat && cat !== 'all') entries = entries.filter(([,t]) => t.category === cat);

        teGrid.innerHTML = entries.map(([key, t]) => {
          const isActive = key === current;
          const isLocked = t.locked && !(TE.isUnlocked && TE.isUnlocked(key));
          const bg = t.colors?.bg || '#1a1a2e';
          const accent = t.colors?.accent || '#C8541A';
          const surface = t.colors?.surface || '#16213e';
          const txt = t.colors?.text || '#e2e8f0';
          const muted = t.colors?.muted || '#6b7280';
          return `<div onclick="${isLocked ? '' : `window._tePreviewTheme('${key}')`}" style="background:${bg};border:2px solid ${isActive ? accent : 'rgba(255,255,255,.06)'};border-radius:8px;padding:8px;cursor:${isLocked?'not-allowed':'pointer'};transition:all .15s;position:relative;opacity:${isLocked?'0.45':'1'};">
            <div style="display:flex;gap:3px;margin-bottom:4px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${accent};"></span>
              <span style="width:10px;height:10px;border-radius:50%;background:${surface};"></span>
              ${t.colors?.accent2 ? `<span style="width:10px;height:10px;border-radius:50%;background:${t.colors.accent2};"></span>` : ''}
            </div>
            <div style="font-size:10px;font-weight:700;color:${txt};font-family:'Barlow Condensed',sans-serif;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${isLocked?'🔒 ':''}${t.name}</div>
            ${isActive ? `<div style="position:absolute;top:4px;right:4px;background:${accent};color:#fff;font-size:7px;font-weight:800;padding:1px 5px;border-radius:6px;">✓</div>` : ''}
            ${t.overlay?.type && t.overlay.type !== 'none' ? `<div style="position:absolute;bottom:3px;right:4px;font-size:7px;color:${muted};">✦</div>` : ''}
          </div>`;
        }).join('');
      };

      // Build filter buttons
      const TE = window.ThemeEngine;
      const btnStyle = 'padding:5px 10px;border-radius:14px;border:1px solid var(--br);font-size:10px;font-weight:700;cursor:pointer;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:.04em;text-transform:uppercase;transition:all .15s;white-space:nowrap;';
      let btns = `<button class="te-filter-btn" data-cat="all" onclick="window._teRenderSettingsGrid('all')" style="${btnStyle}background:var(--orange);color:#fff;">All</button>`;
      if (TE) {
        TE.getCategories().forEach(c => {
          btns += `<button class="te-filter-btn" data-cat="${c.key}" onclick="window._teRenderSettingsGrid('${c.key}')" style="${btnStyle}background:var(--s2);color:var(--m);">${c.icon} ${c.label}</button>`;
        });
      }
      teCatBar.innerHTML = btns;

      // Initial render: show all
      window._teRenderSettingsGrid('all');
      teGrid.dataset.loaded = '1';

      // Init achievements + builder
      if (window.ThemeAchievements?.renderAchievementPanel) window.ThemeAchievements.renderAchievementPanel('te-achievements-panel');
      if (window.ThemeBuilder?.renderBuilder) window.ThemeBuilder.renderBuilder('te-builder-panel');
    }
    const fontGrid = document.getElementById('settings-font-grid');
    if (fontGrid && !fontGrid.dataset.loaded) {
      if (typeof NBD_FONTS !== 'undefined') {
        fontGrid.innerHTML = '';
        const _nbd_activeFont = window._nbd_activeFont || '';
        NBD_FONTS.forEach(f => {
          const isAct = f.id === _nbd_activeFont;
          const d = document.createElement('div');
          d.style.cssText = 'background:var(--s2);border:1px solid var(--br);border-radius:8px;padding:10px;cursor:pointer;transition:border-color .15s;' + (isAct ? 'border-color:var(--orange);' : '');
          d.onclick = () => { if (typeof nbdApplyFont === 'function') nbdApplyFont(f.id); };
          d.innerHTML = '<div style="font-family:' + f.css.fd + ';font-size:13px;font-weight:700;margin-bottom:4px;">' + f.name + (isAct ? ' ✓' : '') + '</div><div style="font-family:' + f.css.fb + ';font-size:11px;color:var(--m);">' + f.preview.b + '</div>';
          fontGrid.appendChild(d);
        });
        fontGrid.dataset.loaded = '1';
      } else if (typeof renderFontGrid === 'function') {
        renderFontGrid('settings-font-grid');
        fontGrid.dataset.loaded = '1';
      }
    }
  }
  // Re-init daily floors when switching to daily tab
  if (tab === 'daily') {
    if (typeof dsInitEditor === 'function') dsInitEditor();
    if (typeof dsLoadThemeGrid === 'function') dsLoadThemeGrid();
  }
  // Lazy-render Company tab
  if (tab === 'company') {
    const c = document.getElementById('companySettingsContainer');
    if (c && typeof window.renderCompanySettings === 'function') {
      c.innerHTML = window.renderCompanySettings();
    }
  }
  // Lazy-render Team tab
  if (tab === 'team') {
    const t = document.getElementById('teamManagementContainer');
    if (t && typeof window.renderTeamManagement === 'function') {
      t.innerHTML = window.renderTeamManagement();
    }
  }
  // Lazy-render Access tab
  if (tab === 'access') {
    const a = document.getElementById('accessControlContainer');
    if (a && typeof window.renderAccessControl === 'function') {
      a.innerHTML = window.renderAccessControl();
    }
  }
}
window.switchSettingsTab = switchSettingsTab;

// Theme preview system — click previews, confirm bar to apply or revert
window._tePreviewTheme = function(key) {
  const TE = window.ThemeEngine;
  const prev = window._teOriginalTheme || (TE ? TE.getCurrent() : (document.documentElement.getAttribute('data-theme') || 'nbd-original'));
  if (!window._teOriginalTheme) window._teOriginalTheme = prev;

  // Apply preview without saving
  if (TE) { TE.apply(key, false); } else { applyTheme(key, false); }

  // Show confirm bar if not already showing
  if (!document.getElementById('te-confirm-bar')) {
    const bar = document.createElement('div');
    bar.id = 'te-confirm-bar';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--s);border-top:2px solid var(--orange);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;backdrop-filter:blur(12px);';
    bar.innerHTML = `
      <div style="font-size:13px;color:var(--t);font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.04em;">PREVIEWING THEME</div>
      <div style="display:flex;gap:8px;">
        <button onclick="window._teRevertTheme()" style="padding:8px 16px;background:var(--s2);border:1px solid var(--br);border-radius:8px;color:var(--t);font-size:12px;font-weight:700;cursor:pointer;font-family:'Barlow Condensed',sans-serif;">✕ Revert</button>
        <button onclick="window._teConfirmTheme()" style="padding:8px 20px;background:var(--orange);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:'Barlow Condensed',sans-serif;">✓ Apply Theme</button>
      </div>`;
    document.body.appendChild(bar);
  }
};
window._teRevertTheme = function() {
  const orig = window._teOriginalTheme || 'nbd-original';
  const TE = window.ThemeEngine;
  if (TE) { TE.apply(orig, false); } else { applyTheme(orig, false); }
  window._teOriginalTheme = null;
  const bar = document.getElementById('te-confirm-bar');
  if (bar) bar.remove();
};
window._teConfirmTheme = function() {
  // Save the currently previewed theme permanently
  const cur = window.ThemeEngine ? window.ThemeEngine.getCurrent() : (document.documentElement.getAttribute('data-theme') || 'nbd-original');
  if (window.ThemeEngine) { window.ThemeEngine.apply(cur, true); } else { applyTheme(cur, true); }
  window._teOriginalTheme = null;
  const bar = document.getElementById('te-confirm-bar');
  if (bar) bar.remove();
  if (typeof showToast === 'function') showToast('Theme applied ✓');
  // Refresh the section to update active states
  const s = document.getElementById('te-theme-sections');
  if (s) { s.dataset.loaded = ''; switchSettingsTab('appearance'); }
};

function toggleSettingsSection(section) {
  const container = document.getElementById('settings-'+section);
  if (!container) return;
  
  const isCollapsed = container.classList.contains('collapsed');
  
  if(isCollapsed) {
    container.classList.remove('collapsed');
  } else {
    container.classList.add('collapsed');
  }
  
  // Save state to localStorage
  localStorage.setItem('settings-'+section, isCollapsed ? 'open' : 'collapsed');
}

// Restore settings section states on load
function restoreSettingsSections() {
  ['themes', 'crm', 'estimates', 'daily'].forEach(section => {
    const state = localStorage.getItem('settings-'+section);
    const container = document.getElementById('settings-'+section);
    if (!container) return;
    
    // Apply saved state, or use default (themes/crm open, estimates/daily collapsed)
    if (state === 'collapsed') {
      container.classList.add('collapsed');
    } else if (state === 'open') {
      container.classList.remove('collapsed');
    }
    // If no saved state, leave as-is (HTML default)
  });
}


// Restore nav section states on load
function restoreNavSections() {
  ['tools','insights'].forEach(section => {
    const state = localStorage.getItem('nav-'+section);
    if(state === 'closed') {
      document.getElementById('section-'+section).classList.remove('open');
      document.getElementById('toggle-'+section).classList.remove('open');
    }
  });
}
setTimeout(restoreNavSections, 100);

// ══════════════════════════════════════════════

// ══ Window Scope Exposures ══════════════════════════════════
window.openCmdPalette = openCmdPalette;
window.closeCmdPalette = closeCmdPalette;
window.openShortcutsPanel = openShortcutsPanel;
window.closeShortcutsPanel = closeShortcutsPanel;
window.toggleShortcutsPanel = toggleShortcutsPanel;
window.scrollToColumn = scrollToColumn;
window.showKanbanSkeleton = showKanbanSkeleton;
window.showPhotosSkeleton = showPhotosSkeleton;
window.hideSkeleton = hideSkeleton;
window.showToast = showToast;
window.closeToast = closeToast;
window.toggleNavSection = toggleNavSection;
window.switchSettingsTab = switchSettingsTab;
window.toggleSettingsSection = toggleSettingsSection;
window.restoreSettingsSections = restoreSettingsSections;
window.restoreNavSections = restoreNavSections;
