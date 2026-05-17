        // ── Hotkey toggle system ──
        // Each hotkey has a localStorage flag. The keydown handler
        // checks the flag before firing. Settings panel renders
        // the toggle grid from the HOTKEYS registry.
        window._HOTKEYS = [
          { key: 'n', label: 'New Lead', desc: 'Opens the Add Lead modal', id: 'hk_n' },
          { key: 'e', label: 'New Estimate', desc: 'Opens the Estimate builder', id: 'hk_e' },
          { key: '/', label: 'Focus Search', desc: 'Jumps cursor to the search bar', id: 'hk_slash' },
          { key: '?', label: 'Show Shortcuts', desc: 'Opens the shortcuts help overlay', id: 'hk_help' }
        ];
        function isHotkeyEnabled(id) {
          return localStorage.getItem('nbd_hk_disabled_' + id) !== '1';
        }
        function toggleHotkey(id, on) {
          if (on) localStorage.removeItem('nbd_hk_disabled_' + id);
          else localStorage.setItem('nbd_hk_disabled_' + id, '1');
          renderHotkeyToggles();
        }
        function renderHotkeyToggles() {
          var grid = document.getElementById('hotkeyTogglesGrid');
          if (!grid) return;
          grid.innerHTML = window._HOTKEYS.map(function(hk) {
            var on = isHotkeyEnabled(hk.id);
            return '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--s2);border:1px solid var(--br);border-radius:6px;cursor:pointer;">'
              + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleHotkey(\'' + hk.id + '\',this.checked)" style="accent-color:var(--orange);width:16px;height:16px;">'
              + '<div>'
              + '<div style="font-size:12px;font-weight:600;color:var(--t);display:flex;align-items:center;gap:6px;">'
              + '<kbd style="background:var(--s);border:1px solid var(--br);border-radius:3px;padding:2px 6px;font-family:monospace;font-size:11px;">' + hk.key + '</kbd> '
              + hk.label + '</div>'
              + '<div style="font-size:10px;color:var(--m);margin-top:2px;">' + hk.desc + '</div>'
              + '</div></label>';
          }).join('');
        }
        document.addEventListener('DOMContentLoaded', renderHotkeyToggles);
