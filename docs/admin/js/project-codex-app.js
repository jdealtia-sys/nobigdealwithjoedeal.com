/* ═══════════════════════════════════════════════════════
   PROJECT CODEX — CORE ENGINE
   ═══════════════════════════════════════════════════════ */

const CODEX_VERSION = '1.0';
const PROXY = 'https://us-central1-nobigdeal-pro.cloudfunctions.net/adminAI';

// ── STATE ─────────────────────────────────────────────
let CODEX = {
  version: CODEX_VERSION,
  projectName: '',
  accessCode: '',
  storageMode: 'local', // 'local' | 'cloud' | 'export'
  createdAt: null,
  synthesis: '',
  dna: {},
  sessions: [],
  tasks: [],
  debt: [],
  directives: [],
  briefings: [],
  versions: [],
};
let _setupMode = 'blank';
let _setupStorage = 'local';
let _taskFilter = 'open';
let _searchFilters = ['all'];
let _currentPage = 'synthesis';

// ── STORAGE KEY ───────────────────────────────────────
function storageKey() { return 'nbd-project-codex-' + btoa(CODEX.accessCode || '').slice(0,8); }

// ── LOCK / UNLOCK ─────────────────────────────────────
function unlock() {
  const code = document.getElementById('lock-input').value.trim();
  if (!code) { showError('Enter your access code'); return; }

  // Try loading existing codex with this code
  const key = 'nbd-project-codex-' + btoa(code).slice(0,8);
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      CODEX = JSON.parse(saved);
      CODEX.accessCode = code;
      launchApp();
      return;
    } catch(e) {}
  }
  showError('No Codex found for that code. Create one below ↓');
}

function showError(msg) {
  const el = document.getElementById('lock-error');
  el.textContent = msg;
  setTimeout(() => el.textContent = '', 3000);
}

function showSetup() {
  document.getElementById('setup-screen').classList.add('open');
}
function closeSetup() {
  document.getElementById('setup-screen').classList.remove('open');
}

function selectSetupMode(mode) {
  _setupMode = mode;
  document.querySelectorAll('.setup-option').forEach(o => o.classList.remove('selected'));
  document.getElementById('opt-' + mode).classList.add('selected');
}
function selectStorage(mode) {
  _setupStorage = mode;
  document.querySelectorAll('.setup-option').forEach(o => o.classList.remove('selected'));
  document.getElementById('opt-' + mode).classList.add('selected');
}

function setupNext(step) {
  document.getElementById('setup-step-' + step).classList.remove('active');
  document.getElementById('setup-step-' + (step+1)).classList.add('active');
  if (_setupMode === 'import') {
    document.getElementById('setup-import-area').style.display = 'block';
  }
}
function setupBack(step) {
  document.getElementById('setup-step-' + step).classList.remove('active');
  document.getElementById('setup-step-' + (step-1)).classList.add('active');
}

async function setupFinish() {
  const name = document.getElementById('setup-project-name').value.trim() || 'My Project';
  const code = document.getElementById('setup-access-code').value.trim();
  if (!code) { toast('Enter an access code'); return; }

  CODEX = {
    version: CODEX_VERSION,
    projectName: name,
    accessCode: code,
    storageMode: _setupStorage,
    createdAt: new Date().toISOString(),
    synthesis: '',
    dna: { vision: '', github: '', stack: '', pillars: '' },
    sessions: [], tasks: [], debt: [], directives: [], briefings: [], versions: [],
  };

  if (_setupMode === 'import') {
    const raw = document.getElementById('setup-import-text').value.trim();
    if (raw) await parseAndImport(raw);
  } else if (_setupMode === 'wizard') {
    // Seed with wizard — launch and show wizard prompt in synthesis
    CODEX.synthesis = 'Complete the setup wizard: go to Session → Add Session → describe your project to generate your first Section 0.';
  }

  closeSetup();
  saveCodex();
  launchApp();
}

function launchApp() {
  document.getElementById('lock-screen').style.display = 'none';
  const app = document.getElementById('app');
  app.classList.add('unlocked');
  renderAll();
  goTo('synthesis');
}

// ── SAVE / LOAD ───────────────────────────────────────
function saveCodex() {
  if (CODEX.storageMode === 'export') return;
  localStorage.setItem(storageKey(), JSON.stringify(CODEX));
}

// ── NAVIGATION ────────────────────────────────────────
function goTo(page) {
  _currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  const nav = document.getElementById('nav-' + page);
  if (pg) pg.classList.add('active');
  if (nav) nav.classList.add('active');
}

function openSearch() { goTo('search'); document.getElementById('search-input')?.focus(); }

// ── RENDER ALL ────────────────────────────────────────
function renderAll() {
  renderStats();
  renderSynthesis();
  renderDNA();
  renderSessions();
  renderTasks();
  renderDebt();
  renderDirectives();
  renderBriefings();
  renderVersions();
}

