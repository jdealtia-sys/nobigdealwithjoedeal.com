/**
 * NBD Platform — Shared Utilities
 * Reusable helper functions
 */

// Date formatting
function nbdFormatDate(timestamp, format = 'short') {
  if (!timestamp) return '';
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  
  const options = {
    short: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit', hour12: true },
    full: { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }
  };
  
  return date.toLocaleDateString('en-US', options[format] || options.short);
}

function nbdTimeAgo(timestamp) {
  if (!timestamp) return '';
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((new Date() - date) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };
  
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
    }
  }
  
  return 'Just now';
}

// Phone formatting
function nbdFormatPhone(phone) {
  if (!phone) return '';
  
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  
  return phone;
}

function nbdValidatePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10;
}

// Email validation
function nbdValidateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Currency formatting
function nbdFormatCurrency(amount, includeCents = false) {
  if (!amount && amount !== 0) return '';
  
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: includeCents ? 2 : 0,
    maximumFractionDigits: includeCents ? 2 : 0
  }).format(amount);
  
  return formatted;
}

// String helpers
function nbdCapitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function nbdSlugify(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nbdTruncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength).trim() + '...';
}

// Status badges
function nbdGetStatusColor(status) {
  const colors = {
    new: '#3b82f6',        // blue
    contacted: '#f59e0b',  // orange
    scheduled: '#8b5cf6',  // purple
    won: '#10b981',        // green
    lost: '#ef4444',       // red
    draft: '#6b7280',      // gray
    published: '#10b981',  // green
    active: '#10b981',     // green
    completed: '#6b7280',  // gray
    canceled: '#ef4444'    // red
  };
  
  return colors[status] || '#6b7280';
}

function nbdGetStatusLabel(status) {
  const labels = {
    new: 'New',
    contacted: 'Contacted',
    scheduled: 'Scheduled',
    won: 'Won',
    lost: 'Lost',
    draft: 'Draft',
    published: 'Published',
    active: 'Active',
    completed: 'Completed',
    canceled: 'Canceled'
  };
  
  return labels[status] || nbdCapitalize(status);
}

// Loading states
function nbdShowLoading(elementId, message = 'Loading...') {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.innerHTML = `
    <div class="nbd-loading">
      <div class="nbd-spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function nbdHideLoading(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.innerHTML = '';
}

// Toast notifications
function nbdShowToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `nbd-toast nbd-toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('nbd-toast-show');
  }, 100);
  
  setTimeout(() => {
    toast.classList.remove('nbd-toast-show');
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, duration);
}

// Local storage helpers
function nbdSaveToStorage(key, value) {
  try {
    localStorage.setItem(`nbd_${key}`, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('Save to storage error:', error);
    return false;
  }
}

function nbdGetFromStorage(key, defaultValue = null) {
  try {
    const value = localStorage.getItem(`nbd_${key}`);
    return value ? JSON.parse(value) : defaultValue;
  } catch (error) {
    console.error('Get from storage error:', error);
    return defaultValue;
  }
}

function nbdRemoveFromStorage(key) {
  try {
    localStorage.removeItem(`nbd_${key}`);
    return true;
  } catch (error) {
    console.error('Remove from storage error:', error);
    return false;
  }
}

// URL helpers
function nbdGetQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function nbdSetQueryParam(param, value) {
  const url = new URL(window.location);
  url.searchParams.set(param, value);
  window.history.pushState({}, '', url);
}

// Debounce helper
function nbdDebounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Array helpers
function nbdGroupBy(array, key) {
  return array.reduce((result, item) => {
    const group = item[key];
    if (!result[group]) {
      result[group] = [];
    }
    result[group].push(item);
    return result;
  }, {});
}

// Expose all functions to window scope
window.nbdFormatDate = nbdFormatDate;
window.nbdTimeAgo = nbdTimeAgo;
window.nbdFormatPhone = nbdFormatPhone;
window.nbdValidatePhone = nbdValidatePhone;
window.nbdValidateEmail = nbdValidateEmail;
window.nbdFormatCurrency = nbdFormatCurrency;
window.nbdCapitalize = nbdCapitalize;
window.nbdSlugify = nbdSlugify;
window.nbdTruncate = nbdTruncate;
window.nbdGetStatusColor = nbdGetStatusColor;
window.nbdGetStatusLabel = nbdGetStatusLabel;
window.nbdShowLoading = nbdShowLoading;
window.nbdHideLoading = nbdHideLoading;
window.nbdShowToast = nbdShowToast;
window.nbdSaveToStorage = nbdSaveToStorage;
window.nbdGetFromStorage = nbdGetFromStorage;
window.nbdRemoveFromStorage = nbdRemoveFromStorage;
window.nbdGetQueryParam = nbdGetQueryParam;
window.nbdSetQueryParam = nbdSetQueryParam;
window.nbdDebounce = nbdDebounce;
window.nbdGroupBy = nbdGroupBy;
