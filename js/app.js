// ═══════════════════════════════════════════════════════
// GymOps — Entry point: boot + all event wiring
// ═══════════════════════════════════════════════════════
//
// ── Layer 1 / Layer 2 (Story 4.2 decision record) ─────
// Layer 1 is the workout-in-progress path (workout.js + picker.js +
// signals.js + state.js): starting, logging, resting, undoing, finishing.
// It must never be blocked or slowed by anything else — no Layer 2 feature
// may sit between a tap and a logged set.
// Layer 2 is everything reached from idle/completed: plans, history,
// idle dashboard, banners (idle.js mediator), AI summary, settings.
// Layer 2 reads workout state; Layer 1 never depends on Layer 2 rendering.

import {
  dbClearAll,
  dbDeleteSession,
  dbDeleteSetById,
  dbExportCSVByRange,
  dbGetActiveSession,
  dbResequenceSets,
  initDB,
} from './db.js';
import { APP_VERSION, getWeightUnit, state } from './state.js';
import { downloadCSV, showScreen } from './ui.js';
import { dismissSessionSignal, renderProgressionSignal } from './signals.js';
import { dismissReminderBanner, getReminderEnabled, setReminderEnabled } from './idle.js';
import {
  _doStartSession,
  cancelFinishConfirm,
  clearError,
  confirmDeleteSet,
  dismissPRCelebration,
  finishWorkout,
  hideInactivityModal,
  initInactivityWatchdog,
  logSet,
  quickLogSet,
  renderActive,
  renderRecentSets,
  resetInactivityTimer,
  resumeLastWorkout,
  resumeSession,
  saveNotesNow,
  scheduleNotesSave,
  setActiveExercise,
  showFinishConfirm,
  startRestTimer,
  startSession,
  stopRestTimer,
  triggerExport,
  undoSet,
} from './workout.js';
import './history.js'; // side-effect import: registers the history screen hook
import {
  applyOtherPending,
  backFromOtherType,
  closePicker,
  confirmOtherName,
  openPicker,
  openPickerForPlan,
  setPickerGroup,
  setPickerQuery,
  setPickerSort,
} from './picker.js';
import { archiveCurrentPlan, dismissPlanNudge, openNewPlan, savePlan } from './plans.js';
import {
  getAnthropicKey,
  openExportRangeModal,
  setAnthropicKey,
  setWeightUnit,
} from './settings.js';
import { generateAISummary, hideAISummaryModal } from './ai.js';

