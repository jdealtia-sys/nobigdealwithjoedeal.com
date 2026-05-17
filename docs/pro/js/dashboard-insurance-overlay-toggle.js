              // Show/hide the insurance overlay based on the mode selector.
              // Kept tiny and inline so it runs regardless of script order.
              window.toggleInsuranceOverlay = function() {
                var m = document.getElementById('estMode');
                var b = document.getElementById('estInsuranceBlock');
                if (m && b) b.style.display = (m.value === 'insurance') ? 'block' : 'none';
              };