function renderStats() {
  const openTasks = CODEX.tasks.filter(t => !t.closed).length;
  const closedTasks = CODEX.tasks.filter(t => t.closed).length;
  const days = CODEX.createdAt ? Math.ceil((Date.now() - new Date(CODEX.createdAt)) / 86400000) : 0;
  document.getElementById('stat-sessions').textContent = CODEX.sessions.length;
  document.getElementById('stat-loops').textContent = openTasks;
  document.getElementById('stat-closed').textContent = closedTasks;
  document.getElementById('stat-days').textContent = days;
  document.getElementById('sb-session-count').textContent = CODEX.sessions.length;
  document.getElementById('sb-task-count').textContent = openTasks;
  document.getElementById('tb-project-name').textContent = CODEX.projectName || 'Project Codex';
}

function renderSynthesis() {
  document.getElementById('synthesis-text').textContent = CODEX.synthesis || 'No synthesis yet. Add your first session to generate one.';
}

function renderDNA() {
  const el = document.getElementById('dna-fields');
  if (!el) return;
  const dna = CODEX.dna || {};
  const fields = [
    ['vision', 'Core Vision'],
    ['github', 'Repository / URL'],
    ['stack', 'Tech Stack'],
    ['pillars', 'Product Pillars'],
    ['notes', 'Additional Notes'],
  ];
  el.innerHTML = fields.map(([key, label]) => `
    <div class="dna-field">
      <div class="dna-label">${escHtml(label)}</div>
      <div class="dna-value" id="dna-${escHtml(key)}">${dna[key] ? escHtml(dna[key]) : '<span style="color:var(--dim)">Not set</span>'}</div>
    </div>`).join('');
}

