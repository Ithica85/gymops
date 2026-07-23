// ═══════════════════════════════════════════════════════
// GymOps — LAYER 1 — the in-workout path: start/resume, log, rest, undo, finish, PR, quick-log
// ═══════════════════════════════════════════════════════

import {
  dbCreateSession,
  dbDeleteLastSet,
  dbExportCSV,
  dbExportSessionCSV,
  dbFinishSession,
  dbGetActivePlan,
  dbGetActiveSession,
  dbGetAllSets,
  dbGetAllTimeBestForExercise,
  dbGetLastSessionExerciseOrder,
  dbGetLastSessionSetsForExercise,
  dbGetLastSetForExercise,
  dbGetNextPlanDay,
  dbGetPlanDays,
  dbGetPlanExercises,
  dbGetRecentSets,
  dbGetSession,
  dbGetSessionBestForExercise,
  dbGetSessionPlan,
  dbGetSetCount,
  dbGetSetCountForExercise,
  dbInsertSet,
  dbLinkSessionToPlan,
  dbResumeSession,
  dbUpdateSessionDay,
  dbUpdateSessionNotes,
} from './db.js';
import { gdriveUpload } from './gdrive.js';
import {
  WEIGHT_EPSILON_KG,
  convertWeight,
  getExerciseType,
  getRestSecs,
  getWeightUnit,
  localDateStr,
  state,
} from './state.js';
import { downloadCSV, escapeHTML, showScreen } from './ui.js';
import {
  computeProgressionSignal,
  computeSessionSignal,
  renderProgressionSignal,
  renderSessionSignal,
} from './signals.js';
import { openPicker, openPickerForStart } from './picker.js';
import { renderPlanAdherence } from './plans.js';
import { getAnthropicKey } from './settings.js';

// Debounce handle for the notes textarea. Notes are saved 600ms after the
// user stops typing, and immediately on blur (e.g. switching apps).
export let _notesDebounce = null;

// Flushes the current notes value to the DB immediately, cancelling any
// pending debounced save. Passing null when the textarea is empty avoids
// storing an empty string in the DB.
export function saveNotesNow() {
  clearTimeout(_notesDebounce);
  if (!state.sessionId) return;
  const notes = document.getElementById('session-notes').value.trim();
  dbUpdateSessionNotes(state.sessionId, notes || null);
}

// Schedules a save 600ms after the last keystroke. Resets on each input event.
export function scheduleNotesSave() {
  clearTimeout(_notesDebounce);
  _notesDebounce = setTimeout(saveNotesNow, 600);
}

// ── Inactivity timer ──────────────────────────────────

export const INACTIVITY_MS = 30 * 60 * 1000; // Show prompt after 30 min of no activity

export const AUTO_CLOSE_MS =  5 * 60 * 1000; // Auto-close session 5 min after prompt is ignored

export let _inactivityTimer    = null;

export let _autoCloseTimer     = null;

export let _lastActivityTime   = null; // Wall-clock timestamp of last activity — used to detect
                                // inactivity when the browser throttles background timers

// Elapsed session timer — ticks every second while a session is active.
let _sessionTimer    = null;

let _sessionStart    = null; // Date object for the session's start_time

// ── Shared audio ──────────────────────────────────────

// One AudioContext for the whole session (4.9) — browsers cap the number of
// live contexts, and creating one per beep leaks them (they're never closed).
let _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  // iOS suspends contexts created outside a user gesture; resume is a no-op
  // when already running.
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

// ── Rest timer ────────────────────────────────────────

let _restTimer   = null;

export let _restEndTime = null; // wall-clock timestamp when rest period ends

