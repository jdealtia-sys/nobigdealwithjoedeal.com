// ╔═══════════════════════════════════════════════════════════════════╗
// ║  NBD PRO — WIDGET HOME PAGE SYSTEM v1.0                         ║
// ║  30 customizable widgets • drag grid • localStorage persistence  ║
// ╚═══════════════════════════════════════════════════════════════════╝

(function(){
'use strict';

// ── WIDGET REGISTRY ─────────────────────────────────────────────
const WIDGETS = [

  // ═══ PIPELINE & SALES ═══
  {id:'pipeline-value', name:'Pipeline Value', icon:'💰', cat:'Pipeline & Sales', size:'md',
    render(el){
      const leads = window._leads || [];
      const stages = {New:0, Contacted:0, 'Est. Sent':0, Negotiating:0, Won:0};
      let total = 0;
      leads.forEach(l => {
        const val = parseFloat(l.estValue || l.value || 0);
        total += val;
        if(stages[l.stage] !== undefined) stages[l.stage] += val;
      });
      const stageBar = Object.entries(stages).filter(([,v])=>v>0).map(([s,v])=>{
        const pct = total > 0 ? (v/total*100) : 0;
        const colors = {New:'var(--blue)',Contacted:'#A855F7','Est. Sent':'#F97316',Negotiating:'var(--gold)',Won:'var(--green)'};
        return `<div style="flex:${pct};background:${colors[s]||'#666'};height:8px;min-width:2px;" title="${s}: $${v.toLocaleString()}"></div>`;
      }).join('');
      el.innerHTML = `
        <div class="w-big-num">$${total >= 1000 ? (total/1000).toFixed(1)+'k' : total.toFixed(0)}</div>
        <div class="w-sub">Total Pipeline Value</div>
        <div style="display:flex;border-radius:4px;overflow:hidden;margin-top:10px;gap:1px;">${stageBar || '<div style="flex:1;background:var(--br);height:8px;"></div>'}</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:var(--m);">
          <span>${leads.length} leads</span><span>${leads.filter(l=>['closed','Complete','install_complete'].includes(l.stage||l._stageKey||'')).length} won</span>
        </div>`;
    }},

  {id:'hot-leads', name:'Hot Leads', icon:'🔥', cat:'Pipeline & Sales', size:'md',
    render(el){
      const TERMINAL = ['closed','Complete','install_complete','lost','Lost'];
      const HOT = ['contacted','estimate_submitted','contract_signed','Contacted','Est. Sent'];
      const leads = (window._leads || []).filter(l => {
        const sk = l.stage || l._stageKey || '';
        if(TERMINAL.includes(sk)) return false;
        if(l.callback) { const cb = new Date(l.callback); return cb <= new Date(); }
        return HOT.includes(sk);
      }).slice(0, 5);
      if(!leads.length) { el.innerHTML = '<div class="w-empty">No hot leads right now</div>'; return; }
      el.innerHTML = leads.map(l => `
        <div class="w-lead-row" onclick="if(window.goTo){goTo('crm')}">
          <div class="w-lead-name">${l.name || l.address || 'Unknown'}</div>
          <div class="w-lead-stage" style="color:${l.stage==='Contacted'?'#A855F7':l.stage==='Est. Sent'?'#F97316':'var(--m)'}">${l.stage}</div>
        </div>`).join('');
    }},

  {id:'win-rate', name:'Win Rate', icon:'🏆', cat:'Pipeline & Sales', size:'sm',
    render(el){
      const leads = window._leads || [];
      const WON = ['closed','Complete','install_complete','final_photos','final_payment','deductible_collected'];
      const LOST = ['lost','Lost'];
      const decided = leads.filter(l => WON.includes(l.stage||l._stageKey||'') || LOST.includes(l.stage||l._stageKey||''));
      const won = decided.filter(l => WON.includes(l.stage||l._stageKey||'')).length;
      const closed = decided;
      const rate = closed.length > 0 ? (won / closed.length * 100) : 0;
      const circumference = 2 * Math.PI * 36;
      const offset = circumference - (rate / 100) * circumference;
      el.innerHTML = `
        <svg width="84" height="84" style="display:block;margin:0 auto 8px;">
          <circle cx="42" cy="42" r="36" stroke="var(--br)" stroke-width="6" fill="none"/>
          <circle cx="42" cy="42" r="36" stroke="var(--orange)" stroke-width="6" fill="none"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 42 42)" stroke-linecap="round"/>
          <text x="42" y="46" text-anchor="middle" fill="var(--t)" font-family="'Barlow Condensed',sans-serif" font-size="20" font-weight="800">${rate.toFixed(0)}%</text>
        </svg>
        <div class="w-sub">${won} won / ${closed.length} closed</div>`;
    }},

  {id:'revenue-month', name:'Revenue This Month', icon:'📈', cat:'Pipeline & Sales', size:'sm',
    render(el){
      const leads = window._leads || [];
      const now = new Date();
      const WON = ['closed','Complete','install_complete','final_photos','final_payment','deductible_collected'];
      const thisMonth = leads.filter(l => {
        if(!WON.includes(l.stage||l._stageKey||'')) return false;
        const d = l.updatedAt?.toDate ? l.updatedAt.toDate() : l.updatedAt?.seconds ? new Date(l.updatedAt.seconds*1000) : new Date(l.updatedAt||0);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
      const rev = thisMonth.reduce((s,l) => s + parseFloat(l.jobValue || l.estValue || l.value || 0), 0);
      const goal = parseFloat(localStorage.getItem('nbd_monthly_goal') || '50000');
      const pct = goal > 0 ? Math.min(100, rev / goal * 100) : 0;
      el.innerHTML = `
        <div class="w-big-num" style="color:var(--green);">$${rev >= 1000 ? (rev/1000).toFixed(1)+'k' : rev.toFixed(0)}</div>
        <div class="w-sub">Revenue This Month</div>
        <div class="w-bar-track"><div class="w-bar-fill" style="width:${pct}%"></div></div>
        <div style="font-size:9px;color:var(--m);text-align:right;margin-top:3px;">${pct.toFixed(0)}% of $${(goal/1000).toFixed(0)}k goal</div>`;
    }},

  {id:'stage-funnel', name:'Stage Funnel', icon:'🔻', cat:'Pipeline & Sales', size:'lg',
    render(el){
      const leads = window._leads || [];
      const stages = ['New','Contacted','Est. Sent','Negotiating','Won'];
      const counts = stages.map(s => leads.filter(l => l.stage === s).length);
      const max = Math.max(...counts, 1);
      el.innerHTML = `<div class="w-funnel">` + stages.map((s, i) => {
        const pct = 40 + (1 - i/(stages.length-1)) * 60;
        const colors = ['var(--blue)','#A855F7','#F97316','var(--gold)','var(--green)'];
        return `<div class="w-funnel-row">
          <div class="w-funnel-bar" style="width:${pct}%;background:${colors[i]};">${counts[i]}</div>
          <span class="w-funnel-label">${s}</span>
        </div>`;
      }).join('') + `</div>`;
    }},

  {id:'recent-activity', name:'Recent Activity', icon:'⚡', cat:'Pipeline & Sales', size:'md',
    render(el){
      const leads = (window._leads || []).filter(l => l.updatedAt || l.createdAt)
        .sort((a,b) => _toMs(b.updatedAt||b.createdAt) - _toMs(a.updatedAt||a.createdAt)).slice(0, 5);
      if(!leads.length) { el.innerHTML = '<div class="w-empty">No recent activity</div>'; return; }
      el.innerHTML = leads.map(l => {
        const ago = _timeAgo(l.updatedAt || l.createdAt);
        return `<div class="w-activity-row">
          <div class="w-activity-dot" style="background:${l.stage==='Won'?'var(--green)':l.stage==='Lost'?'#EF4444':'var(--orange)'}"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:11px;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.name||l.address||'Lead'}</div>
            <div style="font-size:10px;color:var(--m);">${l.stage} • ${ago}</div>
          </div>
        </div>`;
      }).join('');
    }},

  {id:'stale-leads', name:'Stale Leads', icon:'⏰', cat:'Pipeline & Sales', size:'md',
    render(el){
      const now = Date.now();
      const stale = (window._leads || []).filter(l => {
        if(l.stage==='Won'||l.stage==='Lost') return false;
        const last = _toMs(l.updatedAt||l.createdAt);
        return last > 0 && (now - last) > 7*24*60*60*1000;
      }).sort((a,b) => _toMs(a.updatedAt||a.createdAt) - _toMs(b.updatedAt||b.createdAt)).slice(0,5);
      if(!stale.length) { el.innerHTML = '<div class="w-empty" style="color:var(--green);">No stale leads — nice work!</div>'; return; }
      el.innerHTML = `<div style="font-size:10px;color:var(--red);margin-bottom:6px;font-weight:700;">${stale.length} leads need attention</div>` +
        stale.map(l => {
          const days = Math.floor((now - _toMs(l.updatedAt||l.createdAt)) / 86400000);
          return `<div class="w-lead-row"><div class="w-lead-name">${l.name||l.address||'Lead'}</div><div style="color:var(--red);font-size:10px;">${days > 0 ? days+'d ago' : 'today'}</div></div>`;
        }).join('');
    }},

  {id:'close-board', name:'Close Board', icon:'🎯', cat:'Pipeline & Sales', size:'md',
    render(el){
      const leads = (window._leads || []).filter(l => l.stage === 'Negotiating' || l.stage === 'Est. Sent');
      const total = leads.reduce((s,l) => s + parseFloat(l.estValue||l.value||0), 0);
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span class="w-big-num" style="font-size:22px;">${leads.length}</span>
          <span style="font-size:11px;color:var(--green);font-weight:700;">$${total>=1000?(total/1000).toFixed(1)+'k':total.toFixed(0)} closeable</span>
        </div>` +
        leads.slice(0,4).map(l => `<div class="w-lead-row">
          <div class="w-lead-name">${l.name||l.address||'Lead'}</div>
          <div style="color:var(--orange);font-size:10px;font-weight:700;">$${parseFloat(l.estValue||l.value||0).toLocaleString()}</div>
        </div>`).join('');
    }},

  // ═══ OPERATIONS ═══
  {id:'weather-radar', name:'Weather Radar', icon:'🌧️', cat:'Operations', size:'md',
    render(el){
      el.innerHTML = `<div id="w-radar-map" style="height:160px;border-radius:6px;overflow:hidden;"></div>
        <div style="font-size:9px;color:var(--m);margin-top:4px;text-align:center;">Live NEXRAD radar • Updates every 10 min</div>`;
      setTimeout(() => {
        if(!window.L) return;
        if(window._wRadarMap){try{window._wRadarMap.remove();}catch(e){}}
        const map = L.map('w-radar-map',{zoomControl:false,attributionControl:false}).setView([39.07,-84.17],7);
        window._wRadarMap = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:10}).addTo(map);
        L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',{opacity:.6,maxZoom:10}).addTo(map);
      }, 100);
    }},

  {id:'storm-alerts', name:'Storm Alerts', icon:'⛈️', cat:'Operations', size:'sm',
    render(el){
      el.innerHTML = `<div class="w-empty" style="font-size:11px;">
        <div style="font-size:20px;margin-bottom:6px;">🛡️</div>
        No active alerts in your area.<br>
        <span style="font-size:9px;color:var(--m);">Checks NWS alerts API</span>
      </div>`;
      // Attempt to fetch NWS alerts
      fetch('https://api.weather.gov/alerts/active?area=OH&severity=Severe,Extreme&limit=3')
        .then(r => r.json()).then(data => {
          if(data.features && data.features.length) {
            el.innerHTML = data.features.slice(0,3).map(f => `
              <div style="padding:6px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:5px;margin-bottom:4px;font-size:10px;">
                <div style="font-weight:700;color:var(--red);">${f.properties.event}</div>
                <div style="color:var(--m);margin-top:2px;">${(f.properties.headline||'').substring(0,80)}</div>
              </div>`).join('');
          }
        }).catch(err => { console.warn('[widgets] storm-alerts fetch failed', err); });
    }},

  {id:'today-schedule', name:"Today's Schedule", icon:'📅', cat:'Operations', size:'md',
    render(el){
      const calSettings = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
      if(!calSettings.username) {
        el.innerHTML = '<div class="w-empty"><div style="font-size:20px;margin-bottom:6px;">📅</div>Connect Cal.com in Settings to see today\'s appointments</div>';
        return;
      }
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:700;color:var(--t);">Today</span>
          <button class="w-mini-btn" onclick="goTo('schedule')">Open Calendar →</button>
        </div>
        <div class="w-empty" style="font-size:11px;">Cal.com appointments will appear here with future webhook integration.</div>`;
    }},

  {id:'task-checklist', name:'Task Checklist', icon:'✅', cat:'Operations', size:'md',
    render(el){
      let tasks = JSON.parse(localStorage.getItem('nbd_home_tasks') || '[]');
      if(!tasks.length) tasks = [{t:'Follow up on yesterday\'s leads',d:false},{t:'Send 3 estimates',d:false},{t:'Update pipeline stages',d:false},{t:'Check storm reports',d:false}];
      el.innerHTML = `<div id="w-tasks">` + tasks.map((t,i) => `
        <label class="w-task-row">
          <input type="checkbox" ${t.d?'checked':''} onchange="window._wToggleTask(${i},this.checked)">
          <span style="${t.d?'text-decoration:line-through;opacity:.5;':''}font-size:12px;color:var(--t);">${t.t}</span>
        </label>`).join('') + `</div>
        <div style="margin-top:6px;display:flex;gap:4px;">
          <input type="text" id="w-task-input" placeholder="Add task..." style="flex:1;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:5px 8px;font-size:11px;color:var(--t);font-family:inherit;">
          <button class="w-mini-btn" onclick="window._wAddTask()">+</button>
        </div>`;
    }},

  {id:'quick-estimate', name:'Quick Estimate', icon:'🧮', cat:'Operations', size:'sm',
    render(el){
      el.innerHTML = `
        <div style="margin-bottom:6px;">
          <label style="font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.08em;">Sq Ft</label>
          <input type="number" id="w-qe-sqft" placeholder="2000" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:6px 8px;font-size:13px;color:var(--t);font-family:inherit;margin-top:2px;" oninput="window._wQuickEst()">
        </div>
        <div style="margin-bottom:6px;">
          <label style="font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.08em;">$/sq</label>
          <input type="number" id="w-qe-rate" placeholder="350" value="350" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:6px 8px;font-size:13px;color:var(--t);font-family:inherit;margin-top:2px;" oninput="window._wQuickEst()">
        </div>
        <div id="w-qe-result" style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:var(--orange);text-align:center;padding:6px 0;">$0</div>`;
    }},

  {id:'material-watch', name:'Material Price Watch', icon:'📊', cat:'Operations', size:'sm',
    render(el){
      // Simulated price data — in production would fetch from supplier API
      const items = [
        {name:'OC Duration', price:'$98/sq', trend:'+2%', up:true},
        {name:'GAF Timberline', price:'$102/sq', trend:'-1%', up:false},
        {name:'Synthetic Felt', price:'$67/roll', trend:'0%', up:false},
        {name:'Drip Edge 10ft', price:'$4.50/pc', trend:'+5%', up:true},
      ];
      el.innerHTML = items.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--br);">
          <div style="font-size:11px;font-weight:600;color:var(--t);">${i.name}</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--m);">${i.price}</span>
            <span style="font-size:9px;color:${i.up?'var(--red)':'var(--green)'};">${i.trend}</span>
          </div>
        </div>`).join('');
    }},

  {id:'team-leaderboard', name:'Team Leaderboard', icon:'🥇', cat:'Operations', size:'sm',
    render(el){
      // Pull from leaderboard data or simulate
      const reps = [
        {name:'Joe Deal', rev:48500, deals:12},
        {name:'Mike S.', rev:32100, deals:8},
        {name:'Sarah K.', rev:27800, deals:7},
      ];
      el.innerHTML = reps.map((r,i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;${i<reps.length-1?'border-bottom:1px solid var(--br);':''}">
          <span style="font-size:14px;">${i===0?'🥇':i===1?'🥈':'🥉'}</span>
          <div style="flex:1;"><div style="font-size:11px;font-weight:700;color:var(--t);">${r.name}</div></div>
          <div style="text-align:right;"><div style="font-size:12px;font-weight:700;color:var(--orange);">$${(r.rev/1000).toFixed(1)}k</div><div style="font-size:9px;color:var(--m);">${r.deals} deals</div></div>
        </div>`).join('');
    }},

  // ═══ TOOLS & QUICK ACTIONS ═══
  {id:'quick-add-lead', name:'Quick Add Lead', icon:'➕', cat:'Tools & Quick Actions', size:'md',
    render(el){
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          <input type="text" id="w-ql-name" placeholder="Homeowner name" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:8px 10px;font-size:12px;color:var(--t);font-family:inherit;">
          <input type="text" id="w-ql-addr" placeholder="Property address" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:8px 10px;font-size:12px;color:var(--t);font-family:inherit;">
          <div style="display:flex;gap:6px;">
            <select id="w-ql-damage" style="flex:1;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:8px;font-size:11px;color:var(--t);font-family:inherit;">
              <option>Roof - Hail</option><option>Roof - Wind</option><option>Siding</option><option>Full Exterior</option>
            </select>
            <button class="btn btn-orange" style="padding:8px 16px;font-size:11px;" onclick="window._wQuickAddLead()">Add →</button>
          </div>
        </div>`;
    }},

  {id:'quick-draw', name:'Quick Draw', icon:'✏️', cat:'Tools & Quick Actions', size:'sm',
    render(el){
      el.innerHTML = `
        <input type="text" id="w-qd-addr" placeholder="Address to measure..." style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:8px 10px;font-size:12px;color:var(--t);font-family:inherit;margin-bottom:8px;">
        <button class="btn btn-orange" style="width:100%;padding:10px;font-size:12px;justify-content:center;" onclick="window._wQuickDraw()">📏 Open Drawing Tool</button>`;
    }},

  {id:'ask-joe-mini', name:'Ask Joe', icon:'🤠', cat:'Tools & Quick Actions', size:'md',
    render(el){
      el.innerHTML = `
        <div id="w-joe-response" style="font-size:12px;color:var(--m);min-height:40px;margin-bottom:8px;max-height:120px;overflow-y:auto;">Ask Joe anything about sales, claims, or your pipeline.</div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="w-joe-input" placeholder="Ask Joe..." style="flex:1;background:var(--s2);border:1px solid var(--br);border-radius:5px;padding:8px 10px;font-size:12px;color:var(--t);font-family:inherit;" onkeydown="if(event.key==='Enter')window._wAskJoe()">
          <button class="btn btn-orange" style="padding:8px 12px;font-size:11px;" onclick="window._wAskJoe()">Ask</button>
        </div>`;
    }},

  {id:'recent-estimates', name:'Recent Estimates', icon:'📋', cat:'Tools & Quick Actions', size:'sm',
    render(el){
      const ests = (window._estimates || []).slice(-3).reverse();
      if(!ests.length) { el.innerHTML = '<div class="w-empty">No estimates yet</div>'; return; }
      el.innerHTML = ests.map(e => `
        <div class="w-lead-row" onclick="goTo('est')">
          <div class="w-lead-name">${e.address || e.addr || 'Estimate'}</div>
          <div style="font-size:10px;color:var(--orange);font-weight:700;">${e.total ? '$'+parseFloat(e.total).toLocaleString() : '—'}</div>
        </div>`).join('');
    }},

  {id:'recent-docs', name:'Recent Documents', icon:'📄', cat:'Tools & Quick Actions', size:'sm',
    render(el){
      el.innerHTML = `
        <div class="w-lead-row" onclick="goTo('docs')"><div class="w-lead-name">Template Library</div><div style="font-size:10px;color:var(--m);">24 templates</div></div>
        <button class="btn btn-ghost" style="width:100%;margin-top:6px;font-size:11px;padding:7px;justify-content:center;" onclick="goTo('docs')">Open Template Library →</button>`;
    }},

  {id:'booking-link', name:'Booking Link', icon:'🔗', cat:'Tools & Quick Actions', size:'sm',
    render(el){
      const cal = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
      const url = cal.username ? `https://cal.com/${cal.username}/${cal.eventSlug||'roof-inspection'}` : '';
      if(!url) { el.innerHTML = '<div class="w-empty">Set up Cal.com first</div>'; return; }
      el.innerHTML = `
        <div style="font-size:11px;color:var(--m);margin-bottom:8px;word-break:break-all;">${url}</div>
        <div style="display:flex;gap:4px;">
          <button class="w-mini-btn" style="flex:1;" onclick="navigator.clipboard.writeText('${url}');showToast('Copied!','ok')">📋 Copy</button>
          <button class="w-mini-btn" style="flex:1;" onclick="window.open('sms:?body='+encodeURIComponent('Book here: ${url}'))">💬 SMS</button>
        </div>`;
    }},

  // ═══ MOTIVATION & TRACKING ═══
  {id:'north-star', name:'North Star Goal', icon:'⭐', cat:'Motivation & Tracking', size:'sm',
    render(el){
      const cfg = JSON.parse(localStorage.getItem('nbd_ds_config') || '{}');
      const goal = cfg.northStar || 'Set your North Star in Settings → Daily OS';
      const deadline = cfg.northStarDeadline || '';
      el.innerHTML = `
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;color:var(--orange);text-transform:uppercase;line-height:1.3;margin-bottom:6px;">${goal}</div>
        ${deadline ? `<div style="font-size:10px;color:var(--m);">Deadline: ${deadline}</div>` : ''}`;
    }},

  {id:'daily-floors', name:'Daily Floors', icon:'📏', cat:'Motivation & Tracking', size:'md',
    render(el){
      const cfg = JSON.parse(localStorage.getItem('nbd_ds_config') || '{}');
      const floors = cfg.floors || [{label:'Doors Knocked',target:30,unit:''},{label:'Contacts Made',target:10,unit:''},{label:'Appts Set',target:3,unit:''}];
      const today = new Date().toISOString().split('T')[0];
      const progress = JSON.parse(localStorage.getItem('nbd_floor_progress_'+today) || '{}');
      el.innerHTML = floors.map((f,i) => {
        const val = progress[i] || 0;
        const pct = f.target > 0 ? Math.min(100, val/f.target*100) : 0;
        return `<div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px;">
            <span style="font-weight:700;color:var(--t);">${f.label}</span>
            <span style="color:${pct>=100?'var(--green)':'var(--m)'};">${val} / ${f.target}</span>
          </div>
          <div class="w-bar-track"><div class="w-bar-fill" style="width:${pct}%;${pct>=100?'background:var(--green);':''}"></div></div>
        </div>`;
      }).join('') + `<button class="w-mini-btn" style="width:100%;margin-top:4px;" onclick="window.open('/pro/daily-success/','_self')">Open Daily Tracker →</button>`;
    }},

  {id:'streak-counter', name:'Streak Counter', icon:'🔥', cat:'Motivation & Tracking', size:'sm',
    render(el){
      const streak = parseInt(localStorage.getItem('nbd_streak') || '0');
      el.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:42px;line-height:1;">${streak > 0 ? '🔥' : '❄️'}</div>
          <div class="w-big-num" style="font-size:36px;">${streak}</div>
          <div class="w-sub">${streak === 1 ? 'day streak' : 'day streak'}</div>
          <div style="font-size:9px;color:var(--m);margin-top:4px;">${streak >= 7 ? 'Unstoppable!' : streak >= 3 ? 'Keep it going!' : 'Build momentum!'}</div>
        </div>`;
    }},

  {id:'quote-widget', name:'Daily Quote', icon:'💬', cat:'Motivation & Tracking', size:'sm',
    render(el){
      const quotes = [
        {q:"The fortune is in the follow-up.",a:"Jim Rohn"},
        {q:"Every no gets you closer to a yes.",a:"Mark Cuban"},
        {q:"Don't find customers for your products, find products for your customers.",a:"Seth Godin"},
        {q:"Success is not final, failure is not fatal.",a:"Winston Churchill"},
        {q:"The best time to plant a tree was 20 years ago. The second best time is now.",a:"Chinese Proverb"},
        {q:"Hustle beats talent when talent doesn't hustle.",a:"Ross Simmonds"},
        {q:"You miss 100% of the shots you don't take.",a:"Wayne Gretzky"},
        {q:"Be so good they can't ignore you.",a:"Steve Martin"},
        {q:"The sale begins when the customer says no.",a:"Jeffrey Gitomer"},
        {q:"Your attitude determines your altitude.",a:"Zig Ziglar"},
      ];
      const today = new Date().getDate();
      const q = quotes[today % quotes.length];
      el.innerHTML = `
        <div style="font-size:13px;font-style:italic;color:var(--t);line-height:1.5;margin-bottom:8px;">"${q.q}"</div>
        <div style="font-size:10px;color:var(--orange);font-weight:700;text-align:right;">— ${q.a}</div>`;
    }},

  {id:'golden-goose', name:'Golden Goose', icon:'🪿', cat:'Motivation & Tracking', size:'sm',
    render(el){
      const cfg = JSON.parse(localStorage.getItem('nbd_ds_config') || '{}');
      const reward = cfg.goldenGoose || 'Set your reward in Settings → Daily OS';
      const today = new Date().toISOString().split('T')[0];
      const progress = JSON.parse(localStorage.getItem('nbd_floor_progress_'+today) || '{}');
      const floors = cfg.floors || [];
      const allHit = floors.length > 0 && floors.every((f,i) => (progress[i]||0) >= f.target);
      el.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:36px;">${allHit ? '🪿✨' : '🪿'}</div>
          <div style="font-size:12px;font-weight:700;color:${allHit?'var(--green)':'var(--t)'};margin:6px 0;">${allHit ? 'UNLOCKED!' : 'Hit all floors to unlock'}</div>
          <div style="font-size:11px;color:var(--orange);font-style:italic;">${reward}</div>
        </div>`;
    }},

  // ═══ DATA & ANALYTICS ═══
  {id:'damage-type-chart', name:'Pipeline by Damage', icon:'🥧', cat:'Data & Analytics', size:'md',
    render(el){
      const leads = window._leads || [];
      const types = {};
      leads.forEach(l => { const dt = l.damageType || l.damage || 'Unknown'; types[dt] = (types[dt]||0)+1; });
      const entries = Object.entries(types).sort((a,b) => b[1]-a[1]);
      const total = leads.length || 1;
      const colors = ['var(--orange)','var(--blue)','var(--green)','#A855F7','var(--gold)','#EC4899','#06B6D4'];
      el.innerHTML = entries.slice(0,5).map(([ name, count], i) => {
        const pct = (count/total*100).toFixed(0);
        return `<div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
            <span style="color:var(--t);font-weight:600;">${name}</span>
            <span style="color:var(--m);">${count} (${pct}%)</span>
          </div>
          <div class="w-bar-track"><div class="w-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]};"></div></div>
        </div>`;
      }).join('');
    }},

  {id:'monthly-trend', name:'Monthly Trend', icon:'📉', cat:'Data & Analytics', size:'lg',
    render(el){
      // Generate last 6 months of simulated data from leads
      const leads = window._leads || [];
      const months = [];
      const now = new Date();
      for(let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        const label = d.toLocaleDateString('en-US',{month:'short'});
        const count = leads.filter(l => {
          const cd = new Date(l.createdAt || 0);
          return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
        }).length;
        months.push({label, count});
      }
      const max = Math.max(...months.map(m=>m.count), 1);
      el.innerHTML = `
        <div style="display:flex;align-items:flex-end;gap:6px;height:100px;">
          ${months.map(m => {
            const h = Math.max(8, m.count/max*90);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
              <span style="font-size:9px;color:var(--t);font-weight:700;">${m.count}</span>
              <div style="width:100%;height:${h}px;background:var(--orange);border-radius:3px 3px 0 0;"></div>
              <span style="font-size:8px;color:var(--m);">${m.label}</span>
            </div>`;
          }).join('')}
        </div>`;
    }},

  {id:'source-breakdown', name:'Lead Sources', icon:'📡', cat:'Data & Analytics', size:'sm',
    render(el){
      const leads = window._leads || [];
      const sources = {};
      leads.forEach(l => { const s = l.source || 'Direct'; sources[s] = (sources[s]||0)+1; });
      const entries = Object.entries(sources).sort((a,b) => b[1]-a[1]).slice(0,4);
      if(!entries.length) { el.innerHTML = '<div class="w-empty">No source data yet</div>'; return; }
      el.innerHTML = entries.map(([s,c]) => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--br);font-size:11px;">
          <span style="color:var(--t);font-weight:600;">${s}</span>
          <span style="color:var(--orange);font-weight:700;">${c}</span>
        </div>`).join('');
    }},

  {id:'territory-mini', name:'Territory Heat Map', icon:'🗺️', cat:'Data & Analytics', size:'lg',
    render(el){
      el.innerHTML = `<div id="w-mini-heat" style="height:180px;border-radius:6px;overflow:hidden;"></div>
        <button class="w-mini-btn" style="width:100%;margin-top:6px;" onclick="goTo('map')">Open Full Map →</button>`;
      setTimeout(() => {
        if(!window.L) return;
        if(window._wMiniHeat){try{window._wMiniHeat.remove();}catch(e){}}
        const leads = window._leads || [];
        const pts = leads.filter(l=>l.lat&&l.lng).map(l=>[l.lat,l.lng]);
        const center = pts.length ? [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length] : [39.07,-84.17];
        const map = L.map('w-mini-heat',{zoomControl:false,attributionControl:false}).setView(center, pts.length>0?11:7);
        window._wMiniHeat = map;
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18}).addTo(map);
        if(pts.length && window.L.heatLayer) L.heatLayer(pts,{radius:20,blur:15,maxZoom:15}).addTo(map);
      }, 100);
    }},
];