function renderSessions() {
  const el = document.getElementById('session-timeline');
  const none = document.getElementById('no-sessions');
  if (!el) return;
  if (!CODEX.sessions.length) {
    el.innerHTML = '';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  const sorted = [...CODEX.sessions].reverse();
  el.innerHTML = sorted.map((s, i) => {
    const num = Number(s.number) || (i + 1);
    const decisions = Number(s.decisions?.length || 0);
    const loops = Number(s.loops?.length || 0);
    const shipped = Number(s.shipped?.length || 0);
    return `
    <div class="timeline-entry">
      <div class="tl-line">
        <div class="tl-dot ${i===0?'latest':''}"></div>
        ${i < sorted.length-1 ? '<div class="tl-track"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-card nbd-tl-card">
          <div class="tl-head">
            <div class="tl-num">S${num}</div>
            <div class="tl-meta">
              <div class="tl-session-title">${escHtml(s.title||'Untitled Session')}</div>
              <div class="tl-date">${escHtml(s.date||'')}</div>
              <div class="tl-chips">
                ${decisions ? `<span class="tl-chip decision">${decisions} decisions</span>` : ''}
                ${loops ? `<span class="tl-chip loop">${loops} open loops</span>` : ''}
                ${shipped ? `<span class="tl-chip shipped">${shipped} shipped</span>` : ''}
              </div>
            </div>
            <div class="tl-expand">▼</div>
          </div>
          <div class="tl-detail">${escHtml(s.content||'')}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.nbd-tl-card').forEach(card => {
    card.addEventListener('click', () => toggleSession(card));
  });
}

function toggleSession(card) {
  card.classList.toggle('expanded');
}

function renderTasks() {
  const el = document.getElementById('task-list');
  const none = document.getElementById('no-tasks');
  if (!el) return;
  let tasks = CODEX.tasks || [];
  if (_taskFilter === 'open') tasks = tasks.filter(t => !t.closed);
  else if (_taskFilter === 'closed') tasks = tasks.filter(t => t.closed);
  if (!tasks.length) {
    el.innerHTML = '';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  const ALLOWED_PRIORITIES = new Set(['LOW','MED','HIGH','CRITICAL']);
  el.innerHTML = tasks.map((t, i) => {
    const prio = ALLOWED_PRIORITIES.has(String(t.priority || '').toUpperCase()) ? String(t.priority).toUpperCase() : 'MED';
    return `
    <div class="task-item ${t.closed?'closed':''}">
      <div class="task-check nbd-task-check ${t.closed?'checked':''}" data-task-id="${escHtml(t.id)}"></div>
      <div style="flex:1">
        <div class="task-text">${escHtml(t.text)}</div>
        <div class="task-meta">S${escHtml(t.session||'?')} · ${escHtml(t.date||'')}</div>
      </div>
      <div class="task-priority ${prio.toLowerCase()}">${prio}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.nbd-task-check').forEach(chk => {
    chk.addEventListener('click', () => toggleTask(chk.dataset.taskId));
  });
}

function filterTasks(filter, btn) {
  _taskFilter = filter;
  document.querySelectorAll('.search-filter').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderTasks();
}

function toggleTask(id) {
  const t = CODEX.tasks.find(t => t.id === id);
  if (t) { t.closed = !t.closed; saveCodex(); renderTasks(); renderStats(); }
}

function renderDebt() {
  const body = document.getElementById('debt-body');
  const none = document.getElementById('no-debt');
  if (!body) return;
  if (!CODEX.debt?.length) {
    body.innerHTML = '';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  body.innerHTML = CODEX.debt.map((d, i) => `
    <tr>
      <td>${escHtml(d.item)}</td>
      <td><span class="debt-sessions">${Number(d.sessions) || 0}</span></td>
      <td>${escHtml(d.time||'')}</td>
      <td style="color:var(--red)">${escHtml(d.cost||'')}</td>
      <td><button type="button" class="tb-btn nbd-debt-remove" data-debt-idx="${i}" style="padding:3px 8px;font-size:8px">✕</button></td>
    </tr>`).join('');
  body.querySelectorAll('.nbd-debt-remove').forEach(btn => {
    btn.addEventListener('click', () => removeDebt(Number(btn.dataset.debtIdx)));
  });
}

function renderDirectives() {
  const el = document.getElementById('directive-list');
  const none = document.getElementById('no-directives');
  if (!el) return;
  if (!CODEX.directives?.length) {
    el.innerHTML = '';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  el.innerHTML = CODEX.directives.map((d, i) => `
    <div class="directive-item">
      <div class="directive-tag">${escHtml(d.tag||'RULE')}</div>
      <div>
        <div class="directive-text">${escHtml(d.text)}</div>
        <div class="directive-session">S${escHtml(d.session||'?')} · ${escHtml(d.date||'')}</div>
      </div>
      <button type="button" class="tb-btn nbd-directive-remove" data-directive-idx="${i}" style="padding:3px 8px;font-size:8px;margin-left:auto;flex-shrink:0">✕</button>
    </div>`).join('');
  el.querySelectorAll('.nbd-directive-remove').forEach(btn => {
    btn.addEventListener('click', () => removeDirective(Number(btn.dataset.directiveIdx)));
  });
}

function renderBriefings() {
  const el = document.getElementById('briefing-list');
  if (!el) return;
  if (!CODEX.briefings?.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">No briefings yet. Add a session to generate one.</div>';
    return;
  }
  el.innerHTML = CODEX.briefings.map((b, i) => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="card-title">Briefing After S${escHtml(b.afterSession)} · ${escHtml(b.date||'')}</div>
        <button type="button" class="tb-btn nbd-briefing-copy" data-briefing-idx="${i}">📋 Copy</button>
      </div>
      <pre style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);line-height:1.7;white-space:pre-wrap;max-height:300px;overflow-y:auto">${escHtml(b.content)}</pre>
    </div>`).join('');
  el.querySelectorAll('.nbd-briefing-copy').forEach(btn => {
    btn.addEventListener('click', () => copyBriefing(Number(btn.dataset.briefingIdx)));
  });
}

function renderVersions() {
  const el = document.getElementById('version-list');
  const none = document.getElementById('no-versions');
  if (!el) return;
  if (!CODEX.versions?.length) {
    el.innerHTML = '';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  el.innerHTML = [...CODEX.versions].reverse().map((v, i) => {
    const compareIdx = CODEX.versions.length - 1 - i;
    const num = Number(v.versionNum) || (i + 1);
    const sessions = Number(v.sessions) || 0;
    return `
    <div class="version-item nbd-version-row" data-compare-idx="${compareIdx}">
      <div>
        <div class="version-label">v${num} — ${escHtml(v.date||'')}</div>
        <div class="version-meta">${sessions} sessions · ${escHtml(v.label||'Export')}</div>
      </div>
      <div class="tb-btn">Compare →</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.nbd-version-row').forEach(row => {
    row.addEventListener('click', () => loadVersionCompare(Number(row.dataset.compareIdx)));
  });
}

function loadVersionCompare(idx) {
  const v = CODEX.versions[idx];
  if (!v) return;
  document.getElementById('version-compare').style.display = 'block';
  document.getElementById('ver-a').textContent = v.markdown || JSON.stringify(v, null, 2);
  document.getElementById('ver-b').textContent = generateMarkdown();
}

// ── ADD SESSION MODAL ─────────────────────────────────
function openAddSession() {
  document.getElementById('add-session-modal').classList.add('open');
}
function closeAddSession() {
  document.getElementById('add-session-modal').classList.remove('open');
}
function sessionTab(tab, btn) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('on'));
  document.getElementById('sp-' + tab).classList.add('on');
}