function fmtRest(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Plays a short double-beep via Web Audio API to signal rest complete.
function beepAlert() {
  try {
    const ctx  = _getAudioCtx();
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

export function stopRestTimer() {
  if (_restTimer) { clearInterval(_restTimer); _restTimer = null; }
  _restEndTime = null;
  document.getElementById('rest-bar').classList.add('hidden');
}

export function _tickRest() {
  const remaining = Math.ceil((_restEndTime - Date.now()) / 1000);
  const countdown = document.getElementById('rest-countdown');
  if (remaining <= 0) {
    clearInterval(_restTimer);
    _restTimer = null;
    countdown.textContent = 'Done!';
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beepAlert();
    setTimeout(stopRestTimer, 2000);
  } else {
    countdown.textContent = fmtRest(remaining);
  }
}

export function startRestTimer() {
  stopRestTimer();
  _restEndTime = Date.now() + getRestSecs() * 1000;
  document.getElementById('rest-bar').classList.remove('hidden');
  _tickRest();
  _restTimer = setInterval(_tickRest, 1000);
}

// One-off ±adjust to the RUNNING countdown (5.2.x #4). Deliberately does not
// touch the stored preference — Settings owns the default; this is "I need a
// bit more right now". Adjusting below zero completes the rest (beep) via the
// normal _tickRest done path. Ignored during the 2s "Done!" linger
// (_restTimer already null) and when no rest is running.
export function adjustRestTimer(deltaSecs) {
  if (!_restTimer) return;
  _restEndTime += deltaSecs * 1000;
  _tickRest();
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
export function resetInactivityTimer() {
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

export function showInactivityModal() {
  document.getElementById('inactivity-modal').classList.remove('hidden');
}

export function hideInactivityModal() {
  document.getElementById('inactivity-modal').classList.add('hidden');
}

// When the tab becomes visible again after being backgrounded, check real
// wall-clock elapsed time — browser may have throttled the setTimeout so it
// never fired. If inactivity threshold has passed, show the modal immediately.
// Lives here rather than in boot because it owns the timer variables above
// (imported bindings are read-only — assignment must happen in this module).
export function initInactivityWatchdog() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_restEndTime !== null) _tickRest(); // resync rest timer after background/lock
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
}

// ── State ─────────────────────────────────────────────

// ── Set display helpers (4.9 dedup) ───────────────────

// A stored set's weight converted to the given display unit. Pre-F-02 rows
// have no unit column — they were always logged in lbs.
function setDisplayWeight(set, toUnit) {
  return convertWeight(set.weight, set.unit || 'lbs', toUnit);
}

// "20 min · 150 cal", or "20 min" when calories weren't logged.
function fmtTimedSet(set) {
  return set.calories != null
    ? `${set.duration_mins} min · ${set.calories} cal`
    : `${set.duration_mins} min`;
}

// Updates the two input field placeholders to show last-session values as ghost text.
// Matches by set_number so Set 1 shows Set 1's previous values, Set 2 shows Set 2's, etc.
// Falls back to generic labels ('Weight', 'Reps') when no history exists for this set number.
export function updateInputFields() {
  const weightEl  = document.getElementById('input-weight');
  const repsEl    = document.getElementById('input-reps');
  const label1    = document.getElementById('label-field1');
  const label2    = document.getElementById('label-field2');
  const lastSets  = dbGetLastSessionSetsForExercise(state.exercise);
  const reference = lastSets.find(s => s.set_number === state.setNumber) ?? null;

  if (state.exerciseType === 'timed') {
    label1.textContent   = 'Duration (mins)';
    label2.textContent   = 'Calories';
    weightEl.placeholder = reference ? String(reference.duration_mins) : 'mins';
    repsEl.placeholder   = (reference?.calories != null) ? String(reference.calories) : 'optional';
  } else {
    const unit = getWeightUnit();
    label1.textContent = `Weight (${unit})`;
    label2.textContent = 'Reps';
    if (reference) {
      weightEl.placeholder = String(setDisplayWeight(reference, unit));
      repsEl.placeholder   = String(reference.reps);
    } else {
      weightEl.placeholder = unit;
      repsEl.placeholder   = 'reps';
    }
  }
  renderWeightConversion(); // hide/recompute on exercise change (timed hides it)
}

// ── Screen routing ────────────────────────────────────

// Renders the "Last session" reference line below the exercise name.
// Pulls all sets for the current exercise from the most recent completed session.
function renderLastSession() {
  const el   = document.getElementById('last-session');
  const sets = dbGetLastSessionSetsForExercise(state.exercise);

  if (!sets.length) {
    el.textContent = 'Last session: No history';
    return;
  }

  const currentUnit = getWeightUnit();
  const parts = sets.map(s => {
    if (s.duration_mins != null) return fmtTimedSet(s);
    return `${setDisplayWeight(s, currentUnit)} ${currentUnit}×${s.reps}`;
  });

  el.textContent = 'Last session: ' + parts.join(', ');
}

// Full re-render of the active screen: exercise name, set number,
// input placeholders, last session reference, and the sets log.
export function renderActive() {
  document.getElementById('exercise-name').textContent = state.exercise;
  document.getElementById('set-number').textContent    = state.setNumber;
  updateInputFields();
  renderLastSession();
  renderRecentSets();
  renderQuickLog();
  renderProgressionSignal(null); // clear any stale signal on exercise change / undo
  renderUpNext();
  renderDayChip();
  // Show Rest button only after at least one set has been logged
  const hasSet = dbGetSetCount(state.sessionId) > 0;
  document.getElementById('btn-rest').classList.toggle('hidden', !hasSet);
}

// ── Plan day chip + switcher (5.2) ────────────────────

// Small pill showing which plan day this session is training. Only rendered
// for multi-day plans — on a single-day plan it would just repeat the plan.
function renderDayChip() {
  const chip = document.getElementById('active-day-chip');
  const plan = state.sessionId ? dbGetSessionPlan(state.sessionId) : null;
  if (!plan?.day || dbGetPlanDays(plan.plan_id).length <= 1) {
    chip.classList.add('hidden');
    return;
  }
  chip.textContent = plan.day.name;
  chip.classList.remove('hidden');
}

// The rotation escape hatch: tapping the chip lists the plan's days; picking
// one re-points the session (dbUpdateSessionDay), which day-scopes the picker
// section, Up Next, and adherence through dbGetSessionPlan.
export function openDaySwitch() {
  const plan = state.sessionId ? dbGetSessionPlan(state.sessionId) : null;
  if (!plan?.day) return;
  const list = document.getElementById('day-switch-list');
  list.replaceChildren(...dbGetPlanDays(plan.plan_id).map(d => {
    const btn = document.createElement('button');
    btn.className = 'day-switch-row' + (d.day_id === plan.day.day_id ? ' day-switch-row--current' : '');
    btn.textContent = d.name; // user text — textContent, never innerHTML
    btn.addEventListener('click', () => {
      dbUpdateSessionDay(state.sessionId, d.day_id);
      closeDaySwitch();
      renderActive();
    });
    return btn;
  }));
  document.getElementById('day-switch-modal').classList.remove('hidden');
}

export function closeDaySwitch() {
  document.getElementById('day-switch-modal').classList.add('hidden');
}

// Pre-session day chooser (5.3): "Train a different day…" on the idle screen.
// Reuses the day-switch modal; picking a day starts the session on it,
// bypassing rotation. The rotated day is highlighted as the default. With an
// unfinished session lying around, defers to startSession's discard guard.
export function openDaySwitchForStart() {
  if (dbGetActiveSession()) { startSession(); return; }
  const plan = dbGetActivePlan();
  if (!plan) return;
  const days = dbGetPlanDays(plan.plan_id);
  if (days.length <= 1) return;
  const next = dbGetNextPlanDay(plan.plan_id);
  const list = document.getElementById('day-switch-list');
  list.replaceChildren(...days.map(d => {
    const btn = document.createElement('button');
    btn.className = 'day-switch-row' + (d.day_id === next?.day_id ? ' day-switch-row--current' : '');
    btn.textContent = d.name; // user text — textContent, never innerHTML
    btn.addEventListener('click', () => {
      closeDaySwitch();
      beginSessionFlow(d.day_id);
    });
    return btn;
  }));
  document.getElementById('day-switch-modal').classList.remove('hidden');
}

// Renders the full session log (all sets, newest first).
// Formats reps sets as "Set N · weight × reps" and timed sets as "Set N · duration min · cal".
export function renderRecentSets() {
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
      details = `Set ${s.set_number} · ${s.weight} ${s.unit || 'lbs'} × ${s.reps}`;
    }
    return `
      <div class="set-item" data-set-id="${s.set_id}">
        <span class="set-item-exercise">${escapeHTML(s.exercise)}</span>
        <span class="set-item-details">${details}</span>
        <button class="set-delete-btn" data-set-id="${s.set_id}" aria-label="Delete set">🗑</button>
      </div>
    `;
  }).join('');
}

