// ============================================================
// NBD Pro — ai.js  
// Ask Joe AI chat system, key management, context builder,
// chat persistence, message rendering, Joe persona
// ============================================================

// ══════════════════════════════════════════════════════════════════════
// ASK JOE AI
// ══════════════════════════════════════════════════════════════════════
const JOE_KEY_STORE  = 'nbd_joe_key';
const JOE_CHAT_STORE = 'nbd_joe_chat';
let _joeMessages = []; // {role, content}
let _joeTyping   = false;

// ── Key management ──────────────────────────────────────────────────
function getJoeKey()  { try { return localStorage.getItem(JOE_KEY_STORE)||''; } catch { return ''; } }
function saveJoeKey() {
  const v = document.getElementById('joeKeyInput')?.value?.trim();
  if(!v || !v.startsWith('sk-ant')) { showToast('Paste a valid Anthropic key (starts with sk-ant)', 'error'); return; }
  try { localStorage.setItem(JOE_KEY_STORE, v); } catch(e){}
  // Update status display in settings
  const status = document.getElementById('joeKeyStatus');
  if (status) { status.textContent = '✓ Key saved — Joe AI is active'; status.style.color = 'var(--green)'; }
  // Clear the input for security
  const inp = document.getElementById('joeKeyInput');
  if (inp) inp.value = '';
  initJoeChat();
  showToast('✓ Joe AI activated', 'success');
}
function clearJoeKey() {
  try { localStorage.removeItem(JOE_KEY_STORE); localStorage.removeItem(JOE_CHAT_STORE); } catch(e){}
  _joeMessages = [];
  initJoeChat();
}

// ── Build rich context from live Firestore data ─────────────────────
function buildJoeContext() {
  const leads    = window._leads || [];
  const ests     = window._estimates || [];
  const user     = window._user;
  const settings = window._userSettings || {};

  const today = new Date(); today.setHours(0,0,0,0);
  const active = leads.filter(l=>!['Lost','Complete'].includes(l.stage||''));
  const closed = leads.filter(l=>l.stage==='Complete');
  const overdue = leads.filter(l=>{
    if(!l.followUp||['Complete','Lost'].includes(l.stage||'')) return false;
    return new Date(l.followUp) <= today;
  });
  const pipeVal = active.reduce((s,l)=>s+parseFloat(l.jobValue||0),0);
  const closedRev = closed.reduce((s,l)=>s+parseFloat(l.jobValue||0),0);

  // Stage breakdown
  const byStage = {};
  leads.forEach(l=>{ byStage[l.stage||'New']=(byStage[l.stage||'New']||0)+1; });
  const stageStr = Object.entries(byStage).map(([k,v])=>`${k}:${v}`).join(', ');

  // Top leads to call out
  const topLeads = active
    .sort((a,b)=>parseFloat(b.jobValue||0)-parseFloat(a.jobValue||0))
    .slice(0,5)
    .map(l=>`${l.firstName||''} ${l.lastName||''} (${l.stage}, ${l.damageType||'unknown damage'}, $${parseFloat(l.jobValue||0).toLocaleString()}, ${l.claimStatus||'no claim'})`)
    .join('; ');

  // Overdue follow-ups
  const overdueStr = overdue.slice(0,5)
    .map(l=>`${l.firstName||''} ${l.lastName||''} - due ${l.followUp}`)
    .join('; ');

  // Tasks due today
  const tasksDue = [];
  (window._leads||[]).forEach(lead=>{
    (window._taskCache[lead.id]||[]).forEach(t=>{
      if(t.done) return;
      const due = t.dueDate ? new Date(t.dueDate+'T23:59:59') : null;
      if(due && due <= new Date()) {
        tasksDue.push(`"${t.text}" for ${(lead.firstName||'')} ${(lead.lastName||'')||lead.address}`);
      }
    });
  });

  return {
    name: settings.displayName || user?.displayName || 'the rep',
    company: settings.company || 'their company',
    totalLeads: leads.length,
    activeLeads: active.length,
    pipelineValue: pipeVal,
    closedRevenue: closedRev,
    overdueCount: overdue.length,
    stageBreakdown: stageStr,
    topLeads: topLeads || 'none yet',
    overdueFollowUps: overdueStr || 'none',
    totalEstimates: ests.length,
    tasksDueToday: tasksDue.length ? tasksDue.join('; ') : 'none',
  };
}

