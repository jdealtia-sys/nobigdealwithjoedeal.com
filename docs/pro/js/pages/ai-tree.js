/* ═══════════════════════════════════════════════════════════
   NBD Pro — AI Decision Tree Engine
   ═══════════════════════════════════════════════════════════ */

// ── DECISION TREE DATA ────────────────────────────────────
const TREE = {
  insurance: {
    icon: '\u26A1',
    label: 'Insurance vs Cash',
    questions: [
      {
        id: 'damage_type',
        label: 'Type of Damage',
        text: 'What type of damage are you dealing with?',
        options: [
          { value: 'Hail damage (impact marks, granule loss)', short: 'Hail' },
          { value: 'Wind damage (missing/lifted shingles, crease marks)', short: 'Wind' },
          { value: 'Storm combination (hail + wind + debris)', short: 'Storm combo' },
          { value: 'Age-related wear (curling, cracking, moss)', short: 'Age/wear' },
          { value: 'Leak or water damage (interior staining, active drip)', short: 'Leak/water' },
        ]
      },
      {
        id: 'roof_age',
        label: 'Roof Age',
        text: 'How old is the current roof?',
        options: [
          { value: '0-5 years old', short: '0-5 yr' },
          { value: '6-10 years old', short: '6-10 yr' },
          { value: '11-15 years old', short: '11-15 yr' },
          { value: '16-20 years old', short: '16-20 yr' },
          { value: '20+ years old', short: '20+ yr' },
        ]
      },
      {
        id: 'carrier',
        label: 'Insurance Carrier',
        text: 'Who is the homeowner\'s insurance carrier?',
        options: [
          { value: 'State Farm', short: 'State Farm' },
          { value: 'Allstate', short: 'Allstate' },
          { value: 'Erie Insurance', short: 'Erie' },
          { value: 'Nationwide', short: 'Nationwide' },
          { value: 'Other / Homeowner unsure', short: 'Other' },
        ]
      },
      {
        id: 'deductible',
        label: 'Deductible Range',
        text: 'What is the homeowner\'s deductible?',
        options: [
          { value: '$500 - $1,000 deductible', short: '$500-1K' },
          { value: '$1,000 - $2,000 deductible', short: '$1K-2K' },
          { value: '$2,000 - $3,000 deductible', short: '$2K-3K' },
          { value: '$3,000+ or percentage-based deductible', short: '$3K+' },
          { value: 'Homeowner doesn\'t know yet', short: 'Unknown' },
        ]
      },
    ]
  },

  supplement: {
    icon: '\uD83D\uDCC8',
    label: 'Supplement Strategy',
    questions: [
      {
        id: 'scope',
        label: 'Scope of Work',
        text: 'What\'s the approved scope from the insurance company?',
        options: [
          { value: 'Roof only (shingles, underlayment, basic items)', short: 'Roof only' },
          { value: 'Roof + partial gutters or flashing', short: 'Roof + partial' },
          { value: 'Full exterior (roof, gutters, siding, paint)', short: 'Full exterior' },
          { value: 'Insurance denied — fighting for approval', short: 'Denied' },
          { value: 'Haven\'t received estimate yet', short: 'Pending' },
        ]
      },
      {
        id: 'carrier_pattern',
        label: 'Carrier Behavior',
        text: 'How has this carrier handled supplements on past jobs?',
        options: [
          { value: 'They typically pay supplements quickly', short: 'Pays fast' },
          { value: 'Slow process but they eventually pay', short: 'Slow but pays' },
          { value: 'They fight most supplements hard', short: 'Fights hard' },
          { value: 'Mixed results — depends on the adjuster', short: 'Mixed' },
          { value: 'First time working with this carrier', short: 'First time' },
        ]
      },
      {
        id: 'missing_items',
        label: 'Missing Line Items',
        text: 'What do you believe is missing from the current scope?',
        options: [
          { value: 'Drip edge, ice & water shield, starter strip', short: 'Code items' },
          { value: 'Ridge vent, pipe boots, step flashing', short: 'Accessories' },
          { value: 'Decking replacement (OSB/plywood)', short: 'Decking' },
          { value: 'Steep charge, high roof, multiple stories', short: 'Labor charges' },
          { value: 'Multiple categories missing', short: 'Multiple' },
        ]
      },
      {
        id: 'relationship',
        label: 'Adjuster Relationship',
        text: 'What\'s your current relationship with the adjuster?',
        options: [
          { value: 'Good working relationship — cooperative', short: 'Good' },
          { value: 'Neutral — professional but distant', short: 'Neutral' },
          { value: 'Adversarial — they push back on everything', short: 'Adversarial' },
          { value: 'Haven\'t met the adjuster yet', short: 'Haven\'t met' },
        ]
      },
    ]
  },

  pricing: {
    icon: '\uD83D\uDCB0',
    label: 'Pricing Strategy',
    questions: [
      {
        id: 'job_type',
        label: 'Job Type',
        text: 'What kind of job are you pricing?',
        options: [
          { value: 'Full roof replacement (tear-off + install)', short: 'Full replace' },
          { value: 'Roof repair (patch, spot fix, leak stop)', short: 'Repair' },
          { value: 'Insurance restoration (replacement via claim)', short: 'Insurance job' },
          { value: 'New construction or addition', short: 'New build' },
          { value: 'Overlay (second layer over existing)', short: 'Overlay' },
        ]
      },
      {
        id: 'customer_budget',
        label: 'Customer Budget',
        text: 'What\'s the homeowner\'s budget comfort level?',
        options: [
          { value: 'Price-sensitive — wants the cheapest option', short: 'Budget' },
          { value: 'Mid-range — wants good value for money', short: 'Mid-range' },
          { value: 'Quality-focused — willing to invest more', short: 'Quality' },
          { value: 'Premium — wants the best, money is not the issue', short: 'Premium' },
          { value: 'Unknown — haven\'t discussed budget yet', short: 'Unknown' },
        ]
      },
      {
        id: 'neighborhood',
        label: 'Neighborhood Profile',
        text: 'What type of neighborhood is this home in?',
        options: [
          { value: 'Entry-level subdivision ($150K-$250K homes)', short: 'Entry-level' },
          { value: 'Mid-range neighborhood ($250K-$400K homes)', short: 'Mid-range' },
          { value: 'Upscale area ($400K-$700K homes)', short: 'Upscale' },
          { value: 'Luxury/estate ($700K+ homes)', short: 'Luxury' },
          { value: 'Rural or mixed area', short: 'Rural/mixed' },
        ]
      },
      {
        id: 'material',
        label: 'Material Preference',
        text: 'What material system are you considering?',
        options: [
          { value: '3-tab shingles (basic, economical)', short: '3-tab' },
          { value: 'Architectural shingles (GAF Timberline, OC Duration)', short: 'Architectural' },
          { value: 'Premium architectural (GAF Grand Canyon, designer)', short: 'Premium arch' },
          { value: 'Metal roofing (standing seam or metal shingle)', short: 'Metal' },
          { value: 'Homeowner wants recommendation', short: 'Needs rec' },
        ]
      },
      {
        id: 'competition',
        label: 'Competitive Situation',
        text: 'How competitive is this bid situation?',
        options: [
          { value: 'We are the only bid (referral or repeat customer)', short: 'Only bid' },
          { value: 'Competing against 1-2 other contractors', short: '1-2 others' },
          { value: 'Competing against 3+ contractors', short: '3+ others' },
          { value: 'Storm chaser competition in the area', short: 'Storm chasers' },
          { value: 'Not sure of competition level', short: 'Unsure' },
        ]
      },
    ]
  },

  damage: {
    icon: '\uD83D\uDD0D',
    label: 'Damage Assessment',
    questions: [
      {
        id: 'visual_signs',
        label: 'Visual Signs',
        text: 'What are the most visible signs of damage?',
        options: [
          { value: 'Round dents or bruises in the shingles', short: 'Dents/bruises' },
          { value: 'Missing, torn, or flipped-up shingles', short: 'Missing/torn' },
          { value: 'Cracking, curling, or cupping of shingle edges', short: 'Cracking/curling' },
          { value: 'Dark streaks, moss, or algae growth', short: 'Streaks/moss' },
          { value: 'Exposed underlayment or decking visible', short: 'Exposed deck' },
        ]
      },
      {
        id: 'soft_metals',
        label: 'Soft Metal Test',
        text: 'What do the soft metals around the roof look like? (vents, gutters, flashing)',
        options: [
          { value: 'Clear dents or dings on vents, gutters, and downspouts', short: 'Clear dents' },
          { value: 'Minor marks — hard to tell if storm or age', short: 'Minor marks' },
          { value: 'No visible damage to soft metals', short: 'No damage' },
          { value: 'Haven\'t checked soft metals yet', short: 'Not checked' },
        ]
      },
      {
        id: 'interior_signs',
        label: 'Interior Evidence',
        text: 'Are there any signs of damage inside the home?',
        options: [
          { value: 'Active leak or water dripping', short: 'Active leak' },
          { value: 'Water stains on ceiling or walls', short: 'Water stains' },
          { value: 'Damp or musty smell in attic', short: 'Musty attic' },
          { value: 'No interior signs of damage', short: 'None inside' },
        ]
      },
      {
        id: 'recent_weather',
        label: 'Recent Weather',
        text: 'Has there been a recent storm event in this area?',
        options: [
          { value: 'Yes — confirmed hail event within last 6 months', short: 'Recent hail' },
          { value: 'Yes — high winds or severe storms recently', short: 'Recent wind' },
          { value: 'Unsure — homeowner reported potential storm damage', short: 'Unsure' },
          { value: 'No recent storm — damage appears to be age-related', short: 'No storm' },
        ]
      },
      {
        id: 'granule_loss',
        label: 'Granule Condition',
        text: 'What\'s the granule situation on the shingles?',
        options: [
          { value: 'Heavy granule loss with exposed asphalt (black spots)', short: 'Heavy loss' },
          { value: 'Moderate granule displacement in impact patterns', short: 'Moderate/pattern' },
          { value: 'Light, even granule wear across the roof', short: 'Light/even' },
          { value: 'Granules collecting in gutters or at base of downspouts', short: 'In gutters' },
          { value: 'Shingles still look relatively intact', short: 'Intact' },
        ]
      },
    ]
  }
};