async function aiFormatSession() {
  const title = document.getElementById('s-title').value;
  const summary = document.getElementById('s-summary').value;
  if (!summary) { toast('Enter a session summary first'); return; }
  const preview = document.getElementById('s-preview');
  preview.style.display = 'block';
  preview.textContent = '⚡ Formatting...';
  const sessionNum = (CODEX.sessions.length || 0) + 1;
  const prompt = `You are formatting a session log entry for a Project Codex system.
Project: ${CODEX.projectName}
Session number: ${sessionNum}
Date: ${new Date().toLocaleDateString()}
Title: ${title}
Summary from user: ${summary}

Format this into a structured session log entry with these sections:
- Output (bullet list of what shipped/was completed)
- Key Decisions
- Open Loops Carried Forward
- Files Modified (if mentioned)

Be concise and technical. Use the same tone as a changelog. Return plain text only.`;

  const result = await callAI(prompt);
  preview.textContent = result;
}

async function aiExtractSession() {
  const raw = document.getElementById('s-raw').value;
  if (!raw) { toast('Paste your raw notes first'); return; }
  const preview = document.getElementById('s-raw-preview');
  preview.style.display = 'block';
  preview.textContent = '⚡ Extracting...';
  const sessionNum = (CODEX.sessions.length || 0) + 1;
  const prompt = `Extract a structured session log from these raw notes for a Project Codex.
Project: ${CODEX.projectName}
Session number: ${sessionNum}
Date: ${new Date().toLocaleDateString()}

Raw notes:
${raw}

Extract and format:
- Session Title (one line)
- Output (what shipped)
- Key Decisions Made
- Open Loops / What Didn't Ship
- Files Modified (if mentioned)
- New Directives (any new rules or immutable decisions)

Return plain text only, no markdown headers.`;

  const result = await callAI(prompt);
  preview.textContent = result;
}

async function saveSession() {
  const activeTab = document.querySelector('.modal-tab.on')?.textContent?.trim();
  let sessionData = {};
  const sessionNum = (CODEX.sessions.length || 0) + 1;
  const date = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});

  if (activeTab?.includes('Summary')) {
    const title = document.getElementById('s-title').value || 'Session ' + sessionNum;
    const content = document.getElementById('s-preview').textContent || document.getElementById('s-summary').value;
    sessionData = { number: sessionNum, title, date, content, decisions: [], loops: [], shipped: [] };
  } else if (activeTab?.includes('Raw')) {
    const content = document.getElementById('s-raw-preview').textContent || document.getElementById('s-raw').value;
    sessionData = { number: sessionNum, title: 'Session ' + sessionNum, date, content, decisions: [], loops: [], shipped: [] };
  } else {
    const title = document.getElementById('sf-title').value || 'Session ' + sessionNum;
    const shipped = document.getElementById('sf-shipped').value;
    const decisions = document.getElementById('sf-decisions').value;
    const loops = document.getElementById('sf-loops').value;
    const files = document.getElementById('sf-files').value;
    const directives = document.getElementById('sf-directives').value;
    const content = [
      shipped ? 'OUTPUT:\n' + shipped : '',
      decisions ? 'KEY DECISIONS:\n' + decisions : '',
      loops ? 'OPEN LOOPS:\n' + loops : '',
      files ? 'FILES MODIFIED:\n' + files : '',
      directives ? 'NEW DIRECTIVES:\n' + directives : '',
    ].filter(Boolean).join('\n\n');
    sessionData = {
      number: sessionNum, title, date, content,
      decisions: decisions ? decisions.split('\n').filter(Boolean) : [],
      loops: loops ? loops.split('\n').filter(Boolean) : [],
      shipped: shipped ? shipped.split('\n').filter(Boolean) : [],
    };
    // Auto-extract tasks from loops
    if (loops) {
      loops.split('\n').filter(Boolean).forEach(loop => {
        CODEX.tasks.push({ id: 'task-' + Date.now() + Math.random(), text: loop.replace(/^[□✓\-\*]\s*/,''), session: sessionNum, date, priority: 'HIGH', closed: false });
      });
    }
    // Auto-extract directives
    if (directives) {
      directives.split('\n').filter(Boolean).forEach(d => {
        CODEX.directives.push({ text: d, tag: 'RULE', session: sessionNum, date });
      });
    }
  }

  CODEX.sessions.push(sessionData);

  // Auto-extract tasks from content using AI if content is rich enough
  if (sessionData.content.length > 100) {
    extractTasksFromSession(sessionData);
  }

  // Auto-regenerate synthesis
  if (CODEX.sessions.length > 0) {
    autoRegenerateSynthesis();
  }

  // Auto-generate briefing
  generateBriefingForSession(sessionData);

  closeAddSession();
  saveCodex();
  renderAll();
  goTo('sessions');
  toast('Session S' + sessionNum + ' saved');
}

