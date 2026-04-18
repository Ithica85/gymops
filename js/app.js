// ═══════════════════════════════════════════════════════
// GymOps — App logic
// ═══════════════════════════════════════════════════════

const APP_VERSION = 'v1.2';

// Master exercise list. Each entry has a name and type:
//   'reps'  — logs weight + reps
//   'timed' — logs duration_mins + optional calories
// Custom exercise names (entered via "Other") are stored as-is and always
// treated as 'reps' since there is no timed variant for free-text exercises.
const EXERCISES = [
  { name: 'Seated Shoulder Press',       type: 'reps'  },
  { name: 'Goblet Squats',               type: 'reps'  },
  { name: 'Rear Delt Fly',               type: 'reps'  },
  { name: 'Hamstring Curls',             type: 'reps'  },
  { name: 'Elliptical',                  type: 'timed' },
  { name: 'Stairmaster',                 type: 'timed' },
  { name: 'Assisted Dips',               type: 'reps'  },
  { name: 'Assisted Pull Ups',           type: 'reps'  },
  { name: 'Press Ups',                   type: 'reps'  },
  { name: 'Bent Over Rows',              type: 'reps'  },
  { name: 'Push Up to Downward Dog',     type: 'reps'  },
  { name: 'Staggered Kettlebell Halo',   type: 'reps'  },
  { name: "Farmer's Carries",            type: 'reps'  },
  { name: 'Seated Leg Press',            type: 'reps'  },
  { name: 'Chest Press',                 type: 'reps'  },
  { name: 'Deadlifts',                   type: 'reps'  },
  { name: 'Other',                       type: 'reps'  },
];

// Looks up an exercise type by name. Falls back to 'reps' for custom names
// entered via the "Other" flow that don't appear in the EXERCISES array.
function getExerciseType(name) {
  return EXERCISES.find(e => e.name === name)?.type ?? 'reps';
}

// ── Session notes auto-save ───────────────────────────

// Debounce handle for the notes textarea. Notes are saved 600ms after the
// user stops typing, and immediately on blur (e.g. switching apps).
let _notesDebounce = null;

// Flushes the current notes value to the DB immediately (no debounce).
// Passing null when the textarea is empty avoids storing an empty string in the DB.
function saveNotesNow() {
  if (!state.sessionId) return;
  const notes = document.getElementById('session-notes').value.trim();
  dbUpdateSessionNotes(state.sessionId, notes || null);
}

// Schedules a save 600ms after the last keystroke. Resets on each input event.
function scheduleNotesSave() {
  clearTimeout(_notesDebounce);
  _notesDebounce = setTimeout(saveNotesNow, 600);
}

// ── Inactivity timer ──────────────────────────────────

const INACTIVITY_MS = 30 * 60 * 1000; // Show prompt after 30 min of no activity
const AUTO_CLOSE_MS =  5 * 60 * 1000; // Auto-close session 5 min after prompt is ignored

let _inactivityTimer    = null;
let _autoCloseTimer     = null;
let _lastActivityTime   = null; // Wall-clock timestamp of last activity — used to detect
                                // inactivity when the browser throttles background timers

// Elapsed session timer — ticks every second while a session is active.
let _sessionTimer    = null;
let _sessionStart    = null; // Date object for the session's start_time

// ── Rest timer ────────────────────────────────────────

const REST_SECS = 90;

let _restTimer     = null;
let _restRemaining = 0;

