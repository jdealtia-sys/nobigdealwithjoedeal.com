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
    // All Claude calls go through the hardened claudeProxy Cloud Function
    // via window.callClaude — no more localStorage-held API keys. The
    // subscription gate, rate limit, and token budget all live server-side.
    if (typeof window.callClaude !== 'function') {
      typingDiv.remove();
      addMessage('⚙️ Joe AI is loading — give the page a second and try again.', 'ai');
      sendBtn.disabled = false;
      return;
    }

    const _systemPrompt = 'You are Joe Deal, owner of No Big Deal Home Solutions in Greater Cincinnati — a battle-tested insurance restoration contractor with 7+ years of experience. You help with roofing, siding, gutters, storm damage claims, Xactimate estimates, adjuster negotiations, and contractor business strategy. You are direct, actionable, and field-tested. You never recommend dishonest practices. Keep responses concise and practical.';

    const data = await window.callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: _systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

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
    const msg = String(error?.message || '');
    if (/subscription|paid/i.test(msg)) {
      addMessage('Ask Joe AI requires an active paid subscription. Upgrade from the dashboard to unlock it.', 'ai');
    } else if (/rate limit|budget/i.test(msg)) {
      addMessage('You\'ve hit the AI rate limit for now — try again in a minute or two.', 'ai');
    } else {
      addMessage('Oops! Something went wrong. Please try again.', 'ai');
    }
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
