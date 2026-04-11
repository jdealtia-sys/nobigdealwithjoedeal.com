const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

// Auto-resize textarea
userInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
});

// Send on Enter (Shift+Enter for new line)
userInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;
  
  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';
  
  // Remove welcome message if present
  const welcome = messagesDiv.querySelector('.welcome');
  if (welcome) welcome.remove();
  
  // Add user message
  addMessage(message, 'user');
  
  // Show typing indicator
  const typingDiv = addTypingIndicator();
  
  // Disable send button
  sendBtn.disabled = true;
  
  try {
    // Get Anthropic API key from localStorage (same key saved by dashboard settings)
    const _apiKey = localStorage.getItem('nbd_joe_key') || '';
    if (!_apiKey || !_apiKey.startsWith('sk-ant')) {
      typingDiv.remove();
      addMessage('⚙️ To use Joe AI, add your Anthropic API key in the CRM Dashboard → Settings → Ask Joe AI tab. Get a free key at console.anthropic.com.', 'ai');
      sendBtn.disabled = false;
      return;
    }

    const _systemPrompt = 'You are Joe Deal, owner of No Big Deal Home Solutions in Greater Cincinnati — a battle-tested insurance restoration contractor with 7+ years of experience. You help with roofing, siding, gutters, storm damage claims, Xactimate estimates, adjuster negotiations, and contractor business strategy. You are direct, actionable, and field-tested. You never recommend dishonest practices. Keep responses concise and practical.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
        'x-api-key': _apiKey
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: _systemPrompt,
        messages: [{ role: 'user', content: message }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'API error' } }));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Remove typing indicator
    typingDiv.remove();
    
    // Add AI response
    const _rt = data?.content?.[0]?.text;
    if (_rt) {
      addMessage(_rt, 'ai');
    } else {
      addMessage('Sorry, I encountered an error. Please try again.', 'ai');
    }
    
  } catch (error) {
    console.error('Error:', error);
    typingDiv.remove();
    addMessage('Oops! Something went wrong. Please try again.', 'ai');
  }
  
  // Re-enable send button
  sendBtn.disabled = false;
  userInput.focus();
}

function addMessage(text, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = type === 'user' ? 'U' : '🤖';
  
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(bubble);
  messagesDiv.appendChild(messageDiv);
  
  // Scroll to bottom
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  return messageDiv;
}

function addTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message ai';
  typingDiv.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="bubble">
      <div class="typing active">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  messagesDiv.appendChild(typingDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return typingDiv;
}

// Expose for onclick
window.sendMessage = sendMessage;