// Replaces a set-item's content with an inline confirmation prompt.
// On confirm: deletes the set, re-sequences, refreshes state and UI.
export function confirmDeleteSet(setId) {
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

export function clearError() {
  document.getElementById('input-error').classList.add('hidden');
}

// Focuses the first input field (weight / duration). Called after any action
// that should return the user to the input row.
function focusInput() {
  document.getElementById('input-weight').focus();
}

// 5.6: entering an exercise (or undoing back into one) that has a quick-log
// reference leaves the hero button as the default action — auto-focusing the
// input would count as manual intent and demote it, and would pop the mobile
// keyboard the quick path exists to avoid. No reference → focus as before.
function focusInputUnlessHero() {
  if (!computeQuickLogRef()) focusInput();
}

function clearInputs() {
  document.getElementById('input-weight').value = '';
  document.getElementById('input-reps').value = '';
  renderWeightConversion(); // empty value → helper hides
}

// Inline lbs↔kg helper under the weight input (5.2.x #5): plates are labelled
// in one unit, logging may be in the other. Display-only — the set is stored
// exactly as typed in the current unit; the data layer is untouched. Re-run on
// every input event (wired in app.js), input clear, and exercise change.
export function renderWeightConversion() {
  const el  = document.getElementById('weight-convert');
  const raw = document.getElementById('input-weight').value.trim().replace(',', '.'); // comma-locale keypads (4.5)
  const w   = parseFloat(raw);
  if (state.exerciseType === 'timed' || raw === '' || isNaN(w) || w <= 0) {
    el.classList.add('hidden');
    return;
  }
  const unit  = getWeightUnit();
  const other = unit === 'kg' ? 'lbs' : 'kg';
  el.textContent = `${w} ${unit} = ${convertWeight(w, unit, other)} ${other}`;
  el.classList.remove('hidden');
}

// ── Exercise navigation (F-05) ────────────────────────

// The single owned transition for the active exercise (Story 3.1): the ONLY
// place that mutates state.exercise / state.exerciseType / state.setNumber.
// setNumber is always recomputed from the DB, so it can't drift from reality.
// - type: pass explicitly to bypass getExerciseType (custom "Other" exercises);
//   null derives it from the EXERCISES list.
// - render: false is for bookkeeping callers (set logged / deleted) that manage
//   their own re-render and must not steal focus (quick-log) — they only need
//   the state resync.
export function setActiveExercise(name, type = null, { render = true } = {}) {
  state.exercise     = name;
  state.exerciseType = type ?? getExerciseType(name);
  state.setNumber    = dbGetSetCountForExercise(state.sessionId, name) + 1;
  if (render) {
    renderActive();
    focusInputUnlessHero();
    resetInactivityTimer();
  }
}

// Returns the exercise that follows the current one in last session's logged order,
// or null if there is no prior session, the current exercise wasn't in it, or it was last.
export function computeUpNext(exercise) {
  // Prefer plan order over history order when a plan is linked to this session
  const plan = state.sessionId ? dbGetSessionPlan(state.sessionId) : null;
  if (plan?.exercises?.length) {
    const planNames = plan.exercises.map(e => e.exercise);
    const loggedSet = new Set(
      dbGetAllSets(state.sessionId).map(s => s.exercise)
    );
    // Find first plan exercise not yet started (excluding current)
    const next = planNames.find(n => n !== exercise && !loggedSet.has(n));
    if (next) return next;
    // All plan exercises done — no Up Next hint
    return null;
  }
  // No plan — fall back to last-session order
  const order = dbGetLastSessionExerciseOrder();
  const idx   = order.indexOf(exercise);
  if (idx === -1 || idx === order.length - 1) return null;
  return order[idx + 1];
}

function renderUpNext() {
  const el   = document.getElementById('up-next-hint');
  const next = computeUpNext(state.exercise);
  if (!next) {
    el.classList.add('hidden');
  } else {
    document.getElementById('up-next-name').textContent = next;
    el.classList.remove('hidden');
  }
}

// ── Session lifecycle ─────────────────────────────────

// Starts a fresh session with no prior active session check — called only after
// the user has already confirmed any discard prompt.
// Creates the session. Options (5.3 / 5.8):
// - exercise/type: explicit starting exercise from the start picker (type for
//   custom "Other" names, same contract as setActiveExercise).
// - dayId: explicit plan day from the idle day chooser, overriding rotation.
// With an active plan and no explicit exercise, starts on the plan day's
// first exercise. Plan-less sessions always arrive WITH an exercise (start
// picker). Empty plan day is routed by beginSessionFlow → openPickerForStart
// before create. If we still have no exercise (legacy/direct call), open the
// session picker rather than landing on EXERCISES[0].
export function _doStartSession({ exercise = null, type = null, dayId = null } = {}) {
  document.getElementById('btn-resume-idle').classList.add('hidden');
  _resetQuickLogConfirm();

  state.sessionId = dbCreateSession(getWeightUnit());

  // Link session to active plan if one exists, landing on the chosen day or
  // the next in rotation (day after the last one trained, cycling).
  // dbGetSessionPlan day-scopes the exercises once linked.
  let startExercise = exercise;
  const activePlan  = dbGetActivePlan();
  if (activePlan) {
    const day = (dayId != null
      ? dbGetPlanDays(activePlan.plan_id).find(d => d.day_id === dayId)
      : null) ?? dbGetNextPlanDay(activePlan.plan_id);
    dbLinkSessionToPlan(state.sessionId, activePlan.plan_id, day?.day_id ?? null);
    if (!startExercise) {
      const planExs = dbGetSessionPlan(state.sessionId)?.exercises ?? [];
      if (planExs.length) startExercise = planExs[0].exercise;
    }
  }

  document.getElementById('session-notes').value = '';
  showScreen('active');
  const newSession = dbGetSession(state.sessionId);
  if (newSession) startSessionTimer(newSession.start_time);

  if (startExercise) {
    setActiveExercise(startExercise, type);
  } else {
    // 5.8: never invent EXERCISES[0] — force an explicit pick (session exists)
    openPicker();
    document.getElementById('modal-title').textContent = 'First Exercise';
  }
}

// Entry decision for a NEW session (5.3 / 5.8). With an active plan whose
// resolved day has exercises, the session starts immediately. Empty plan day
// (legacy / hand-edited) and plan-less both open the start picker first —
// session is only created once the picker choice lands in _doStartSession.
export function beginSessionFlow(dayId = null) {
  const activePlan = dbGetActivePlan();
  if (activePlan) {
    const allExs = dbGetPlanExercises(activePlan.plan_id);
    if (allExs.length) {
      const day = (dayId != null
        ? dbGetPlanDays(activePlan.plan_id).find(d => d.day_id === dayId)
        : null) ?? dbGetNextPlanDay(activePlan.plan_id);
      const resolvedDayId = day?.day_id ?? null;
      const dayExs = resolvedDayId != null
        ? allExs.filter(e => e.day_id === resolvedDayId)
        : allExs;
      if (dayExs.length) {
        _doStartSession({ dayId: resolvedDayId ?? dayId });
        return;
      }
      // Empty day — pick exercise first, then create linked to that day
      openPickerForStart(resolvedDayId);
      return;
    }
  }
  openPickerForStart();
}

// Entry point for "Start Workout". If an active session exists, shows a
// discard-confirmation modal; otherwise hands off to beginSessionFlow.
export function startSession() {
  const existing = dbGetActiveSession();
  if (existing) {
    document.getElementById('confirm-discard').classList.remove('hidden');
    return;
  }
  beginSessionFlow();
}

// Resumes an existing session (from idle screen or completed screen).
// Lands on the most recently logged set, else the plan-day first exercise.
// Zero-set plan-less resume (5.8): the chosen exercise was never persisted, so
// open the picker rather than inventing EXERCISES[0].
// Note: resumeLastWorkout() overrides with the exercise active at Finish time,
// which may differ from the last logged set.
export function resumeSession(session) {
  state.sessionId = session.session_id;
  _resetQuickLogConfirm();

  const sessionData = dbGetSession(session.session_id);
  document.getElementById('session-notes').value = sessionData?.notes ?? '';

  const lastSet = dbGetRecentSets(session.session_id, 1)[0];
  showScreen('active');
  if (sessionData) startSessionTimer(sessionData.start_time);

  let exercise = lastSet?.exercise ?? null;
  if (!exercise) {
    const planExs = dbGetSessionPlan(session.session_id)?.exercises ?? [];
    exercise = planExs[0]?.exercise ?? null;
  }
  if (exercise) {
    setActiveExercise(exercise);
  } else {
    // 5.8: no sets, no plan day — force an explicit pick
    openPicker();
    document.getElementById('modal-title').textContent = 'First Exercise';
  }
}

export function showFinishConfirm() {
  document.getElementById('confirm-finish').classList.remove('hidden');
}

// Used only by the confirmed-finish path (finishWorkout). Kept separate from
// cancelFinishConfirm to avoid triggering a re-render mid-finish.
function hideFinishConfirm() {
  document.getElementById('confirm-finish').classList.add('hidden');
}

// Used by the Cancel button and backdrop tap. Nothing can change the active
// exercise while the modal is open, so cancelling only needs to hide the modal
// and hand the user back to the exercise they were on.
export function cancelFinishConfirm() {
  hideFinishConfirm();
  setActiveExercise(state.exercise, state.exerciseType);
}

// ── Drive upload state ────────────────────────────────

// Uploads are chained so two quick finishes (finish → resume → finish) can't
// run concurrently against the shared token client and migration check in
// gdrive.js. The pending counter keeps the inline status honest when a second
// upload starts before the first resolves.
let _driveUploadChain    = Promise.resolve();

let _driveUploadsPending = 0;

// Sets the inline Drive status line on the completed screen. Pass null to hide.
// Inline rather than only a toast: a toast is gone in seconds, but the status
// should still be readable when the user unlocks their phone a minute later.
function _setDriveStatus(text, fail = false) {
  const el = document.getElementById('drive-status');
  if (text === null) { el.classList.add('hidden'); return; }
  el.textContent = text;
  el.classList.toggle('drive-status--fail', fail);
  el.classList.remove('hidden');
}

function _startDriveUpload(csv, sessionStartIso) {
  _driveUploadsPending++;
  _setDriveStatus('Saving to Drive…');
  _driveUploadChain = _driveUploadChain
    .then(() => gdriveUpload(csv, sessionStartIso))
    .then(() => {
      _driveUploadsPending--;
      if (_driveUploadsPending === 0) _setDriveStatus('Saved to Google Drive ✓');
    })
    .catch(() => {
      _driveUploadsPending--;
      _setDriveStatus('Drive save failed — CSV downloaded instead', true);
      triggerExport(); // preserve the local-CSV fallback
    });
}

// Ends the session, triggers Drive upload, and shows the completed screen.
export function finishWorkout() {
  hideFinishConfirm();
  hideInactivityModal();
  clearInactivityTimers();
  stopSessionTimer();
  stopRestTimer();
  saveNotesNow(); // Flush any unsaved notes (cancels pending debounce) before closing

  // state.exercise / state.exerciseType are deliberately left untouched here —
  // resumeLastWorkout() reads them to restore the exercise active at Finish time.

  const count   = dbGetSetCount(state.sessionId);
  dbFinishSession(state.sessionId);
  state.finishedAt = new Date();

  // Auto-save to Google Drive (non-blocking — failure falls back to local CSV download)
  const csv     = dbExportSessionCSV(state.sessionId);
  const session = dbGetSession(state.sessionId);
  if (csv && session) _startDriveUpload(csv, session.start_time);
  else _setDriveStatus(null); // nothing to upload — don't show a stale status

  document.getElementById('session-summary').textContent =
    `${count} set${count !== 1 ? 's' : ''} logged`;

  document.getElementById('btn-resume').classList.remove('hidden');
  document.getElementById('btn-ai-summary').classList.toggle('hidden', !getAnthropicKey());
  renderPlanAdherence(state.sessionId);
  showScreen('completed');

  const signal = computeSessionSignal(state.sessionId);
  renderSessionSignal(signal);
  document.getElementById('session-signal').classList.remove('hidden');
}

// Reopens the most recently finished session if it was completed within the last 60 minutes.
// Calls resumeSession() to restore DB state and notes, then overrides the exercise
// with the one that was active when Finish was tapped (which resumeSession's last-set
// lookup may not match if the user had switched exercise without logging a set).
export function resumeLastWorkout() {
  const elapsed = (new Date() - state.finishedAt) / 1000 / 60;
  if (elapsed >= 60) {
    // Resume window has expired — hide the button and bail
    document.getElementById('btn-resume').classList.add('hidden');
    return;
  }
  // state.exercise still holds the exercise active at Finish time (finishWorkout
  // leaves it untouched); capture it before resumeSession overwrites it from the
  // last logged set.
  const finishExercise = state.exercise;
  const finishType     = state.exerciseType;
  dbResumeSession(state.sessionId);
  resumeSession({ session_id: state.sessionId });
  if (finishExercise) setActiveExercise(finishExercise, finishType);
}

// ── Core actions ──────────────────────────────────────

// Reads the two input fields and logs a set for the current exercise.
// Validation and DB insertion branch on exerciseType:
//   'timed' — duration required, calories optional
//   'reps'  — both weight and reps required, must be positive numbers
export function logSet() {
  // Comma → dot: iOS decimal keypads emit the locale separator, and
  // parseFloat('62,5') would silently truncate to 62.
  const field1 = document.getElementById('input-weight').value.trim().replace(',', '.');
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
      dbInsertSet(state.sessionId, state.exercise, state.setNumber, null, null, duration, calories, getWeightUnit());
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

    // PR check must run BEFORE the insert so the new set isn't its own baseline
    const unit     = getWeightUnit();
    const weightKg = unit === 'lbs' ? weight / 2.2046 : weight;
    const isPR     = isAllTimePR(state.exercise, state.sessionId, weightKg);

    clearError();
    try {
      dbInsertSet(state.sessionId, state.exercise, state.setNumber, weight, reps, null, null, unit);
    } catch (err) {
      showError('DB error: ' + err.message);
      focusInput();
      return;
    }

    if (isPR) {
      _afterSetLogged();
      // Override the rule-engine signal — an all-time PR outranks everything
      renderProgressionSignal(`All-time PR — ${weight} ${unit}`);
      celebratePR(weight, unit, state.exercise);
      return;
    }
  }

  _afterSetLogged();
}

