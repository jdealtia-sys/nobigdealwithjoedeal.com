// ============================================================
// NBD Pro — tasks.js
// Task system: load, save, toggle, delete, render, modal
// Extracted from dashboard.html
// ============================================================

// ══ Module State ══════════════════════════════════════════
// Use var to avoid redeclaration collision with dashboard.html inline script
var _taskModalLeadId = _taskModalLeadId || null;
const _overdueNotifiedLocal = new Set(); // local dedup guard for overdue notifications

// ══ Notification Helper ══════════════════════════════════
async function createNotification(userId, type, title, message, leadId) {
  // Fallback to toast if browser Notification API not available
  if (!('Notification' in window)) {
    return showToast(message, 'info');
  }

  // Request permission on first use if not already granted
  if (Notification.permission === 'default') {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    } catch (e) {
      return showToast(message, 'info');
    }
  }

  // Only show notification if permission was granted
  if (Notification.permission !== 'granted') {
    return showToast(message, 'info');
  }

  // Show browser notification
  try {
    const notif = new Notification(title, {
      body: message,
      icon: '/icon-logo.png',
      badge: '/icon-badge.png',
      tag: `task-${leadId}`,
      requireInteraction: false
    });

    // Click notification to open lead
    if (leadId) {
      notif.addEventListener('click', () => {
        window.focus();
        window.location.href = `/pro/dashboard.html?tab=crm&lead=${leadId}`;
      });
    }
  } catch (e) {
    // Fallback to toast
    showToast(message, 'info');
  }
}

