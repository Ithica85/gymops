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

// ── State ─────────────────────────────────────────────
const state = {
  sessionId:    null,
  exercise:     EXERCISES[0].name,
  exerciseType: EXERCISES[0].type,
  setNumber:    1,
  lastWeight:   null,
  lastReps:     null,
  lastDuration: null,
  lastCalories: null,
};

// ── Input helpers ─────────────────────────────────────
function formatLastSet() {
  const prevNum = state.setNumber - 1;
  if (state.exerciseType === 'timed') {
    if (state.lastDuration == null) return '—';
    const val = state.lastCalories != null
      ? `${state.lastDuration} min · ${state.lastCalories} cal`
      : `${state.lastDuration} min`;
    return `Set ${prevNum}: ${val}`;
  }
  if (state.lastWeight == null) return '—';
  return `Set ${prevNum}: ${state.lastWeight} × ${state.lastReps}`;
}

function updateInputFields() {
  const weightEl = document.getElementById('input-weight');
  const repsEl   = document.getElementById('input-reps');
  if (state.exerciseType === 'timed') {
    weightEl.placeholder = 'Duration (min)';
    repsEl.placeholder   = 'Cal (opt)';
  } else {
    weightEl.placeholder = 'Weight';
    repsEl.placeholder   = 'Reps';
  }
}

// ── Screen routing ────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── UI rendering ──────────────────────────────────────
function renderActive() {
  document.getElementById('exercise-name').textContent = state.exercise;
  document.getElementById('set-number').textContent    = state.setNumber;
  document.getElementById('last-set').textContent      = formatLastSet();
  updateInputFields();
  renderRecentSets();
}

function renderRecentSets() {
  const list  = document.getElementById('sets-list');
  const empty = document.getElementById('sets-empty');
  const sets  = dbGetRecentSets(state.sessionId, 5);

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
  state.sessionId    = dbCreateSession();
  state.exercise     = EXERCISES[0].name;
  state.exerciseType = EXERCISES[0].type;
  state.setNumber    = 1;
  state.lastWeight   = null;
  state.lastReps     = null;
  state.lastDuration = null;
  state.lastCalories = null;

  showScreen('active');
  renderActive();
  focusInput();
}

function resumeSession(session) {
  state.sessionId = session.session_id;

  const lastSet      = dbGetRecentSets(session.session_id, 1)[0];
  state.exercise     = lastSet ? lastSet.exercise : EXERCISES[0].name;
  state.exerciseType = getExerciseType(state.exercise);
  state.setNumber    = dbGetSetCountForExercise(session.session_id, state.exercise) + 1;

  const lastForEx = dbGetLastSetForExercise(session.session_id, state.exercise);
  if (state.exerciseType === 'timed') {
    state.lastDuration = lastForEx ? lastForEx.duration_mins : null;
    state.lastCalories = lastForEx ? lastForEx.calories      : null;
    state.lastWeight   = null;
    state.lastReps     = null;
  } else {
    state.lastWeight   = lastForEx ? lastForEx.weight : null;
    state.lastReps     = lastForEx ? lastForEx.reps   : null;
    state.lastDuration = null;
    state.lastCalories = null;
  }

  showScreen('active');
  renderActive();
  focusInput();
}

function finishWorkout() {
  const count = dbGetSetCount(state.sessionId);
  dbFinishSession(state.sessionId);

  document.getElementById('session-summary').textContent =
    `${count} set${count !== 1 ? 's' : ''} logged`;

  showScreen('completed');
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
    state.lastDuration = duration;
    state.lastCalories = calories;
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
    state.lastWeight = weight;
    state.lastReps   = reps;
  }

  state.setNumber += 1;
  clearInputs();
  renderActive();
  focusInput();
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
    const prev = dbGetLastSetForExercise(state.sessionId, state.exercise);
    if (state.exerciseType === 'timed') {
      state.lastDuration = prev ? prev.duration_mins : null;
      state.lastCalories = prev ? prev.calories      : null;
    } else {
      state.lastWeight = prev ? prev.weight : null;
      state.lastReps   = prev ? prev.reps   : null;
    }
  }

  renderActive();
  focusInput();
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
      state.exercise     = ex.name;
      state.exerciseType = ex.type;
      state.setNumber    = dbGetSetCountForExercise(state.sessionId, ex.name) + 1;
      const last         = dbGetLastSetForExercise(state.sessionId, ex.name);
      if (ex.type === 'timed') {
        state.lastDuration = last ? last.duration_mins : null;
        state.lastCalories = last ? last.calories      : null;
        state.lastWeight   = null;
        state.lastReps     = null;
      } else {
        state.lastWeight   = last ? last.weight : null;
        state.lastReps     = last ? last.reps   : null;
        state.lastDuration = null;
        state.lastCalories = null;
      }
      closePicker();
      renderActive();
      focusInput();
    });

    ul.appendChild(li);
  });

  document.getElementById('exercise-picker').classList.remove('hidden');
}

function closePicker() {
  document.getElementById('exercise-picker').classList.add('hidden');
}

// ── CSV export ────────────────────────────────────────
function triggerExport() {
  const csv = dbExportCSV();
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

  const active = dbGetActiveSession();
  if (active) {
    resumeSession(active);
  } else {
    showScreen('idle');
  }

  // Idle
  document.getElementById('btn-start').addEventListener('click', startSession);

  // Active
  document.getElementById('btn-change-exercise').addEventListener('click', openPicker);
  document.getElementById('btn-undo').addEventListener('click', undoSet);
  document.getElementById('btn-finish').addEventListener('click', finishWorkout);

  // Input: Enter in weight moves to reps; Enter in reps logs the set
  const inputWeight = document.getElementById('input-weight');
  const inputReps   = document.getElementById('input-reps');
  inputWeight.addEventListener('keydown', e => { if (e.key === 'Enter') inputReps.focus(); });
  inputReps.addEventListener('keydown',   e => { if (e.key === 'Enter') logSet(); });
  inputWeight.addEventListener('input', () => clearError());
  inputReps.addEventListener('input',   () => clearError());

  // Exercise picker
  document.getElementById('btn-close-picker').addEventListener('click', closePicker);
  document.getElementById('modal-backdrop').addEventListener('click', closePicker);

  // Completed
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
}

document.addEventListener('DOMContentLoaded', boot);