// Shared post-insert flow for logSet and quickLogSet: progression signal,
// set number advance, re-render, log scroll. focus=false skips refocusing the
// weight input — quick-log must not pop the mobile keyboard, since avoiding
// typing is its entire purpose.
function _afterSetLogged(focus = true) {
  const signal = computeProgressionSignal(state.exercise, state.sessionId);
  // Resync setNumber from the DB (the set is already inserted, so this advances it)
  setActiveExercise(state.exercise, state.exerciseType, { render: false });
  clearInputs();
  renderActive();
  renderProgressionSignal(signal);
  document.querySelector('.sets-log').scrollTop = 0; // Scroll log back to top to show latest set
  if (focus) focusInput();
  // Auto-start the rest countdown after every logged set (4.6). Reps exercises
  // only — cardio blocks don't take 90s rests. Skip dismisses; logging the
  // next set restarts it (startRestTimer resets any running countdown).
  if (state.exerciseType !== 'timed') startRestTimer();
  resetInactivityTimer();
}

// ── PR celebration ────────────────────────────────────

const PR_DISMISS_MS = 2600; // overlay auto-dismisses; tap dismisses sooner

let _prDismissTimer = null;

// Short rising three-note fanfare (C5–E5–G5) via Web Audio — same pattern as
// the rest timer's beepAlert, so sound is already an established app behaviour.
function _prFanfare() {
  try {
    const ctx  = _getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [[523.25, 0], [659.25, 0.12], [783.99, 0.24]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.25);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.25);
    });
  } catch (e) { /* audio unavailable */ }
}

