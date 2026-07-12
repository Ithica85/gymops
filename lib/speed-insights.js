/**
 * Vercel Speed Insights for GymOps
 * Injects the Speed Insights tracking script
 * Based on @vercel/speed-insights v2.0.0
 */

// Initialize the queue for speed insights events
function initQueue() {
  if (window.si) return;
  window.si = function(...params) {
    window.siq = window.siq || [];
    window.siq.push(params);
  };
}

// Detect if we're in development mode
function isDevelopment() {
  try {
    return false; // Always production for this static site
  } catch {
    return false;
  }
}

// Get the script source URL
function getScriptSrc() {
  // For Vercel deployments, use the built-in Speed Insights script
  return '/_vercel/speed-insights/script.js';
}

// Inject Speed Insights into the page
function injectSpeedInsights(props = {}) {
  if (typeof window === 'undefined') return null;
  
  initQueue();
  
  const src = getScriptSrc();
  
  // Don't inject if already present
  if (document.head.querySelector(`script[src*="${src}"]`)) {
    return null;
  }
  
  // Create and configure the script element
  const script = document.createElement('script');
  script.src = src;
  script.defer = true;
  
  // Add SDK metadata
  script.dataset.sdkn = '@vercel/speed-insights';
  script.dataset.sdkv = '2.0.0';
  
  // Handle optional parameters
  if (props.sampleRate) {
    script.dataset.sampleRate = props.sampleRate.toString();
  }
  if (props.route) {
    script.dataset.route = props.route;
  }
  if (props.beforeSend) {
    window.si?.('beforeSend', props.beforeSend);
  }
  
  // Error handling
  script.onerror = () => {
    console.log(
      `[Vercel Speed Insights] Failed to load script from ${src}. Please check if any content blockers are enabled and try again.`
    );
  };
  
  // Inject the script
  document.head.appendChild(script);
  
  return {
    setRoute: (route) => {
      script.dataset.route = route ?? undefined;
    }
  };
}

// Auto-initialize Speed Insights when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectSpeedInsights();
  });
} else {
  // DOM is already ready
  injectSpeedInsights();
}

// Export for manual initialization if needed
window.injectSpeedInsights = injectSpeedInsights;