// ── UTILITY HELPERS ─────────────────────────────────────────────
function _toMs(v) { if(!v) return 0; if(v.toDate) return v.toDate().getTime(); if(v.seconds) return v.seconds*1000; const d=new Date(v); return isNaN(d)?0:d.getTime(); }

function _timeAgo(date) {
  // Handle Firestore Timestamps, strings, and Date objects
  let d = date;
  if(d && d.toDate) d = d.toDate();
  else if(d && d.seconds) d = new Date(d.seconds * 1000);
  else if(!(d instanceof Date)) d = new Date(d);
  if(isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if(s < 0) return 'just now';
  if(s < 60) return 'just now';
  if(s < 3600) return Math.floor(s/60) + 'm ago';
  if(s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}


// ── WIDGET STATE (localStorage) ─────────────────────────────────
const STORAGE_KEY = 'nbd_home_widgets';
const DEFAULT_WIDGETS = ['pipeline-value','hot-leads','win-rate','revenue-month','task-checklist',
  'daily-floors','quick-add-lead','recent-activity','weather-radar','north-star','quote-widget','streak-counter'];

function getActiveWidgets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved && saved.length) return saved;
  } catch(e) {}
  return [...DEFAULT_WIDGETS];
}

function saveActiveWidgets(ids) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}


