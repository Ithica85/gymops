// ═══════════════════════════════════════════════════════
// GymOps — Exercise picker bottom sheet (session mode + plan-editor mode)
// ═══════════════════════════════════════════════════════

import { dbGetExerciseRecency, dbGetSessionPlan, dbGetSetCountForExercise } from './db.js';
import { CARDIO_KEYWORDS, EXERCISES, getExerciseType, state } from './state.js';
import { setActiveExercise } from './workout.js';
import { addExerciseToPlan } from './plans.js';
import { escapeHTML } from './ui.js';

// Picker sort preference — 'recent' (default) or 'az'. Persisted across sessions.
let _pickerSort    = localStorage.getItem('gymops_picker_sort') || 'recent';

// Recency rank map built fresh each time the picker opens: { exerciseName -> rank }
// where rank 0 = most recently used. Populated by _refreshRecencyRanks().
let _recencyRanks  = {};

// 'session' (default) or 'plan' — controls what happens when an exercise is selected.
let _pickerContext = 'session';

function _refreshRecencyRanks() {
  _recencyRanks = {};
  dbGetExerciseRecency().forEach((r, i) => { _recencyRanks[r.exercise] = i; });
}

// Returns EXERCISES sorted per current _pickerSort mode.
// "Other" is always pinned last regardless of sort mode.
// Never-used exercises fall below used ones, sorted A–Z among themselves.
function _sortedExercises() {
  const regular = EXERCISES.filter(e => e.name !== 'Other');
  const other   = EXERCISES.find(e => e.name === 'Other');

  if (_pickerSort === 'az') {
    regular.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    regular.sort((a, b) => {
      const ra = _recencyRanks[a.name];
      const rb = _recencyRanks[b.name];
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return  1;
      return a.name.localeCompare(b.name);
    });
  }

  return other ? [...regular, other] : regular;
}

// Rebuilds the exercise list in the picker using the current sort mode.
// Called by openPicker() and by sort-toggle handlers.
function _renderExerciseList() {
  const ul = document.getElementById('exercise-list');
  ul.innerHTML = '';

  // In plan context (adding to plan editor) skip the plan-section grouping
  const plan = (_pickerContext === 'session' && state.sessionId)
    ? dbGetSessionPlan(state.sessionId) : null;
  const planExerciseNames = plan?.exercises?.map(e => e.exercise) ?? [];
  const planTargetMap = {};
  plan?.exercises?.forEach(e => { planTargetMap[e.exercise] = e; });

  function makeItem(ex, targetHint) {
    const li   = document.createElement('li');
    const done = _pickerContext === 'session'
      ? dbGetSetCountForExercise(state.sessionId, ex.name) > 0
      : false;
    if (targetHint) {
      li.innerHTML = `<span>${escapeHTML(ex.name)}</span><span class="picker-target-hint">${targetHint}</span>`;
    } else {
      li.textContent = ex.name;
    }
    if (ex.name === state.exercise) li.classList.add('selected');
    if (done) li.classList.add('exercise-done');

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
      if (_pickerContext === 'plan') {
        closePicker();
        addExerciseToPlan(ex.name, ex.type);
        return;
      }
      closePicker();
      setActiveExercise(ex.name);
    });
    return li;
  }

  // If session has a plan, render plan exercises first with targets, then a divider, then the rest
  if (planExerciseNames.length > 0) {
    const planHeader = document.createElement('li');
    planHeader.className = 'picker-section-header';
    planHeader.textContent = 'Today\'s Plan';
    ul.appendChild(planHeader);

    planExerciseNames.forEach(name => {
      const ex  = EXERCISES.find(e => e.name === name) ?? { name, type: getExerciseType(name) };
      const tgt = planTargetMap[name];
      const hint = (tgt?.target_sets && tgt?.target_reps)
        ? `${tgt.target_sets}×${tgt.target_reps}` : null;
      ul.appendChild(makeItem(ex, hint));
    });

    const divider = document.createElement('li');
    divider.className = 'picker-divider';
    ul.appendChild(divider);
  }

  // All exercises (sorted), excluding ones already shown in plan section
  _sortedExercises()
    .filter(ex => !planExerciseNames.includes(ex.name))
    .forEach(ex => ul.appendChild(makeItem(ex, null)));

  // Keep sort toggle buttons in sync with current mode
  document.getElementById('picker-sort-recent').classList.toggle('picker-sort-btn--active', _pickerSort === 'recent');
  document.getElementById('picker-sort-az').classList.toggle('picker-sort-btn--active',     _pickerSort === 'az');
}

// Opens the exercise picker bottom sheet. Refreshes recency data and renders the list.
export function openPicker() {
  _refreshRecencyRanks();
  _renderExerciseList();
  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Opens the picker in plan-editing mode: picks add exercises to the plan draft
// instead of switching the active exercise. closePicker() resets to session mode.
export function openPickerForPlan() {
  _pickerContext = 'plan';
  _refreshRecencyRanks();
  _renderExerciseList();
  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Sets the picker sort mode, persists it, and re-renders the list.
export function setPickerSort(mode) {
  _pickerSort = mode;
  localStorage.setItem('gymops_picker_sort', mode);
  _renderExerciseList();
}

// Resets the picker to its default state (list visible, name-entry hidden).
export function closePicker() {
  _pickerContext = 'session';
  document.getElementById('exercise-picker').classList.add('hidden');
  document.getElementById('exercise-list').classList.remove('hidden');
  document.getElementById('btn-close-picker').classList.remove('hidden');
  document.getElementById('other-name-section').classList.add('hidden');
  document.getElementById('other-type-prompt').classList.add('hidden');
  document.getElementById('btn-other-done').classList.remove('hidden');
  document.getElementById('modal-title').textContent = 'Select Exercise';
  _pendingOtherName = '';
}

let _pendingOtherName = ''; // holds the name between the Done step and the type-prompt step

// Applies the pending "Other" exercise name with the type the user chose.
export function applyOtherPending(type) {
  applyOtherExercise(_pendingOtherName, type);
}

// ← Back from the Strength/Cardio prompt to the name-entry step.
export function backFromOtherType() {
  _pendingOtherName = '';
  document.getElementById('other-type-prompt').classList.add('hidden');
  document.getElementById('btn-other-done').classList.remove('hidden');
  document.getElementById('other-name-input').focus();
}

// Applies a confirmed custom exercise name with a resolved type, then closes the picker.
function applyOtherExercise(name, type) {
  const ctx = _pickerContext; // save before closePicker() resets it
  closePicker();
  if (ctx === 'plan') {
    addExerciseToPlan(name, type);
  } else {
    setActiveExercise(name, type);
  }
}

// Validates the free-text name entered via "Other".
// Auto-detects cardio by keyword match; otherwise shows the Strength/Cardio prompt.
export function confirmOtherName() {
  const name    = document.getElementById('other-name-input').value.trim();
  const errorEl = document.getElementById('other-name-error');

  if (!name) {
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');

  const isCardio = CARDIO_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
  if (isCardio) {
    applyOtherExercise(name, 'timed');
    return;
  }

  // No keyword match — ask the user to choose
  _pendingOtherName = name;
  document.getElementById('btn-other-done').classList.add('hidden');
  document.getElementById('other-type-prompt').classList.remove('hidden');
}

// ── Toast ─────────────────────────────────────────────