function fmtRest(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Plays a short double-beep via Web Audio API to signal rest complete.
function beepAlert() {
  try {
    const ctx  = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [0, 0.25].forEach(offset => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch (e) { /* audio unavailable */ }
}

function stopRestTimer() {
  if (_restTimer) { clearInterval(_restTimer); _restTimer = null; }
  _restRemaining = 0;
  document.getElementById('rest-bar').classList.add('hidden');
}

function startRestTimer() {
  stopRestTimer(); // ensure only one timer runs
  _restRemaining = REST_SECS;
  const bar       = document.getElementById('rest-bar');
  const countdown = document.getElementById('rest-countdown');
  bar.classList.remove('hidden');
  countdown.textContent = fmtRest(_restRemaining);

  _restTimer = setInterval(() => {
    _restRemaining -= 1;
    if (_restRemaining <= 0) {
      clearInterval(_restTimer);
      _restTimer = null;
      countdown.textContent = 'Done!';
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      beepAlert();
      setTimeout(stopRestTimer, 2000);
    } else {
      countdown.textContent = fmtRest(_restRemaining);
    }
  }, 1000);
}

// Formats milliseconds as MM:SS (or H:MM:SS for sessions over one hour).
function formatElapsed(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Starts the elapsed timer from the session's recorded start_time (not from now),
// so resumed sessions show the full elapsed time including any break.
// Calls tick() immediately so the display is correct on first render without
// waiting for the first interval to fire.
function startSessionTimer(startTimeISO) {
  _sessionStart = new Date(startTimeISO);
  const el = document.getElementById('session-timer');
  clearInterval(_sessionTimer); // Clear any previous timer before starting a new one
  const tick = () => { el.textContent = formatElapsed(new Date() - _sessionStart); };
  tick();
  _sessionTimer = setInterval(tick, 1000);
}

// Stops the elapsed timer and resets the display to 00:00.
function stopSessionTimer() {
  clearInterval(_sessionTimer);
  _sessionTimer = null;
  _sessionStart = null;
  document.getElementById('session-timer').textContent = '00:00';
}

// Resets the inactivity countdown. Called on any user action (set logged,
// exercise changed, undo). Uses a nested timeout pattern:
//   → After 30 min of inactivity: show "Still working out?" prompt
//   → If no response for a further 5 min: auto-close the session
function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_autoCloseTimer);
  _lastActivityTime = Date.now();
  _inactivityTimer = setTimeout(() => {
    showInactivityModal();
    _autoCloseTimer = setTimeout(() => {
      hideInactivityModal();
      finishWorkout();
    }, AUTO_CLOSE_MS);
  }, INACTIVITY_MS);
}

function clearInactivityTimers() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_autoCloseTimer);
  _inactivityTimer = null;
  _autoCloseTimer  = null;
}

function showInactivityModal() {
  document.getElementById('inactivity-modal').classList.remove('hidden');
}

function hideInactivityModal() {
  document.getElementById('inactivity-modal').classList.add('hidden');
}

// ── State ─────────────────────────────────────────────

// Single mutable state object. No framework reactivity — all DOM updates are
// explicit via render* functions called after state mutations.
const state = {
  sessionId:    null,
  exercise:     EXERCISES[0].name,
  exerciseType: EXERCISES[0].type,
  setNumber:    1,
};

// ── Input helpers ─────────────────────────────────────

// Updates the two input field placeholders to show last-session values as ghost text.
// Matches by set_number so Set 1 shows Set 1's previous values, Set 2 shows Set 2's, etc.
// Falls back to generic labels ('Weight', 'Reps') when no history exists for this set number.
function updateInputFields() {
  const weightEl  = document.getElementById('input-weight');
  const repsEl    = document.getElementById('input-reps');
  const lastSets  = dbGetLastSessionSetsForExercise(state.exercise);
  const reference = lastSets.find(s => s.set_number === state.setNumber) ?? null;

  if (state.exerciseType === 'timed') {
    weightEl.placeholder = reference ? String(reference.duration_mins) : 'Duration (min)';
    repsEl.placeholder   = (reference?.calories != null) ? String(reference.calories) : 'Cal (opt)';
  } else {
    weightEl.placeholder = reference ? String(reference.weight) : 'Weight';
    repsEl.placeholder   = reference ? String(reference.reps)   : 'Reps';
  }
}

// ── Screen routing ────────────────────────────────────

// Shows a named screen (idle / active / completed / settings) and hides all others.
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── UI rendering ──────────────────────────────────────