// ── RENDER ENGINE ───────────────────────────────────────────────
function renderWidgetHome() {
  const grid = document.getElementById('widgetGrid');
  if(!grid) return;

  const activeIds = getActiveWidgets();
  grid.innerHTML = '';

  activeIds.forEach(id => {
    const w = WIDGETS.find(x => x.id === id);
    if(!w) return;

    // Widget → view navigation map. Clicking ANY widget card takes
    // you to a relevant view. Specific widgets get specific targets,
    // everything else defaults to 'crm' since that's where the data
    // lives for most pipeline/sales metrics.
    const NAV_MAP = {
      'pipeline-value': 'crm', 'hot-leads': 'crm', 'win-rate': 'crm',
      'revenue-month': 'crm', 'task-checklist': 'crm', 'stale-leads': 'crm',
      'close-board': 'closeboard', 'source-breakdown': 'crm',
      'stage-funnel': 'crm', 'recent-activity': 'crm', 'recent-estimates': 'est',
      'recent-docs': 'docs', 'damage-type-chart': 'crm', 'monthly-trend': 'crm',
      'd2d-summary': 'd2d', 'd2d-kpi': 'd2d', 'door-knock-heat': 'd2d',
      'weather-radar': 'd2d', 'storm-alerts': 'storm',
      'quick-estimate': 'est', 'quick-draw': 'draw', 'booking-link': 'schedule',
      'ask-joe-mini': 'joe', 'team-leaderboard': 'board',
      'today-schedule': 'schedule', 'material-watch': 'products'
    };
    const card = document.createElement('div');
    card.className = 'w-card w-' + w.size;
    card.dataset.widgetId = w.id;
    // EVERY widget is clickable — NAV_MAP for specific targets,
    // default to 'crm' for anything not explicitly mapped.
    const navTarget = NAV_MAP[w.id] || 'crm';
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.w-card-remove')) return;
      if (typeof window.goTo === 'function') window.goTo(navTarget);
    });
    card.innerHTML = `
      <div class="w-card-hdr">
        <span class="w-card-icon">${w.icon}</span>
        <span class="w-card-title">${w.name}</span>
        <button class="w-card-remove" onclick="event.stopPropagation();window.NBDWidgets.removeWidget('${w.id}')" title="Remove widget">✕</button>
      </div>
      <div class="w-card-body" id="wb-${w.id}"></div>`;
    grid.appendChild(card);

    // Render widget content
    try { w.render(document.getElementById('wb-' + w.id)); }
    catch(e) { document.getElementById('wb-' + w.id).innerHTML = '<div class="w-empty">Error loading widget</div>'; }
  });

  // Add the "Add Widget" card
  const addCard = document.createElement('div');
  addCard.className = 'w-card w-sm w-add-card';
  addCard.onclick = () => window.NBDWidgets.openPicker();
  addCard.innerHTML = `<div style="text-align:center;padding:20px 0;cursor:pointer;">
    <div style="font-size:28px;opacity:.4;">＋</div>
    <div style="font-size:11px;color:var(--m);margin-top:4px;">Add Widget</div>
  </div>`;
  grid.appendChild(addCard);
}