async function extractTasksFromSession(session) {
  const prompt = `Extract open tasks/loops from this session log as a simple list. Return ONLY a JSON array of strings, nothing else.
Session: ${session.content}`;
  try {
    const result = await callAI(prompt);
    const clean = result.replace(/```json|```/g,'').trim();
    const loops = JSON.parse(clean);
    if (Array.isArray(loops)) {
      loops.forEach(loop => {
        if (!CODEX.tasks.find(t => t.text === loop)) {
          CODEX.tasks.push({ id: 'task-' + Date.now() + Math.random(), text: loop, session: session.number, date: session.date, priority: 'HIGH', closed: false });
        }
      });
      saveCodex();
      renderTasks();
      renderStats();
    }
  } catch(e) {}
}

// ── AI SYNTHESIS ──────────────────────────────────────
async function autoRegenerateSynthesis() {
  const prompt = buildSynthesisPrompt();
  const result = await callAI(prompt);
  if (result && !result.includes('Error')) {
    CODEX.synthesis = result;
    saveCodex();
    renderSynthesis();
  }
}

async function regenerateSynthesis() {
  const el = document.getElementById('synthesis-text');
  el.textContent = '⚡ Generating synthesis...';
  const prompt = buildSynthesisPrompt();
  const result = await callAI(prompt);
  CODEX.synthesis = result;
  saveCodex();
  renderSynthesis();
  toast('Synthesis updated');
}

function buildSynthesisPrompt() {
  const recent = CODEX.sessions.slice(-3).map(s => `S${s.number}: ${s.title}\n${s.content}`).join('\n\n');
  const openTasks = CODEX.tasks.filter(t => !t.closed).slice(0,5).map(t => '□ ' + t.text).join('\n');
  return `Write a "Living Executive Synthesis" for a project Codex. This is the highest-altitude view of the project — what's been built, where things stand, what matters most right now.

Project: ${CODEX.projectName}
Total sessions: ${CODEX.sessions.length}
Project DNA: ${JSON.stringify(CODEX.dna)}

Recent sessions:
${recent}

Open tasks:
${openTasks}

Write 3-5 sentences of clear, direct, high-altitude synthesis. No bullet points. Write like a technical co-founder summarizing to an investor. Be specific about what's live, what's blocking, and what the next move is. Return plain text only.`;
}

function editSynthesis() {
  const el = document.getElementById('synthesis-text');
  el.contentEditable = 'true';
  el.focus();
  toast('Click Save when done editing');
}
function saveSynthesis() {
  const el = document.getElementById('synthesis-text');
  el.contentEditable = 'false';
  CODEX.synthesis = el.textContent;
  saveCodex();
  toast('Synthesis saved');
}

// ── AGENT BRIEFING ────────────────────────────────────
async function generateBriefing() {
  const lastSession = CODEX.sessions[CODEX.sessions.length - 1];
  if (!lastSession) { toast('Add a session first'); return; }
  await generateBriefingForSession(lastSession);
  renderBriefings();
  toast('Briefing generated');
}

async function generateBriefingForSession(session) {
  const prompt = `Generate an "Agent Briefing" — a concise brief for the next AI agent picking up this project.

Project: ${CODEX.projectName}
After Session ${session.number}: ${session.title}
Date: ${session.date}

Project DNA:
${JSON.stringify(CODEX.dna, null, 2)}

Recent session content:
${session.content}

Open tasks:
${CODEX.tasks.filter(t=>!t.closed).slice(0,8).map(t=>'□ '+t.text).join('\n')}

Key directives:
${CODEX.directives.slice(-5).map(d=>'['+d.tag+'] '+d.text).join('\n')}

Write a briefing covering: what is this project, what just shipped, what's live right now, what's NOT done yet, and what the next session must focus on. Be technical and direct. 300 words max. Plain text only.`;

  const result = await callAI(prompt);
  const briefing = {
    afterSession: session.number,
    date: session.date,
    content: result,
  };
  // Only keep last 10 briefings
  CODEX.briefings = [...(CODEX.briefings||[]), briefing].slice(-10);
  saveCodex();
}

function copyBriefing(i) {
  navigator.clipboard?.writeText(CODEX.briefings[i]?.content || '');
  toast('Briefing copied to clipboard');
}

// ── DNA EDIT ──────────────────────────────────────────
function editDNA() {
  const fields = ['vision','github','stack','pillars','notes'];
  fields.forEach(key => {
    const el = document.getElementById('dna-' + key);
    if (el) {
      el.contentEditable = 'true';
      el.classList.add('editable');
    }
  });
  toast('Edit fields, then click Save DNA');
  const saveBtn = document.querySelector('#page-dna .tb-btn');
  if (saveBtn) { saveBtn.textContent = '💾 Save DNA'; saveBtn.dataset.action = 'save-dna'; }
}
function saveDNA() {
  const fields = ['vision','github','stack','pillars','notes'];
  fields.forEach(key => {
    const el = document.getElementById('dna-' + key);
    if (el) {
      CODEX.dna[key] = el.textContent;
      el.contentEditable = 'false';
      el.classList.remove('editable');
    }
  });
  saveCodex();
  toast('Project DNA saved');
  const saveBtn = document.querySelector('#page-dna .tb-btn');
  if (saveBtn) { saveBtn.textContent = '✏️ Edit DNA'; saveBtn.dataset.action = 'edit-dna'; }
}

