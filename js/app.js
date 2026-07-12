// ═══════════════════════════════════════════════════════
// GymOps — App logic
// ═══════════════════════════════════════════════════════

const APP_VERSION = 'v3.5';

// ── Weight unit preference ────────────────────────────
// Stored in localStorage as 'kg' or 'lbs'. Each set also stores its unit at log time
// so historical PREV display converts correctly when the user switches units.
const UNIT_KEY = 'gymops_weight_unit';
function getWeightUnit() { return localStorage.getItem(UNIT_KEY) ?? 'kg'; }

// Converts a weight value between units, rounded to 1 decimal. Returns the value
// unchanged when fromUnit === toUnit or weight is null.
function convertWeight(weight, fromUnit, toUnit) {
  if (weight == null || fromUnit === toUnit) return weight;
  const converted = fromUnit === 'lbs' ? weight / 2.2046 : weight * 2.2046;
  return Math.round(converted * 10) / 10;
}

function setWeightUnit(u) {
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
function getAnthropicKey() { return localStorage.getItem(ANTHROPIC_KEY) ?? ''; }
function setAnthropicKey(k) {
  if (k) localStorage.setItem(ANTHROPIC_KEY, k);
  else localStorage.removeItem(ANTHROPIC_KEY);
}

const REMINDER_KEY          = 'gymops_reminder_enabled';
const REMINDER_DISMISSED_AT = 'gymops_reminder_dismissed_at';
const REMINDER_DISMISSALS   = 'gymops_reminder_dismissals';
const REMINDER_OFFSET_MIN   = 'gymops_reminder_offset_min';

const REMINDER_WINDOW_MIN   = 90;  // ± minutes around predicted time to show banner
const REMINDER_OVERDUE_MIN  = 180; // minutes past predicted time before giving up
const REMINDER_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24h between banners
const REMINDER_MIN_SESSIONS = 4;   // minimum sessions before pattern detection activates
const REMINDER_MAX_STDDEV   = 240; // max std dev (mins) — beyond this, pattern is too irregular

function getReminderEnabled() { return localStorage.getItem(REMINDER_KEY) === 'true'; }
function setReminderEnabled(v) {
  localStorage.setItem(REMINDER_KEY, v ? 'true' : 'false');
  document.querySelectorAll('.reminder-btn').forEach(btn => {
    btn.classList.toggle('unit-btn--active', btn.dataset.reminder === String(v));
  });
  checkIdleBanners(); // re-evaluate: hides the reminder when disabled, may show it when enabled
}

// Returns { meanMinutes, stdDevMinutes } from ISO start_time strings, or null if
// the pattern is too irregular (std dev > REMINDER_MAX_STDDEV).
function computeTrainingWindow(startTimes) {
  const minutes = startTimes.map(t => {
    const d = new Date(t);
    return d.getHours() * 60 + d.getMinutes();
  });
  const mean    = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const stdDev  = Math.sqrt(minutes.reduce((s, m) => s + (m - mean) ** 2, 0) / minutes.length);
  if (stdDev > REMINDER_MAX_STDDEV) return null;
  return { meanMinutes: mean, stdDevMinutes: stdDev };
}

function hideReminderBanner() {
  document.getElementById('reminder-banner').classList.add('hidden');
}

function dismissReminderBanner() {
  hideReminderBanner();
  localStorage.setItem(REMINDER_DISMISSED_AT, Date.now().toString());
  const dismissals = parseInt(localStorage.getItem(REMINDER_DISMISSALS) ?? '0') + 1;
  localStorage.setItem(REMINDER_DISMISSALS, dismissals.toString());
  // After every 3 dismissals, shift the predicted time forward by 30 minutes
  if (dismissals % 3 === 0) {
    const offset = parseInt(localStorage.getItem(REMINDER_OFFSET_MIN) ?? '0');
    localStorage.setItem(REMINDER_OFFSET_MIN, (offset + 30).toString());
  }
}

// Decides whether the generic session reminder (F-04) should show.
// Returns a render thunk that fills in the banner text, or null.
// Priority against the plan banners is handled by IDLE_BANNERS order, not here.
function computeReminderBanner() {
  if (!getReminderEnabled()) return null;

  const startTimes = dbGetRecentSessionStartTimes(10);
  if (startTimes.length < REMINDER_MIN_SESSIONS) return null;
  if (dbHasSessionToday()) return null;

  const lastDismissed = parseInt(localStorage.getItem(REMINDER_DISMISSED_AT) ?? '0');
  if (Date.now() - lastDismissed < REMINDER_COOLDOWN_MS) return null;

  const window = computeTrainingWindow(startTimes);
  if (!window) return null;

  const now            = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const offset         = parseInt(localStorage.getItem(REMINDER_OFFSET_MIN) ?? '0');
  const targetMinutes  = window.meanMinutes + offset;
  const diff           = currentMinutes - targetMinutes;

  if (diff < -REMINDER_WINDOW_MIN || diff > REMINDER_OVERDUE_MIN) return null;
  const overdue = diff > REMINDER_WINDOW_MIN;
  return () => {
    document.getElementById('reminder-text').textContent = overdue
      ? "Haven't trained yet today"
      : 'Time to train';
  };
}

// ── Idle banners (mediator) ───────────────────────────

// The idle screen shows at most ONE banner at a time. Entries are in priority
// order: the first compute() that returns a render thunk wins; every other
// banner is hidden. To add a banner, add an entry at the right priority —
// no cross-banner visibility checks needed.
const IDLE_BANNERS = [
  { id: 'plan-expiry-banner', compute: computePlanExpiryBanner },
  { id: 'plan-nudge-banner',  compute: computePlanNudgeBanner  },
  { id: 'reminder-banner',    compute: computeReminderBanner   },
];

// Evaluates all idle banners in priority order. Called on every idle screen
// visit and whenever a setting changes banner eligibility.
function checkIdleBanners() {
  let winner = null;
  for (const banner of IDLE_BANNERS) {
    document.getElementById(banner.id).classList.add('hidden');
    if (!winner) {
      const render = banner.compute();
      if (render) winner = { id: banner.id, render };
    }
  }
  if (winner) {
    winner.render();
    document.getElementById(winner.id).classList.remove('hidden');
  }
}

// ── Progression signal ────────────────────────────────

const WEIGHT_EPSILON_KG = 0.05; // ~100 g tolerance — avoids float noise in "matched" checks
const SIGNAL_GAP_DAYS   = 3;    // gap threshold for "Back after a few days"

// Deterministic rule engine — returns a signal string or null.
// Priority order: P1 (long-term) > P2 (session best) > P3 (last session) > P4 (negative).
// Same inputs always produce the same output (no randomness, no side effects).
function computeProgressionSignal(exercise, sessionId) {
  if (getExerciseType(exercise) === 'timed') return null;

  const currentBestKg = dbGetSessionBestForExercise(sessionId, exercise);
  if (currentBestKg == null) return null;

  const history = dbGetRecentSessionsBestForExercise(exercise, 6); // newest first
  if (!history.length) return null; // first-ever session for this exercise

  const prevBestKg  = history[0].best_weight_kg;
  const currentUnit = getWeightUnit();

  // P1 — 3 sessions improving: previous 2 completed sessions + current all strictly up
  if (history.length >= 2) {
    const [h0, h1] = history;
    if (h1.best_weight_kg < h0.best_weight_kg - WEIGHT_EPSILON_KG &&
        currentBestKg    > h0.best_weight_kg + WEIGHT_EPSILON_KG) {
      return '3 sessions improving';
    }
  }

  // P1 — Best in 2 weeks: current beats every completed session in the last 14 days
  const twoWeeksAgo  = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentBests  = history.filter(h => h.start_time >= twoWeeksAgo);
  if (recentBests.length > 0) {
    const maxRecentKg = Math.max(...recentBests.map(h => h.best_weight_kg));
    if (currentBestKg > maxRecentKg + WEIGHT_EPSILON_KG) {
      return 'Best in 2 weeks';
    }
  }

  // P2 — New session high: current beats most recent completed session
  if (currentBestKg > prevBestKg + WEIGHT_EPSILON_KG) {
    const deltaKg    = currentBestKg - prevBestKg;
    const delta      = currentUnit === 'lbs'
      ? Math.round(deltaKg * 2.2046)
      : Math.round(deltaKg * 10) / 10;
    return `+${delta} ${currentUnit} — new session high`;
  }

  // P3 — Time gap: returning after 3+ days away
  const daysSince = (Date.now() - new Date(history[0].start_time).getTime()) / 86400000;
  if (daysSince >= SIGNAL_GAP_DAYS) return 'Back after a few days';

  // P3 — Back on track: most recent session was a dip, current session recovers
  if (history.length >= 2) {
    const prev2BestKg = history[1].best_weight_kg;
    if (prevBestKg  < prev2BestKg - WEIGHT_EPSILON_KG &&
        currentBestKg >= prevBestKg - WEIGHT_EPSILON_KG) {
      return 'Back on track';
    }
  }

  // P3 — Matched previous best
  if (Math.abs(currentBestKg - prevBestKg) <= WEIGHT_EPSILON_KG) {
    return 'Matched previous best';
  }

  // P4 — Negative (only fires when nothing positive applies)
  if (currentBestKg < prevBestKg - WEIGHT_EPSILON_KG) {
    return 'Slight drop from last session';
  }

  return null;
}

function renderProgressionSignal(signal) {
  const el = document.getElementById('progression-signal');
  if (!signal) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.textContent = signal;
    el.classList.remove('hidden');
  }
}