// ── WIDGET PICKER MODAL ─────────────────────────────────────────
function openWidgetPicker() {
  const activeIds = getActiveWidgets();
  const cats = [...new Set(WIDGETS.map(w => w.cat))];

  let html = `<div class="w-picker-overlay" id="wPickerOverlay" onclick="if(event.target===this)window.NBDWidgets.closePicker()">
    <div class="w-picker">
      <div class="w-picker-hdr">
        <div>
          <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--orange);">Customize Home</div>
          <div style="font-size:18px;font-weight:800;color:var(--t);">Widget Library</div>
        </div>
        <button style="background:none;border:none;color:var(--m);font-size:20px;cursor:pointer;" onclick="window.NBDWidgets.closePicker()">✕</button>
      </div>
      <div class="w-picker-body">`;

  cats.forEach(cat => {
    const catWidgets = WIDGETS.filter(w => w.cat === cat);
    html += `<div class="w-picker-cat">${cat}</div>`;
    catWidgets.forEach(w => {
      const isActive = activeIds.includes(w.id);
      html += `<label class="w-picker-row ${isActive ? 'w-picker-active' : ''}">
        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="window.NBDWidgets.toggleWidget('${w.id}', this.checked)">
        <span class="w-picker-icon">${w.icon}</span>
        <span class="w-picker-name">${w.name}</span>
        <span class="w-picker-size">${w.size}</span>
      </label>`;
    });
  });

  html += `</div>
      <div class="w-picker-footer">
        <button class="btn btn-ghost" style="font-size:11px;padding:8px 14px;" onclick="window.NBDWidgets.resetDefaults()">Reset to Defaults</button>
        <button class="btn btn-orange" style="font-size:12px;padding:8px 20px;" onclick="window.NBDWidgets.closePicker()">Done</button>
      </div>
    </div>
  </div>`;

  const container = document.createElement('div');
  container.id = 'wPickerContainer';
  container.innerHTML = html;
  document.body.appendChild(container);
}

