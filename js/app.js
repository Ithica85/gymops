// ═══════════════════════════════════════════════════════
// GymOps — App logic
// ═══════════════════════════════════════════════════════

const EXERCISES = [
  'Seated Shoulder Press',
  'Goblet Squats',
  'Rear Delt Fly',
  'Hamstring Curls',
  'Elliptical',
  'Assisted Dips',
  'Assisted Pull Ups',
  'Press Ups',
  'Bent Over Rows',
  'Push Up to Downward Dog',
  'Staggered Kettlebell Halo',
  "Farmer's Carries",
  'Seated Leg Press',
  'Chest Press',
  'Deadlifts',
  'Other',
];

// ── State ─────────────────────────────────────────────
const state = {
  sessionId:  null,
  exercise:   EXERCISES[0],
  setNumber:  1,
  lastWeight: null,
  lastReps:   null,
};

// ── Input helpers ─────────────────────────────────────
function parseInput(raw) {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const weight = parseFloat(parts[0]);
  const reps   = parseInt(parts[1], 10);
  if (isNaN(weight) || isNaN(reps) || weight <= 0 || reps <= 0) return null;
  return { weight, reps };
}

function formatLastSet(weight, reps) {
  return weight == null ? '—' : `${weight} × ${reps}`;
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
  document.getElementById('last-set').textContent      = formatLastSet(state.lastWeight, state.lastReps);
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
  list.innerHTML = sets.map(s => `
    <div class="set-item">
      <span class="set-item-exercise">${s.exercise}</span>
      <span class="set-item-details">Set ${s.set_number} · ${s.weight} × ${s.reps}</span>
    </div>
  `).join('');
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
  const input = document.getElementById('set-input');
  input.focus();
}

// ── Session lifecycle ─────────────────────────────────
function startSession() {
  state.sessionId  = dbCreateSession();
  state.exercise   = EXERCISES[0];
  state.setNumber  = 1;
  state.lastWeight = null;
  state.lastReps   = null;

  showScreen('active');
  renderActive();
  focusInput();
}

function resumeSession(session) {
  state.sessionId = session.session_id;

  const lastSet    = dbGetRecentSets(session.session_id, 1)[0];
  state.exercise   = lastSet ? lastSet.exercise : EXERCISES[0];
  state.setNumber  = dbGetSetCountForExercise(session.session_id, state.exercise) + 1;

  const lastForEx  = dbGetLastSetForExercise(session.session_id, state.exercise);
  state.lastWeight = lastForEx ? lastForEx.weight : null;
  state.lastReps   = lastForEx ? lastForEx.reps   : null;

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
  const input  = document.getElementById('set-input');
  const parsed = parseInput(input.value);

  if (!parsed) {
    showError('Enter two numbers: weight then reps (e.g. 50 8)');
    focusInput();
    return;
  }

  clearError();
  dbInsertSet(state.sessionId, state.exercise, state.setNumber, parsed.weight, parsed.reps);

  state.lastWeight = parsed.weight;
  state.lastReps   = parsed.reps;
  state.setNumber += 1;

  input.value = '';
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
    state.setNumber  = Math.max(1, state.setNumber - 1);
    const prev       = dbGetLastSetForExercise(state.sessionId, state.exercise);
    state.lastWeight = prev ? prev.weight : null;
    state.lastReps   = prev ? prev.reps   : null;
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
    li.textContent = ex;
    if (ex === state.exercise) li.classList.add('selected');

    li.addEventListener('click', () => {
      state.exercise   = ex;
      state.setNumber  = dbGetSetCountForExercise(state.sessionId, ex) + 1;
      const last       = dbGetLastSetForExercise(state.sessionId, ex);
      state.lastWeight = last ? last.weight : null;
      state.lastReps   = last ? last.reps   : null;
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

  // Input: Enter logs the set, any keystroke clears error
  const input = document.getElementById('set-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') logSet(); });
  input.addEventListener('input',   ()  => clearError());

  // Exercise picker
  document.getElementById('btn-close-picker').addEventListener('click', closePicker);
  document.getElementById('modal-backdrop').addEventListener('click', closePicker);

  // Completed
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
}

document.addEventListener('DOMContentLoaded', boot);
