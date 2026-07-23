// ═══════════════════════════════════════════════════════
// GymOps — Settings: weight unit, Anthropic API key, ranged CSV export,
// full-database backup & restore
// ═══════════════════════════════════════════════════════

import { dbExportBackup, dbRestoreBackup, dbValidateBackup } from './db.js';
import { REST_SECS_KEY, UNIT_KEY, localDateStr, state } from './state.js';
import { downloadFile, showToast } from './ui.js';
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
  const fmt = localDateStr; // local calendar day, not UTC's
  document.getElementById('export-from').value = fmt(from);
  document.getElementById('export-to').value   = fmt(today);
  document.getElementById('export-range').classList.remove('hidden');
}

// ── Backup & restore (4.3) ────────────────────────────

// Holds the validated blob between file selection and the user's confirmation.
let _pendingRestoreBlob = null;

export function downloadBackup() {
  downloadFile(
    dbExportBackup(),
    `gymops-backup-${localDateStr()}.json`,
    'application/json'
  );
  showToast('Backup downloaded');
}

// ── Rest timer duration (4.9) ─────────────────────────

// Persists the rest countdown length and reflects it on the Settings toggle.
// startRestTimer() reads getRestSecs() on each start, so the change applies
// from the next rest; a countdown already running keeps its end time.
export function setRestSecs(secs) {
  localStorage.setItem(REST_SECS_KEY, String(secs));
  document.querySelectorAll('.rest-btn').forEach(btn => {
    btn.classList.toggle('unit-btn--active', Number(btn.dataset.secs) === secs);
  });
}

// File-input change handler: validates the chosen file without touching the
// live DB, then opens the confirm modal with a summary of what it contains.
export async function handleRestoreFile(file) {
  if (!file) return;
  let info;
  try {
    info = dbValidateBackup(await file.text());
  } catch (err) {
    alert(err.message);
    return;
  }
  _pendingRestoreBlob = info.blob;
  const when = info.lastDate ? new Date(info.lastDate).toLocaleDateString() : '—';
  document.getElementById('restore-summary').textContent =
    `Backup contains ${info.sessions} session${info.sessions === 1 ? '' : 's'}, ` +
    `${info.sets} set${info.sets === 1 ? '' : 's'} · last workout ${when}`;
  document.getElementById('confirm-restore').classList.remove('hidden');
}

export function cancelRestore() {
  _pendingRestoreBlob = null;
  document.getElementById('confirm-restore').classList.add('hidden');
}

export async function confirmRestore() {
  if (!_pendingRestoreBlob) return;
  try {
    await dbRestoreBackup(_pendingRestoreBlob); // async since 5.4 (IDB write)
  } catch (err) {
    // Reloading here would boot the OLD database while looking like a
    // successful restore — surface the failure instead.
    alert('Restore failed: ' + err.message);
    return;
  }
  location.reload(); // Reboot onto the restored database
}

// ── Plans ─────────────────────────────────────────────
