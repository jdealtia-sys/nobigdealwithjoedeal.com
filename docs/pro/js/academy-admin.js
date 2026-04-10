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
      
      // Placeholder—fetches member data from Firestore in real implementation
      const html = `
        <div class="member-detail">
          <h2>Member Progress</h2>
          <div class="progress-section">
            <h3>Process Tree Progress</h3>
            <div class="tree-progress">
              <div class="tree-branch">
                <span>Insurance: 45%</span>
                <div class="progress-bar"><div class="progress-fill" style="width:45%"></div></div>
              </div>
              <div class="tree-branch">
                <span>Retail: 30%</span>
                <div class="progress-bar"><div class="progress-fill" style="width:30%"></div></div>
              </div>
            </div>
          </div>
          
          <div class="progress-section">
            <h3>Courses</h3>
            <div class="course-list"></div>
          </div>
          
          <div class="progress-section">
            <h3>Assignment History</h3>
            <table class="assignment-history">
              <thead><tr><th>Content</th><th>Assigned</th><th>Due</th><th>Status</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          
          <button class="assign-new-btn">Assign New Content</button>
        </div>
      `;
      
      container.innerHTML = html;
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
      
      const leaderboard = [
        {rank:1, name:'John Smith', score:'5 courses', badge:'🏆 First Course Champion'},
        {rank:2, name:'Sarah Jones', score:'4 courses', badge:'⚡ Quiz Master'},
        {rank:3, name:'Mike Davis', score:'3 courses', badge:''},
        {rank:4, name:'Lisa Brown', score:'2 courses', badge:'🔥 7-day streak'},
        {rank:5, name:'Tom Wilson', score:'1 course', badge:''}
      ];
      
      let html = '<table class="leaderboard"><thead><tr><th>Rank</th><th>Name</th><th>Score</th><th>Badge</th></tr></thead><tbody>';
      leaderboard.forEach(row => {
        html += `<tr><td>${row.rank}</td><td>${row.name}</td><td>${row.score}</td><td>${row.badge}</td></tr>`;
      });
      html += '</tbody></table>';
      
      container.innerHTML = html;
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
      // Placeholder: loads team members from window.teamMembers
      const teamMembers = window.teamMembers || [];
      const grid = container.querySelector('.team-grid');
      
      if(grid) {
        grid.innerHTML = teamMembers.map(member => `
          <div class="team-card">
            <h4>${member.name}</h4>
            <p class="role">${member.role}</p>
            <div class="progress-stat">Overall: ${Math.floor(Math.random() * 100)}%</div>
            <div class="progress-stat">Courses: ${Math.floor(Math.random() * 6)}/6</div>
            <div class="progress-stat">Last Activity: ${Math.floor(Math.random() * 30)} days ago</div>
            <button class="view-detail-btn">View Details</button>
          </div>
        `).join('');
      }
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