function closePicker() {
  const c = document.getElementById('wPickerContainer');
  if(c) c.remove();
}


// ── WIDGET MANAGEMENT ───────────────────────────────────────────
function toggleWidget(id, on) {
  let active = getActiveWidgets();
  if(on && !active.includes(id)) active.push(id);
  if(!on) active = active.filter(x => x !== id);
  saveActiveWidgets(active);
  renderWidgetHome();
}

function removeWidget(id) {
  let active = getActiveWidgets().filter(x => x !== id);
  saveActiveWidgets(active);
  renderWidgetHome();
  showToast('Widget removed', 'info');
}

function resetDefaults() {
  saveActiveWidgets([...DEFAULT_WIDGETS]);
  closePicker();
  renderWidgetHome();
  showToast('Widgets reset to defaults', 'ok');
}


// ── WIDGET INTERACTION HELPERS (global) ─────────────────────────
window._wToggleTask = function(idx, done) {
  let tasks = JSON.parse(localStorage.getItem('nbd_home_tasks') || '[]');
  if(!tasks.length) tasks = [{t:'Follow up on yesterday\'s leads',d:false},{t:'Send 3 estimates',d:false},{t:'Update pipeline stages',d:false},{t:'Check storm reports',d:false}];
  if(tasks[idx]) tasks[idx].d = done;
  localStorage.setItem('nbd_home_tasks', JSON.stringify(tasks));
  renderWidgetHome();
};