// ── Session completion signal ──────────────────────────

// Deterministic interpretation line derived from session stats.
function _sessionInterpretation({ daysSincePrev, volumeDeltaRatio, improvementCount, bestDeltaKg }) {
  if (daysSincePrev === null) return 'Great start — baseline set';
  if (daysSincePrev >= SIGNAL_GAP_DAYS) return 'Good return after a few days off';
  if (bestDeltaKg > WEIGHT_EPSILON_KG) {
    if (improvementCount >= 2) return 'Building momentum';
    if (volumeDeltaRatio !== null && volumeDeltaRatio > 0.05) return 'Strong session';
    return 'Solid progression today';
  }
  if (volumeDeltaRatio !== null && volumeDeltaRatio > 0.05) return 'Consistent work this week';
  if (volumeDeltaRatio !== null && Math.abs(volumeDeltaRatio) <= 0.1) return 'Consistent with last session';
  return 'Keep building';
}

// Aggregates session stats and returns the 3–4 closure signal lines.
// Must be called after dbFinishSession() so the current session is 'completed'.
// Uses beforeSessionId to exclude the current session from historical queries.
function computeSessionSignal(sessionId) {
  const currentExerciseCount = dbGetSessionExerciseCount(sessionId);
  const currentVolumeKg      = dbGetSessionVolume(sessionId);
  const prevSession          = dbGetPreviousCompletedSession(sessionId);

  if (!prevSession) {
    return {
      exerciseLine:    `${currentExerciseCount} exercise${currentExerciseCount !== 1 ? 's' : ''} logged`,
      volumeLine:      null,
      improvementLine: null,
      interpretation:  'Great start — baseline set',
    };
  }

  const prevExerciseCount = dbGetSessionExerciseCount(prevSession.session_id);
  const prevVolumeKg      = dbGetSessionVolume(prevSession.session_id);
  const daysSincePrev     = (Date.now() - new Date(prevSession.start_time).getTime()) / 86400000;

  // Exercise completion line
  let exerciseLine;
  if (currentExerciseCount >= prevExerciseCount) {
    exerciseLine = `${currentExerciseCount} exercise${currentExerciseCount !== 1 ? 's' : ''} logged`;
  } else {
    const skipped = prevExerciseCount - currentExerciseCount;
    exerciseLine = `${currentExerciseCount} of ${prevExerciseCount} exercises — ${skipped} skipped`;
  }

  // Volume delta line
  let volumeLine      = null;
  let volumeDeltaRatio = null;
  if (prevVolumeKg > 0 && currentVolumeKg > 0) {
    volumeDeltaRatio = (currentVolumeKg - prevVolumeKg) / prevVolumeKg;
    if (volumeDeltaRatio > 0.05)       volumeLine = 'Total volume up from last session';
    else if (volumeDeltaRatio < -0.05) volumeLine = 'Volume slightly down from last session';
    else                               volumeLine = 'Volume matched last session';
  }

  // Best improvement across all reps exercises (vs most recent session each was performed)
  const exercises      = dbGetSessionRepsExercises(sessionId);
  let bestDeltaKg      = 0;
  let bestExercise     = null;
  let improvementCount = 0;
  const currentUnit    = getWeightUnit();

  exercises.forEach(exercise => {
    const currentBestKg = dbGetSessionBestForExercise(sessionId, exercise);
    const history       = dbGetRecentSessionsBestForExercise(exercise, 1, sessionId);
    if (!history.length || currentBestKg == null) return;
    const delta = currentBestKg - history[0].best_weight_kg;
    if (delta > WEIGHT_EPSILON_KG) {
      improvementCount++;
      if (delta > bestDeltaKg) { bestDeltaKg = delta; bestExercise = exercise; }
    }
  });

  let improvementLine = null;
  if (bestExercise !== null) {
    const displayDelta = currentUnit === 'lbs'
      ? Math.round(bestDeltaKg * 2.2046)
      : Math.round(bestDeltaKg * 10) / 10;
    improvementLine = `Best set: ${bestExercise} +${displayDelta} ${currentUnit}`;
  }

  return {
    exerciseLine,
    volumeLine,
    improvementLine,
    interpretation: _sessionInterpretation({ daysSincePrev, volumeDeltaRatio, improvementCount, bestDeltaKg }),
  };
}

function renderSessionSignal(signal) {
  document.getElementById('signal-exercises').textContent      = signal.exerciseLine;
  const volEl = document.getElementById('signal-volume');
  if (signal.volumeLine) {
    volEl.textContent = signal.volumeLine;
    volEl.classList.remove('hidden');
  } else {
    volEl.classList.add('hidden');
  }
  const impEl = document.getElementById('signal-improvement');
  if (signal.improvementLine) {
    impEl.textContent = signal.improvementLine;
    impEl.classList.remove('hidden');
  } else {
    impEl.classList.add('hidden');
  }
  document.getElementById('signal-interpretation').textContent = signal.interpretation;
}

function dismissSessionSignal() {
  document.getElementById('session-signal').classList.add('hidden');
}

// Master exercise list. Each entry has a name and type:
//   'reps'  — logs weight + reps
//   'timed' — logs duration_mins + optional calories
// Cardio keywords — free-text names containing any of these (case-insensitive)
// are auto-detected as timed exercises in the "Other" flow.
const CARDIO_KEYWORDS = ['treadmill', 'bike', 'rower', 'elliptical', 'stairmaster'];