// ── TASKS ─────────────────────────────────────────────
function openAddTask() {
  const text = prompt('Task description:');
  if (!text?.trim()) return;
  const priority = prompt('Priority (CRITICAL / HIGH / MED):', 'HIGH') || 'HIGH';
  CODEX.tasks.push({
    id: 'task-' + Date.now(),
    text: text.trim(),
    session: CODEX.sessions.length || 0,
    date: new Date().toLocaleDateString(),
    priority: priority.toUpperCase(),
    closed: false,
  });
  saveCodex(); renderTasks(); renderStats();
  toast('Task added');
}

// ── DEBT ──────────────────────────────────────────────
function openAddDebt() {
  const item = prompt('Item name:');
  if (!item?.trim()) return;
  const sessions = parseInt(prompt('Sessions open:', '1')) || 1;
  const time = prompt('Estimated time:', '1 hr') || '1 hr';
  const cost = prompt('Daily cost (revenue impact):', '$0') || '$0';
  CODEX.debt.push({ item: item.trim(), sessions, time, cost });
  saveCodex(); renderDebt();
  toast('Debt item added');
}
function removeDebt(i) {
  CODEX.debt.splice(i, 1);
  saveCodex(); renderDebt();
}

// ── DIRECTIVES ────────────────────────────────────────
function openAddDirective() {
  const text = prompt('Directive text:');
  if (!text?.trim()) return;
  const tag = prompt('Tag (ALWAYS / NEVER / IMMUTABLE / RULE):', 'RULE') || 'RULE';
  CODEX.directives.push({
    text: text.trim(), tag: tag.toUpperCase(),
    session: CODEX.sessions.length || 0,
    date: new Date().toLocaleDateString(),
  });
  saveCodex(); renderDirectives();
  toast('Directive added');
}
function removeDirective(i) {
  CODEX.directives.splice(i, 1);
  saveCodex(); renderDirectives();
}

// ── SEARCH ────────────────────────────────────────────
function toggleSearchFilter(filter, btn) {
  if (filter === 'all') {
    _searchFilters = ['all'];
    document.querySelectorAll('.search-filter').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  } else {
    _searchFilters = _searchFilters.filter(f => f !== 'all');
    if (_searchFilters.includes(filter)) {
      _searchFilters = _searchFilters.filter(f => f !== filter);
      btn.classList.remove('on');
    } else {
      _searchFilters.push(filter);
      btn.classList.add('on');
    }
    if (!_searchFilters.length) {
      _searchFilters = ['all'];
      document.getElementById('sf-all').classList.add('on');
    }
  }
  runSearch();
}

function runSearch() {
  const q = document.getElementById('search-input')?.value?.toLowerCase().trim() || '';
  const results = document.getElementById('search-results');
  const none = document.getElementById('no-results');
  if (!results) return;
  if (!q) { results.innerHTML = ''; none.style.display='none'; return; }

  let hits = [];
  // Escape regex metacharacters in the query so a malicious admin typing
  // `<script>` doesn't compile into a regex object.
  const qEscaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Build a safe highlight: escape the input text first so any HTML in the
  // source data can never execute, THEN wrap matches in <span> markers
  // bracketed with placeholder tokens so we can re-insert them as real tags
  // after the escape pass.
  const HL_OPEN = '\u0001HL_OPEN\u0001';
  const HL_CLOSE = '\u0001HL_CLOSE\u0001';
  const highlight = txt => {
    const marked = String(txt || '').replace(new RegExp(qEscaped, 'gi'), m => HL_OPEN + m + HL_CLOSE);
    return escHtml(marked)
      .replace(new RegExp(HL_OPEN, 'g'), '<span class="sr-match">')
      .replace(new RegExp(HL_CLOSE, 'g'), '</span>');
  };

  // Search sessions
  if (_searchFilters.includes('all') || _searchFilters.includes('decisions')) {
    CODEX.sessions.forEach(s => {
      if (s.title?.toLowerCase().includes(q) || s.content?.toLowerCase().includes(q)) {
        hits.push({ session: 'S' + s.number + ' · ' + s.date, text: highlight((s.title + '\n' + s.content).slice(0,200)) });
      }
    });
  }
  // Search tasks
  if (_searchFilters.includes('all') || _searchFilters.includes('loops')) {
    CODEX.tasks.forEach(t => {
      if (t.text?.toLowerCase().includes(q)) {
        hits.push({ session: 'Task · S' + t.session, text: highlight(t.text) });
      }
    });
  }
  // Search directives
  if (_searchFilters.includes('all') || _searchFilters.includes('directives')) {
    CODEX.directives.forEach(d => {
      if (d.text?.toLowerCase().includes(q)) {
        hits.push({ session: '[' + d.tag + '] S' + d.session, text: highlight(d.text) });
      }
    });
  }

  if (!hits.length) {
    results.innerHTML = '';
    none.style.display = 'block';
    return;
  }
  none.style.display = 'none';
  // h.text is already safe: highlight() escapes the raw text and only
  // re-inserts <span class="sr-match"> around the matched substring.
  // h.session is unescaped authored content — escape it defensively here.
  results.innerHTML = hits.map(h => `
    <div class="search-result">
      <div class="sr-session">${escHtml(h.session)}</div>
      <div class="sr-text">${h.text}</div>
    </div>`).join('');
}

