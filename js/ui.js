// ═══════════════════════════════════════════════════════
// GymOps — Screen routing (with per-screen show hooks), toasts, shared DOM helpers
// ═══════════════════════════════════════════════════════

// Screens register a render hook that runs whenever they are shown — keeps
// showScreen() feature-agnostic (same ethos as the IDLE_BANNERS mediator).
const _screenShowHooks = {};

export function onScreenShow(name, fn) { _screenShowHooks[name] = fn; }

// Shows a named screen (idle / active / completed / settings) and hides all others.
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  _screenShowHooks[name]?.();
}

// ── UI rendering ──────────────────────────────────────

// Escapes user-entered text (plan names, objectives, custom exercise names)
// for safe interpolation into innerHTML templates. Prefer textContent / DOM
// APIs for new code (see history.js); use this when a template literal is
// genuinely clearer.
export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shows a brief notification at the bottom of the screen.
// Errors display for 5 seconds; success messages display for 3 seconds.
// Currently has no callers (Drive messaging moved to the inline drive-status
// line) — kept as the shared toast primitive for future features.
export function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), isError ? 5000 : 3000);
}

// ── File downloads ────────────────────────────────────

export function downloadFile(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCSV(csv, filename) {
  downloadFile(csv, filename, 'text/csv');
}