// Custom exercise names (entered via "Other") are stored as-is.
// Type is either auto-detected via CARDIO_KEYWORDS or chosen via the Strength/Cardio prompt.
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

let _restTimer   = null;
let _restEndTime = null; // wall-clock timestamp when rest period ends

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
  _restEndTime = null;
  document.getElementById('rest-bar').classList.add('hidden');
}

function _tickRest() {
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

function startRestTimer() {
  stopRestTimer();
  _restEndTime = Date.now() + REST_SECS * 1000;
  document.getElementById('rest-bar').classList.remove('hidden');
  _tickRest();
  _restTimer = setInterval(_tickRest, 1000);
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
      const displayWeight  = convertWeight(reference.weight, reference.unit || 'lbs', unit);
      weightEl.placeholder = String(displayWeight);
      repsEl.placeholder   = String(reference.reps);
    } else {
      weightEl.placeholder = unit;
      repsEl.placeholder   = 'reps';
    }
  }
}

// ── Screen routing ────────────────────────────────────

// Shows a named screen (idle / active / completed / settings) and hides all others.
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  // Banner hierarchy on idle: expiry > plan nudge > generic reminder —
  // Banner priority (expiry > nudge > reminder) is owned by the IDLE_BANNERS mediator
  if (name === 'idle') { renderIdleDashboard(); checkIdleBanners(); }
  if (name === 'plans') renderPlansScreen();
  if (name === 'history') renderHistoryScreen();
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

  const currentUnit = getWeightUnit();
  const parts = sets.map(s => {
    if (s.duration_mins != null) {
      return s.calories != null
        ? `${s.duration_mins} min · ${s.calories} cal`
        : `${s.duration_mins} min`;
    }
    const displayWeight = convertWeight(s.weight, s.unit || 'lbs', currentUnit);
    return `${displayWeight} ${currentUnit}×${s.reps}`;
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
  renderQuickLog();
  renderProgressionSignal(null); // clear any stale signal on exercise change / undo
  renderUpNext();
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
      details = `Set ${s.set_number} · ${s.weight} ${s.unit || 'lbs'} × ${s.reps}`;
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

// ── Exercise navigation (F-05) ────────────────────────

// Switches to a named exercise without opening the picker.
// type is optional — callers that know the type (e.g. applyOtherExercise) pass it
// explicitly; otherwise getExerciseType is used (covers all EXERCISES array entries).
function switchExercise(name, type = null) {
  state.exercise     = name;
  state.exerciseType = type ?? getExerciseType(name);
  state.setNumber    = dbGetSetCountForExercise(state.sessionId, name) + 1;
  renderActive();
  focusInput();
  resetInactivityTimer();
}

// Returns the exercise that follows the current one in last session's logged order,
// or null if there is no prior session, the current exercise wasn't in it, or it was last.
function computeUpNext(exercise) {
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
function _doStartSession() {
  document.getElementById('btn-resume-idle').classList.add('hidden');

  state.sessionId    = dbCreateSession(getWeightUnit());
  state.exercise     = EXERCISES[0].name;
  state.exerciseType = EXERCISES[0].type;
  state.setNumber    = 1;

  // Link session to active plan if one exists; use plan's first exercise as starting point
  const activePlan = dbGetActivePlan();
  if (activePlan) {
    dbLinkSessionToPlan(state.sessionId, activePlan.plan_id);
    const planExs = dbGetPlanExercises(activePlan.plan_id);
    if (planExs.length) {
      state.exercise     = planExs[0].exercise;
      state.exerciseType = getExerciseType(planExs[0].exercise);
    }
  }

  document.getElementById('session-notes').value = '';
  showScreen('active');
  renderActive();
  focusInput();
  resetInactivityTimer();
  const newSession = dbGetSession(state.sessionId);
  if (newSession) startSessionTimer(newSession.start_time);
}

// Entry point for "Start Workout". If an active session exists, shows a
// discard-confirmation modal; otherwise starts immediately.
function startSession() {
  const existing = dbGetActiveSession();
  if (existing) {
    document.getElementById('confirm-discard').classList.remove('hidden');
    return;
  }
  _doStartSession();
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
  state.setNumber += 1;
  clearInputs();
  renderActive();
  renderProgressionSignal(signal);
  document.querySelector('.sets-log').scrollTop = 0; // Scroll log back to top to show latest set
  if (focus) focusInput();
  resetInactivityTimer();
}

// ── PR celebration ────────────────────────────────────

const PR_DISMISS_MS = 2600; // overlay auto-dismisses; tap dismisses sooner

let _prDismissTimer = null;

// Short rising three-note fanfare (C5–E5–G5) via Web Audio — same pattern as
// the rest timer's beepAlert, so sound is already an established app behaviour.
function _prFanfare() {
  try {
    const ctx  = new AudioContext();
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
function isAllTimePR(exercise, sessionId, weightKg) {
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

function dismissPRCelebration() {
  clearTimeout(_prDismissTimer);
  _prDismissTimer = null;
  document.getElementById('pr-celebration').classList.add('hidden');
}

// ── Quick log (one-tap set) ───────────────────────────

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

// Updates the quick-log button's visibility and label for the current
// exercise/set number. Weight is shown converted to the current display unit.
function renderQuickLog() {
  const btn = document.getElementById('btn-quick-log');
  const ref = computeQuickLogRef();
  if (!ref) { btn.classList.add('hidden'); return; }

  const s = ref.set;
  let valueText;
  if (s.duration_mins != null) {
    valueText = s.calories != null
      ? `${s.duration_mins} min · ${s.calories} cal`
      : `${s.duration_mins} min`;
  } else {
    const unit = getWeightUnit();
    valueText = `${convertWeight(s.weight, s.unit || 'lbs', unit)} ${unit} × ${s.reps}`;
  }
  document.getElementById('quick-log-label').textContent = ref.label;
  document.getElementById('quick-log-value').textContent = valueText;
  btn.classList.remove('hidden');
}

// Logs the reference set in one tap. Weight is stored converted to the current
// unit (matching what the button displayed), so mixed-unit history stays exact.
function quickLogSet() {
  const ref = computeQuickLogRef();
  if (!ref) return;

  const s = ref.set;
  clearError();
  try {
    if (s.duration_mins != null) {
      dbInsertSet(state.sessionId, state.exercise, state.setNumber,
        null, null, s.duration_mins, s.calories ?? null, getWeightUnit());
    } else {
      const unit = getWeightUnit();
      dbInsertSet(state.sessionId, state.exercise, state.setNumber,
        convertWeight(s.weight, s.unit || 'lbs', unit), s.reps, null, null, unit);
    }
  } catch (err) {
    showError('DB error: ' + err.message);
    return;
  }
  _afterSetLogged(false); // no refocus — keep the keyboard down
}

// Deletes the most recently logged set for the session.
// If no sets exist for the current exercise, opens the exercise picker instead —
// this lets the user recover from selecting the wrong exercise without losing session data.
function undoSet() {
  if (dbGetSetCountForExercise(state.sessionId, state.exercise) === 0) {
    openPicker();
    return;
  }

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
      li.innerHTML = `<span>${ex.name}</span><span class="picker-target-hint">${targetHint}</span>`;
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
      switchExercise(ex.name);
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
function openPicker() {
  _refreshRecencyRanks();
  _renderExerciseList();
  document.getElementById('exercise-picker').classList.remove('hidden');
}

// Resets the picker to its default state (list visible, name-entry hidden).
function closePicker() {
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

// Applies a confirmed custom exercise name with a resolved type, then closes the picker.
function applyOtherExercise(name, type) {
  const ctx = _pickerContext; // save before closePicker() resets it
  closePicker();
  if (ctx === 'plan') {
    addExerciseToPlan(name, type);
  } else {
    switchExercise(name, type);
  }
}

// Validates the free-text name entered via "Other".
// Auto-detects cardio by keyword match; otherwise shows the Strength/Cardio prompt.
function confirmOtherName() {
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

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Exports the current session CSV (completed screen button).
function triggerExport() {
  const csv = state.sessionId ? dbExportSessionCSV(state.sessionId) : dbExportCSV();
  if (!csv) { alert('No data to export.'); return; }
  downloadCSV(csv, `gymops-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Opens the date-range export modal with sensible defaults (last 30 days → today).
function openExportRangeModal() {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 30);
  const fmt = d => d.toISOString().slice(0, 10);
  document.getElementById('export-from').value = fmt(from);
  document.getElementById('export-to').value   = fmt(today);
  document.getElementById('export-range').classList.remove('hidden');
}

// ── Plans ─────────────────────────────────────────────

// Plan adherence: compares plan exercises to what was actually logged.
function renderPlanAdherence(sessionId) {
  const el   = document.getElementById('plan-adherence');
  const plan = dbGetSessionPlan(sessionId);
  if (!plan?.exercises?.length) { el.classList.add('hidden'); return; }

  const loggedNames = new Set(dbGetAllSets(sessionId).map(s => s.exercise));
  const total       = plan.exercises.length;
  const done        = plan.exercises.filter(e => loggedNames.has(e.exercise)).length;
  const skipped     = plan.exercises.filter(e => !loggedNames.has(e.exercise)).map(e => e.exercise);

  let text = `${plan.name}: ${done}/${total} exercises`;
  if (skipped.length) text += ` · skipped ${skipped.join(', ')}`;
  el.textContent = text;
  el.classList.remove('hidden');
}

// Plan expiry banner — fires when the active plan has run over its duration.
// Returns a render thunk or null (visibility is the mediator's job).
function computePlanExpiryBanner() {
  const plan = dbGetActivePlan();
  if (!plan || !plan.duration_weeks) return null;

  const endMs    = new Date(plan.start_date).getTime() + plan.duration_weeks * 7 * 24 * 60 * 60 * 1000;
  const daysOver = Math.floor((Date.now() - endMs) / (24 * 60 * 60 * 1000));
  if (daysOver < 0) return null;

  const daysStr = daysOver === 0 ? 'today' : `${daysOver} day${daysOver !== 1 ? 's' : ''} ago`;
  return () => {
    document.getElementById('plan-expiry-text').textContent =
      `"${plan.name}" ended ${daysStr} — time to review.`;
  };
}

// ── Plan nudges ───────────────────────────────────────

const PLAN_NUDGE_DISMISSED_AT = 'gymops_plan_nudge_dismissed_at';
const PLAN_NUDGE_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // matches F-04 reminder cooldown

function hidePlanNudge() {
  document.getElementById('plan-nudge-banner').classList.add('hidden');
}

function dismissPlanNudge() {
  hidePlanNudge();
  localStorage.setItem(PLAN_NUDGE_DISMISSED_AT, Date.now().toString());
}

// Returns the nudge message for the active plan, or null. Deterministic rules,
// priority order:
//   1. Week pace (needs target_sessions_per_week): fires when the days left in
//      the week get tight for the sessions still needed — remaining sessions
//      ≥ days left including today.
//   2. Gap (any active plan): SIGNAL_GAP_DAYS+ days since the last session.
// Never fires if there's a completed session today.
function computePlanNudge() {
  const plan = dbGetActivePlan();
  if (!plan) return null;
  if (dbHasSessionToday()) return null;

  // Expired plans are the expiry banner's job, not a nudge
  if (plan.duration_weeks) {
    const endMs = new Date(plan.start_date).getTime() + plan.duration_weeks * 7 * 86400000;
    if (Date.now() >= endMs) return null;
  }

  // Rule 1 — week pace
  if (plan.target_sessions_per_week) {
    const thisWeek  = _weekStart(new Date());
    const done      = dbGetCompletedSessionsSince(thisWeek.toISOString()).length;
    const remaining = plan.target_sessions_per_week - done;
    const daysLeft  = 7 - ((new Date().getDay() + 6) % 7); // incl. today (Mon=7 … Sun=1)
    if (remaining > 0 && remaining >= daysLeft - 1) {
      return `${done} of ${plan.target_sessions_per_week} sessions this week — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
    }
  }

  // Rule 2 — idle gap while a plan is active
  const last = dbGetLastCompletedSession();
  if (last) {
    const daysSince = Math.floor((Date.now() - new Date(last.start_time).getTime()) / 86400000);
    if (daysSince >= SIGNAL_GAP_DAYS) {
      return `No training in ${daysSince} days — ${plan.name} is waiting`;
    }
  }

  return null;
}

// Plan nudge banner — cooldown gate plus the computePlanNudge() rules.
// Returns a render thunk or null. The expiry banner outranks this via
// IDLE_BANNERS order — no cross-check needed here.
function computePlanNudgeBanner() {
  const lastDismissed = parseInt(localStorage.getItem(PLAN_NUDGE_DISMISSED_AT) ?? '0');
  if (Date.now() - lastDismissed < PLAN_NUDGE_COOLDOWN_MS) return null;

  const message = computePlanNudge();
  if (!message) return null;
  return () => {
    document.getElementById('plan-nudge-text').textContent = message; // plan names are user text
  };
}

// ── Plans screen ──────────────────────────────────────

function renderPlansScreen() {
  const active   = dbGetActivePlan();
  const cardEl   = document.getElementById('active-plan-card');
  const pastEl   = document.getElementById('past-plans-list');
  const allPlans = dbGetAllPlans();
  const past     = allPlans.filter(p => p.status !== 'active');

  if (active) {
    const exs        = dbGetPlanExercises(active.plan_id);
    const startDate  = new Date(active.start_date);
    const weekNum    = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    let durationStr = active.duration_weeks
      ? `Week ${weekNum} of ${active.duration_weeks}`
      : `Started ${startDate.toLocaleDateString()}`;
    if (active.target_sessions_per_week) durationStr += ` · ${active.target_sessions_per_week}×/week`;
    const objectives = active.objectives_json ? JSON.parse(active.objectives_json) : [];

    cardEl.innerHTML = `
      <div class="plan-card-header">
        <div>
          <p class="plan-card-name">${active.name}</p>
          <p class="plan-card-meta">${durationStr}</p>
        </div>
        <button class="btn-text plan-card-edit" data-plan-id="${active.plan_id}">Edit</button>
      </div>
      ${objectives.length ? `<ul class="plan-objectives-list">${objectives.map(o => `<li>${o}</li>`).join('')}</ul>` : ''}
      <p class="plan-exercises-preview">${exs.map(e => {
        const t = (e.target_sets && e.target_reps) ? ` ${e.target_sets}×${e.target_reps}` : '';
        return `${e.exercise}${t}`;
      }).join(' · ')}</p>
    `;
    cardEl.classList.remove('hidden');
    cardEl.querySelector('.plan-card-edit').addEventListener('click', () => openEditPlan(active.plan_id));
  } else {
    cardEl.innerHTML = '<p class="plan-card-empty">No active plan. Create one to guide your sessions.</p>';
    cardEl.classList.remove('hidden');
  }

  pastEl.innerHTML = '';
  if (past.length) {
    const header = document.createElement('p');
    header.className = 'settings-label';
    header.style.marginTop = '24px';
    header.textContent = 'Past Plans';
    pastEl.appendChild(header);
    past.forEach(p => {
      const row = document.createElement('div');
      row.className = 'past-plan-row';
      row.innerHTML = `
        <span class="past-plan-name">${p.name}</span>
        <button class="btn-text plan-card-edit" data-plan-id="${p.plan_id}">View</button>
      `;
      row.querySelector('.plan-card-edit').addEventListener('click', () => openEditPlan(p.plan_id));
      pastEl.appendChild(row);
    });
  }
}

// ── Plan editor ───────────────────────────────────────

let _editingPlanId    = null; // null = new plan
let _editingExercises = [];   // { exercise, type, targetSets, targetReps }

function openNewPlan() {
  _editingPlanId    = null;
  _editingExercises = [];
  document.getElementById('plan-editor-title').textContent    = 'New Plan';
  document.getElementById('plan-name-input').value            = '';
  document.getElementById('plan-duration-input').value        = '';
  document.getElementById('plan-target-sessions-input').value = '';
  document.getElementById('plan-obj-1').value                 = '';
  document.getElementById('plan-obj-2').value                 = '';
  document.getElementById('plan-obj-3').value                 = '';
  document.getElementById('plan-save-error').classList.add('hidden');
  document.getElementById('btn-archive-plan').classList.add('hidden');
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

function openEditPlan(planId) {
  const plan = dbGetPlan(planId);
  if (!plan) return;
  const exs = dbGetPlanExercises(planId);
  const objectives = plan.objectives_json ? JSON.parse(plan.objectives_json) : [];

  _editingPlanId    = planId;
  _editingExercises = exs.map(e => ({
    exercise: e.exercise, type: getExerciseType(e.exercise),
    targetSets: e.target_sets, targetReps: e.target_reps,
  }));

  document.getElementById('plan-editor-title').textContent = plan.name;
  document.getElementById('plan-name-input').value         = plan.name;
  document.getElementById('plan-duration-input').value     = plan.duration_weeks ?? '';
  document.getElementById('plan-target-sessions-input').value = plan.target_sessions_per_week ?? '';
  document.getElementById('plan-obj-1').value              = objectives[0] ?? '';
  document.getElementById('plan-obj-2').value              = objectives[1] ?? '';
  document.getElementById('plan-obj-3').value              = objectives[2] ?? '';
  document.getElementById('plan-save-error').classList.add('hidden');
  document.getElementById('btn-archive-plan').classList.toggle('hidden', plan.status !== 'active');
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

function renderPlanEditorExercises() {
  const container = document.getElementById('plan-exercises-list');
  container.innerHTML = '';
  _editingExercises.forEach((ex, i) => {
    const row = document.createElement('div');
    row.className = 'plan-exercise-row';
    row.innerHTML = `
      <span class="plan-exercise-row-name">${ex.exercise}</span>
      <div class="plan-exercise-row-targets">
        <input type="number" class="plan-target-input" placeholder="Sets" value="${ex.targetSets ?? ''}" min="1" max="20" inputmode="numeric" data-idx="${i}" data-field="sets">
        <span class="plan-target-sep">×</span>
        <input type="number" class="plan-target-input" placeholder="Reps" value="${ex.targetReps ?? ''}" min="1" max="100" inputmode="numeric" data-idx="${i}" data-field="reps">
      </div>
      <button class="plan-exercise-remove" data-idx="${i}">✕</button>
    `;
    row.querySelectorAll('.plan-target-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        if (inp.dataset.field === 'sets') _editingExercises[idx].targetSets = parseInt(inp.value) || null;
        else                              _editingExercises[idx].targetReps = parseInt(inp.value) || null;
      });
    });
    row.querySelector('.plan-exercise-remove').addEventListener('click', () => {
      _editingExercises.splice(i, 1);
      renderPlanEditorExercises();
    });
    container.appendChild(row);
  });
}

function addExerciseToPlan(name, type) {
  if (_editingExercises.some(e => e.exercise === name)) return; // no duplicates
  _editingExercises.push({ exercise: name, type: type ?? getExerciseType(name), targetSets: null, targetReps: null });
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

function savePlan() {
  const name     = document.getElementById('plan-name-input').value.trim();
  const errorEl  = document.getElementById('plan-save-error');

  if (!name || !_editingExercises.length) {
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const durationWeeks  = parseInt(document.getElementById('plan-duration-input').value) || null;
  const targetSessions = parseInt(document.getElementById('plan-target-sessions-input').value) || null;
  const objectives    = [
    document.getElementById('plan-obj-1').value.trim(),
    document.getElementById('plan-obj-2').value.trim(),
    document.getElementById('plan-obj-3').value.trim(),
  ].filter(Boolean);
  const objectivesJson = objectives.length ? JSON.stringify(objectives) : null;

  if (_editingPlanId) {
    dbUpdatePlan(_editingPlanId, name, durationWeeks, objectivesJson, targetSessions);
    dbSavePlanExercises(_editingPlanId, _editingExercises);
  } else {
    // Archive any currently active plan before creating the new one
    const existing = dbGetActivePlan();
    if (existing) dbUpdatePlanStatus(existing.plan_id, 'archived');
    const planId = dbCreatePlan(name, new Date().toISOString().slice(0, 10), durationWeeks, objectivesJson, targetSessions);
    dbSavePlanExercises(planId, _editingExercises);
  }

  showScreen('plans');
}

function archiveCurrentPlan() {
  if (!_editingPlanId) return;
  if (!confirm('Archive this plan? It will no longer guide your sessions.')) return;
  dbUpdatePlanStatus(_editingPlanId, 'archived');
  showScreen('plans');
}

// ── Idle dashboard ────────────────────────────────────

// Returns midnight on the Monday of the week containing d (local time).
function _weekStart(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return date;
}

// Human-relative day for the hook line: "today", "yesterday", "on Tuesday"
// (within the last week), or "12 days ago".
function _relativeDay(iso) {
  const d     = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that  = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days  = Math.round((today - that) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return 'on ' + d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${days} days ago`;
}

// Renders the 7-day week strip (Mon–Sun) and the consecutive-week streak.
// Hidden entirely until the first completed session exists.
function renderWeekStrip() {
  const card = document.getElementById('week-strip');
  if (!dbGetLastCompletedSession()) { card.classList.add('hidden'); return; }

  const thisWeek = _weekStart(new Date());
  const lookback = new Date(thisWeek.getTime() - 25 * 7 * 86400000); // ~6 months for streak
  const sessions = dbGetCompletedSessionsSince(lookback.toISOString());

  // Trained day indexes (Mon=0) for the current week
  const trained = new Set();
  // Week-start timestamps that contain at least one session (for the streak)
  const weeks = new Set();
  sessions.forEach(t => {
    const d = new Date(t);
    weeks.add(_weekStart(d).getTime());
    if (d >= thisWeek) trained.add((d.getDay() + 6) % 7);
  });

  const days = document.getElementById('week-strip-days');
  days.innerHTML = '';
  const todayIdx = (new Date().getDay() + 6) % 7;
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((letter, i) => {
    const col = document.createElement('div');
    col.className = 'week-day';
    if (trained.has(i)) col.classList.add('week-day--trained');
    if (i === todayIdx) col.classList.add('week-day--today');
    const dot = document.createElement('span');
    dot.className = 'week-day-dot';
    const lbl = document.createElement('span');
    lbl.className = 'week-day-letter';
    lbl.textContent = letter;
    col.append(dot, lbl);
    days.appendChild(col);
  });

  // Streak = consecutive calendar weeks with ≥1 session, ending at the current
  // week. An untrained current week doesn't break the streak yet — it just
  // isn't counted — so the streak survives until a full week is missed.
  let cursor = weeks.has(thisWeek.getTime())
    ? thisWeek.getTime()
    : thisWeek.getTime() - 7 * 86400000;
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor -= 7 * 86400000;
  }
  const streakEl = document.getElementById('week-strip-streak');
  streakEl.classList.toggle('hidden', streak < 2);
  if (streak >= 2) streakEl.textContent = `${streak}-week streak`;

  card.classList.remove('hidden');
}

// Sets the idle subtitle: a hook from the last session when history exists
// ("Chest Press hit 65 kg on Tuesday — beat it?"), a session summary when
// nothing improved, or the default "Ready to train" for a fresh install.
function renderIdleHook() {
  const el   = document.getElementById('idle-subtitle');
  const last = dbGetLastCompletedSession();
  if (!last) {
    el.textContent = 'Ready to train';
    el.classList.remove('idle-subtitle--hook');
    return;
  }

  const when = _relativeDay(last.start_time);

  // Best improvement in the last session vs each exercise's prior history —
  // same comparison the completion signal makes (kg-normalised).
  let bestDeltaKg  = 0;
  let bestExercise = null;
  let bestKg       = null;
  dbGetSessionRepsExercises(last.session_id).forEach(exercise => {
    const currentBestKg = dbGetSessionBestForExercise(last.session_id, exercise);
    const history       = dbGetRecentSessionsBestForExercise(exercise, 1, last.session_id);
    if (!history.length || currentBestKg == null) return;
    const delta = currentBestKg - history[0].best_weight_kg;
    if (delta > WEIGHT_EPSILON_KG && delta > bestDeltaKg) {
      bestDeltaKg  = delta;
      bestExercise = exercise;
      bestKg       = currentBestKg;
    }
  });

  if (bestExercise) {
    const unit  = getWeightUnit();
    const value = convertWeight(bestKg, 'kg', unit);
    el.textContent = `${bestExercise} hit ${value} ${unit} ${when} — beat it?`;
  } else {
    const sets      = dbGetSetCount(last.session_id);
    const exercises = dbGetSessionExerciseCount(last.session_id);
    el.textContent  = `Last workout ${when} — ${sets} set${sets !== 1 ? 's' : ''} across ${exercises} exercise${exercises !== 1 ? 's' : ''}`;
  }
  el.classList.add('idle-subtitle--hook');
}

// Shows the active plan and current week number below the week strip.
function renderIdlePlanLine() {
  const el   = document.getElementById('idle-plan-line');
  const plan = dbGetActivePlan();
  if (!plan) { el.classList.add('hidden'); return; }
  const weekNum = Math.floor((Date.now() - new Date(plan.start_date).getTime()) / (7 * 86400000)) + 1;
  el.textContent = `${plan.name} · Week ${weekNum}${plan.duration_weeks ? ` of ${plan.duration_weeks}` : ''}`;
  el.classList.remove('hidden');
}

function renderIdleDashboard() {
  renderIdleHook();
  renderWeekStrip();
  renderIdlePlanLine();
}

// ── Exercise history ──────────────────────────────────

// Formats a date for history displays: "2 Jul", with the year appended
// only when it differs from the current year ("2 Jul 2025").
function fmtHistDate(d) {
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

// Renders the exercise list on the History screen, most recently used first.
// Rows are built via DOM APIs (not innerHTML) because custom "Other" exercise
// names are user-entered free text.
function renderHistoryScreen() {
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const rows  = dbGetExercisesWithHistory();

  list.innerHTML = '';
  empty.classList.toggle('hidden', rows.length > 0);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const name = document.createElement('span');
    name.className = 'history-row-name';
    name.textContent = r.exercise;

    const meta = document.createElement('span');
    meta.className = 'history-row-meta';
    meta.textContent =
      `${r.session_count} session${r.session_count !== 1 ? 's' : ''} · ${fmtHistDate(new Date(r.last_used))}`;

    const arrow = document.createElement('span');
    arrow.className = 'history-row-arrow';
    arrow.textContent = '›';

    row.append(name, meta, arrow);
    row.addEventListener('click', () => openExerciseHistory(r.exercise));
    list.appendChild(row);
  });
}

// Chart layout state for the pointer/tooltip handler. Rebuilt on every render.
// px is each point's x coordinate in viewBox units; the handler rescales
// pointer offsets by (viewBox width / rendered width) to find the nearest point.
let _histChart = null;

const HIST_W   = 320;
const HIST_H   = 190;
const HIST_PAD = { top: 18, right: 14, bottom: 22, left: 40 };

// Picks a "nice" gridline step (1/2/5 × power of 10) close to rawStep.
function _niceStep(rawStep) {
  const pow  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const frac = rawStep / pow;
  if (frac <= 1) return pow;
  if (frac <= 2) return 2 * pow;
  if (frac <= 5) return 5 * pow;
  return 10 * pow;
}

// Builds the progression line chart as inline SVG.
// points: [{ date: Date, value: Number, detail: String }] in ascending date order,
// values already converted to the display unit. Single series — the screen title
// names it, so there is no legend. Numbers/dates only go through innerHTML;
// user-entered text never enters this string.
function renderHistoryChart(points, unitLabel) {
  const wrap = document.getElementById('history-chart');
  const note = document.getElementById('history-chart-note');
  wrap.innerHTML = '';
  _histChart = null;
  hideHistoryTooltip();

  if (points.length < 2) {
    note.textContent = points.length === 1
      ? 'Your trend line appears from the second session.'
      : 'No data for this exercise yet.';
    note.classList.remove('hidden');
    if (!points.length) return;
  } else {
    note.classList.add('hidden');
  }

  const innerW = HIST_W - HIST_PAD.left - HIST_PAD.right;
  const innerH = HIST_H - HIST_PAD.top - HIST_PAD.bottom;
  const baseY  = HIST_H - HIST_PAD.bottom;

  // Y domain with ~10% headroom either side; never below zero
  const values = points.map(p => p.value);
  const vMin   = Math.min(...values);
  const vMax   = Math.max(...values);
  const spread = (vMax - vMin) || Math.max(vMax * 0.1, 1);
  const yMin   = Math.max(0, vMin - spread * 0.15);
  const yMax   = vMax + spread * 0.15;

  const x = i => points.length === 1
    ? HIST_PAD.left + innerW / 2
    : HIST_PAD.left + (i / (points.length - 1)) * innerW;
  const y = v => baseY - ((v - yMin) / (yMax - yMin)) * innerH;

  const px  = points.map((_, i) => x(i));
  const pts = points.map((p, i) => `${px[i].toFixed(1)},${y(p.value).toFixed(1)}`);

  // Horizontal gridlines at ~3 clean-number ticks, hairline, recessive
  const step = _niceStep((yMax - yMin) / 3);
  let grid = '';
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) {
    const gy = y(t).toFixed(1);
    grid += `<line x1="${HIST_PAD.left}" x2="${HIST_W - HIST_PAD.right}" y1="${gy}" y2="${gy}" stroke="#2c2c2c" stroke-width="1"/>`;
    grid += `<text x="${HIST_PAD.left - 6}" y="${+gy + 3}" text-anchor="end" font-size="10" fill="#777">${Math.round(t * 10) / 10}</text>`;
  }

  // Area wash under the line (skip for a single point)
  const area = points.length > 1
    ? `<path d="M ${pts[0]} L ${pts.join(' L ')} L ${px[px.length - 1].toFixed(1)},${baseY} L ${px[0].toFixed(1)},${baseY} Z" fill="#c8ff57" opacity="0.08"/>`
    : '';

  const line = points.length > 1
    ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#c8ff57" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';

  // Dots: series fill with a 2px surface ring so they read where they cross the line
  const dots = points.map((p, i) =>
    `<circle cx="${px[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="#c8ff57" stroke="#181818" stroke-width="2"/>`
  ).join('');

  // Selective direct label: endpoint value only, in text ink (never the series color)
  const last   = points[points.length - 1];
  const lastX  = Math.min(px[px.length - 1], HIST_W - HIST_PAD.right - 2);
  const endLbl = `<text x="${lastX.toFixed(1)}" y="${(y(last.value) - 9).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="#f0f0f0">${Math.round(last.value * 10) / 10} ${unitLabel}</text>`;

  // X labels: first and last session dates
  let xLbls = `<text x="${HIST_PAD.left}" y="${HIST_H - 6}" text-anchor="start" font-size="10" fill="#777">${fmtHistDate(points[0].date)}</text>`;
  if (points.length > 1) {
    xLbls += `<text x="${HIST_W - HIST_PAD.right}" y="${HIST_H - 6}" text-anchor="end" font-size="10" fill="#777">${fmtHistDate(last.date)}</text>`;
  }

  const crosshair = `<line id="hist-crosshair" x1="0" x2="0" y1="${HIST_PAD.top}" y2="${baseY}" stroke="#444" stroke-width="1" visibility="hidden"/>`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${HIST_W} ${HIST_H}`);
  svg.innerHTML = grid + area + crosshair + line + dots + endLbl + xLbls;
  wrap.appendChild(svg);

  _histChart = { points, px, unitLabel, svg };

  // Crosshair + tooltip: snap to the nearest session by X. pan-y touch-action
  // (in CSS) keeps vertical page scroll working while horizontal drags scrub.
  svg.addEventListener('pointermove', _histPointerMove);
  svg.addEventListener('pointerdown', _histPointerMove);
  svg.addEventListener('pointerleave', hideHistoryTooltip);
}

function _histPointerMove(e) {
  if (!_histChart) return;
  const rect  = _histChart.svg.getBoundingClientRect();
  const vx    = ((e.clientX - rect.left) / rect.width) * HIST_W; // viewBox units
  let nearest = 0;
  _histChart.px.forEach((p, i) => {
    if (Math.abs(p - vx) < Math.abs(_histChart.px[nearest] - vx)) nearest = i;
  });

  const point = _histChart.points[nearest];
  const cross = document.getElementById('hist-crosshair');
  if (cross) {
    cross.setAttribute('x1', _histChart.px[nearest]);
    cross.setAttribute('x2', _histChart.px[nearest]);
    cross.setAttribute('visibility', 'visible');
  }

  const tip = document.getElementById('history-tooltip');
  document.getElementById('history-tooltip-value').textContent =
    `${Math.round(point.value * 10) / 10} ${_histChart.unitLabel}${point.detail ? ` ${point.detail}` : ''}`;
  document.getElementById('history-tooltip-date').textContent = fmtHistDate(point.date);
  tip.classList.remove('hidden');

  // Position over the hovered point, clamped inside the card
  const card    = tip.parentElement;
  const cardW   = card.clientWidth;
  const pointPx = rect.left - card.getBoundingClientRect().left + (_histChart.px[nearest] / HIST_W) * rect.width;
  const half    = tip.offsetWidth / 2;
  tip.style.left = `${Math.max(half + 4, Math.min(cardW - half - 4, pointPx))}px`;
}

function hideHistoryTooltip() {
  document.getElementById('history-tooltip').classList.add('hidden');
  const cross = document.getElementById('hist-crosshair');
  if (cross) cross.setAttribute('visibility', 'hidden');
}

// Renders the per-session breakdown list, newest first. This is the chart's
// table view — every plotted value is readable here without touching the chart.
function renderHistorySessions(rows, weighted, unit) {
  const container = document.getElementById('history-sessions');
  container.innerHTML = '';

  [...rows].reverse().forEach(r => {
    const row = document.createElement('div');
    row.className = 'history-session-row';

    const date = document.createElement('span');
    date.className = 'history-session-date';
    date.textContent = fmtHistDate(new Date(r.start_time));

    const main = document.createElement('span');
    main.className = 'history-session-main';
    if (weighted && r.best_weight_kg != null) {
      const w = convertWeight(r.best_weight_kg, 'kg', unit);
      main.textContent = `${w} ${unit}${r.reps_at_best != null ? ` × ${r.reps_at_best}` : ''}`;
    } else if (r.total_mins != null) {
      main.textContent = `${Math.round(r.total_mins * 10) / 10} min${r.total_cals ? ` · ${r.total_cals} cal` : ''}`;
    } else {
      main.textContent = '—';
    }

    const sets = document.createElement('span');
    sets.className = 'history-session-sets';
    sets.textContent = `${r.set_count} set${r.set_count !== 1 ? 's' : ''}`;

    row.append(date, main, sets);
    container.appendChild(row);
  });
}

// Opens the detail screen for one exercise: stat tiles, chart, session list.
// An exercise charts weight when any session has weight data, otherwise duration —
// data presence decides, so custom "Other" cardio names chart correctly too.
function openExerciseHistory(exercise) {
  document.getElementById('exercise-history-title').textContent = exercise;

  const rows     = dbGetExerciseSessionHistory(exercise);
  const unit     = getWeightUnit();
  const weighted = rows.some(r => r.best_weight_kg != null);

  const points = weighted
    ? rows.filter(r => r.best_weight_kg != null).map(r => ({
        date:   new Date(r.start_time),
        value:  convertWeight(r.best_weight_kg, 'kg', unit),
        detail: r.reps_at_best != null ? `× ${r.reps_at_best}` : '',
      }))
    : rows.filter(r => r.total_mins != null).map(r => ({
        date:   new Date(r.start_time),
        value:  Math.round(r.total_mins * 10) / 10,
        detail: r.total_cals ? `· ${r.total_cals} cal` : '',
      }));

  const unitLabel = weighted ? unit : 'min';
  const fmtVal    = v => `${Math.round(v * 10) / 10} ${unitLabel}`;

  const bestEl   = document.getElementById('hist-stat-best');
  const lastEl   = document.getElementById('hist-stat-last');
  const changeEl = document.getElementById('hist-stat-change');

  if (points.length) {
    bestEl.textContent = fmtVal(Math.max(...points.map(p => p.value)));
    lastEl.textContent = fmtVal(points[points.length - 1].value);
  } else {
    bestEl.textContent = '—';
    lastEl.textContent = '—';
  }

  changeEl.classList.remove('positive', 'negative');
  if (points.length >= 2) {
    const delta = Math.round((points[points.length - 1].value - points[0].value) * 10) / 10;
    changeEl.textContent = `${delta > 0 ? '+' : ''}${delta} ${unitLabel}`;
    if (delta > 0) changeEl.classList.add('positive');
    if (delta < 0) changeEl.classList.add('negative');
  } else {
    changeEl.textContent = '—';
  }

  renderHistoryChart(points, unitLabel);
  renderHistorySessions(rows, weighted, unit);
  showScreen('exercise-history');
}

// ── AI Session Summary ────────────────────────────────

// Builds a compact text description of the completed session for the prompt.
// Groups sets by exercise in first-occurrence order, then summarises each.
function _buildSessionContext(sessionId) {
  const sets = [...dbGetAllSets(sessionId)].reverse(); // ASC order
  const unit = getWeightUnit();
  const order = [];
  const groups = {};
  for (const s of sets) {
    if (!groups[s.exercise]) { groups[s.exercise] = []; order.push(s.exercise); }
    groups[s.exercise].push(s);
  }
  const lines = [];
  for (const ex of order) {
    const exSets = groups[ex];
    if (exSets[0].duration_mins != null) {
      const totalMins = exSets.reduce((sum, s) => sum + (s.duration_mins ?? 0), 0);
      const cals = exSets.reduce((sum, s) => sum + (s.calories ?? 0), 0);
      lines.push(`${ex}: ${Math.round(totalMins)} mins${cals ? `, ${cals} cal` : ''}`);
    } else {
      const weighted = exSets.filter(s => s.weight != null);
      if (!weighted.length) continue;
      const bestKg = Math.max(...weighted.map(s =>
        s.unit === 'lbs' ? s.weight / 2.2046 : s.weight
      ));
      const displayBest = unit === 'lbs'
        ? Math.round(bestKg * 2.2046)
        : Math.round(bestKg * 10) / 10;
      const bestReps = Math.max(...exSets.map(s => s.reps ?? 0));
      const history = dbGetRecentSessionsBestForExercise(ex, 5, sessionId);
      let histNote = '';
      if (history.length > 0) {
        const deltaKg = bestKg - history[0].best_weight_kg;
        if (deltaKg >= 0.5) {
          const d = unit === 'lbs' ? Math.round(deltaKg * 2.2046) : Math.round(deltaKg * 10) / 10;
          histNote = ` (+${d}${unit} vs last session)`;
        } else if (deltaKg <= -0.5) {
          const d = unit === 'lbs' ? Math.round(Math.abs(deltaKg) * 2.2046) : Math.round(Math.abs(deltaKg) * 10) / 10;
          histNote = ` (-${d}${unit} vs last session)`;
        } else {
          histNote = ' (matched previous best)';
        }
      }
      lines.push(`${ex}: best ${displayBest}${unit} × ${bestReps} reps, ${exSets.length} sets${histNote}`);
    }
  }
  // Append plan context if this session was linked to a plan
  const plan = dbGetSessionPlan(sessionId);
  if (plan) {
    const startDate   = new Date(plan.start_date);
    const weekNumber  = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const durationStr = plan.duration_weeks ? ` (${weekNumber} of ${plan.duration_weeks} weeks)` : '';
    lines.push('');
    lines.push(`Plan: ${plan.name}${durationStr}`);
    const objectives = plan.objectives_json ? JSON.parse(plan.objectives_json) : [];
    if (objectives.length) lines.push(`Objectives: ${objectives.join('; ')}`);
    const planNames  = plan.exercises.map(e => e.exercise);
    const loggedNames = [...new Set(dbGetAllSets(sessionId).map(s => s.exercise))];
    const done    = planNames.filter(n => loggedNames.includes(n));
    const skipped = planNames.filter(n => !loggedNames.includes(n));
    const extra   = loggedNames.filter(n => !planNames.includes(n));
    if (done.length)    lines.push(`Completed plan exercises: ${done.join(', ')}`);
    if (skipped.length) lines.push(`Skipped: ${skipped.join(', ')}`);
    if (extra.length)   lines.push(`Added outside plan: ${extra.join(', ')}`);
  }

  return lines.join('\n');
}

async function generateAISummary() {
  const textEl = document.getElementById('ai-summary-text');
  document.getElementById('ai-summary-modal').classList.remove('hidden');
  textEl.className = 'ai-summary-text loading';
  textEl.textContent = 'Generating…';

  const key = getAnthropicKey();
  if (!key) {
    textEl.className = 'ai-summary-text error';
    textEl.textContent = 'Add your Anthropic API key in Settings → AI to enable this feature.';
    return;
  }

  const context = _buildSessionContext(state.sessionId);

  try {
    const resp = await fetch('/api/ai-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, apiKey: key }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      textEl.className = 'ai-summary-text error';
      textEl.textContent = data.error ?? `Error (${resp.status})`;
      return;
    }

    textEl.className = 'ai-summary-text';
    textEl.textContent = data.text ?? 'Summary unavailable — great workout either way!';
  } catch (_) {
    textEl.className = 'ai-summary-text error';
    textEl.textContent = 'Network error. Check your connection and try again.';
  }
}

function hideAISummaryModal() {
  document.getElementById('ai-summary-modal').classList.add('hidden');
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
    if (name) switchExercise(name);
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
  inputWeight.addEventListener('input', () => { clearError(); renderProgressionSignal(null); });
  inputReps.addEventListener('input',   () => { clearError(); renderProgressionSignal(null); });

  // Session notes
  const notesEl = document.getElementById('session-notes');
  notesEl.addEventListener('input', scheduleNotesSave);
  notesEl.addEventListener('blur', () => { clearTimeout(_notesDebounce); saveNotesNow(); });

  // Exercise picker — sort toggle
  document.getElementById('picker-sort-recent').addEventListener('click', () => {
    _pickerSort = 'recent';
    localStorage.setItem('gymops_picker_sort', 'recent');
    _renderExerciseList();
  });
  document.getElementById('picker-sort-az').addEventListener('click', () => {
    _pickerSort = 'az';
    localStorage.setItem('gymops_picker_sort', 'az');
    _renderExerciseList();
  });

  // Exercise picker
  document.getElementById('btn-close-picker').addEventListener('click', closePicker);
  document.getElementById('modal-backdrop').addEventListener('click', closePicker);
  document.getElementById('btn-other-done').addEventListener('click', confirmOtherName);
  document.getElementById('btn-other-cancel').addEventListener('click', closePicker);
  document.getElementById('btn-other-strength').addEventListener('click', () => applyOtherExercise(_pendingOtherName, 'reps'));
  document.getElementById('btn-other-cardio').addEventListener('click', () => applyOtherExercise(_pendingOtherName, 'timed'));
  document.getElementById('btn-other-type-back').addEventListener('click', () => {
    _pendingOtherName = '';
    document.getElementById('other-type-prompt').classList.add('hidden');
    document.getElementById('btn-other-done').classList.remove('hidden');
    document.getElementById('other-name-input').focus();
  });
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

  // When the tab becomes visible again after being backgrounded, check real
  // wall-clock elapsed time — browser may have throttled the setTimeout so it
  // never fired. If inactivity threshold has passed, show the modal immediately.
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
  document.getElementById('btn-add-plan-exercise').addEventListener('click', () => {
    _pickerContext = 'plan';
    _refreshRecencyRanks();
    _renderExerciseList();
    document.getElementById('exercise-picker').classList.remove('hidden');
  });

  // Completed screen
  document.getElementById('btn-resume').addEventListener('click', resumeLastWorkout);
  document.getElementById('btn-new-workout').addEventListener('click', () => showScreen('idle'));
  document.getElementById('btn-export').addEventListener('click', triggerExport);
  document.getElementById('btn-ai-summary').addEventListener('click', generateAISummary);
  document.getElementById('btn-ai-summary-done').addEventListener('click', hideAISummaryModal);
  document.getElementById('ai-summary-backdrop').addEventListener('click', hideAISummaryModal);
}

document.addEventListener('DOMContentLoaded', boot);
