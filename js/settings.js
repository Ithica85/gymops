// ═══════════════════════════════════════════════════════
// GymOps — Settings: weight unit, Anthropic API key, ranged CSV export
// ═══════════════════════════════════════════════════════

import { UNIT_KEY, state } from './state.js';
import { updateInputFields } from './workout.js';

export function setWeightUnit(u) {
  localStorage.setItem(UNIT_KEY, u);
  // Reflect active state on the toggle buttons
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.classList.toggle('unit-btn--active', btn.dataset.unit === u);
  });
  // Re-render input fields so label/placeholder updates immediately
  if (state.sessionId) updateInputFields();
}

// ── Session reminder (in-app, Option A) ───────────────
// Note: True OS-level push notifications (fire when app is closed) require a
// backend push server (FCM/APNS). This is out of scope for Phase 2 — tracked
// as tech debt for a future phase. Option A delivers the same habit signal at
// the high-intent moment when the user opens the app.

const ANTHROPIC_KEY = 'gymops_anthropic_key';

export function getAnthropicKey() { return localStorage.getItem(ANTHROPIC_KEY) ?? ''; }

export function setAnthropicKey(k) {
  if (k) localStorage.setItem(ANTHROPIC_KEY, k);
  else localStorage.removeItem(ANTHROPIC_KEY);
}

// Opens the date-range export modal with sensible defaults (last 30 days → today).
export function openExportRangeModal() {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 30);
  const fmt = d => d.toISOString().slice(0, 10);
  document.getElementById('export-from').value = fmt(from);
  document.getElementById('export-to').value   = fmt(today);
  document.getElementById('export-range').classList.remove('hidden');
}

// ── Plans ─────────────────────────────────────────────