async function _loadTasks(leadId) {
  if (!window._taskCache) window._taskCache = {};
  try {
    const snap = await getDocs(query(collection(db,'leads',leadId,'tasks'), orderBy('createdAt','asc')));
    const tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
    window._taskCache[leadId] = tasks;
    return tasks;
  } catch(e){ return window._taskCache[leadId]||[]; }
}
async function _saveTask(leadId, text, dueDate) {
  try {
    const ref = await addDoc(collection(db,'leads',leadId,'tasks'),{text:text.trim(),done:false,dueDate:dueDate||'',createdAt:serverTimestamp()});
    return ref.id;
  } catch(e){ return null; }
}
async function _toggleTask(leadId, taskId, done) {
  try { 
    await updateDoc(doc(db,'leads',leadId,'tasks',taskId), {
      done,
      completedAt: done ? serverTimestamp() : null
    }); 
  } catch(e){}
}
async function _deleteTask(leadId, taskId) {
  try { await deleteDoc(doc(db,'leads',leadId,'tasks',taskId)); } catch(e){}
}
async function loadAllTasks() {
  // Use allSettled so a single lead's failure doesn't block the rest
  await Promise.allSettled((window._leads||[]).map(l=>_loadTasks(l.id)));
  renderTodayTasks();
  renderLeads(window._leads, window._filteredLeads);
}
function renderTodayTasks() {
  const el = document.getElementById('todayTasksList');
  if(!el) return;
  const now = new Date();
  const eod = new Date(); eod.setHours(23,59,59,999);
  const sod = new Date(); sod.setHours(0,0,0,0);
  const items = [];
  if (!window._taskCache) window._taskCache = {};
  (window._leads||[]).forEach(lead=>{
    ((window._taskCache||{})[lead.id]||[]).forEach(t=>{
      if(t.done) return;
      const due = t.dueDate ? new Date(t.dueDate+'T23:59:59') : null;
      if(!due||due>eod) return;
      
      // Create notification for newly overdue tasks (deduplicated per session + Firestore flag)
      const notifKey = lead.id + '_' + t.id;
      if(due<sod && !t.overdueNotified && !_overdueNotifiedLocal.has(notifKey) && auth.currentUser) {
        _overdueNotifiedLocal.add(notifKey); // prevent re-fire within this session
        createNotification(
          auth.currentUser.uid,
          'task_overdue',
          'Task Overdue',
          `"${t.text}" for ${((lead.firstName||'')+' '+(lead.lastName||'')).trim()||lead.address}`,
          lead.id
        ).then(() => {
          // Mark as notified in Firestore to prevent cross-session duplicates
          updateDoc(doc(db,'leads',lead.id,'tasks',t.id), {overdueNotified: true}).catch(e=>{});
        });
      }
      
      items.push({task:t,lead,leadName:((lead.firstName||'')+' '+(lead.lastName||'')).trim()||lead.address||'Lead',isOverdue:due<sod,due});
    });
  });
  if(!items.length){el.innerHTML='<div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg></div><div class="empty-title">All Caught Up</div><div class="empty-sub">No tasks due today. Nice work.</div></div>';return;}
  items.sort((a,b)=>(b.isOverdue-a.isOverdue)||(a.due-b.due));
  el.innerHTML=items.slice(0,8).map(({task,lead,leadName,isOverdue})=>`<div class="today-task-item"><input type="checkbox" class="today-task-cb" ${task.done?'checked':''} onchange="toggleTodayTask('${lead.id}','${task.id}',this.checked)"><span class="today-task-text ${task.done?'done':''}">${task.text}</span>${isOverdue?'<span class="today-task-overdue">OVERDUE</span>':''}<span class="today-task-lead" onclick="openTaskModal('${lead.id}',null)">${leadName.split(' ')[0]}</span></div>`).join('')+(items.length>8?`<div style="text-align:center;padding:8px;font-size:11px;color:var(--m);">+${items.length-8} more — <span style="color:var(--orange);cursor:pointer;" onclick="goTo('crm')">view in CRM</span></div>`:'');
}
async function toggleTodayTask(leadId,taskId,done){const t=(window._taskCache[leadId]||[]).find(t=>t.id===taskId);if(t)t.done=done;await _toggleTask(leadId,taskId,done);renderTodayTasks();renderLeads(window._leads,window._filteredLeads);}
async function openTaskModal(leadId,event){
  if(event)event.stopPropagation();
  _taskModalLeadId=leadId;
  const lead=(window._leads||[]).find(l=>l.id===leadId);
  document.getElementById('taskModalName').textContent=lead?(((lead.firstName||'')+' '+(lead.lastName||'')).trim()||lead.address):leadId;
  document.getElementById('taskModalAddr').textContent=lead?(lead.address||'').split(',').slice(0,2).join(','):'';
  document.getElementById('taskInput').value='';
  document.getElementById('taskDue').value='';
  document.getElementById('taskModal').classList.add('open');
  renderTaskList(await _loadTasks(leadId));
}
function closeTaskModal(){document.getElementById('taskModal').classList.remove('open');_taskModalLeadId=null;renderLeads(window._leads,window._filteredLeads);renderTodayTasks();}
function _taskDueLabel(ds){const d=new Date(ds+'T12:00:00'),t=new Date(),tm=new Date(t);t.setHours(0,0,0,0);tm.setDate(tm.getDate()+1);tm.setHours(0,0,0,0);const dd=new Date(d);dd.setHours(0,0,0,0);if(dd.getTime()===t.getTime())return'Today';if(dd.getTime()===tm.getTime())return'Tomorrow';if(dd<t)return'Overdue';return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function renderTaskList(tasks){
  const el=document.getElementById('taskList');if(!el)return;
  if(!tasks.length){el.innerHTML='<div class="task-empty">No tasks yet. Add one above.</div>';return;}
  const now=new Date();
  const undone=tasks.filter(t=>!t.done).sort((a,b)=>(!a.dueDate&&!b.dueDate)?0:!a.dueDate?1:!b.dueDate?-1:new Date(a.dueDate)-new Date(b.dueDate));
  el.innerHTML=[...undone,...tasks.filter(t=>t.done)].map(t=>{
    const due=t.dueDate?new Date(t.dueDate+'T23:59:59'):null;
    const ov=due&&due<now&&!t.done;
    return `<div class="task-item ${t.done?'done':''} ${ov?'overdue':''}" id="titem-${t.id}"><input type="checkbox" class="task-cb" ${t.done?'checked':''} onchange="checkTask('${t.id}',this.checked)"><span class="task-text">${t.text}</span>${t.dueDate?`<span class="task-due ${ov?'overdue':''}">${_taskDueLabel(t.dueDate)}</span>`:''}<button class="task-del" onclick="removeTask('${t.id}')" title="Delete">×</button></div>`;
  }).join('');
}
async function addTask(){const inp=document.getElementById('taskInput'),due=document.getElementById('taskDue'),text=inp.value.trim();if(!text||!_taskModalLeadId)return;inp.value='';await _saveTask(_taskModalLeadId,text,due.value||'');renderTaskList(await _loadTasks(_taskModalLeadId));}
async function checkTask(taskId,done){if(!_taskModalLeadId)return;const t=(window._taskCache[_taskModalLeadId]||[]).find(t=>t.id===taskId);if(t)t.done=done;const item=document.getElementById('titem-'+taskId);if(item)item.classList.toggle('done',done);await _toggleTask(_taskModalLeadId,taskId,done);setTimeout(async()=>renderTaskList(await _loadTasks(_taskModalLeadId)),400);}
async function removeTask(taskId){if(!_taskModalLeadId)return;await _deleteTask(_taskModalLeadId,taskId);renderTaskList(await _loadTasks(_taskModalLeadId));}
window.addEventListener('load',()=>{setTimeout(loadAllTasks,1800);});
// ══ END TASK SYSTEM ══════════════════════════════

// ══ Window Scope Exposures ══════════════════════════════════
window._loadTasks = _loadTasks;
window._saveTask = _saveTask;
window._toggleTask = _toggleTask;
window._deleteTask = _deleteTask;
window.loadAllTasks = loadAllTasks;
window.renderTodayTasks = renderTodayTasks;
window.toggleTodayTask = toggleTodayTask;
window.openTaskModal = openTaskModal;
window.closeTaskModal = closeTaskModal;
window.addTask = addTask;
window.checkTask = checkTask;
window.removeTask = removeTask;
window.createNotification = createNotification;
