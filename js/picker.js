// ═══════════════════════════════════════════════════════
// GymOps — Exercise picker bottom sheet (session mode + plan-editor mode)
// ═══════════════════════════════════════════════════════

import { dbGetExerciseRecency, dbGetSessionPlan, dbGetSetCountForExercise } from './db.js';
import { CARDIO_KEYWORDS, EXERCISES, MUSCLE_GROUPS, getExerciseType, state } from './state.js';
import { _doStartSession, setActiveExercise } from './workout.js';
import { addExerciseToPlan } from './plans.js';
import { escapeHTML } from './ui.js';

// Picker sort preference — 'recent' (default) or 'az'. Persisted across sessions.
let _pickerSort    = localStorage.getItem('gymops_picker_sort') || 'recent';

// Recency rank map built fresh each time the picker opens: { exerciseName -> rank }
// where rank 0 = most recently used. Populated by _refreshRecencyRanks().
let _recencyRanks  = {};

// 'session' (default), 'plan', or 'start' (5.3: choosing the first exercise
// BEFORE the session exists) — controls what happens on selection.
let _pickerContext = 'session';

// In plan mode: index of the _editingDays entry picks are added to (5.2).
let _pickerDayIdx = 0;

// Live filters (v3.6): search query and active muscle-group chip.
// Both reset when the picker closes so it always reopens in the default view.
let _pickerQuery = '';
let _pickerGroup = 'All';

function _refreshRecencyRanks() {
  _recencyRanks = {};
  dbGetExerciseRecency().forEach((r, i) => { _recencyRanks[r.exercise] = i; });
}

// Recency comparator: used exercises by most-recent-first, never-used A–Z below.
function _byRecency(a, b) {
  const ra = _recencyRanks[a.name];
  const rb = _recencyRanks[b.name];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1;
  if (rb !== undefined) return  1;
  return a.name.localeCompare(b.name);
}

export function setPickerQuery(q) {
  _pickerQuery = q;
  _renderExerciseList();
}

export function setPickerGroup(g) {
  _pickerGroup = g;
  _renderExerciseList();
}

