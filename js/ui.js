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
  armBackGuard(); // keep the Back-button guard in sync with the new depth
}

// ── Hardware/browser Back-button integration ──────────
// The app is a multi-screen SPA that never changes the URL, so without this the
// Android/browser Back button has no in-app state to consume and escapes the
// app entirely (user feedback 2026-07-25). We mirror UI depth onto the history
// stack with a single "guard" entry, kept present whenever the UI sits below the
// idle root — an open modal, or a back-navigable sub-screen. Back then:
//   open modal  → close the topmost one
//   sub-screen  → return to its parent (…exercise-history → history → idle)
//   idle root   → fall through to the browser default (exit the standalone PWA)
// The workout screens (active/completed) and the recovery screen are left alone
// — Back does the default there, so a stray press never yanks the user out of a
// live workout.

// screenId → the screen Back returns to. Screens absent here are Back-roots
// (idle, active, completed, recovery): Back exits rather than navigating.
const _BACK_PARENTS = {
  'screen-settings':         'idle',
  'screen-plans':            'idle',
  'screen-plan-editor':      'plans',
  'screen-history':          'idle',
  'screen-exercise-history': 'history',
};

let _backReady     = false;
let _closeTopModal = () => false; // supplied by initBackButton; true if it closed something

function _currentScreenId() {
  return document.querySelector('.screen.active')?.id ?? null;
}

function _anyModalOpen() {
  return [...document.querySelectorAll('.modal, .pr-celebration')]
    .some(m => !m.classList.contains('hidden'));
}

// Whether a Back press should be caught in-app rather than exiting.
function _belowRoot() {
  return _anyModalOpen() || (_currentScreenId() in _BACK_PARENTS);
}

// Keeps exactly one guard entry on the stack while below root. Idempotent (only
// pushes when the current top isn't already a guard) so the stack never grows
// unbounded — depth is handled by the screen-parent chain, not by stacking
// guards. No-ops until initBackButton has run (and in the Node test DOM).
export function armBackGuard() {
  if (!_backReady) return;
  if (_belowRoot() && history.state?.gymopsGuard !== 1) {
    history.pushState({ gymopsGuard: 1 }, '');
  }
}

function _onPopState() {
  if (!_backReady) return;
  // The guard we pushed was just consumed by this Back press. Re-derive what to
  // do from the live UI, and re-arm the guard if we stayed in the app.
  if (_closeTopModal()) { armBackGuard(); return; }
  const parent = _BACK_PARENTS[_currentScreenId()];
  if (parent) { showScreen(parent); return; } // showScreen re-arms via armBackGuard
  // idle/active/completed/recovery + nothing open → let Back exit the app.
}

// Wired once from boot(). Guarded so the Node test DOM (no history/window/
// MutationObserver) never trips over it. `closeTopModal` closes the frontmost
// overlay and returns whether it closed one.
export function initBackButton(closeTopModal) {
  if (typeof window === 'undefined' || typeof history === 'undefined' ||
      typeof window.addEventListener !== 'function') return;
  _closeTopModal = closeTopModal;
  try { history.replaceState({ gymopsRoot: 1 }, ''); } catch (_) { return; }
  _backReady = true;
  window.addEventListener('popstate', _onPopState);
  // Arm the guard whenever a modal's visibility changes, so we don't have to
  // touch every scattered modal-open call site.
  if (typeof MutationObserver === 'function') {
    const obs = new MutationObserver(() => armBackGuard());
    document.querySelectorAll('.modal, .pr-celebration').forEach(m =>
      obs.observe(m, { attributes: true, attributeFilter: ['class'] }));
  }
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
// Shared toast primitive. Wired (4.9) to download confirmations — backup
// file and ranged CSV export. Drive upload messaging stays on the inline
// drive-status line, which outlives a toast.
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
