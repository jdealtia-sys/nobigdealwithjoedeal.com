          // Render the accessory panel + wire .slabel2 collapse. Uses a
          // readyState guard so this works at initial page load AND
          // when called later by _hydrateViewTemplate('draw') (Phase
          // C.3 extracted view-draw into a <template>; cloned scripts
          // are re-executed by the hydration helper, but if the helper
          // runs AFTER DOMContentLoaded the listener never fires).
          (function() {
            function _drawInit() {
              setTimeout(function() { if (typeof renderAccessoryPanel === 'function') renderAccessoryPanel(); }, 2000);
              document.querySelectorAll('.map-sidebar .slabel2').forEach(function(label) {
                if (label._drawCollapseWired) return;
                label._drawCollapseWired = true;
                label.addEventListener('click', function() {
                  label.classList.toggle('collapsed');
                  var next = label.nextElementSibling;
                  while (next && !next.classList.contains('slabel2')) {
                    next.style.display = label.classList.contains('collapsed') ? 'none' : '';
                    next = next.nextElementSibling;
                  }
                });
              });
            }
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', _drawInit);
            } else {
              _drawInit();
            }
          })();