// ── STATE ─────────────────────────────────────────────────
let currentCat = null;
let currentStep = 0;
let answers = {};
let history = [];

// Load history from localStorage
try {
  const saved = localStorage.getItem('nbd_ai_tree_history');
  if (saved) history = JSON.parse(saved);
} catch(e) {}

// ── CATEGORY SELECTION ────────────────────────────────────
document.querySelectorAll('.cat-card').forEach(card => {
  card.addEventListener('click', () => {
    const cat = card.dataset.cat;
    selectCategory(cat);
  });
});

function selectCategory(cat) {
  currentCat = cat;
  currentStep = 0;
  answers = {};

  // Highlight card
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.cat-card[data-cat="${cat}"]`).classList.add('active');

  // Hide result/error
  document.getElementById('resultPanel').classList.remove('active');
  document.getElementById('errorPanel').classList.remove('active');
  document.getElementById('aiLoading').classList.remove('active');

  // Show flow
  showQuestion();
}

// ── QUESTION RENDERING ────────────────────────────────────
function showQuestion() {
  const tree = TREE[currentCat];
  const q = tree.questions[currentStep];
  const total = tree.questions.length;

  document.getElementById('flowCatLabel').innerHTML = `${tree.icon} ${tree.label}`;
  document.getElementById('flowStep').textContent = `${currentStep + 1}/${total}`;
  document.getElementById('progressFill').style.width = `${((currentStep + 1) / total) * 100}%`;
  document.getElementById('questionLabel').textContent = `Question ${currentStep + 1} — ${q.label}`;
  document.getElementById('questionText').textContent = q.text;

  // Render options
  const grid = document.getElementById('optionsGrid');
  const letters = ['A', 'B', 'C', 'D', 'E'];
  grid.innerHTML = q.options.map((opt, i) => {
    const selected = answers[q.id] === opt.value ? ' selected' : '';
    return `<button type="button" class="opt-btn${selected}" data-value="${escapeHtml(opt.value)}">
      <span class="opt-letter">${letters[i]}</span>
      <span>${escapeHtml(opt.value)}</span>
    </button>`;
  }).join('');

  // Button states
  document.getElementById('btnBack').style.display = currentStep > 0 ? '' : 'none';

  const isLast = currentStep === total - 1;
  const btn = document.getElementById('btnNext');
  btn.textContent = isLast ? 'Get AI Recommendation' : 'Next \u2192';
  btn.disabled = !answers[q.id];

  // Show panel
  const panel = document.getElementById('flowPanel');
  panel.classList.add('active');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectOption(btn) {
  const q = TREE[currentCat].questions[currentStep];
  const value = btn.dataset.value;
  answers[q.id] = value;

  // Update visual state
  btn.closest('.options-grid').querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  // Enable next
  document.getElementById('btnNext').disabled = false;
}

// ── FLOW NAVIGATION ───────────────────────────────────────
function flowNext() {
  const tree = TREE[currentCat];
  const q = tree.questions[currentStep];
  if (!answers[q.id]) return;

  if (currentStep < tree.questions.length - 1) {
    currentStep++;
    showQuestion();
  } else {
    runAI();
  }
}

function flowBack() {
  if (currentStep > 0) {
    currentStep--;
    showQuestion();
  }
}

function resetAll() {
  currentCat = null;
  currentStep = 0;
  answers = {};
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  document.getElementById('flowPanel').classList.remove('active');
  document.getElementById('aiLoading').classList.remove('active');
  document.getElementById('resultPanel').classList.remove('active');
  document.getElementById('errorPanel').classList.remove('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── AI CALL ───────────────────────────────────────────────
async function runAI() {
  const tree = TREE[currentCat];

  // Build context
  let contextLines = [];
  tree.questions.forEach(q => {
    contextLines.push(`- ${q.label}: ${answers[q.id]}`);
  });

  const systemPrompt = `You are Joe Deal's AI decision engine for roofing contractors operating in the Cincinnati/Northern Kentucky area. You give direct, actionable recommendations based on real industry experience. No fluff — speak like a seasoned contractor coach. Be specific with dollar amounts, percentages, and carrier-specific strategies when relevant.`;

  const userPrompt = `Based on the following ${tree.label} scenario for a roofing job:

Category: ${tree.label}
${contextLines.join('\n')}

Provide a clear, actionable recommendation in this EXACT format (use these exact headers):

DECISION: [One clear sentence — what the contractor should do]

CONFIDENCE: [High, Medium, or Low]

KEY REASONING:
- [First reason with specific detail]
- [Second reason with specific detail]
- [Third reason with specific detail]

TALKING POINTS FOR HOMEOWNER:
- [First talking point — what to actually say to the homeowner]
- [Second talking point]
- [Third talking point if relevant]

NEXT STEPS:
1. [First concrete action step]
2. [Second concrete action step]
3. [Third concrete action step]
4. [Fourth step if needed]

Be specific to the Cincinnati/Ohio/Kentucky market. Reference carrier-specific patterns, local code requirements, and real pricing ranges where relevant. Do not hedge — give a clear direction.`;

  // Show loading, hide flow
  document.getElementById('flowPanel').classList.remove('active');
  document.getElementById('aiLoading').classList.add('active');
  document.getElementById('aiLoading').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    if (typeof window.callClaude !== 'function') {
      throw new Error('AI engine not available. Make sure you are logged in.');
    }

    const response = await window.callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: systemPrompt,
      temperature: 0.3,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response?.content?.[0]?.text || '';
    if (!text || text.length < 40) {
      throw new Error('Empty or invalid response from AI. Please try again.');
    }

    document.getElementById('aiLoading').classList.remove('active');
    displayResult(text);
  } catch(err) {
    document.getElementById('aiLoading').classList.remove('active');
    document.getElementById('errorMsg').textContent = err.message || 'Something went wrong. Please try again.';
    document.getElementById('errorPanel').classList.add('active');
    document.getElementById('errorPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── RESULT PARSING & DISPLAY ──────────────────────────────
function displayResult(raw) {
  const tree = TREE[currentCat];

  // Parse structured response
  const decision = extractSection(raw, 'DECISION') || 'See detailed analysis below';
  const confidence = extractSection(raw, 'CONFIDENCE') || 'Medium';
  const reasoning = extractBullets(raw, 'KEY REASONING');
  const talkingPoints = extractBullets(raw, 'TALKING POINTS');
  const nextSteps = extractBullets(raw, 'NEXT STEPS');

  // Confidence level
  const confLower = confidence.toLowerCase().trim();
  let confClass = 'medium';
  if (confLower.includes('high')) confClass = 'high';
  else if (confLower.includes('low')) confClass = 'low';

  const confLabels = { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' };

  // Set header
  document.getElementById('resultIco').textContent = tree.icon;
  document.getElementById('resultLabel').textContent = tree.label + ' Recommendation';
  document.getElementById('resultDecision').textContent = decision;

  const badge = document.getElementById('confidenceBadge');
  badge.className = `confidence-badge ${confClass}`;
  badge.textContent = confLabels[confClass] || confidence;

  // Build body
  let bodyHTML = '';

  if (reasoning.length > 0) {
    bodyHTML += `<div class="result-section">
      <div class="result-section-title">Key Reasoning</div>
      <ul class="result-list">${reasoning.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>`;
  }

  if (talkingPoints.length > 0) {
    bodyHTML += `<div class="result-section">
      <div class="result-section-title">Talking Points for Homeowner</div>
      <ul class="result-list">${talkingPoints.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>`;
  }

  if (nextSteps.length > 0) {
    bodyHTML += `<div class="result-section">
      <div class="result-section-title">Next Steps</div>
      <ol class="result-steps">${nextSteps.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ol>
    </div>`;
  }

  // Context summary
  bodyHTML += `<div class="result-section">
    <div class="result-section-title">Your Inputs</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${tree.questions.map(q => {
        const opt = q.options.find(o => o.value === answers[q.id]);
        const short = opt ? opt.short : answers[q.id];
        return `<span style="display:inline-flex;padding:3px 10px;border-radius:20px;background:var(--og3);border:1px solid var(--br);font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t2);letter-spacing:.3px;">${escapeHtml(q.label)}: ${escapeHtml(short)}</span>`;
      }).join('')}
    </div>
  </div>`;

  document.getElementById('resultBody').innerHTML = bodyHTML;

  // Show panel
  document.getElementById('resultPanel').classList.add('active');
  document.getElementById('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Save to history
  const entry = {
    cat: currentCat,
    icon: tree.icon,
    label: tree.label,
    decision: decision,
    confidence: confClass,
    answers: { ...answers },
    rawResult: raw,
    time: Date.now(),
  };
  history.unshift(entry);
  if (history.length > 20) history = history.slice(0, 20);
  try { localStorage.setItem('nbd_ai_tree_history', JSON.stringify(history)); } catch(e) {}
  renderHistory();
}

// ── TEXT PARSING UTILS ────────────────────────────────────
function extractSection(text, header) {
  // Match "HEADER:" or "**HEADER:**" followed by content up to next header
  const patterns = [
    new RegExp(`(?:^|\\n)\\**${header}\\**:?\\s*(.+?)(?=\\n\\**[A-Z ]+\\**:|$)`, 's'),
    new RegExp(`${header}:?\\s*(.+?)(?=\\n[A-Z ]+:|$)`, 's'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      let val = m[1].trim();
      // Remove leading bullet/number
      val = val.replace(/^[-*\d.]+\s*/, '');
      // Take first line only
      val = val.split('\n')[0].trim();
      return val;
    }
  }
  return '';
}

function extractBullets(text, header) {
  const patterns = [
    new RegExp(`(?:^|\\n)\\**${header}[^:]*\\**:?\\s*\\n([\\s\\S]+?)(?=\\n\\**[A-Z ]+\\**:|$)`, ''),
    new RegExp(`${header}[^:]*:?\\s*\\n([\\s\\S]+?)(?=\\n[A-Z ]+:|$)`, ''),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const block = m[1];
      const lines = block.split('\n')
        .map(l => l.replace(/^\s*[-*\d.]+\s*/, '').trim())
        .filter(l => l.length > 5);
      return lines;
    }
  }
  return [];
}

// ── HISTORY ───────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('historyList');
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">No analyses yet. Pick a category above to get started.</div>';
    return;
  }

  list.innerHTML = history.map((h, i) => {
    const ago = timeAgo(h.time);
    return `<div class="history-card" data-history-idx="${i}">
      <div class="history-ico">${h.icon}</div>
      <div class="history-info">
        <div class="history-cat">${escapeHtml(h.label)}</div>
        <div class="history-decision">${escapeHtml(h.decision)}</div>
      </div>
      <div class="history-time">${ago}</div>
    </div>`;
  }).join('');
}

function replayHistory(idx) {
  const h = history[idx];
  if (!h) return;

  currentCat = h.cat;
  answers = { ...h.answers };
  displayResult(h.rawResult);
  document.getElementById('flowPanel').classList.remove('active');
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`.cat-card[data-cat="${h.cat}"]`);
  if (card) card.classList.add('active');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── COPY RESULT ───────────────────────────────────────────
function copyResult() {
  const tree = TREE[currentCat];
  const decision = document.getElementById('resultDecision').textContent;
  let text = `${tree.label} Recommendation\n\n${decision}\n`;

  const sections = document.querySelectorAll('#resultBody .result-section');
  sections.forEach(sec => {
    const title = sec.querySelector('.result-section-title');
    if (title) text += `\n${title.textContent}\n`;
    sec.querySelectorAll('li').forEach(li => {
      text += `- ${li.textContent}\n`;
    });
  });

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.result-footer .btn-ghost');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1500);
  }).catch(() => {});
}