// ── EXPORT ────────────────────────────────────────────
function generateMarkdown() {
  const now = new Date().toLocaleDateString();
  const v = (CODEX.versions?.length || 0) + 1;
  let md = `CODEX-EXPORT-v${v}.0\n${CODEX.projectName?.toUpperCase() || 'PROJECT CODEX'}\nVersion: v${v}.0 | Sessions: ${CODEX.sessions.length} | Generated: ${now}\n\n`;
  md += '════════════════════════════════════════\n\n';
  md += '0. LIVING EXECUTIVE SYNTHESIS\n\n' + (CODEX.synthesis || 'No synthesis yet.') + '\n\n';
  md += '════════════════════════════════════════\n\n';
  md += '1. PROJECT DNA\n\n';
  Object.entries(CODEX.dna || {}).forEach(([k,v]) => { if(v) md += k.toUpperCase() + ': ' + v + '\n'; });
  md += '\n════════════════════════════════════════\n\n';
  md += '2. SESSION LOG\n\n';
  [...CODEX.sessions].reverse().forEach(s => {
    md += `Session ${s.number} — ${s.date} — "${s.title}"\n${s.content}\n\n────────────────────────────────────────\n\n`;
  });
  md += '3. TASK REGISTRY\n\n';
  md += 'OPEN:\n';
  CODEX.tasks.filter(t=>!t.closed).forEach(t => { md += `[${t.priority}] ${t.text} | S${t.session}\n`; });
  md += '\nCLOSED:\n';
  CODEX.tasks.filter(t=>t.closed).forEach(t => { md += `✓ ${t.text}\n`; });
  md += '\n════════════════════════════════════════\n\n';
  md += '4. COST OF DELAY\n\n';
  CODEX.debt?.forEach(d => { md += `${d.item} | ${d.sessions} sessions | ${d.time} | ${d.cost}\n`; });
  md += '\n════════════════════════════════════════\n\n';
  md += '5. META DIRECTIVES\n\n';
  CODEX.directives?.forEach(d => { md += `[${d.tag}] S${d.session}: ${d.text}\n`; });
  md += '\n════════════════════════════════════════\n';
  md += `END OF CODEX v${v}.0\nGenerated by Project Codex · NBD Pro\n${now}`;
  return md;
}