window._wAddTask = function() {
  const input = document.getElementById('w-task-input');
  if(!input || !input.value.trim()) return;
  let tasks = JSON.parse(localStorage.getItem('nbd_home_tasks') || '[]');
  tasks.push({t: input.value.trim(), d: false});
  localStorage.setItem('nbd_home_tasks', JSON.stringify(tasks));
  renderWidgetHome();
};

window._wQuickEst = function() {
  const sqft = parseFloat(document.getElementById('w-qe-sqft')?.value || 0);
  const rate = parseFloat(document.getElementById('w-qe-rate')?.value || 350);
  const squares = sqft / 100;
  const total = squares * rate;
  const el = document.getElementById('w-qe-result');
  if(el) el.textContent = '$' + total.toLocaleString(undefined, {maximumFractionDigits:0});
};

window._wQuickAddLead = function() {
  const name = document.getElementById('w-ql-name')?.value?.trim();
  const addr = document.getElementById('w-ql-addr')?.value?.trim();
  const damage = document.getElementById('w-ql-damage')?.value;
  if(!addr) { showToast('Enter an address','error'); return; }
  // Trigger the lead modal if available
  if(window.openLeadModal) {
    openLeadModal();
    setTimeout(() => {
      const nameEl = document.getElementById('leadName'); if(nameEl && name) nameEl.value = name;
      const addrEl = document.getElementById('leadAddr'); if(addrEl) addrEl.value = addr;
      const dmgEl = document.getElementById('leadDamage'); if(dmgEl && damage) dmgEl.value = damage;
    }, 100);
  }
  showToast('Opening lead form...','info');
};