// Entry point. Initialises the DB, then wires up all event listeners.
// Always shows the idle screen on load, even if an active session exists —
// the user must explicitly tap "Resume" rather than being dropped into a session.
async function boot() {
  await initDB();

  // Always show idle screen on boot
  const active = dbGetActiveSession();
  if (active) {
    // Show the resume button if there's an unfinished session
    document.getElementById('btn-resume-idle').classList.remove('hidden');
  }
  showScreen('idle');

  // Idle
  document.getElementById('btn-resume-idle').addEventListener('click', () => {
    const session = dbGetActiveSession();
    if (session) resumeSession(session);
  });
  document.getElementById('btn-start').addEventListener('click', startSession);

  // Discard-session confirmation modal
  const hideDiscardModal = () => document.getElementById('confirm-discard').classList.add('hidden');
  document.getElementById('btn-confirm-discard').addEventListener('click', () => {
    const existing = dbGetActiveSession();
    if (existing) dbDeleteSession(existing.session_id);
    hideDiscardModal();
    _doStartSession();
  });
  document.getElementById('btn-cancel-discard').addEventListener('click', hideDiscardModal);
  document.getElementById('confirm-discard-backdrop').addEventListener('click', hideDiscardModal);

  // Active
  document.getElementById('btn-change-exercise').addEventListener('click', openPicker);
  document.getElementById('up-next-hint').addEventListener('click', () => {
    const name = document.getElementById('up-next-name').textContent;
    if (name) setActiveExercise(name);
  });
  document.getElementById('btn-log-set').addEventListener('click', logSet);
  document.getElementById('btn-quick-log').addEventListener('click', quickLogSet);
  document.getElementById('pr-celebration').addEventListener('click', dismissPRCelebration);
  document.getElementById('btn-undo').addEventListener('click', undoSet);
  document.getElementById('btn-rest').addEventListener('click', startRestTimer);
  document.getElementById('btn-rest-skip').addEventListener('click', stopRestTimer);

  // Set deletion — delegated on the list so it covers dynamically rendered rows
  document.getElementById('sets-list').addEventListener('click', e => {
    const trashBtn  = e.target.closest('.set-delete-btn');
    const cancelBtn = e.target.closest('.set-delete-cancel');
    const confirmBtn = e.target.closest('.set-delete-confirm');

    if (trashBtn)   { confirmDeleteSet(Number(trashBtn.dataset.setId));  return; }
    if (cancelBtn)  { renderRecentSets(); return; }
    if (confirmBtn) {
      const setId  = Number(confirmBtn.dataset.setId);
      const row    = dbDeleteSetById(setId);
      if (row) {
        dbResequenceSets(state.sessionId, row.exercise);
        // Keep state.setNumber in sync for the currently selected exercise
        if (row.exercise === state.exercise) {
          setActiveExercise(state.exercise, state.exerciseType, { render: false });
        }
      }
      renderActive();
    }
  });
  document.getElementById('btn-finish').addEventListener('click', showFinishConfirm);
  document.getElementById('btn-confirm-end').addEventListener('click', finishWorkout);
  document.getElementById('btn-cancel-end').addEventListener('click', cancelFinishConfirm);
  document.getElementById('confirm-finish-backdrop').addEventListener('click', cancelFinishConfirm);

  // Input: Enter in weight moves to reps; Enter in reps logs the set
  const inputWeight = document.getElementById('input-weight');
  const inputReps   = document.getElementById('input-reps');
  inputWeight.addEventListener('keydown', e => { if (e.key === 'Enter') inputReps.focus(); });
  inputReps.addEventListener('keydown',   e => { if (e.key === 'Enter') logSet(); });
  inputWeight.addEventListener('input', () => { clearError(); renderProgressionSignal(null); });
  inputReps.addEventListener('input',   () => { clearError(); renderProgressionSignal(null); });

  // Session notes
  const notesEl = document.getElementById('session-notes');
  notesEl.addEventListener('input', scheduleNotesSave);
  notesEl.addEventListener('blur', saveNotesNow); // flushes + cancels any pending debounce

  // Exercise picker — search, muscle-group chips, sort toggle
  document.getElementById('picker-search').addEventListener('input', e => setPickerQuery(e.target.value));
  document.getElementById('picker-chips').addEventListener('click', e => {
    const chip = e.target.closest('.picker-chip');
    if (chip) setPickerGroup(chip.dataset.group);
  });
  document.getElementById('picker-sort-recent').addEventListener('click', () => setPickerSort('recent'));
  document.getElementById('picker-sort-az').addEventListener('click', () => setPickerSort('az'));

  // Exercise picker
  document.getElementById('btn-close-picker').addEventListener('click', closePicker);
  document.getElementById('modal-backdrop').addEventListener('click', closePicker);
  document.getElementById('btn-other-done').addEventListener('click', confirmOtherName);
  document.getElementById('btn-other-cancel').addEventListener('click', closePicker);
  document.getElementById('btn-other-strength').addEventListener('click', () => applyOtherPending('reps'));
  document.getElementById('btn-other-cardio').addEventListener('click', () => applyOtherPending('timed'));
  document.getElementById('btn-other-type-back').addEventListener('click', backFromOtherType);
  document.getElementById('other-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmOtherName();
  });
  document.getElementById('other-name-input').addEventListener('input', () => {
    document.getElementById('other-name-error').classList.add('hidden');
  });

  // Reminder banner
  document.getElementById('btn-reminder-dismiss').addEventListener('click', dismissReminderBanner);

  // Plan nudge banner
  document.getElementById('btn-plan-nudge-dismiss').addEventListener('click', dismissPlanNudge);

  // Settings
  document.getElementById('settings-version').textContent = 'GymOps ' + APP_VERSION;
  setWeightUnit(getWeightUnit());
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => setWeightUnit(btn.dataset.unit));
  });
  setReminderEnabled(getReminderEnabled());
  document.querySelectorAll('.reminder-btn').forEach(btn => {
    btn.addEventListener('click', () => setReminderEnabled(btn.dataset.reminder === 'true'));
  });
  document.getElementById('btn-settings').addEventListener('click', () => showScreen('settings'));
  document.getElementById('btn-settings-back').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-clear-data').addEventListener('click', () => {
    document.getElementById('confirm-clear').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-clear').addEventListener('click', () => {
    document.getElementById('confirm-clear').classList.add('hidden');
  });
  document.getElementById('confirm-clear-backdrop').addEventListener('click', () => {
    document.getElementById('confirm-clear').classList.add('hidden');
  });
  document.getElementById('btn-confirm-clear').addEventListener('click', () => {
    dbClearAll();
    location.reload(); // Reload to reinitialise the in-memory DB from scratch
  });

  // Export history (date-range modal)
  document.getElementById('btn-export-history').addEventListener('click', openExportRangeModal);
  const hideExportModal = () => document.getElementById('export-range').classList.add('hidden');
  document.getElementById('btn-cancel-export').addEventListener('click', hideExportModal);
  document.getElementById('export-range-backdrop').addEventListener('click', hideExportModal);
  document.getElementById('btn-do-export').addEventListener('click', () => {
    const from = document.getElementById('export-from').value;
    const to   = document.getElementById('export-to').value;
    const csv  = dbExportCSVByRange(from, to);
    if (!csv) { alert('No sessions found in that date range.'); return; }
    const suffix = (from || to) ? `${from || 'start'}-to-${to || 'today'}` : new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `gymops-${suffix}.csv`);
    hideExportModal();
  });

  // Anthropic API key input — load saved value; save on blur
  const keyInput = document.getElementById('input-anthropic-key');
  keyInput.value = getAnthropicKey();
  keyInput.addEventListener('blur', () => setAnthropicKey(keyInput.value.trim()));

  // Release notes modal
  const hideReleaseNotes = () => document.getElementById('release-notes').classList.add('hidden');
  document.getElementById('btn-release-notes').addEventListener('click', () => {
    document.getElementById('release-notes').classList.remove('hidden');
  });
  document.getElementById('btn-close-release-notes').addEventListener('click', hideReleaseNotes);
  document.getElementById('release-notes-backdrop').addEventListener('click', hideReleaseNotes);

  // Session completion signal
  document.getElementById('btn-signal-done').addEventListener('click', dismissSessionSignal);
  document.getElementById('session-signal-backdrop').addEventListener('click', dismissSessionSignal);

  // Inactivity modal responses
  document.getElementById('btn-inactivity-continue').addEventListener('click', () => {
    hideInactivityModal();
    resetInactivityTimer(); // User confirmed they're still active — restart the countdown
  });
  document.getElementById('btn-inactivity-end').addEventListener('click', () => {
    hideInactivityModal();
    finishWorkout();
  });

  // Inactivity + rest-timer resync when the tab returns to the foreground
  // (owned by workout.js — it assigns the module-private timer variables)
  initInactivityWatchdog();

  // Exercise history
  document.getElementById('btn-history-idle').addEventListener('click', () => showScreen('history'));
  document.getElementById('btn-history-back').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-exercise-history-back').addEventListener('click', () => showScreen('history'));

  // Plans
  document.getElementById('btn-plans-idle').addEventListener('click', () => showScreen('plans'));
  document.getElementById('btn-plans-back').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-new-plan').addEventListener('click', openNewPlan);
  document.getElementById('btn-plan-editor-back').addEventListener('click', () => showScreen('plans'));
  document.getElementById('btn-save-plan').addEventListener('click', savePlan);
  document.getElementById('btn-archive-plan').addEventListener('click', archiveCurrentPlan);
  document.getElementById('btn-plan-expiry-review').addEventListener('click', () => showScreen('plans'));
  document.getElementById('btn-add-plan-exercise').addEventListener('click', openPickerForPlan);

  // Completed screen
  document.getElementById('btn-resume').addEventListener('click', resumeLastWorkout);
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
  document.getElementById('btn-ai-summary').addEventListener('click', generateAISummary);
  document.getElementById('btn-ai-summary-done').addEventListener('click', hideAISummaryModal);
  document.getElementById('ai-summary-backdrop').addEventListener('click', hideAISummaryModal);
}

document.addEventListener('DOMContentLoaded', boot);