// Rebuilds the exercise list from the current sort mode, search query, and
// group chip. Three views (v3.6):
//   searching     — flat filtered results, used exercises first, no sections
//   recent (dflt) — Today's Plan, then Recent (used, by recency), then the
//                   never-used catalogue under muscle-group section headers
//   a–z           — Today's Plan, then the whole catalogue flat A–Z (pre-v3.6
//                   behavior, kept for the US-04 toggle)
// "Other" is always appended last — it's the escape hatch when search finds
// nothing. Used exercises appear ONLY in Recent, never duplicated in sections.
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
    // In start mode nothing is selected yet — state.exercise is a leftover
    // from the previous session (or the boot placeholder).
    if (_pickerContext !== 'start' && ex.name === state.exercise) li.classList.add('selected');
    if (done) li.classList.add('exercise-done');

    li.addEventListener('click', () => {
      if (ex.name === 'Other') {
        document.getElementById('exercise-list').classList.add('hidden');
        document.getElementById('btn-close-picker').classList.add('hidden');
        document.getElementById('picker-controls').classList.add('hidden');
        document.getElementById('other-name-section').classList.remove('hidden');
        document.getElementById('other-name-input').value = '';
        document.getElementById('other-name-error').classList.add('hidden');
        document.getElementById('modal-title').textContent = 'Exercise Name';
        document.getElementById('other-name-input').focus();
        return;
      }
      if (_pickerContext === 'plan') {
        const dayIdx = _pickerDayIdx; // save before closePicker() resets it
        closePicker();
        addExerciseToPlan(ex.name, ex.type, dayIdx);
        return;
      }
      if (_pickerContext === 'start') {
        closePicker();
        _doStartSession({ exercise: ex.name, type: ex.type });
        return;
      }
      closePicker();
      setActiveExercise(ex.name);
    });
    return li;
  }

  function sectionHeader(label) {
    const li = document.createElement('li');
    li.className = 'picker-section-header';
    li.textContent = label;
    ul.appendChild(li);
  }

  function renderPlanSection() {
    if (!planExerciseNames.length) return;
    // Multi-day sessions name the day so "Today's Plan" reads as e.g. "— Push"
    sectionHeader(plan?.day ? `Today's Plan — ${plan.day.name}` : "Today's Plan");
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

  // Apply chip + search filters to the catalogue (Other is exempt — always shown)
  let entries = EXERCISES.filter(e => e.name !== 'Other');
  if (_pickerGroup !== 'All') entries = entries.filter(e => e.muscleGroup === _pickerGroup);
  const query = _pickerQuery.trim().toLowerCase();
  if (query) entries = entries.filter(e => e.name.toLowerCase().includes(query));

  if (query) {
    // Searching: flat results, used exercises first
    entries.sort(_byRecency);
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'picker-empty';
      li.textContent = 'No matches — add it as a custom exercise:';
      ul.appendChild(li);
    }
    entries.forEach(ex => ul.appendChild(makeItem(ex, null)));
  } else if (_pickerSort === 'az') {
    // Flat A–Z (pre-v3.6 behavior)
    renderPlanSection();
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(ex => !planExerciseNames.includes(ex.name))
      .forEach(ex => ul.appendChild(makeItem(ex, null)));
  } else {
    // Default: Recent block, then never-used catalogue in muscle-group sections
    renderPlanSection();
    const inPlan = ex => planExerciseNames.includes(ex.name);
    const used   = entries
      .filter(ex => _recencyRanks[ex.name] !== undefined && !inPlan(ex))
      .sort((a, b) => _recencyRanks[a.name] - _recencyRanks[b.name]);
    if (used.length) {
      sectionHeader('Recent');
      used.forEach(ex => ul.appendChild(makeItem(ex, null)));
    }
    for (const group of MUSCLE_GROUPS) {
      const fresh = entries
        .filter(ex => ex.muscleGroup === group && _recencyRanks[ex.name] === undefined && !inPlan(ex))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!fresh.length) continue;
      sectionHeader(group);
      fresh.forEach(ex => ul.appendChild(makeItem(ex, null)));
    }
  }

  // "Other" always last, regardless of filters
  ul.appendChild(makeItem(EXERCISES.find(e => e.name === 'Other'), null));

  // Keep sort toggle buttons in sync with current mode
  document.getElementById('picker-sort-recent').classList.toggle('picker-sort-btn--active', _pickerSort === 'recent');
  document.getElementById('picker-sort-az').classList.toggle('picker-sort-btn--active',     _pickerSort === 'az');

  // Rebuild chips (from MUSCLE_GROUPS so they can never drift from the catalogue)
  const chipsEl = document.getElementById('picker-chips');
  chipsEl.innerHTML = '';
  for (const group of ['All', ...MUSCLE_GROUPS]) {
    const btn = document.createElement('button');
    btn.className = 'picker-chip' + (group === _pickerGroup ? ' picker-chip--active' : '');
    btn.textContent = group;
    btn.dataset.group = group;
    chipsEl.appendChild(btn);
  }
}

// Opens the exercise picker bottom sheet. Refreshes recency data and renders the list.
export function openPicker() {
  _refreshRecencyRanks();
  _renderExerciseList();
  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Opens the picker in start mode (5.3): the session doesn't exist yet, and
// selecting an exercise creates it via _doStartSession. Dismissing the sheet
// creates nothing — closePicker() resets to session mode.
export function openPickerForStart() {
  _pickerContext = 'start';
  _refreshRecencyRanks();
  _renderExerciseList();
  document.getElementById('modal-title').textContent = 'First Exercise';
  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Opens the picker in plan-editing mode: picks add exercises to the given
// day of the plan draft instead of switching the active exercise.
// closePicker() resets to session mode.
export function openPickerForPlan(dayIdx = 0) {
  _pickerContext = 'plan';
  _pickerDayIdx  = dayIdx;
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

// Resets the picker to its default state (list visible, name-entry hidden,
// filters cleared so it always reopens in the default Recent view).
export function closePicker() {
  _pickerContext = 'session';
  _pickerQuery   = '';
  _pickerGroup   = 'All';
  document.getElementById('picker-search').value = '';
  document.getElementById('exercise-picker').classList.add('hidden');
  document.getElementById('exercise-list').classList.remove('hidden');
  document.getElementById('btn-close-picker').classList.remove('hidden');
  document.getElementById('picker-controls').classList.remove('hidden');
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
  const ctx    = _pickerContext; // save before closePicker() resets it
  const dayIdx = _pickerDayIdx;
  closePicker();
  if (ctx === 'plan') {
    addExerciseToPlan(name, type, dayIdx);
  } else if (ctx === 'start') {
    _doStartSession({ exercise: name, type }); // custom name straight into a new session
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