// Returns true when a just-entered weight is an all-time PR: beats the best of
// every completed session AND anything already logged this session (so a PR
// improved twice in one session celebrates both times). Requires prior
// completed-session history — a first-ever exercise has nothing to beat.
// Call BEFORE inserting the set, so the new set isn't compared against itself.
export function isAllTimePR(exercise, sessionId, weightKg) {
  const allTimeKg = dbGetAllTimeBestForExercise(exercise);
  if (allTimeKg == null) return false;
  if (weightKg <= allTimeKg + WEIGHT_EPSILON_KG) return false;
  const sessionBestKg = dbGetSessionBestForExercise(sessionId, exercise);
  return sessionBestKg == null || weightKg > sessionBestKg + WEIGHT_EPSILON_KG;
}

// Shows the PR overlay: card pop, confetti burst, haptic, fanfare.
// Auto-dismisses; never blocks logging. Exercise names are user text — the
// detail line is set via textContent.
function celebratePR(displayWeight, unit, exercise) {
  document.getElementById('pr-detail').textContent = `${displayWeight} ${unit} · ${exercise}`;

  const confetti = document.getElementById('pr-confetti');
  confetti.innerHTML = '';
  const colors = ['#c8ff57', '#f0f0f0', '#8fb63e'];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('span');
    piece.className = 'pr-confetti-piece';
    const angle = Math.random() * Math.PI * 2;
    const dist  = 90 + Math.random() * 140;
    piece.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    piece.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist) - 40}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 540 - 270)}deg`);
    piece.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
    piece.style.background = colors[i % colors.length];
    confetti.appendChild(piece);
  }

  document.getElementById('pr-celebration').classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
  _prFanfare();
  clearTimeout(_prDismissTimer);
  _prDismissTimer = setTimeout(dismissPRCelebration, PR_DISMISS_MS);
}

export function dismissPRCelebration() {
  clearTimeout(_prDismissTimer);
  _prDismissTimer = null;
  document.getElementById('pr-celebration').classList.add('hidden');
}

// ── Quick log (one-tap set) ───────────────────────────

const QUICK_LOG_CONFIRM_MS = 1200; // inline ✓ confirmation stays up this long
const QUICK_LOG_GUARD_MS   = 600;  // taps ignored this long after a log — absorbs "did that work?" re-taps

let _quickLogLoggedAt = 0;
let _quickLogConfirmTimer = null;

// Clears any pending ✓ confirmation + tap guard. Called on session start and
// resume so a stale window never carries into a new session.
function _resetQuickLogConfirm() {
  clearTimeout(_quickLogConfirmTimer);
  _quickLogConfirmTimer = null;
  _quickLogLoggedAt = 0;
  document.getElementById('btn-quick-log').classList.remove('quick-log-confirm');
}

// Returns the reference set the quick-log button would insert, or null.
// Preferred: the last completed session's set matching the current set number
// ("Same as last time" — the same reference the ghost-text placeholders show).
// Fallback: the most recent set logged for this exercise in the current session
// ("Repeat last set" — covers doing more sets than last session, and first-ever
// exercises from set 2 onward).
function computeQuickLogRef() {
  const lastSets = dbGetLastSessionSetsForExercise(state.exercise);
  const match    = lastSets.find(s => s.set_number === state.setNumber);
  if (match) return { set: match, label: 'Same as last time' };
  const current = dbGetLastSetForExercise(state.sessionId, state.exercise);
  if (current) return { set: current, label: 'Repeat last set' };
  return null;
}

// 5.6 prominence pass: with a reference available, quick-log is the hero
// (lime primary above the inputs) and Log Set demotes; the moment the user
// shows manual intent — an input focused or holding text — Log Set
// re-promotes and quick-log drops to its quiet state. Hierarchy follows
// intent. Both swaps are colour-only (no size change), so buttons never
// move under a finger mid-tap.
function _manualIntent() {
  const w  = document.getElementById('input-weight');
  const r  = document.getElementById('input-reps');
  const ae = document.activeElement;
  return ae === w || ae === r ||
    String(w.value).trim() !== '' || String(r.value).trim() !== '';
}

// Re-applies the hero/quiet + demoted classes from current state. Cheap and
// idempotent — wired to input focus/blur/input events as well as every
// renderQuickLog. Visibility (.hidden) is owned by renderQuickLog, not here.
export function updateLogEmphasis() {
  const quickBtn = document.getElementById('btn-quick-log');
  const logBtn   = document.getElementById('btn-log-set');
  const hero = !quickBtn.classList.contains('hidden') && !_manualIntent();
  quickBtn.classList.toggle('quick-log-quiet', !hero);
  logBtn.classList.toggle('btn-demoted', hero);
}

// Updates the quick-log button's visibility and label for the current
// exercise/set number. Weight is shown converted to the current display unit.
function renderQuickLog() {
  // Don't stomp the ✓ confirmation — _showQuickLogConfirm's timer repaints
  // when the window expires. Emphasis still resyncs (inputs were cleared by
  // _afterSetLogged, so the confirm window settles on the hero state).
  if (Date.now() - _quickLogLoggedAt < QUICK_LOG_CONFIRM_MS) { updateLogEmphasis(); return; }

  const btn = document.getElementById('btn-quick-log');
  btn.classList.remove('quick-log-confirm');
  const ref = computeQuickLogRef();
  if (!ref) { btn.classList.add('hidden'); updateLogEmphasis(); return; }

  const s = ref.set;
  let valueText;
  if (s.duration_mins != null) {
    valueText = fmtTimedSet(s);
  } else {
    const unit = getWeightUnit();
    valueText = `${setDisplayWeight(s, unit)} ${unit} × ${s.reps}`;
  }
  document.getElementById('quick-log-label').textContent = ref.label;
  document.getElementById('quick-log-value').textContent = valueText;
  btn.classList.remove('hidden');
  updateLogEmphasis();
}

// Swaps the button to "✓ Logged — {value}" with a background flash, reverting
// to the next reference after QUICK_LOG_CONFIRM_MS (renderQuickLog skips
// repaints while the confirmation is up, so renderActive can't stomp it).
function _showQuickLogConfirm(valueText) {
  const btn = document.getElementById('btn-quick-log');
  document.getElementById('quick-log-label').textContent = '✓ Logged';
  document.getElementById('quick-log-value').textContent = valueText;
  btn.classList.remove('quick-log-confirm');
  void btn.offsetWidth; // restart the flash animation on back-to-back sets
  btn.classList.add('quick-log-confirm');
  clearTimeout(_quickLogConfirmTimer);
  _quickLogConfirmTimer = setTimeout(() => {
    _quickLogLoggedAt = 0;
    renderQuickLog();
  }, QUICK_LOG_CONFIRM_MS);
  updateLogEmphasis();
}

// Logs the reference set in one tap. Weight is stored converted to the current
// unit (matching what the button displayed), so mixed-unit history stays exact.
export function quickLogSet() {
  // With no visible feedback users re-tapped thinking the first tap failed and
  // logged duplicate sets (5.2.x #1) — absorb re-taps inside the guard window.
  if (Date.now() - _quickLogLoggedAt < QUICK_LOG_GUARD_MS) return;

  const ref = computeQuickLogRef();
  if (!ref) return;

  const s = ref.set;
  clearError();
  let valueText;
  try {
    if (s.duration_mins != null) {
      dbInsertSet(state.sessionId, state.exercise, state.setNumber,
        null, null, s.duration_mins, s.calories ?? null, getWeightUnit());
      valueText = fmtTimedSet(s);
    } else {
      const unit = getWeightUnit();
      const weight = setDisplayWeight(s, unit);
      dbInsertSet(state.sessionId, state.exercise, state.setNumber,
        weight, s.reps, null, null, unit);
      valueText = `${weight} ${unit} × ${s.reps}`;
    }
  } catch (err) {
    showError('DB error: ' + err.message);
    return;
  }
  _quickLogLoggedAt = Date.now(); // before _afterSetLogged so its re-render keeps the confirmation
  _showQuickLogConfirm(valueText);
  if (navigator.vibrate) navigator.vibrate(30);
  _afterSetLogged(false); // no refocus — keep the keyboard down
}

// Deletes the most recently logged set of the CURRENT exercise — never the
// session-global last set, which may belong to an exercise logged later and
// no longer on screen (4.2 / review #C5).
// If no sets exist for the current exercise, opens the exercise picker instead —
// this lets the user recover from selecting the wrong exercise without losing session data.
export function undoSet() {
  if (dbGetSetCountForExercise(state.sessionId, state.exercise) === 0) {
    openPicker();
    return;
  }

  const deleted = dbDeleteLastSet(state.sessionId, state.exercise);
  if (!deleted) {
    showError('Nothing to undo');
    setTimeout(clearError, 1500);
    return;
  }

  // Resync setNumber from the DB (always the current exercise's set now)
  setActiveExercise(state.exercise, state.exerciseType, { render: false });

  renderActive();
  focusInputUnlessHero();
  resetInactivityTimer();
}

// ── Exercise picker ───────────────────────────────────

// Exports the current session CSV (completed screen button).
export function triggerExport() {
  const csv = state.sessionId ? dbExportSessionCSV(state.sessionId) : dbExportCSV();
  if (!csv) { alert('No data to export.'); return; }
  downloadCSV(csv, `gymops-${localDateStr()}.csv`);
}
