// ═══════════════════════════════════════════════════════
// GymOps — App logic
// ═══════════════════════════════════════════════════════

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

function getExerciseType(name) {
  return EXERCISES.find(e => e.name === name)?.type ?? 'reps';
}

// ── Session notes auto-save ───────────────────────────
let _notesDebounce = null;

function saveNotesNow() {
  if (!state.sessionId) return;
  const notes = document.getElementById('session-notes').value.trim();
  dbUpdateSessionNotes(state.sessionId, notes || null);
}

function scheduleNotesSave() {
  clearTimeout(_notesDebounce);
  _notesDebounce = setTimeout(saveNotesNow, 600);
}

// ── Inactivity timer ──────────────────────────────────
const INACTIVITY_MS = 30 * 60 * 1000;
const AUTO_CLOSE_MS =  5 * 60 * 1000;

let _inactivityTimer = null;
let _autoCloseTimer  = null;

function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_autoCloseTimer);
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
const state = {
  sessionId:    null,
  exercise:     EXERCISES[0].name,
  exerciseType: EXERCISES[0].type,
  setNumber:    1,
};

// ── Input helpers ─────────────────────────────────────
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
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── UI rendering ──────────────────────────────────────
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

function renderActive() {
  document.getElementById('exercise-name').textContent = state.exercise;
  document.getElementById('set-number').textContent    = state.setNumber;
  updateInputFields();
  renderLastSession();
  renderRecentSets();
}

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
      <div class="set-item">
        <span class="set-item-exercise">${s.exercise}</span>
        <span class="set-item-details">${details}</span>
      </div>
    `;
  }).join('');
}

function showError(msg) {
  const el = document.getElementById('input-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('input-error').classList.add('hidden');
}

function focusInput() {
  document.getElementById('input-weight').focus();
}

function clearInputs() {
  document.getElementById('input-weight').value = '';
  document.getElementById('input-reps').value = '';
}

// ── Session lifecycle ─────────────────────────────────
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
}

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
}

function showFinishConfirm() {
  document.getElementById('confirm-finish').classList.remove('hidden');
}

function hideFinishConfirm() {
  document.getElementById('confirm-finish').classList.add('hidden');
}

function finishWorkout() {
  hideFinishConfirm();
  hideInactivityModal();
  clearInactivityTimers();
  clearTimeout(_notesDebounce);
  saveNotesNow();

  const count   = dbGetSetCount(state.sessionId);
  dbFinishSession(state.sessionId);
  state.finishedAt = new Date();

  // Auto-save to Google Drive (non-blocking)
  const csv     = dbExportSessionCSV(state.sessionId);
  const session = dbGetSession(state.sessionId);
  if (csv && session) gdriveUpload(csv, session.start_time);

  document.getElementById('session-summary').textContent =
    `${count} set${count !== 1 ? 's' : ''} logged`;

  document.getElementById('btn-resume').classList.remove('hidden');
  showScreen('completed');
}

function resumeLastWorkout() {
  const elapsed = (new Date() - state.finishedAt) / 1000 / 60;
  if (elapsed >= 60) {
    document.getElementById('btn-resume').classList.add('hidden');
    return;
  }
  dbResumeSession(state.sessionId);
  resumeSession({ session_id: state.sessionId });
}

// ── Core actions ──────────────────────────────────────
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

    if (!field1 || !field2 || isNaN(weight) || isNaN(reps) || weight <= 0 || reps <= 0) {
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
  document.querySelector('.sets-log').scrollTop = 0;
  focusInput();
  resetInactivityTimer();
}

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
function openPicker() {
  const ul = document.getElementById('exercise-list');
  ul.innerHTML = '';

  EXERCISES.forEach(ex => {
    const li = document.createElement('li');
    li.textContent = ex.name;
    if (ex.name === state.exercise) li.classList.add('selected');

    li.addEventListener('click', () => {
      if (ex.name === 'Other') {
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

function closePicker() {
  document.getElementById('exercise-picker').classList.add('hidden');
  document.getElementById('exercise-list').classList.remove('hidden');
  document.getElementById('btn-close-picker').classList.remove('hidden');
  document.getElementById('other-name-section').classList.add('hidden');
  document.getElementById('modal-title').textContent = 'Select Exercise';
}

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
function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), isError ? 5000 : 3000);
}

// ── CSV export ────────────────────────────────────────
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
async function boot() {
  await initDB();

  // Always show idle screen on boot
  const active = dbGetActiveSession();
  if (active) {
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
  document.getElementById('btn-finish').addEventListener('click', showFinishConfirm);
  document.getElementById('btn-confirm-end').addEventListener('click', finishWorkout);
  document.getElementById('btn-cancel-end').addEventListener('click', hideFinishConfirm);
  document.getElementById('confirm-finish-backdrop').addEventListener('click', hideFinishConfirm);

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
    location.reload();
  });

  // Completed
  document.getElementById('btn-inactivity-continue').addEventListener('click', () => {
    hideInactivityModal();
    resetInactivityTimer();
  });
  document.getElementById('btn-inactivity-end').addEventListener('click', () => {
    hideInactivityModal();
    finishWorkout();
  });

  document.getElementById('btn-resume').addEventListener('click', resumeLastWorkout);
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
}

document.addEventListener('DOMContentLoaded', boot);
