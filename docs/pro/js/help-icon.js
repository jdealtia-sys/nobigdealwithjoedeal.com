/**
 * Help-icon helper — window.HelpIcon.
 *
 * Drops a small "?" button next to any element. Clicking the button
 * opens the relevant how-to.html section in a new tab. Optionally
 * shows a brief popover preview before navigating, but for now we
 * just deep-link — popover preview lands in a later iteration.
 *
 * Usage from anywhere:
 *   HelpIcon.attach(document.getElementById('myHeader'), 'kanban');
 *   HelpIcon.attach('.section-title', 'leads', { position: 'after' });
 *
 * Anchors map to section IDs in how-to.html. Pass the bare anchor
 * (no leading '#') — the helper builds the full URL.
 */
(function() {
  'use strict';

  // Inject styles once. Visual matches the rest of the app — small
  // orange "?" that fits inline next to a header without dominating it.
  function injectStyles() {
    if (document.getElementById('nbd-help-icon-css')) return;
    const css = `
      .nbd-help-icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px;
        margin-left: 8px;
        background: rgba(232, 114, 12, 0.08);
        border: 1px solid rgba(232, 114, 12, 0.3);
        color: #e8720c;
        border-radius: 50%;
        font-size: 11px; font-weight: 700; font-family: 'Barlow', sans-serif;
        text-decoration: none;
        cursor: pointer;
        transition: all 0.15s ease;
        vertical-align: middle;
        /* Expand the hit-target without changing visual size — pseudo-element
           creates a 44×44 invisible tap zone centered on the icon for fat
           fingers on iPhones. Keeps the design tight while honoring HIG. */
        position: relative;
      }
      .nbd-help-icon::after {
        content: ''; position: absolute; inset: -13px; /* expands hit area to 44x44 */
      }
      .nbd-help-icon:hover {
        background: #e8720c;
        color: #fff;
        transform: scale(1.1);
      }
      .nbd-help-icon:focus-visible {
        outline: 2px solid #e8720c;
        outline-offset: 2px;
      }
      /* On touch-only devices, drop the hover transform so the icon doesn't
         "stick" scaled after a tap. */
      @media (pointer: coarse) {
        .nbd-help-icon:hover { transform: none; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'nbd-help-icon-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**
   * Attach a "?" help icon to a target element.
   * @param {HTMLElement|string} target - Element or selector
   * @param {string} anchor - Section ID in how-to.html (without '#')
   * @param {Object} [opts]
   * @param {'after'|'before'|'inside'} [opts.position='after']
   * @param {string} [opts.title] - Tooltip text
   */
  function attach(target, anchor, opts) {
    const o = opts || {};
    const position = o.position || 'after';
    const title = o.title || 'Learn how — opens How To';
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    // Don't double-attach. Look for an existing sibling icon.
    const existing = el.querySelector?.('.nbd-help-icon') ||
                     (el.nextElementSibling?.classList?.contains('nbd-help-icon') && el.nextElementSibling);
    if (existing) return existing;

    injectStyles();
    const icon = document.createElement('a');
    icon.className = 'nbd-help-icon';
    icon.textContent = '?';
    icon.href = 'how-to.html#' + encodeURIComponent(anchor);
    icon.target = '_blank';
    icon.rel = 'noopener';
    icon.setAttribute('aria-label', title);
    icon.title = title;

    if (position === 'inside') {
      el.appendChild(icon);
    } else if (position === 'before') {
      el.parentNode.insertBefore(icon, el);
    } else {
      el.parentNode.insertBefore(icon, el.nextSibling);
    }
    return icon;
  }

  /**
   * Open the how-to at a specific anchor (programmatic).
   * Useful for "Help" entries in menus that don't have a target element.
   */
  function open(anchor) {
    const url = anchor ? 'how-to.html#' + encodeURIComponent(anchor) : 'how-to.html';
    window.open(url, '_blank', 'noopener');
  }

  window.HelpIcon = { attach, open };
})();
