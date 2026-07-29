// ═══════════════════════════════════════════════════════
// GymOps — Screen routing (with per-screen show hooks), toasts, shared DOM helpers
// ═══════════════════════════════════════════════════════

// Screens register a render hook that runs whenever they are shown — keeps
// showScreen() feature-agnostic (same ethos as the IDLE_BANNERS mediator).
const _screenShowHooks = {};

// A LIST per screen, not one slot. It held a single fn until 6.9, when Settings
// needed a second hook and silently replaced its first — the Drive card simply
// stopped refreshing, with nothing to see in any test or console. Registering a
// hook must never unregister someone else's.
export function onScreenShow(name, fn) {
  (_screenShowHooks[name] ??= []).push(fn);
}

// Shows a named screen (idle / active / completed / settings) and hides all others.
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(`screen-${name}`);
  screen.classList.add('active');
  _screenShowHooks[name]?.forEach(fn => fn());
  armBackGuard(); // keep the Back-button guard in sync with the new depth

  // 6.3: move focus into the new screen. Without this, focus stays on the
  // control that navigated — which is now inside a hidden screen — and the next
  // Tab starts from <body>, so a keyboard user loses their place on every
  // navigation. The container takes focus rather than a control, so nothing is
  // implicitly "pressed" and no on-screen keyboard opens. Call sites that want
  // an input focused (setActiveExercise → focusInputUnlessHero) run after this
  // and still win.
  if (typeof screen.focus === 'function') {
    screen.tabIndex = -1;
    screen.focus({ preventScroll: true });
  }
}

// ── Keyboard-operable rows (6.3) ──────────────────────
// The picker, the merge sheet and the History list are all built from clickable
// <li>/<div> elements. A click handler alone makes them mouse/touch-only: they
// take no focus and a screen reader announces plain text, so the exercise
// picker — which sits on the path to logging a set — was unreachable without a
// pointer. Rather than restructure three renderers around real <button>s (and
// re-do their CSS), give the row the button contract it was already pretending
// to have. Space is preventDefault-ed because on a focused element it scrolls.
export function makeRowInteractive(el, onActivate) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onActivate(e);
  });
  return el;
}

// ── Modal focus management (6.3) ──────────────────────
// Modals were visual-only: opening one left focus behind on the trigger, so a
// keyboard user kept tabbing through the screen *underneath* the sheet, and
// closing one dropped focus to <body> — losing your place entirely.
//
// Focus lands on the SHEET, not on its first control, for two reasons: it makes
// the screen reader announce the dialog's name (the aria-labelledby added in
// this pass), and focusing the first control would pop the on-screen keyboard
// in the picker — the exact thing `picker-search` is deliberately never
// autofocused to avoid. Call sites that DO want an input focused (the "Other"
// exercise flow, rename) still win: they focus synchronously, and the check
// below sees focus is already inside and leaves it alone.
let _focusReturn = null;

function _openModals() {
  return [...document.querySelectorAll('.modal, .pr-celebration')]
    .filter(m => !m.classList.contains('hidden'));
}

function _focusablesIn(root) {
  const sel = 'button, [href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll(sel)]
    .filter(el => !el.disabled && !el.classList.contains('hidden')
                && !el.closest('.hidden') && el.offsetParent !== null);
}

function _onModalsChanged() {
  const open = _openModals();
  if (open.length) {
    if (!_focusReturn) _focusReturn = document.activeElement;
    const top = open[open.length - 1];
    if (!top.contains(document.activeElement)) {
      const sheet = top.querySelector('.modal-sheet') ?? top;
      sheet.tabIndex = -1;
      sheet.focus({ preventScroll: true });
    }
    return;
  }
  // Everything closed — put focus back where it came from, if that element is
  // still around and still visible (a rename can remove its own trigger).
  const target = _focusReturn;
  _focusReturn = null;
  if (target && document.contains(target) && target.offsetParent !== null) {
    target.focus({ preventScroll: true });
  }
}

// Wired once from boot(), alongside initBackButton. Guarded the same way so the
// Node test DOM never trips over it.
export function initModalA11y() {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;

  const obs = new MutationObserver(_onModalsChanged);
  document.querySelectorAll('.modal, .pr-celebration').forEach(m =>
    obs.observe(m, { attributes: true, attributeFilter: ['class'] }));

  document.addEventListener('keydown', e => {
    const open = _openModals();
    if (!open.length) return;
    const top = open[open.length - 1];

    // Escape closes the frontmost sheet — the keyboard counterpart of the
    // backdrop tap, and of Back on Android.
    if (e.key === 'Escape') { _closeTopModal(); return; }

    if (e.key !== 'Tab') return;
    const items = _focusablesIn(top);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    // Focus sitting on the sheet itself counts as "before the first item".
    if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === top.querySelector('.modal-sheet'))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
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
