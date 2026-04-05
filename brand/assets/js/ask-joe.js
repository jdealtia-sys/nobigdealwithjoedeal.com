/**
 * NBD Brand — Ask Joe AI JavaScript
 * Gemini-powered FAQ chatbot
 */

// Load components
fetch('/shared/components/header.html')
  .then(res => res.text())
  .then(html => { document.getElementById('header-container').innerHTML = html; });

fetch('/shared/components/footer.html')
  .then(res => res.text())
  .then(html => { document.getElementById('footer-container').innerHTML = html; });

fetch('/shared/components/modal.html')
  .then(res => res.text())
  .then(html => { document.getElementById('modal-container').innerHTML = html; });

// State
let questionsLeft = 5;
let conversationHistory = [];

// Send message
async function sendMessage(event) {
  event.preventDefault();
  
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Clear input
  input.value = '';
  
  // Add user message to chat
  addMessage(message, 'user');
  
  // Check if questions left
  if (questionsLeft <= 0) {
    // Show email gate
    showEmailGate();
    return;
  }
  
  // Decrement questions
  questionsLeft--;
  updateQuestionCounter();
  
  // Show typing indicator
  showTypingIndicator();
  
  // Get AI response
  try {
    const response = await getAIResponse(message);
    removeTypingIndicator();
    addMessage(response, 'bot');
    
  } catch (error) {
    console.error('AI response error:', error);
    removeTypingIndicator();
    addMessage(
      "Sorry, I'm having trouble right now. Call me directly at (513) 867-5309 and I'll answer your question.",
      'bot'
    );
  }
}

// Add message to chat
function addMessage(text, sender) {
  const messagesContainer = document.getElementById('chatMessages');
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}-message`;
  
  messageDiv.innerHTML = `
    <div class="message-avatar">${sender === 'bot' ? '👨‍🔧' : '👤'}</div>
    <div class="message-content">
      <div class="message-bubble">
        <p>${text}</p>
      </div>
    </div>
  `;
  
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Show typing indicator
function showTypingIndicator() {
  const messagesContainer = document.getElementById('chatMessages');
  
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot-message';
  typingDiv.id = 'typingIndicator';
  
  typingDiv.innerHTML = `
    <div class="message-avatar">👨‍🔧</div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  
  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Remove typing indicator
function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

// Update question counter
function updateQuestionCounter() {
  const counter = document.getElementById('questionCounter');
  counter.textContent = `Questions left: ${questionsLeft}`;
  
  if (questionsLeft === 0) {
    counter.textContent = 'Out of free questions — enter email to continue';
    counter.style.color = 'var(--secondary)';
  }
}

// Get AI response from Gemini
async function getAIResponse(userMessage) {
  // Add to conversation history
  conversationHistory.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });
  
  // System prompt
  const systemPrompt = `You are Joe Deal, owner of No Big Deal Home Solutions in Greater Cincinnati, OH. You have 7+ years of experience in roofing, siding, gutters, and insurance restoration.

Personality:
- Straight-talking, no BS
- Anti-contractor industry tactics (inflated pricing, fake urgency)
- Helpful and honest
- Down-to-earth, approachable

Answer style:
- Keep responses under 100 words
- Be conversational and friendly
- Provide specific, practical advice
- For pricing questions, give Greater Cincinnati ranges
- Always emphasize honesty and transparency
- End with a soft CTA when relevant: "Want to talk more? Call me at (513) 867-5309"

Topics you're expert in:
- Roofing (shingles, metal, tile)
- Siding (vinyl, fiber cement, wood)
- Gutters (seamless, guards, materials)
- Insurance claims (storm damage, process)
- Pricing and estimates
- Ohio weather considerations

If asked about something outside home services, politely redirect to your expertise.`;
  
  // Call Gemini via existing Cloudflare Worker
  const response = await fetch('https://nbd-ai-proxy.jonathandeal459.workers.dev/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: userMessage,
      systemPrompt,
      conversationHistory
    })
  });
  
  if (!response.ok) {
    throw new Error('AI response failed');
  }
  
  const data = await response.json();
  const aiResponse = data.response;
  
  // Add AI response to history
  conversationHistory.push({
    role: 'model',
    parts: [{ text: aiResponse }]
  });
  
  return aiResponse;
}

// Ask predefined question
function askPredefined(question) {
  const input = document.getElementById('messageInput');
  input.value = question;
  document.getElementById('chatForm').dispatchEvent(new Event('submit'));
}

// Show email gate modal
function showEmailGate() {
  nbdShowModal({
    title: 'Want To Keep Going?',
    body: `
      <p style="margin-bottom: 1rem;">You've used your 5 free questions. Enter your email to keep chatting with Joe—or just call him directly.</p>
      <form id="emailGateForm" onsubmit="submitEmailGate(event)" style="margin-bottom: 1rem;">
        <div class="nbd-form-group">
          <label class="nbd-label">Email Address</label>
          <input type="email" id="gateEmail" class="nbd-input" placeholder="your@email.com" required>
        </div>
        <button type="submit" class="nbd-btn nbd-btn-primary w-full">Continue Chatting</button>
      </form>
      <p style="text-align: center; margin: 1rem 0;">OR</p>
      <a href="tel:+15138675309" class="nbd-btn nbd-btn-secondary w-full">Call Joe: (513) 867-5309</a>
    `,
    showCancel: true,
    showConfirm: false
  });
}

// Submit email gate
async function submitEmailGate(event) {
  event.preventDefault();
  
  const email = document.getElementById('gateEmail').value.trim();
  
  if (!email || !nbdValidateEmail(email)) {
    nbdShowToast('Please enter a valid email', 'warning');
    return;
  }
  
  try {
    // Create lead in Firestore
    await nbdCreateLead({
      email,
      source: 'ask_joe_ai',
      serviceType: 'general',
      notes: 'Ask Joe AI email gate',
      name: '',
      phone: '',
      address: ''
    });
    
    // Reset question counter
    questionsLeft = 10; // Give 10 more questions
    updateQuestionCounter();
    
    // Close modal
    nbdHideModal();
    
    // Show success message
    addMessage(
      "Thanks! You've got 10 more questions. Keep 'em coming. 👍",
      'bot'
    );
    
  } catch (error) {
    console.error('Email gate error:', error);
    nbdShowToast('Something went wrong. Please call Joe at (513) 867-5309.', 'error');
  }
}

// Expose functions
window.sendMessage = sendMessage;
window.askPredefined = askPredefined;
window.submitEmailGate = submitEmailGate;
