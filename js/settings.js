// ═══════════════════════════════════════════════════════
// GymOps — Settings: weight unit, Anthropic API key, ranged CSV export,
// full-database backup & restore
// ═══════════════════════════════════════════════════════

import { dbExportBackup, dbResetWorkoutData, dbRestoreBackup, dbValidateBackup } from './db.js';
import { gdriveConnect, gdriveDisconnect, gdriveIsConnected } from './gdrive.js';
import { REST_SECS_KEY, UNIT_KEY, localDateStr, state } from './state.js';
import { downloadFile, onScreenShow, showToast } from './ui.js';
import { COUNTER_LABELS, getCounterSummary } from './counters.js';
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

// ── Google Drive connection (6.6) ─────────────────────
//
// Connecting is a deliberate, reversible action taken on the Settings screen —
// the only place in the app allowed to raise a Google consent screen. Session
// finish reads gdriveIsConnected() and stays silent when it's false.

export function renderGDriveStatus() {
  const connected = gdriveIsConnected();
  const status    = document.getElementById('gdrive-status');
  status.textContent = connected ? 'Connected' : 'Not connected';
  status.classList.toggle('settings-status--on', connected);
  document.getElementById('btn-gdrive-connect').classList.toggle('hidden', connected);
  document.getElementById('btn-gdrive-disconnect').classList.toggle('hidden', !connected);
}

export async function connectGDrive() {
  const btn = document.getElementById('btn-gdrive-connect');
  const err = document.getElementById('gdrive-error');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  // Caught rather than thrown on: a declined or blocked consent popup is a
  // normal outcome here, not an error state the user needs a stack trace for.
  let failure = null;
  try { await gdriveConnect(); } catch (e) { failure = e; }

  btn.disabled = false;
  btn.textContent = 'Connect Google Drive';
  renderGDriveStatus();

  if (failure) {
    err.textContent = 'Couldn’t connect. Allow pop-ups for this site and try again.';
    err.classList.remove('hidden');
  } else {
    showToast('Google Drive connected');
  }
}

export function disconnectGDrive() {
  gdriveDisconnect();
  document.getElementById('gdrive-error').classList.add('hidden');
  renderGDriveStatus();
  showToast('Google Drive disconnected');
}

// ── Usage counters (6.9) ──────────────────────────────

// Renders the local funnel. Built with DOM APIs rather than innerHTML — the
// labels are ours and the values are numbers, but this is the last screen that
// should acquire a string-concatenation habit.
export function renderUsageCounters() {
  const list = document.getElementById('usage-list');
  const s    = getCounterSummary();
  list.replaceChildren();

  for (const [key, label] of COUNTER_LABELS) {
    const row = document.createElement('div');
    row.className = 'usage-row';
    const name = document.createElement('span');
    name.className = 'usage-row-label';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'usage-row-value';
    value.textContent = String(s.counts[key] ?? 0);
    row.append(name, value);
    list.appendChild(row);
  }

  // The two ratios are the point of the whole feature — a raw pile of totals
  // doesn't answer "do sessions that start get finished". Omitted entirely
  // rather than shown as 0% when nothing has happened yet.
  const rates = [];
  if (s.completionRate != null) rates.push(`${s.completionRate}% of started workouts finished`);
  if (s.quickLogShare  != null) rates.push(`${s.quickLogShare}% of sets logged in one tap`);
  const summary = document.getElementById('usage-summary');
  summary.textContent = rates.join(' · ');
  summary.classList.toggle('hidden', !rates.length);

  const since = document.getElementById('usage-since');
  since.textContent = s.since ? `Counting since ${s.since}` : 'Nothing counted yet';
}

// Counters change constantly while the app is used, so like the Drive card
// they're read on every visit rather than once at boot.
onScreenShow('settings', renderGDriveStatus);
onScreenShow('settings', renderUsageCounters);

// ── Reset workout data (6.8) ──────────────────────────

// The narrow reset: history goes, everything that isn't history stays.
// Reloads onto the emptied database, exactly as the full clear does.
export async function resetWorkoutData() {
  await dbResetWorkoutData();
  location.reload();
}

// ── Plans ─────────────────────────────────────────────
