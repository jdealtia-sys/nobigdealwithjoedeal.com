/**
 * NBD Brand — AI Visualizer JavaScript
 * Gemini (prompt generation) → DALL-E 3 (image generation)
 */

// Load components
fetch('/shared/components/header.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('header-container').innerHTML = html;
  });

fetch('/shared/components/footer.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('footer-container').innerHTML = html;
  });

fetch('/shared/components/modal.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('modal-container').innerHTML = html;
  });

// State
let selectedService = 'roof';
let selectedColor = 'charcoal';
let visualizationData = null;

// Color names mapping
const colorNames = {
  charcoal: 'Charcoal Gray',
  brown: 'Warm Brown',
  gray: 'Classic Gray',
  white: 'Bright White',
  tan: 'Desert Tan',
  green: 'Forest Green',
  blue: 'Navy Blue',
  red: 'Brick Red'
};

// Service selection
function selectService(service) {
  selectedService = service;
  
  // Update button states
  document.querySelectorAll('.service-type-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-service="${service}"]`).classList.add('active');
  
  // Show/hide relevant options
  document.getElementById('roofOptions').classList.add('hidden');
  document.getElementById('sidingOptions').classList.add('hidden');
  document.getElementById('guttersOptions').classList.add('hidden');
  document.getElementById(`${service}Options`).classList.remove('hidden');
}

// Color selection
function selectColor(color) {
  selectedColor = color;
  
  // Update swatch states
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.classList.remove('active');
  });
  document.querySelector(`[data-color="${color}"]`).classList.add('active');
  
  // Update color name
  document.getElementById('colorName').textContent = colorNames[color];
}

// Generate visualization
async function generateVisualization() {
  const address = document.getElementById('address').value.trim();
  
  if (!address) {
    nbdShowToast('Please enter your address', 'warning');
    return;
  }
  
  // Get form values based on selected service
  let material, style;
  
  if (selectedService === 'roof') {
    style = document.getElementById('roofType').value;
    material = document.getElementById('roofMaterial').value;
  } else if (selectedService === 'siding') {
    material = document.getElementById('sidingMaterial').value;
    style = 'standard';
  } else {
    material = document.getElementById('guttersMaterial').value;
    style = 'standard';
  }
  
  // Show loading state
  const previewArea = document.getElementById('previewArea');
  previewArea.innerHTML = `
    <div class="preview-loading">
      <div class="nbd-spinner"></div>
      <h3>Generating Your Design...</h3>
      <p>This takes about 30 seconds. We're creating a photorealistic mockup of your home.</p>
    </div>
  `;
  
  // Disable button
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';
  
  try {
    // Call AI Visualizer API endpoint
    const response = await fetch('https://nbd-ai-visualizer.jonathandeal459.workers.dev/visualize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        serviceType: selectedService,
        material,
        style,
        color: selectedColor
      })
    });
    
    if (!response.ok) {
      throw new Error('Visualization failed');
    }
    
    const data = await response.json();
    
    // Store visualization data
    visualizationData = {
      address,
      serviceType: selectedService,
      material,
      style,
      color: selectedColor,
      imageURL: data.imageURL,
      estimate: data.estimate
    };
    
    // Display result
    displayVisualization(data.imageURL, data.estimate);
    
  } catch (error) {
    console.error('Visualization error:', error);
    
    // Show error
    previewArea.innerHTML = `
      <div class="preview-placeholder">
        <div class="placeholder-icon">⚠️</div>
        <h3>Oops! Something Went Wrong</h3>
        <p>We couldn't generate your visualization. Please try again or call Joe directly at (513) 867-5309.</p>
      </div>
    `;
    
    nbdShowToast('Failed to generate visualization. Please try again.', 'error');
  } finally {
    // Re-enable button
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate My Visualization';
  }
}

// Display visualization result
function displayVisualization(imageURL, estimate) {
  // Update preview area
  const previewArea = document.getElementById('previewArea');
  previewArea.innerHTML = `
    <img src="${imageURL}" alt="Your home visualization" class="preview-image">
  `;
  
  // Update estimate
  document.getElementById('estimateRange').textContent = `$${estimate.low.toLocaleString()} - $${estimate.high.toLocaleString()}`;
  
  // Show results area
  document.getElementById('resultsArea').classList.remove('hidden');
  
  // Scroll to results
  document.getElementById('resultsArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  nbdShowToast('Visualization complete!', 'success');
}

// Submit lead
async function submitLead(event) {
  event.preventDefault();
  
  const name = document.getElementById('leadName').value.trim();
  const email = document.getElementById('leadEmail').value.trim();
  const phone = document.getElementById('leadPhone').value.trim();
  
  if (!name || !email) {
    nbdShowToast('Please enter your name and email', 'warning');
    return;
  }
  
  try {
    // Create lead in Firestore
    const leadData = {
      name,
      email,
      phone,
      address: visualizationData.address,
      serviceType: visualizationData.serviceType,
      source: 'ai_visualizer',
      visualizerData: visualizationData,
      notes: `AI Visualizer lead: ${visualizationData.serviceType} in ${visualizationData.color} ${visualizationData.material}`,
      assignedTo: null
    };
    
    const result = await nbdCreateLead(leadData);
    
    if (result.success) {
      // Success modal
      nbdShowModal({
        title: 'Thanks! I'll Be In Touch.',
        body: `
          <p style="margin-bottom: 1rem;">Your visualization and info have been sent to Joe. He'll review your project and reach out within 24 hours.</p>
          <p style="margin-bottom: 1rem;"><strong>What happens next:</strong></p>
          <ul style="margin-left: 1.5rem; margin-bottom: 1rem;">
            <li>Joe will call or email you (usually same day)</li>
            <li>He'll ask a few questions about your home</li>
            <li>You'll get an exact quote—no pressure, just straight talk</li>
          </ul>
          <p>Questions? Call Joe directly: <strong>(513) 867-5309</strong></p>
        `,
        confirmText: 'Got It',
        showCancel: false
      });
      
      // Clear form
      document.getElementById('leadForm').reset();
      
      // Track conversion (optional: Google Analytics, Meta Pixel, etc.)
      if (typeof gtag !== 'undefined') {
        gtag('event', 'generate_lead', {
          service_type: visualizationData.serviceType,
          value: (visualizationData.estimate.low + visualizationData.estimate.high) / 2
        });
      }
      
    } else {
      throw new Error('Lead creation failed');
    }
    
  } catch (error) {
    console.error('Lead submission error:', error);
    nbdShowToast('Failed to submit your info. Please call Joe at (513) 867-5309.', 'error');
  }
}

// Initialize Google Places Autocomplete (when API key is added)
document.addEventListener('DOMContentLoaded', () => {
  const addressInput = document.getElementById('address');
  
  // Check if Google Places API is loaded
  if (typeof google !== 'undefined' && google.maps && google.maps.places) {
    const autocomplete = new google.maps.places.Autocomplete(addressInput, {
      types: ['address'],
      componentRestrictions: { country: 'us' }
    });
    
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        addressInput.value = place.formatted_address;
      }
    });
  }
});

// Expose functions to window scope
window.selectService = selectService;
window.selectColor = selectColor;
window.generateVisualization = generateVisualization;
window.submitLead = submitLead;