// Renders the "Last session" reference line below the exercise name.
// Pulls all sets for the current exercise from the most recent completed session.
function renderLastSession() {
  const el   = document.getElementById('last-session');
  const sets = dbGetLastSessionSetsForExercise(state.exercise);

  if (!sets.length) {
    el.textContent = 'Last session: No history';
    return;
  }

  const parts = sets.map(s => {
    if (s.duration_mins != null) {
      return s.calories != null
        ? `${s.duration_mins} min · ${s.calories} cal`
        : `${s.duration_mins} min`;
    }
    return `${s.weight}×${s.reps}`;
  });

  el.textContent = 'Last session: ' + parts.join(', ');
}

// Full re-render of the active screen: exercise name, set number,
// input placeholders, last session reference, and the sets log.
function renderActive() {
  document.getElementById('exercise-name').textContent = state.exercise;
  document.getElementById('set-number').textContent    = state.setNumber;
  updateInputFields();
  renderLastSession();
  renderRecentSets();
  // Show Rest button only after at least one set has been logged
  const hasSet = dbGetSetCount(state.sessionId) > 0;
  document.getElementById('btn-rest').classList.toggle('hidden', !hasSet);
}

// Renders the full session log (all sets, newest first).
// Formats reps sets as "Set N · weight × reps" and timed sets as "Set N · duration min · cal".
function renderRecentSets() {
  const list  = document.getElementById('sets-list');
  const empty = document.getElementById('sets-empty');
  const sets  = dbGetAllSets(state.sessionId);

  if (!sets.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = sets.map(s => {
    let details;
    if (s.duration_mins != null) {
      details = s.calories != null
        ? `Set ${s.set_number} · ${s.duration_mins} min · ${s.calories} cal`
        : `Set ${s.set_number} · ${s.duration_mins} min`;
    } else {
      details = `Set ${s.set_number} · ${s.weight} × ${s.reps}`;
    }
    return `
      <div class="set-item" data-set-id="${s.set_id}">
        <span class="set-item-exercise">${s.exercise}</span>
        <span class="set-item-details">${details}</span>
        <button class="set-delete-btn" data-set-id="${s.set_id}" aria-label="Delete set">🗑</button>
      </div>
    `;
  }).join('');
}

// Replaces a set-item's content with an inline confirmation prompt.
// On confirm: deletes the set, re-sequences, refreshes state and UI.
function confirmDeleteSet(setId) {
  const row = document.querySelector(`.set-item[data-set-id="${setId}"]`);
  if (!row) return;
  row.classList.add('set-item--confirming');
  row.innerHTML = `
    <span class="set-delete-confirm-msg">Delete this set?</span>
    <div class="set-delete-confirm-actions">
      <button class="btn-text set-delete-cancel" data-set-id="${setId}">Cancel</button>
      <button class="btn-danger set-delete-confirm" data-set-id="${setId}">Delete</button>
    </div>
  `;
}

function showError(msg) {
  const el = document.getElementById('input-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('input-error').classList.add('hidden');
}

// Focuses the first input field (weight / duration). Called after any action
// that should return the user to the input row.
function focusInput() {
  document.getElementById('input-weight').focus();
}

function clearInputs() {
  document.getElementById('input-weight').value = '';
  document.getElementById('input-reps').value = '';
}

// ── Session lifecycle ─────────────────────────────────

// Starts a new workout session. If an active session already exists (e.g. from
// a crash or browser close), it is silently finished before creating the new one.
// Always defaults to the first exercise in the list.
function startSession() {
  // Abandon any lingering active session
  const existing = dbGetActiveSession();
  if (existing) dbFinishSession(existing.session_id);

  document.getElementById('btn-resume-idle').classList.add('hidden');

  state.sessionId    = dbCreateSession();
  state.exercise     = EXERCISES[0].name;
  state.exerciseType = EXERCISES[0].type;
  state.setNumber    = 1;

  document.getElementById('session-notes').value = '';
  showScreen('active');
  renderActive();
  focusInput();
  resetInactivityTimer();
  // Read start_time back from DB rather than using new Date(), so the timer
  // is anchored to the exact timestamp stored in the session record.
  const newSession = dbGetSession(state.sessionId);
  if (newSession) startSessionTimer(newSession.start_time);
}

// Resumes an existing session (from idle screen or completed screen).
// Determines which exercise to land on by looking at the most recently logged set.
// Note: resumeLastWorkout() overrides this with the exercise that was active
// at the time Finish was tapped, which may differ from the last logged set.
function resumeSession(session) {
  state.sessionId = session.session_id;

  const sessionData = dbGetSession(session.session_id);
  document.getElementById('session-notes').value = sessionData?.notes ?? '';

  const lastSet      = dbGetRecentSets(session.session_id, 1)[0];
  state.exercise     = lastSet ? lastSet.exercise : EXERCISES[0].name;
  state.exerciseType = getExerciseType(state.exercise);
  state.setNumber    = dbGetSetCountForExercise(session.session_id, state.exercise) + 1;

  showScreen('active');
  renderActive();
  focusInput();
  resetInactivityTimer();
  if (sessionData) startSessionTimer(sessionData.start_time);
}

// Saved when the Finish confirmation modal opens, restored if the user cancels.
// Ensures dismissing the modal returns to the exact exercise the user was on,
// even if no sets had been logged for it yet (so it doesn't appear in dbGetRecentSets).
let _savedExercise     = null;
let _savedExerciseType = null;

function showFinishConfirm() {
  _savedExercise     = state.exercise;
  _savedExerciseType = state.exerciseType;
  document.getElementById('confirm-finish').classList.remove('hidden');
}

// Used only by the confirmed-finish path (finishWorkout). Clears saved state
// without restoring it. Kept separate from cancelFinishConfirm to avoid
// triggering a re-render mid-finish.
function hideFinishConfirm() {
  document.getElementById('confirm-finish').classList.add('hidden');
  _savedExercise     = null;
  _savedExerciseType = null;
}

// Used by the Cancel button and backdrop tap. Restores the saved exercise
// before hiding the modal, then re-renders and returns focus to the input.
function cancelFinishConfirm() {
  state.exercise     = _savedExercise;
  state.exerciseType = _savedExerciseType;
  hideFinishConfirm();
  renderActive();
  focusInput();
}

// Saved at the moment Finish is confirmed, so resumeLastWorkout() can restore
// the exact exercise the user was on — not just the last exercise with a logged set.
let _resumeExercise     = null;
let _resumeExerciseType = null;

// Ends the session, triggers Drive upload, and shows the completed screen.
function finishWorkout() {
  hideFinishConfirm();
  hideInactivityModal();
  clearInactivityTimers();
  stopSessionTimer();
  stopRestTimer();
  clearTimeout(_notesDebounce);
  saveNotesNow(); // Flush any unsaved notes before closing the session

  // Capture current exercise before state changes, so resume can restore it
  _resumeExercise     = state.exercise;
  _resumeExerciseType = state.exerciseType;

  const count   = dbGetSetCount(state.sessionId);
  dbFinishSession(state.sessionId);
  state.finishedAt = new Date();

  // Auto-save to Google Drive (non-blocking — failure shows toast, doesn't block UI)
  const csv     = dbExportSessionCSV(state.sessionId);
  const session = dbGetSession(state.sessionId);
  if (csv && session) gdriveUpload(csv, session.start_time);

  document.getElementById('session-summary').textContent =
    `${count} set${count !== 1 ? 's' : ''} logged`;

  document.getElementById('btn-resume').classList.remove('hidden');
  showScreen('completed');
}

// Reopens the most recently finished session if it was completed within the last 60 minutes.
// Calls resumeSession() to restore DB state and notes, then overrides the exercise
// with the one that was active when Finish was tapped (which resumeSession's last-set
// lookup may not match if the user had switched exercise without logging a set).
function resumeLastWorkout() {
  const elapsed = (new Date() - state.finishedAt) / 1000 / 60;
  if (elapsed >= 60) {
    // Resume window has expired — hide the button and bail
    document.getElementById('btn-resume').classList.add('hidden');
    return;
  }
  dbResumeSession(state.sessionId);
  resumeSession({ session_id: state.sessionId });
  if (_resumeExercise !== null) {
    state.exercise     = _resumeExercise;
    state.exerciseType = _resumeExerciseType;
    state.setNumber    = dbGetSetCountForExercise(state.sessionId, state.exercise) + 1;
    _resumeExercise     = null;
    _resumeExerciseType = null;
    renderActive(); // Re-render to reflect restored exercise
  }
}

// ── Core actions ──────────────────────────────────────

// Reads the two input fields and logs a set for the current exercise.
// Validation and DB insertion branch on exerciseType:
//   'timed' — duration required, calories optional
//   'reps'  — both weight and reps required, must be positive numbers
function logSet() {
  const field1 = document.getElementById('input-weight').value.trim();
  const field2 = document.getElementById('input-reps').value.trim();

  if (state.exerciseType === 'timed') {
    const duration = parseFloat(field1);
    const calories = field2 ? parseInt(field2, 10) : null;

    if (!field1 || isNaN(duration) || duration <= 0) {
      showError('Enter duration');
      focusInput();
      return;
    }
    if (field2 && (isNaN(calories) || calories < 0)) {
      showError('Enter a valid calorie count');
      focusInput();
      return;
    }

    clearError();
    try {
      dbInsertSet(state.sessionId, state.exercise, state.setNumber, null, null, duration, calories);
    } catch (err) {
      showError('DB error: ' + err.message);
      focusInput();
      return;
    }
  } else {
    const weight = parseFloat(field1);
    const reps   = parseInt(field2, 10);

    if (!field1 || !field2 || isNaN(weight) || isNaN(reps) || weight < 0 || reps <= 0) {
      showError('Enter weight and reps');
      focusInput();
      return;
    }

    clearError();
    try {
      dbInsertSet(state.sessionId, state.exercise, state.setNumber, weight, reps);
    } catch (err) {
      showError('DB error: ' + err.message);
      focusInput();
      return;
    }
  }

  state.setNumber += 1;
  clearInputs();
  renderActive();
  document.querySelector('.sets-log').scrollTop = 0; // Scroll log back to top to show latest set
  focusInput();
  resetInactivityTimer();
}

// Deletes the most recently logged set for the session.
// Only decrements setNumber if the deleted set was for the currently selected
// exercise — deleting a different exercise's set shouldn't change the counter.
function undoSet() {
  const deleted = dbDeleteLastSet(state.sessionId);
  if (!deleted) {
    showError('Nothing to undo');
    setTimeout(clearError, 1500);
    return;
  }

  if (deleted.exercise === state.exercise) {
    state.setNumber = Math.max(1, state.setNumber - 1);
  }

  renderActive();
  focusInput();
  resetInactivityTimer();
}

// ── Exercise picker ───────────────────────────────────

// Opens the exercise picker bottom sheet. Marks the currently selected exercise.
// The "Other" item shows an inline free-text input instead of immediately closing.
function openPicker() {
  const ul = document.getElementById('exercise-list');
  ul.innerHTML = '';

  EXERCISES.forEach(ex => {
    const li = document.createElement('li');
    li.textContent = ex.name;
    if (ex.name === state.exercise) li.classList.add('selected');

    li.addEventListener('click', () => {
      if (ex.name === 'Other') {
        // Switch picker to name-entry mode — hide list, show text input
        document.getElementById('exercise-list').classList.add('hidden');
        document.getElementById('btn-close-picker').classList.add('hidden');
        document.getElementById('other-name-section').classList.remove('hidden');
        document.getElementById('other-name-input').value = '';
        document.getElementById('other-name-error').classList.add('hidden');
        document.getElementById('modal-title').textContent = 'Exercise Name';
        document.getElementById('other-name-input').focus();
        return;
      }

      state.exercise     = ex.name;
      state.exerciseType = ex.type;
      // Set number for this exercise = sets already logged + 1
      state.setNumber    = dbGetSetCountForExercise(state.sessionId, ex.name) + 1;
      closePicker();
      renderActive();
      focusInput();
      resetInactivityTimer();
    });

    ul.appendChild(li);
  });

  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Resets the picker to its default state (list visible, name-entry hidden).
function closePicker() {
  document.getElementById('exercise-picker').classList.add('hidden');
  document.getElementById('exercise-list').classList.remove('hidden');
  document.getElementById('btn-close-picker').classList.remove('hidden');
  document.getElementById('other-name-section').classList.add('hidden');
  document.getElementById('modal-title').textContent = 'Select Exercise';
}

// Validates and applies the custom exercise name entered via "Other".
// Custom names are always treated as 'reps' — there is no timed "Other" variant.
// If the field is blank, shows an inline error without closing the picker.
function confirmOtherName() {
  const name    = document.getElementById('other-name-input').value.trim();
  const errorEl = document.getElementById('other-name-error');

  if (!name) {
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  state.exercise     = name;
  state.exerciseType = 'reps';
  state.setNumber    = dbGetSetCountForExercise(state.sessionId, name) + 1;

  closePicker();
  renderActive();
  focusInput();
  resetInactivityTimer();
}

// ── Toast ─────────────────────────────────────────────

// Shows a brief notification at the bottom of the screen.
// Errors display for 5 seconds; success messages display for 3 seconds.
function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), isError ? 5000 : 3000);
}

// ── CSV export ────────────────────────────────────────

// Triggers a CSV download. Exports the current session only if one is active;
// otherwise exports the full workout history across all sessions.
function triggerExport() {
  const csv = state.sessionId ? dbExportSessionCSV(state.sessionId) : dbExportCSV();
  if (!csv) { alert('No data to export.'); return; }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `gymops-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Boot ──────────────────────────────────────────────

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

  // Active
  document.getElementById('btn-change-exercise').addEventListener('click', openPicker);
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
          state.setNumber = dbGetSetCountForExercise(state.sessionId, state.exercise) + 1;
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
  inputWeight.addEventListener('input', () => clearError());
  inputReps.addEventListener('input',   () => clearError());

  // Session notes
  const notesEl = document.getElementById('session-notes');
  notesEl.addEventListener('input', scheduleNotesSave);
  notesEl.addEventListener('blur', () => { clearTimeout(_notesDebounce); saveNotesNow(); });

  // Exercise picker
  document.getElementById('btn-close-picker').addEventListener('click', closePicker);
  document.getElementById('modal-backdrop').addEventListener('click', closePicker);
  document.getElementById('btn-other-done').addEventListener('click', confirmOtherName);
  document.getElementById('other-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmOtherName();
  });
  document.getElementById('other-name-input').addEventListener('input', () => {
    document.getElementById('other-name-error').classList.add('hidden');
  });

  // Settings
  document.getElementById('settings-version').textContent = 'GymOps ' + APP_VERSION;
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

  // Inactivity modal responses
  document.getElementById('btn-inactivity-continue').addEventListener('click', () => {
    hideInactivityModal();
    resetInactivityTimer(); // User confirmed they're still active — restart the countdown
  });
  document.getElementById('btn-inactivity-end').addEventListener('click', () => {
    hideInactivityModal();
    finishWorkout();
  });

  // When the tab becomes visible again after being backgrounded, check real
  // wall-clock elapsed time — browser may have throttled the setTimeout so it
  // never fired. If inactivity threshold has passed, show the modal immediately.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!_lastActivityTime || !state.sessionId) return;
    const elapsed = Date.now() - _lastActivityTime;
    if (elapsed >= INACTIVITY_MS) {
      clearTimeout(_inactivityTimer);
      clearTimeout(_autoCloseTimer);
      showInactivityModal();
      _autoCloseTimer = setTimeout(() => {
        hideInactivityModal();
        finishWorkout();
      }, AUTO_CLOSE_MS);
    }
  });

  // Completed screen
  document.getElementById('btn-resume').addEventListener('click', resumeLastWorkout);
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
}

document.addEventListener('DOMContentLoaded', boot);
