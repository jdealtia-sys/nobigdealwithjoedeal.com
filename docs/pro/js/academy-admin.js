(function() {
  'use strict';
  
  window.RealDealAdmin = {
    
    renderAdminPanel: function(containerId) {
      const container = document.getElementById(containerId);
      if(!container) return;
      
      const html = `
        <div class="academy-admin-panel">
          <h2>Academy Admin Dashboard</h2>
          <div class="admin-nav">
            <button class="admin-tab-btn active" data-tab="overview">Team Overview</button>
            <button class="admin-tab-btn" data-tab="assign">Assign Content</button>
            <button class="admin-tab-btn" data-tab="leaderboard">Leaderboard</button>
            <button class="admin-tab-btn" data-tab="bulk">Bulk Assign</button>
          </div>
          
          <div class="admin-content">
            <div id="tab-overview" class="admin-tab active">
              <h3>Team Member Progress</h3>
              <div class="team-grid"></div>
            </div>
            
            <div id="tab-assign" class="admin-tab">
              <h3>Assign Content to Member</h3>
              <div class="assign-form">
                <select class="member-select" placeholder="Select member...">
                  <option value="">Choose team member</option>
                </select>
                <select class="content-type-select">
                  <option value="process">Process Node</option>
                  <option value="course">Full Course</option>
                  <option value="lesson">Lesson</option>
                  <option value="quiz">Quiz</option>
                </select>
                <select class="content-select" placeholder="Select content...">
                  <option value="">Choose content</option>
                </select>
                <input type="date" class="due-date-input" placeholder="Due date (optional)">
                <textarea class="note-input" placeholder="Assignment note..."></textarea>
                <button class="assign-submit">Assign</button>
              </div>
            </div>
            
            <div id="tab-leaderboard" class="admin-tab">
              <h3>Team Leaderboard</h3>
              <div class="leaderboard-filters">
                <button class="filter-btn active" data-filter="courses">Courses Completed</button>
                <button class="filter-btn" data-filter="quiz">Quiz Average</button>
                <button class="filter-btn" data-filter="streak">Activity Streak</button>
              </div>
              <table class="leaderboard-table">
                <thead>
                  <tr><th>Rank</th><th>Name</th><th>Score</th><th>Badge</th></tr>
                </thead>
                <tbody class="leaderboard-body"></tbody>
              </table>
            </div>
            
            <div id="tab-bulk" class="admin-tab">
              <h3>Bulk Assign Content</h3>
              <div class="bulk-form">
                <div class="member-checklist"></div>
                <select class="bulk-content-select">
                  <option value="">Choose content</option>
                </select>
                <input type="date" class="bulk-due-date" placeholder="Due date (optional)">
                <button class="bulk-assign-submit">Assign to Selected</button>
              </div>
            </div>
          </div>
        </div>
      `;
      
      container.innerHTML = html;
      this._attachEventListeners(container);
      this._loadTeamMembers(container);
    },
    
    renderMemberDetail: function(containerId, uid) {
      const container = document.getElementById(containerId);
      if(!container) return;

      // Real implementation will fetch member progress from Firestore
      // (academy_progress collection keyed by uid). Until that lands,
      // show an empty state instead of hardcoded fake 45%/30% numbers.
      // No fake data, no silent placeholder progress bars.
      container.textContent = '';
      const wrap = document.createElement('div');
      wrap.className = 'member-detail';
      wrap.style.cssText = 'text-align:center;padding:40px 20px;color:var(--m, #8892A4);';

      const h2 = document.createElement('h2');
      h2.textContent = 'Member Progress';
      h2.style.cssText = 'color:var(--t, #fff);margin-bottom:12px;';
      wrap.appendChild(h2);

      const body = document.createElement('div');
      body.style.cssText = 'font-size:13px;line-height:1.6;max-width:420px;margin:0 auto;';
      body.textContent = uid
        ? 'Member progress data lives in Firestore (academy_progress collection). This view activates when team members are invited and start completing courses.'
        : 'Select a team member from the Overview tab to see their progress here.';
      wrap.appendChild(body);

      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:18px;font-size:10px;color:var(--m, #888);text-transform:uppercase;letter-spacing:.12em;';
      hint.textContent = 'Multi-user team features coming in Enterprise tier';
      wrap.appendChild(hint);

      container.appendChild(wrap);
    },
    
    assignContent: function(targetUid, contentId, type, opts) {
      const assignment = {
        targetUid: targetUid,
        contentId: contentId,
        type: type,
        assignedDate: new Date(),
        dueDate: opts.dueDate || null,
        note: opts.note || null,
        status: 'assigned',
        progress: 0
      };
      
      // In real implementation: write to Firestore
      // db.collection('academy_assignments').doc(targetUid).collection('assignments').add(assignment)
      
      console.log('Assignment created:', assignment);
      return assignment;
    },
    
    bulkAssign: function(uids, contentId, type, opts) {
      const assignments = [];
      uids.forEach(uid => {
        const a = this.assignContent(uid, contentId, type, opts);
        assignments.push(a);
      });
      return assignments;
    },
    
    getTeamProgress: function() {
      // Returns summary stats: total members, active learners, courses completed, avg quiz score
      return {
        totalMembers: 0,
        activeLearners: 0,
        coursesCompleted: 0,
        avgQuizScore: 0
      };
    },
    
    renderLeaderboard: function(containerId) {
      const container = document.getElementById(containerId);
      if(!container) return;

      // Read real team progress from localStorage + Firestore (future).
      // Solo operator mode: show empty state instead of fake data.
      let teamProgress = [];
      try {
        const raw = localStorage.getItem('nbd_team_academy_progress');
        if (raw) teamProgress = JSON.parse(raw) || [];
      } catch (e) {}

      if (teamProgress.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px 20px;color:var(--m, #8892A4);">
            <div style="font-size:36px;margin-bottom:8px;">🎓</div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--t, #fff);letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;">
              No Learners Yet
            </div>
            <div style="font-size:12px;line-height:1.6;max-width:380px;margin:0 auto;">
              The leaderboard activates once you invite team members and they start completing courses.
              For now you're in solo operator mode — every course you finish goes straight to your personal progress.
            </div>
            <div style="margin-top:18px;font-size:10px;color:var(--m, #888);text-transform:uppercase;letter-spacing:.12em;">
              Multi-user team features coming in Enterprise tier
            </div>
          </div>
        `;
        return;
      }

      // Real data path — build with DOM builders so row.name / score /
      // badge can never smuggle markup into the page.
      container.textContent = '';
      const table = document.createElement('table');
      table.className = 'leaderboard-table';

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Rank', 'Name', 'Score', 'Badge'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      teamProgress.forEach((row, i) => {
        const tr = document.createElement('tr');
        [String(i + 1), row.name || '', row.score || '', row.badge || ''].forEach(v => {
          const td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    },
    
    _attachEventListeners: function(container) {
      // Tab switching
      container.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          container.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
          container.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
          const tabName = e.target.dataset.tab;
          document.getElementById('tab-' + tabName).classList.add('active');
          e.target.classList.add('active');
        });
      });
      
      // Assign submit
      const assignBtn = container.querySelector('.assign-submit');
      if(assignBtn) {
        assignBtn.addEventListener('click', () => {
          const memberSelect = container.querySelector('.member-select').value;
          const contentType = container.querySelector('.content-type-select').value;
          const content = container.querySelector('.content-select').value;
          const dueDate = container.querySelector('.due-date-input').value;
          const note = container.querySelector('.note-input').value;
          
          if(memberSelect && content) {
            this.assignContent(memberSelect, content, contentType, {dueDate, note});
            alert('Content assigned successfully');
          }
        });
      }
      
      // Leaderboard filter
      container.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          // In real implementation: refresh leaderboard with new sort
        });
      });
    },
    
    _loadTeamMembers: function(container) {
      // Reads team members from the real Firestore-backed cache.
      // In solo-operator mode the array is empty, so render an empty
      // state instead of fake users — matches the renderLeaderboard
      // empty-state pattern and the 'no fake data' quality standard.
      const teamMembers = (window._teamMembersCache && Array.isArray(window._teamMembersCache))
        ? window._teamMembersCache
        : [];
      const grid = container.querySelector('.team-grid');
      if (!grid) return;

      if (teamMembers.length === 0) {
        // Empty state — solo operator mode, no fake data
        grid.textContent = '';
        const empty = document.createElement('div');
        empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:32px 16px;color:var(--m, #8892A4);';
        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:32px;margin-bottom:8px;';
        icon.textContent = '👥';
        const title = document.createElement('div');
        title.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:var(--t, #fff);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;";
        title.textContent = 'No team members yet';
        const body = document.createElement('div');
        body.style.cssText = 'font-size:12px;line-height:1.5;max-width:340px;margin:0 auto;';
        body.textContent = 'Invite reps from Settings → Team to populate this panel. Each invited rep appears here with their real course progress once they start learning.';
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(body);
        grid.appendChild(empty);
        return;
      }

      // Real data path — build cards with DOM builders so member.name /
      // member.role / etc. can never inject markup even if they come
      // from an un-sanitized Firestore write.
      grid.textContent = '';
      teamMembers.forEach(member => {
        const card = document.createElement('div');
        card.className = 'team-card';

        const nameEl = document.createElement('h4');
        nameEl.textContent = member.name || 'Unnamed rep';
        card.appendChild(nameEl);

        const roleEl = document.createElement('p');
        roleEl.className = 'role';
        roleEl.textContent = member.role || '';
        card.appendChild(roleEl);

        // Real progress fields (undefined when absent — shows '—')
        const overall = (member.overallPct != null) ? member.overallPct + '%' : '—';
        const courses = (member.coursesDone != null && member.coursesTotal != null)
          ? member.coursesDone + '/' + member.coursesTotal
          : '—';
        const lastAct = member.lastActivityDaysAgo != null
          ? member.lastActivityDaysAgo + ' days ago'
          : '—';

        [
          ['Overall: ',       overall],
          ['Courses: ',       courses],
          ['Last Activity: ', lastAct]
        ].forEach(([label, val]) => {
          const stat = document.createElement('div');
          stat.className = 'progress-stat';
          stat.textContent = label + val;
          card.appendChild(stat);
        });

        const btn = document.createElement('button');
        btn.className = 'view-detail-btn';
        btn.textContent = 'View Details';
        btn.dataset.uid = member.uid || '';
        card.appendChild(btn);

        grid.appendChild(card);
      });
    }
  };
  
  // CSS for styling — uses CSS variables from the live theme
  // so the academy admin panel respects the active theme picker
  // (155 themes). Fallbacks provided for any theme that doesn't
  // define a variable.
  const style = document.createElement('style');
  style.textContent = `
    .academy-admin-panel {
      padding: 20px;
      background: var(--s, #1a1a1a);
      color: var(--t, #fff);
      border-radius: 8px;
    }

    .admin-nav {
      display: flex;
      gap: 10px;
      margin: 20px 0;
      border-bottom: 1px solid var(--br, #333);
    }

    .admin-tab-btn {
      padding: 10px 20px;
      background: none;
      border: none;
      color: var(--m, #999);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.3s;
      font-family: inherit;
    }

    .admin-tab-btn.active {
      color: var(--orange, #e8720c);
      border-bottom-color: var(--orange, #e8720c);
    }

    .admin-tab {
      display: none;
      margin-top: 20px;
    }

    .admin-tab.active {
      display: block;
    }

    .team-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }

    .team-card {
      background: var(--s2, #222);
      padding: 15px;
      border-radius: 6px;
      border: 1px solid var(--br, #333);
    }

    .team-card h4 {
      margin: 0 0 5px 0;
      color: var(--orange, #e8720c);
    }

    .progress-stat {
      font-size: 12px;
      color: var(--m, #999);
      margin: 8px 0;
    }

    .progress-bar {
      height: 6px;
      background: var(--s3, #333);
      border-radius: 3px;
      overflow: hidden;
      margin: 5px 0;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--orange, #e8720c), var(--ob, #f08030));
    }

    .assign-form, .bulk-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
    }

    .assign-form input, .assign-form select, .assign-form textarea {
      padding: 10px;
      background: var(--s2, #222);
      border: 1px solid var(--br, #333);
      color: var(--t, #fff);
      border-radius: 4px;
      font-family: inherit;
    }

    .assign-submit, .bulk-assign-submit {
      padding: 10px 20px;
      background: var(--orange, #e8720c);
      color: #fff;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      font-family: inherit;
    }

    .leaderboard-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }

    .leaderboard-table th, .leaderboard-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid var(--br, #333);
    }

    .leaderboard-table th {
      background: var(--s2, #222);
      color: var(--orange, #e8720c);
      font-weight: bold;
    }
  `;
  
  if(document.head) {
    document.head.appendChild(style);
  }
  
})();