window._wQuickDraw = function() {
  const addr = document.getElementById('w-qd-addr')?.value?.trim();
  if(window.goTo) goTo('draw');
  if(addr) {
    setTimeout(() => {
      const el = document.getElementById('drawSearch');
      if(el) { el.value = addr; if(window.searchDraw) searchDraw(); }
    }, 200);
  }
};

window._wAskJoe = function() {
  const input = document.getElementById('w-joe-input');
  if(!input || !input.value.trim()) return;
  const q = input.value.trim();
  input.value = '';
  const resp = document.getElementById('w-joe-response');
  if(resp) resp.innerHTML = '<div style="color:var(--orange);">Thinking...</div>';
  // If Joe AI is available, use it
  if(window.sendJoeMessage) {
    // Redirect to full Joe
    goTo('joe');
    setTimeout(() => {
      const joeInput = document.querySelector('.joe-input-area textarea');
      if(joeInput) { joeInput.value = q; sendJoeMessage(); }
    }, 200);
  } else {
    if(resp) resp.innerHTML = '<div style="color:var(--m);">Open Ask Joe for full AI chat →</div>';
  }
};


// ── PUBLIC API ──────────────────────────────────────────────────
window.NBDWidgets = {
  WIDGETS,
  render: renderWidgetHome,
  openPicker: openWidgetPicker,
  closePicker: closePicker,
  toggleWidget,
  removeWidget,
  resetDefaults,
  getActive: getActiveWidgets,
};

})();