function buildJoeSystemPrompt(ctx) {
  return `You are Joe Deal — owner of No Big Deal Home Solutions in the Greater Cincinnati area. You're a battle-tested insurance restoration contractor with years in roofing, siding, storm damage, fire, water, and smoke claims. You founded No Big Deal Solutions and you know this industry cold: Xactimate, supplement writing, adjuster negotiations, canvassing, D2D sales, the whole game.

You're talking to one of your members on the NBD Pro platform — a contractor you're coaching. Your job is to give them real, actionable advice the way you would standing in their driveway or on the phone. Plain language. No fluff. Honest. If something is a bad idea, say so. If they're leaving money on the table, tell them.

CURRENT MEMBER CONTEXT (live from their pipeline):
- Member name: ${ctx.name}
- Company: ${ctx.company}
- Total leads: ${ctx.totalLeads} | Active: ${ctx.activeLeads}
- Pipeline value: $${ctx.pipelineValue.toLocaleString()}
- Closed revenue: $${ctx.closedRevenue.toLocaleString()}
- Overdue follow-ups: ${ctx.overdueCount}
- Stage breakdown: ${ctx.stageBreakdown}
- Top leads by value: ${ctx.topLeads}
- Overdue follow-up names: ${ctx.overdueFollowUps}
- Tasks due today: ${ctx.tasksDueToday}
- Total estimates on file: ${ctx.totalEstimates}

USE THIS DATA. When they ask about their pipeline, leads, priorities, or follow-ups — reference the actual numbers above. Don't be generic.

RESPONSE STYLE:
- Talk like a contractor, not a consultant. Short sentences. Direct.
- Use bullet points when listing multiple things.
- Keep responses focused — 100-250 words unless they need something longer like a document.
- If they ask you to write something (supplement request, scope, letter to adjuster) — write the actual thing, not a template.
- Sign off with action items when appropriate.`;
}

function updateJoeContextBar(ctx) {
  const bar = document.getElementById('joeContextBar');
  if(!bar) return;
  if(ctx.totalLeads === 0 && ctx.totalEstimates === 0) { bar.style.display='none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = `
    ⚡ LIVE CONTEXT: ${ctx.activeLeads} active leads · $${ctx.pipelineValue.toLocaleString()} pipeline
    ${ctx.overdueCount ? `· <span style="color:var(--red);">⚠ ${ctx.overdueCount} overdue</span>` : ''}
    ${ctx.tasksDueToday !== 'none' ? '· Tasks due today' : ''}
  `;
}

// ── Chat persistence ────────────────────────────────────────────────
function loadJoeChat() {
  try {
    const saved = sessionStorage.getItem(JOE_CHAT_STORE);
    if(saved) _joeMessages = JSON.parse(saved);
  } catch { _joeMessages = []; }
}
function saveJoeChat() {
  try {
    // Keep last 40 messages to avoid sessionStorage bloat
    const trimmed = _joeMessages.slice(-40);
    sessionStorage.setItem(JOE_CHAT_STORE, JSON.stringify(trimmed));
  } catch(e){}
}

// ── Init ────────────────────────────────────────────────────────────
function initJoeChat() {
  const noKey  = document.getElementById('joeNoKey');
  const msgs   = document.getElementById('joeMessages');
  const input  = document.getElementById('joeInputArea');
  if(!noKey || !msgs || !input) return;

  // Check for stored key — show gate if missing
  const _k = getJoeKey();
  if (!_k) {
    noKey.style.display='block'; msgs.style.display='none'; input.style.display='none';
    document.getElementById('joeContextBar').style.display='none';
    return;
  }
  noKey.style.display='none'; msgs.style.display='flex'; input.style.display='block';

  loadJoeChat();

  if(_joeMessages.length === 0) {
    // Welcome message
    const ctx = buildJoeContext();
    const greeting = ctx.totalLeads > 0
      ? `Hey ${ctx.name.split(' ')[0] || 'there'} — I've got eyes on your pipeline. You've got ${ctx.activeLeads} active leads worth $${ctx.pipelineValue.toLocaleString()}${ctx.overdueCount ? `, and ${ctx.overdueCount} follow-up${ctx.overdueCount!==1?'s':''} that need attention today` : ''}. What do you want to work on?`
      : `Hey ${ctx.name.split(' ')[0] || 'there'} — Joe here. Looks like you're just getting started. Add your first lead in CRM and I can start giving you real advice based on your actual pipeline. In the meantime, ask me anything about running claims, canvassing, or closing jobs.`;
    appendJoeMessage('joe', greeting);
  } else {
    renderJoeMessages();
  }

  const ctx = buildJoeContext();
  updateJoeContextBar(ctx);
}

// ── Render ──────────────────────────────────────────────────────────
function renderJoeMessages() {
  const el = document.getElementById('joeMessages');
  if(!el) return;
  el.innerHTML = _joeMessages.map(m => buildJoeBubble(m.role, m.content)).join('');
  scrollJoeToBottom();
}

function buildJoeBubble(role, content) {
  // Convert **bold**, bullet points, newlines
  const formatted = (content||'')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/^[•\-] (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>\s*)+/g, match => '<ul>'+match+'</ul>')
    .replace(/\n/g,'<br>');
  const avatar = role==='joe' ? '🤠' : (window._userSettings?.displayName?.[0]||'J');
  return `<div class="joe-msg ${role}">
    <div class="joe-msg-avatar">${avatar}</div>
    <div class="joe-bubble">${formatted}</div>
  </div>`;
}

