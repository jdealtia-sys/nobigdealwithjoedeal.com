const WORKER_URL = 'https://nbd-ai-proxy.jonathandeal459.workers.dev';

let autoRefreshTimer = null;

window.addEventListener('auth-ready', () => {
  const user = window._currentUser;
  
  // Admin-only check (demo account bypass)
  if (user.email !== 'demo@nbdpro.com' && user.email !== 'jdeal@nobigdealsolutions.com') {
    document.body.innerHTML = '<div style="text-align:center; padding:100px; color:var(--red);">🚫 Admin access required</div>';
    return;
  }
  
  loadAnalytics();
  
  // Auto-refresh every 30 seconds
  autoRefreshTimer = setInterval(loadAnalytics, 30000);
});

async function loadAnalytics() {
  try {
    // TODO: Call worker endpoint to fetch KV analytics data
    // For now, show mock data until worker endpoint is built
    
    const now = new Date();
    const mockData = {
      today: {
        requests: 247,
        tokens: 52840,
        cost: 0.0158,
        errors: 3,
        rateLimits: 1,
        lastHour: 18
      },
      hourly: generateMockHourlyData(),
      topUsers: [
        { email: 'demo@nbdpro.com', requests: 142, tokens: 31200, cost: 0.0094 },
        { email: 'jdeal@nobigdealsolutions.com', requests: 89, tokens: 18400, cost: 0.0055 },
        { email: 'contractor1@example.com', requests: 16, tokens: 3240, cost: 0.0009 }
      ],
      features: {
        'ask-joe': { requests: 198, tokens: 44200, cost: 0.0133 },
        'vault-analyzer': { requests: 32, tokens: 6800, cost: 0.0020 },
        'property-intel': { requests: 17, tokens: 1840, cost: 0.0005 }
      }
    };
    
    // Update stats
    document.getElementById('requestsToday').textContent = mockData.today.requests.toLocaleString();
    document.getElementById('requestsLastHour').textContent = mockData.today.lastHour;
    document.getElementById('tokensToday').textContent = mockData.today.tokens.toLocaleString();
    document.getElementById('avgTokens').textContent = Math.round(mockData.today.tokens / mockData.today.requests);
    document.getElementById('costToday').textContent = `$${mockData.today.cost.toFixed(4)}`;
    document.getElementById('projectedCost').textContent = `$${(mockData.today.cost * 30).toFixed(2)}`;
    
    const successRate = ((mockData.today.requests - mockData.today.errors) / mockData.today.requests * 100).toFixed(1);
    document.getElementById('successRate').textContent = `${successRate}%`;
    document.getElementById('successRate').className = 'stat-value ' + (successRate >= 99 ? 'green' : successRate >= 95 ? 'orange' : 'red');
    document.getElementById('errorCount').textContent = mockData.today.errors;
    document.getElementById('rateLimitCount').textContent = mockData.today.rateLimits;
    
    // Render chart
    renderChart(mockData.hourly);
    
    // Render top users
    renderTopUsers(mockData.topUsers);
    
    // Render features
    renderFeatures(mockData.features);
    
    // Update timestamp
    document.getElementById('lastRefresh').textContent = `Last refreshed: ${now.toLocaleTimeString()}`;
    
  } catch (error) {
    console.error('Analytics load error:', error);
    const el = document.getElementById('chartContainer');
    el.textContent = '';
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = 'Failed to load analytics: ' + (error && error.message ? error.message : 'unknown error');
    el.appendChild(box);
  }
}

function generateMockHourlyData() {
  const data = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 3600000);
    data.push({
      hour: hour.getHours(),
      requests: Math.floor(Math.random() * 20) + 5
    });
  }
  return data;
}

function renderChart(hourlyData) {
  const container = document.getElementById('chartContainer');
  const max = Math.max(...hourlyData.map(d => d.requests));
  
  let html = '<div style="display:flex; align-items:flex-end; gap:8px; height:100%; padding:20px 0;">';
  
  hourlyData.forEach(d => {
    const reqs = Number(d.requests || 0);
    const hour = Number(d.hour || 0);
    const height = Math.max(0, Math.min(100, (reqs / max) * 100));
    html += `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:8px;">
        <div style="font-size:11px; color:var(--text3); font-family:'Syne Mono',monospace;">${reqs}</div>
        <div style="
          width:100%;
          background:var(--blue);
          height:${height}%;
          border-radius:4px 4px 0 0;
          transition:all 0.3s var(--ease);
          opacity:0.7;
        " title="${reqs} requests at ${hour}:00"></div>
        <div style="font-size:10px; color:var(--text3);">${hour}</div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

// Tiny HTML escaper used by every render* helper in this file. Admin pages
// are behind the custom-claim gate but authored data (user emails, feature
// names) is still escaped defence-in-depth.
function _analyticsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderTopUsers(users) {
  const container = document.getElementById('topUsers');

  if (users.length === 0) {
    container.innerHTML = '<div style="color:var(--text3); font-size:14px;">No user data available</div>';
    return;
  }

  let html = '';
  users.forEach((user, i) => {
    const cost = Number(user.cost || 0).toFixed(4);
    const requests = Number(user.requests || 0);
    const tokens = Number(user.tokens || 0).toLocaleString();
    html += `
      <div class="user-item">
        <div class="user-rank">${i + 1}</div>
        <div class="user-info">
          <div class="user-email">${_analyticsEsc(user.email)}</div>
          <div class="user-meta">${requests} requests • ${_analyticsEsc(tokens)} tokens</div>
        </div>
        <div class="user-stats">
          <div class="user-stat">
            <div class="user-stat-val">$${_analyticsEsc(cost)}</div>
            <div class="user-stat-lbl">Cost</div>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderFeatures(features) {
  const container = document.getElementById('featureBreakdown');

  let html = '<div class="user-list">';

  Object.entries(features).forEach(([name, data]) => {
    const reqs = Number(data.requests || 0);
    const tokens = Number(data.tokens || 0).toLocaleString();
    const cost = Number(data.cost || 0).toFixed(4);
    html += `
      <div class="user-item">
        <div class="user-info">
          <div class="user-email">${_analyticsEsc(name)}</div>
          <div class="user-meta">${reqs} requests • ${_analyticsEsc(tokens)} tokens</div>
        </div>
        <div class="user-stats">
          <div class="user-stat">
            <div class="user-stat-val">$${_analyticsEsc(cost)}</div>
            <div class="user-stat-lbl">Cost</div>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});

// Wire the refresh button that was previously an inline onclick=.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof window.loadAnalytics === 'function') window.loadAnalytics();
    });
  });
});