// ── UTILS ─────────────────────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── INIT ──────────────────────────────────────────────────
renderHistory();

// Make visible if auth doesn't fire (fallback)
setTimeout(() => { document.documentElement.style.visibility = 'visible'; }, 2000);

// ─────────────────────────────────────────────────
// Event delegation for the ai-tree buttons. Replaces inline onclick="..."
// handlers removed from the HTML. Also handles dynamically-injected
// .opt-btn and .history-card via delegation from document.body so the
// handlers survive re-render cycles.
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('nnav-burger');
  if (burger) burger.addEventListener('click', () => {
    if (typeof window.nbdNavToggle === 'function') window.nbdNavToggle();
  });
  const back = document.getElementById('btnBack');
  if (back) back.addEventListener('click', () => {
    if (typeof window.flowBack === 'function') window.flowBack();
  });
  const next = document.getElementById('btnNext');
  if (next) next.addEventListener('click', () => {
    if (typeof window.flowNext === 'function') window.flowNext();
  });
  document.querySelectorAll('[data-action="reset-all"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof window.resetAll === 'function') window.resetAll();
    });
  });
  document.querySelectorAll('[data-action="copy-result"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof window.copyResult === 'function') window.copyResult();
    });
  });
});

// Delegated: dynamic .opt-btn and .history-card children
document.addEventListener('click', event => {
  const optBtn = event.target.closest('.opt-btn');
  if (optBtn && typeof window.selectOption === 'function') {
    window.selectOption(optBtn);
    return;
  }
  const histCard = event.target.closest('.history-card[data-history-idx]');
  if (histCard && typeof window.replayHistory === 'function') {
    window.replayHistory(Number(histCard.dataset.historyIdx));
  }
});
