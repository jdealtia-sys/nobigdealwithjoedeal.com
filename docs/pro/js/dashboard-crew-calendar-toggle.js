        // Calendar toggle — show via command palette or settings
        window.toggleCrewCalendar = function() {
          const el = document.getElementById('crewCalendar');
          if (!el) return;
          el.style.display = el.style.display === 'none' ? 'block' : 'none';
          if (el.style.display !== 'none' && window.CrewCalendar?.render) window.CrewCalendar.render('crewCalendar');
        };