function appendJoeMessage(role, content) {
  _joeMessages.push({role, content});
  const el = document.getElementById('joeMessages');
  if(el) {
    const div = document.createElement('div');
    div.innerHTML = buildJoeBubble(role, content);
    el.appendChild(div.firstChild);
    scrollJoeToBottom();
  }
  saveJoeChat();
}

function showJoeTyping() {
  const el = document.getElementById('joeMessages');
  if(!el) return;
  const div = document.createElement('div');
  div.className = 'joe-msg joe';
  div.id = 'joeTypingIndicator';
  div.innerHTML = `<div class="joe-msg-avatar">🤠</div><div class="joe-bubble"><div class="joe-typing"><span></span><span></span><span></span></div></div>`;
  el.appendChild(div);
  scrollJoeToBottom();
}

function hideJoeTyping() {
  document.getElementById('joeTypingIndicator')?.remove();
}

function scrollJoeToBottom() {
  const el = document.getElementById('joeMessages');
  if(el) setTimeout(()=>{ el.scrollTop = el.scrollHeight; }, 50);
}

// ── Send message ────────────────────────────────────────────────────
async function sendJoeMessage() {
  if(_joeTyping) return;
  const inp = document.getElementById('joeInput');
  const text = inp?.value?.trim();
  if(!text) return;

  inp.value = '';
  inp.style.height = '42px';

  appendJoeMessage('user', text);
  _joeTyping = true;
  document.getElementById('joeSendBtn').disabled = true;
  showJoeTyping();

  const ctx = buildJoeContext();
  const systemPrompt = buildJoeSystemPrompt(ctx);

  // Build message history for API (last 20 turns for context window)
  const apiMessages = _joeMessages.slice(-20).map(m=>({
    role: m.role === 'joe' ? 'assistant' : 'user',
    content: m.content
  }));

  try {
    // Use callClaude proxy (Cloud Function → fallback to localStorage key)
    if (!window.callClaude) {
      // Proxy not loaded yet — check for direct key as last resort
      const _joeApiKey = getJoeKey();
      if (!_joeApiKey) {
        hideJoeTyping();
        appendJoeMessage('joe', '⚙️ To activate Joe AI, add your Anthropic API key in **Settings → Ask Joe AI**. Get a free key at console.anthropic.com — it takes 2 minutes.');
        _joeTyping = false;
        document.getElementById('joeSendBtn').disabled = false;
        return;
      }
    }

    const data = await window.callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages
    });

    const reply = data?.content?.[0]?.text || 'Sorry, something went wrong. Try again.';

    hideJoeTyping();
    appendJoeMessage('joe', reply);

  } catch(err) {
    hideJoeTyping();
    const errMsg = `Couldn't reach Joe right now. ${err.message || 'Check your connection and try again.'}`;
    appendJoeMessage('joe', errMsg);
  }

  _joeTyping = false;
  document.getElementById('joeSendBtn').disabled = false;
  updateJoeContextBar(ctx);
}

function joeQuick(msg) {
  const inp = document.getElementById('joeInput');
  if(inp) inp.value = msg;
  sendJoeMessage();
}

// Hook into goTo to init chat when tab opens
(function(){
  const _prev = window.goTo;
  window.goTo = function(view) {
    if(_prev) _prev(view);
    if(view === 'joe') {
      setTimeout(initJoeChat, 80);
    }
  };
})();

// Settings page key save (reads from #joeKeyInputSettings instead of #joeKeyInput)
function saveJoeKeyFromSettings() {
  const v = document.getElementById('joeKeyInputSettings')?.value?.trim();
  if(!v || !v.startsWith('sk-ant')) { showToast('Paste a valid Anthropic key (starts with sk-ant)', 'error'); return; }
  try { localStorage.setItem(JOE_KEY_STORE, v); } catch(e){}
  const status = document.getElementById('joeKeyStatus');
  if (status) { status.textContent = '✓ Key saved — Joe AI is active'; status.style.color = 'var(--green)'; }
  const inp = document.getElementById('joeKeyInputSettings');
  if (inp) inp.value = '';
  initJoeChat();
  showToast('✓ Joe AI activated', 'success');
}

// Clear chat history from current session
function clearJoeChat() {
  try { sessionStorage.removeItem(JOE_CHAT_STORE); } catch(e){}
  _joeMessages = [];
  initJoeChat();
  showToast('Chat cleared', 'success');
}

// Expose all AI functions to window scope (required for onclick handlers)
window.saveJoeKey = saveJoeKey;
window.saveJoeKeyFromSettings = saveJoeKeyFromSettings;
window.clearJoeKey = clearJoeKey;
window.clearJoeChat = clearJoeChat;
window.getJoeKey = getJoeKey;
window.initJoeChat = initJoeChat;
window.sendJoeMessage = sendJoeMessage;
window.joeQuick = joeQuick;
// ══ END ASK JOE AI ════════════════════════════════════════════════════