function exportCodex(format) {
  const md = generateMarkdown();
  const v = (CODEX.versions?.length || 0) + 1;
  const date = new Date().toLocaleDateString();

  // Save version snapshot
  CODEX.versions = [...(CODEX.versions||[]), {
    versionNum: v, date, sessions: CODEX.sessions.length,
    label: 'Export v' + v, markdown: md,
  }].slice(-20);
  saveCodex();
  renderVersions();

  if (format === 'markdown') {
    const blob = new Blob([md], {type:'text/markdown'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `CODEX-EXPORT-v${v}.0.md`;
    a.click();
    toast('Markdown exported');
  } else if (format === 'json') {
    const blob = new Blob([JSON.stringify(CODEX, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `codex-backup-v${v}.json`;
    a.click();
    toast('JSON backup exported');
  } else if (format === 'clipboard') {
    navigator.clipboard?.writeText(md);
    toast('Codex copied to clipboard — paste into any AI chat');
  } else if (format === 'pdf') {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>${CODEX.projectName} Codex</title><style>body{font-family:monospace;font-size:12px;line-height:1.7;padding:40px;max-width:800px;margin:0 auto}pre{white-space:pre-wrap}</style><link rel="stylesheet" href="/assets/css/nbd-mobile.css">
</head><body><pre>${md.replace(/</g,'&lt;')}</pre></body></html>`);
    w.document.close();
    // CSP-safe print: the popup inherits this page's CSP (script-src-elem
    // 'self'), which blocks the former inline <script>window.print()</script>
    // — invoke print() from the opener instead.
    w.focus();
    w.print();
    toast('PDF print dialog opened');
  }
}

async function importCodex() {
  const text = document.getElementById('import-text').value.trim();
  if (!text) { toast('Paste export data first'); return; }
  await parseAndImport(text);
  saveCodex();
  renderAll();
  toast('Smart merge complete');
}

async function parseAndImport(text) {
  // Try JSON first
  try {
    const parsed = JSON.parse(text);
    if (parsed.sessions) {
      // Smart merge: only add sessions we don't have
      const existingNums = new Set(CODEX.sessions.map(s => s.number));
      const newSessions = (parsed.sessions || []).filter(s => !existingNums.has(s.number));
      CODEX.sessions = [...CODEX.sessions, ...newSessions];
      if (parsed.directives) CODEX.directives = [...(CODEX.directives||[]), ...(parsed.directives||[])];
      if (parsed.tasks) CODEX.tasks = [...(CODEX.tasks||[]), ...(parsed.tasks||[]).filter(t => !CODEX.tasks.find(e=>e.text===t.text))];
      if (parsed.synthesis && !CODEX.synthesis) CODEX.synthesis = parsed.synthesis;
      if (parsed.dna && !Object.keys(CODEX.dna||{}).length) CODEX.dna = parsed.dna;
      toast(`Merged ${newSessions.length} new sessions`);
      return;
    }
  } catch(e) {}

  // Parse markdown format
  const sessionMatches = [...text.matchAll(/Session (\d+) — ([^\n]+) — "([^"]+)"\n([\s\S]*?)(?=Session \d+|$)/g)];
  const existingNums = new Set(CODEX.sessions.map(s => s.number));
  let added = 0;
  sessionMatches.forEach(m => {
    const num = parseInt(m[1]);
    if (!existingNums.has(num)) {
      CODEX.sessions.push({ number: num, date: m[2].trim(), title: m[3].trim(), content: m[4].trim(), decisions:[], loops:[], shipped:[] });
      added++;
    }
  });

  // Extract directives
  const directiveMatches = [...text.matchAll(/\[(ALWAYS|NEVER|IMMUTABLE|RULE)\] S(\d+): (.+)/g)];
  directiveMatches.forEach(m => {
    if (!CODEX.directives.find(d=>d.text===m[3])) {
      CODEX.directives.push({ tag: m[1], session: m[2], text: m[3], date: '' });
    }
  });

  toast(`Parsed ${added} sessions from markdown`);
}

// ── AI CALL ───────────────────────────────────────────
async function callAI(prompt) {
  try {
    const user = window._auth?.currentUser;
    const token = user ? await user.getIdToken() : '';
    if (!token) return 'AI unavailable: not signed in';
    const res = await fetch(PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ prompt, maxTokens: 800 }),
    });
    const data = await res.json();
    return data.text || data.response || data.content?.[0]?.text || 'AI unavailable';
  } catch(e) {
    return 'AI call failed: ' + e.message;
  }
}

// ── UTILS ─────────────────────────────────────────────
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

// ── BOOT ──────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }
});

/* ═══════════════════════════════════════════════════════
   CSP-SAFE EVENT WIRING
   Replaces the former inline on*= handler attributes, which
   the production CSP blocks (script-src-attr 'none'). One
   delegated click listener; elements declare their handler
   with data-action. Unique inputs are wired directly.
   ═══════════════════════════════════════════════════════ */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'unlock': unlock(); break;
    case 'show-setup': showSetup(); break;
    case 'close-setup': closeSetup(); break;
    case 'select-setup-mode': selectSetupMode(el.dataset.mode); break;
    case 'select-storage': selectStorage(el.dataset.mode); break;
    case 'setup-next': setupNext(Number(el.dataset.step)); break;
    case 'setup-back': setupBack(Number(el.dataset.step)); break;
    case 'setup-finish': setupFinish(); break;
    case 'open-search': openSearch(); break;
    case 'open-add-session': openAddSession(); break;
    case 'close-add-session': closeAddSession(); break;
    case 'goto': goTo(el.dataset.page); break;
    case 'regenerate-synthesis': regenerateSynthesis(); break;
    case 'edit-synthesis': editSynthesis(); break;
    case 'save-synthesis': saveSynthesis(); break;
    case 'edit-dna': editDNA(); break;
    case 'save-dna': saveDNA(); break;
    case 'generate-briefing': generateBriefing(); break;
    case 'filter-tasks': filterTasks(el.dataset.filter, el); break;
    case 'open-add-task': openAddTask(); break;
    case 'open-add-debt': openAddDebt(); break;
    case 'open-add-directive': openAddDirective(); break;
    case 'export-codex': exportCodex(el.dataset.format); break;
    case 'import-codex': importCodex(); break;
    case 'toggle-search-filter': toggleSearchFilter(el.dataset.filter, el); break;
    case 'session-tab': sessionTab(el.dataset.tab, el); break;
    case 'ai-format-session': aiFormatSession(); break;
    case 'ai-extract-session': aiExtractSession(); break;
    case 'save-session': saveSession(); break;
  }
});

document.getElementById('lock-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlock();
});
document.getElementById('search-input')?.addEventListener('input', runSearch);
