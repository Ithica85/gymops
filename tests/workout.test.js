// Layer 1 integration tests (4.8): the money path — start → log → undo →
// resume → finish — driven through js/workout.js against a REAL in-memory
// sql.js database. The DOM is the stub from tests/setup.js: rendering is
// exercised but not asserted on; every assertion reads DB or shared state.
//
// Fake timers are installed AFTER initDB (sql.js wasm init must run on real
// timers) so the session/rest/inactivity intervals never leak between tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initDB,
  dbGetAllSets, dbGetSession, dbGetSetCount, dbGetActiveSession,
  dbCreatePlan, dbSavePlanExercises, dbGetPlanDays, dbFinishSession,
  dbUpdateSessionDay,
} from '../js/db.js';
import { EXERCISES, localDateStr, state } from '../js/state.js';
import {
  _doStartSession, startSession, beginSessionFlow, resumeSession, logSet, quickLogSet, undoSet,
  finishWorkout, resumeLastWorkout, setActiveExercise, computeUpNext,
  saveNotesNow, stopRestTimer, adjustRestTimer, renderWeightConversion,
  updateLogEmphasis, _restEndTime,
} from '../js/workout.js';

// 5.8: no path auto-lands on EXERCISES[0] — tests that need a plan-less session
// pass an exercise explicitly (mirrors the start-picker product path).
const DEFAULT_EXERCISE = EXERCISES[0].name;
const OTHER_EXERCISE   = EXERCISES.find(e => e.type === 'reps' && e.name !== DEFAULT_EXERCISE).name;

function el(id) { return document.getElementById(id); }

function startOnDefault() {
  _doStartSession({ exercise: DEFAULT_EXERCISE });
}

function typeAndLog(field1, field2) {
  el('input-weight').value = field1;
  el('input-reps').value = field2;
  logSet();
}

beforeEach(async () => {
  localStorage.clear();
  await initDB();
  vi.useFakeTimers();
  state.sessionId = null;
  state.exercise = null;
  state.exerciseType = null;
  state.setNumber = 1;
  state.finishedAt = null;
  el('input-weight').value = '';
  el('input-reps').value = '';
  el('session-notes').value = '';
});

afterEach(() => {
  stopRestTimer();
  vi.useRealTimers();
});

describe('start → log → finish (the money path)', () => {
  it('start creates an active session on the chosen exercise at set 1', () => {
    startOnDefault();
    expect(state.sessionId).toBe(1);
    expect(state.exercise).toBe(DEFAULT_EXERCISE);
    expect(state.setNumber).toBe(1);
    expect(dbGetActiveSession().session_id).toBe(1);
  });

  it('logging sets advances setNumber and persists rows', () => {
    startOnDefault();
    typeAndLog('60', '8');
    typeAndLog('62.5', '6');
    expect(state.setNumber).toBe(3);
    const sets = dbGetAllSets(state.sessionId); // newest first
    expect(sets.map(s => [s.set_number, s.weight, s.reps])).toEqual([[2, 62.5, 6], [1, 60, 8]]);
    expect(sets.every(s => s.exercise === DEFAULT_EXERCISE)).toBe(true);
  });

  it('finish completes the session in the DB and stamps end_time', () => {
    startOnDefault();
    typeAndLog('60', '8');
    finishWorkout();
    const session = dbGetSession(state.sessionId);
    expect(session.status).toBe('completed');
    expect(session.end_time).toBeTruthy();
    expect(dbGetActiveSession()).toBeNull();
  });

  it('startSession() refuses to trample an existing active session', () => {
    startOnDefault();
    const first = state.sessionId;
    startSession(); // must show the discard modal instead of creating session 2
    expect(state.sessionId).toBe(first);
    expect(el('confirm-discard').classList.contains('hidden')).toBe(false);
    expect(dbGetActiveSession().session_id).toBe(first);
  });
});

describe('logSet validation', () => {
  beforeEach(() => startOnDefault());

  it('rejects empty and negative input without inserting', () => {
    typeAndLog('', '');
    typeAndLog('-5', '8');
    typeAndLog('60', '0');
    expect(dbGetSetCount(state.sessionId)).toBe(0);
    expect(state.setNumber).toBe(1);
  });

  it('accepts zero weight (bodyweight) and comma decimals', () => {
    typeAndLog('0', '12');
    typeAndLog('62,5', '8'); // comma-locale keypad (4.5)
    const sets = dbGetAllSets(state.sessionId);
    expect(sets.map(s => s.weight)).toEqual([62.5, 0]);
  });

  it('timed exercises store duration/calories, never weight/reps', () => {
    setActiveExercise('Elliptical');
    expect(state.exerciseType).toBe('timed');
    typeAndLog('20', '150');
    const [row] = dbGetAllSets(state.sessionId);
    expect([row.duration_mins, row.calories, row.weight, row.reps]).toEqual([20, 150, null, null]);
  });
});

describe('undo', () => {
  beforeEach(() => startOnDefault());

  it('removes only the current exercise\'s last set (4.2 scope fix)', () => {
    typeAndLog('60', '8');
    typeAndLog('65', '8');
    setActiveExercise(OTHER_EXERCISE);
    typeAndLog('40', '10'); // logged LATER, different exercise

    setActiveExercise(DEFAULT_EXERCISE);
    undoSet();

    const sets = dbGetAllSets(state.sessionId);
    expect(sets.map(s => [s.exercise, s.weight])).toEqual([
      [OTHER_EXERCISE, 40],   // untouched despite being the session-global last set
      [DEFAULT_EXERCISE, 60], // 65 removed
    ]);
    expect(state.setNumber).toBe(2); // resynced from DB
  });

  it('with no sets for the current exercise, opens the picker and deletes nothing', () => {
    typeAndLog('60', '8');
    setActiveExercise(OTHER_EXERCISE); // nothing logged here yet
    undoSet();
    expect(dbGetSetCount(state.sessionId)).toBe(1);
    expect(el('exercise-picker').classList.contains('hidden')).toBe(false);
  });
});

describe('finish → resume', () => {
  it('resume reopens the session on the exercise active at Finish time', () => {
    startOnDefault();
    typeAndLog('60', '8');
    setActiveExercise(OTHER_EXERCISE); // switched but never logged
    finishWorkout();

    resumeLastWorkout();
    expect(dbGetSession(state.sessionId).status).toBe('active');
    expect(state.exercise).toBe(OTHER_EXERCISE); // not the last-logged exercise
    expect(state.setNumber).toBe(1);
  });

  it('resume is refused once the 60-minute window has passed', () => {
    startOnDefault();
    typeAndLog('60', '8');
    finishWorkout();
    vi.advanceTimersByTime(61 * 60 * 1000); // fake clock: push Date past the window
    resumeLastWorkout();
    expect(dbGetSession(state.sessionId).status).toBe('completed');
  });
});

describe('cross-session behaviours', () => {
  function completeFirstSession(weight = '60') {
    startOnDefault();
    typeAndLog(weight, '8');
    finishWorkout();
  }

  it('quick-log repeats last session\'s matching set without typing', () => {
    completeFirstSession('60');
    startOnDefault();
    setActiveExercise(DEFAULT_EXERCISE);
    quickLogSet();
    const [row] = dbGetAllSets(state.sessionId);
    expect([row.weight, row.reps, row.set_number]).toEqual([60, 8, 1]);
    expect(state.setNumber).toBe(2);
  });

  it('an all-time PR still logs the set (celebration never blocks logging)', () => {
    completeFirstSession('60');
    startOnDefault();
    typeAndLog('70', '8'); // beats 60 kg all-time best → PR path
    const [row] = dbGetAllSets(state.sessionId);
    expect(row.weight).toBe(70);
    expect(el('pr-celebration').classList.contains('hidden')).toBe(false);
    expect(state.setNumber).toBe(2);
  });

  it('ghost/quick-log reference never bleeds in from the current session (beforeSessionId guard)', () => {
    completeFirstSession('60');
    startOnDefault();
    typeAndLog('65', '8');
    quickLogSet(); // set 2 — last session had only 1 set → falls back to repeat-last (65)
    const sets = dbGetAllSets(state.sessionId);
    expect(sets.map(s => s.weight)).toEqual([65, 65]);
  });

  it('quick-log re-taps inside the guard window log exactly one set (5.2.x #1)', () => {
    completeFirstSession('60');
    startOnDefault();
    quickLogSet();
    quickLogSet(); // frantic re-tap, same instant
    vi.advanceTimersByTime(400);
    quickLogSet(); // still inside the 600ms guard
    expect(dbGetSetCount(state.sessionId)).toBe(1);
    expect(state.setNumber).toBe(2);

    vi.advanceTimersByTime(300); // past the guard — a deliberate next set logs
    quickLogSet();
    expect(dbGetSetCount(state.sessionId)).toBe(2);
    expect(state.setNumber).toBe(3);
  });

  it('quick-log hero: with a reference, quick-log leads and Log Set demotes (5.6)', () => {
    completeFirstSession('60');
    startOnDefault();
    expect(el('btn-quick-log').classList.contains('hidden')).toBe(false);
    expect(el('btn-quick-log').classList.contains('quick-log-quiet')).toBe(false);
    expect(el('btn-log-set').classList.contains('btn-demoted')).toBe(true);
  });

  it('typing re-promotes Log Set; clearing restores the quick-log hero (5.6)', () => {
    completeFirstSession('60');
    startOnDefault();
    el('input-weight').value = '70';
    updateLogEmphasis(); // app.js fires this on the input event
    expect(el('btn-quick-log').classList.contains('quick-log-quiet')).toBe(true);
    expect(el('btn-log-set').classList.contains('btn-demoted')).toBe(false);

    el('input-weight').value = '';
    updateLogEmphasis();
    expect(el('btn-quick-log').classList.contains('quick-log-quiet')).toBe(false);
    expect(el('btn-log-set').classList.contains('btn-demoted')).toBe(true);
  });

  it('no reference → quick-log hidden and Log Set stays primary (5.6)', () => {
    startOnDefault(); // first-ever session: no history, no reference
    expect(el('btn-quick-log').classList.contains('hidden')).toBe(true);
    expect(el('btn-log-set').classList.contains('btn-demoted')).toBe(false);
  });

  it('quick-log shows ✓ Logged inline, then reverts to the next reference', () => {
    completeFirstSession('60');
    startOnDefault();
    quickLogSet();
    expect(el('quick-log-label').textContent).toBe('✓ Logged');
    expect(el('quick-log-value').textContent).toMatch(/^60 (kg|lbs) × 8$/);
    expect(el('btn-quick-log').classList.contains('quick-log-confirm')).toBe(true);

    vi.advanceTimersByTime(1200); // confirmation window expires → repaint
    expect(el('quick-log-label').textContent).not.toBe('✓ Logged');
    expect(el('btn-quick-log').classList.contains('quick-log-confirm')).toBe(false);
  });
});

describe('session start chooser (5.3)', () => {
  function makeSplit() {
    const planId = dbCreatePlan('Split', localDateStr(), null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Push', exercises: [{ exercise: 'Chest Press' }] },
      { dayId: null, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown' }] },
    ]);
    return { planId, days: dbGetPlanDays(planId) };
  }

  it('plan-less Start opens the start picker and creates NO session', () => {
    startSession();
    expect(el('exercise-picker').classList.contains('hidden')).toBe(false);
    expect(el('modal-title').textContent).toBe('First Exercise');
    expect(dbGetActiveSession()).toBeNull();
    expect(state.sessionId).toBeNull();
  });

  it('an explicit exercise from the picker creates the session on it', () => {
    _doStartSession({ exercise: OTHER_EXERCISE, type: 'reps' });
    expect(state.exercise).toBe(OTHER_EXERCISE);
    expect(dbGetActiveSession()).not.toBeNull();
    expect(state.setNumber).toBe(1);
  });

  it('with an active plan, beginSessionFlow starts immediately — no picker', () => {
    makeSplit();
    el('exercise-picker').classList.add('hidden'); // stub DOM classes persist across tests
    beginSessionFlow();
    expect(el('exercise-picker').classList.contains('hidden')).toBe(true);
    expect(state.exercise).toBe('Chest Press'); // Push day, first exercise
    expect(dbGetActiveSession()).not.toBeNull();
  });

  it('an explicit dayId overrides rotation', () => {
    const { days } = makeSplit();
    beginSessionFlow(days[1].day_id); // rotation would pick Push; ask for Pull
    expect(state.exercise).toBe('Lat Pulldown');
    expect(dbGetSession(state.sessionId).day_id).toBe(days[1].day_id);
  });
});

describe('no catalogue-default start (5.8)', () => {
  it('zero-set plan-less resume opens the picker — never lands on EXERCISES[0]', () => {
    // Product path: pick exercise → log nothing → kill tab → resume.
    // Chosen exercise isn't persisted until a set is logged.
    _doStartSession({ exercise: OTHER_EXERCISE, type: 'reps' });
    const session = dbGetActiveSession();
    expect(dbGetSetCount(session.session_id)).toBe(0);

    // Simulate a cold resume (boot resets state to the catalogue placeholder)
    state.exercise = DEFAULT_EXERCISE;
    state.exerciseType = 'reps';
    el('exercise-picker').classList.add('hidden');

    resumeSession(session);

    expect(el('exercise-picker').classList.contains('hidden')).toBe(false);
    expect(el('modal-title').textContent).toBe('First Exercise');
    // Must not have called setActiveExercise(EXERCISES[0]) — exercise stays
    // whatever it was until the user picks (boot placeholder is fine; auto-land is not).
    // The load-bearing check: we did NOT silently switch onto DEFAULT via resolve.
    // After cold-boot simulation state was already DEFAULT; picking is required.
    expect(dbGetActiveSession().session_id).toBe(session.session_id);
    expect(dbGetSetCount(session.session_id)).toBe(0);
  });

  it('zero-set plan resume still lands on the plan-day first exercise (no picker)', () => {
    const planId = dbCreatePlan('Split', localDateStr(), null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Push', exercises: [{ exercise: 'Chest Press' }] },
    ]);
    _doStartSession(); // plan-linked, lands on Chest Press
    const session = dbGetActiveSession();
    expect(dbGetSetCount(session.session_id)).toBe(0);

    state.exercise = DEFAULT_EXERCISE; // cold resume
    el('exercise-picker').classList.add('hidden');
    resumeSession(session);

    expect(el('exercise-picker').classList.contains('hidden')).toBe(true);
    expect(state.exercise).toBe('Chest Press');
  });

  it('bare _doStartSession with no exercise opens the picker (no EXERCISES[0])', () => {
    el('exercise-picker').classList.add('hidden');
    state.exercise = null;
    _doStartSession(); // defensive hatch — no plan, no exercise arg
    expect(dbGetActiveSession()).not.toBeNull();
    expect(el('exercise-picker').classList.contains('hidden')).toBe(false);
    expect(el('modal-title').textContent).toBe('First Exercise');
    expect(state.exercise).toBeNull(); // never setActiveExercise'd to catalogue default
  });

  it('empty plan day opens the start picker before creating a session', () => {
    const planId = dbCreatePlan('Odd', localDateStr(), null, null, null);
    // One empty day + one trained day — empty days can exist via hand-edit/legacy
    // even though the plan editor drops them on save.
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Rest', exercises: [] },
      { dayId: null, name: 'Push', exercises: [{ exercise: 'Chest Press' }] },
    ]);
    const days = dbGetPlanDays(planId);
    el('exercise-picker').classList.add('hidden');

    beginSessionFlow(days[0].day_id); // empty "Rest" day

    expect(el('exercise-picker').classList.contains('hidden')).toBe(false);
    expect(el('modal-title').textContent).toBe('First Exercise');
    expect(dbGetActiveSession()).toBeNull(); // session not created until pick
    expect(state.sessionId).toBeNull();
  });

  it('resume with a logged set still lands on that exercise', () => {
    _doStartSession({ exercise: OTHER_EXERCISE, type: 'reps' });
    typeAndLog('60', '8');
    const session = dbGetActiveSession();
    state.exercise = DEFAULT_EXERCISE;
    el('exercise-picker').classList.add('hidden');
    resumeSession(session);
    expect(state.exercise).toBe(OTHER_EXERCISE);
    expect(el('exercise-picker').classList.contains('hidden')).toBe(true);
  });
});

describe('rest timer auto-start (4.6)', () => {
  it('arms after a reps set, not after a timed set', () => {
    startOnDefault();
    typeAndLog('60', '8');
    expect(_restEndTime).not.toBeNull(); // live ESM binding

    stopRestTimer();
    setActiveExercise('Elliptical');
    typeAndLog('20', '150');
    expect(_restEndTime).toBeNull();
  });
});

describe('in-session rest adjust (5.2.x #4)', () => {
  it('+30 extends the running countdown; the stored preference is untouched', () => {
    startOnDefault();
    typeAndLog('60', '8'); // auto-starts rest (90s default)
    const before = _restEndTime;
    adjustRestTimer(30);
    expect(_restEndTime - before).toBe(30_000);
    expect(localStorage.getItem('gymops_rest_secs')).toBeNull();
  });

  it('adjusting below zero completes the rest through the normal done path', () => {
    startOnDefault();
    typeAndLog('60', '8');
    adjustRestTimer(-120); // 90s remaining − 120s → done
    expect(el('rest-countdown').textContent).toBe('Done!');
    vi.advanceTimersByTime(2000); // linger, then the bar hides
    expect(_restEndTime).toBeNull();
    expect(el('rest-bar').classList.contains('hidden')).toBe(true);
  });

  it('is a no-op when no rest is running', () => {
    startOnDefault();
    expect(_restEndTime).toBeNull();
    adjustRestTimer(30);
    expect(_restEndTime).toBeNull();
  });
});

describe('inline lbs↔kg converter (5.2.x #5)', () => {
  beforeEach(() => startOnDefault()); // default unit: kg

  it('shows the converted value while typing, comma decimals included', () => {
    el('input-weight').value = '60';
    renderWeightConversion();
    expect(el('weight-convert').textContent).toBe('60 kg = 132.3 lbs');
    expect(el('weight-convert').classList.contains('hidden')).toBe(false);

    el('input-weight').value = '62,5'; // comma-locale keypad (4.5)
    renderWeightConversion();
    expect(el('weight-convert').textContent).toBe('62.5 kg = 137.8 lbs');
  });

  it('hides for empty, non-numeric, and zero values', () => {
    for (const v of ['', 'abc', '0', '-5']) {
      el('input-weight').value = v;
      renderWeightConversion();
      expect(el('weight-convert').classList.contains('hidden')).toBe(true);
    }
  });

  it('never shows for timed exercises (the field is a duration)', () => {
    setActiveExercise('Elliptical');
    el('input-weight').value = '20';
    renderWeightConversion();
    expect(el('weight-convert').classList.contains('hidden')).toBe(true);
  });
});

describe('rest duration preference (4.9)', () => {
  it('startRestTimer honours gymops_rest_secs; unknown values fall back to 90', () => {
    startOnDefault();
    localStorage.setItem('gymops_rest_secs', '120');
    typeAndLog('60', '8');
    expect(_restEndTime - Date.now()).toBe(120_000); // Date frozen by fake timers

    localStorage.setItem('gymops_rest_secs', '45'); // not one of the offered choices
    typeAndLog('60', '8');
    expect(_restEndTime - Date.now()).toBe(90_000);
  });
});

describe('localDateStr (4.9)', () => {
  it('formats the LOCAL calendar day as YYYY-MM-DD', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateStr(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31'); // late evening stays local
  });
});

describe('session notes', () => {
  it('saveNotesNow flushes the textarea to the DB (null when empty)', () => {
    startOnDefault();
    el('session-notes').value = '  felt strong  ';
    saveNotesNow();
    expect(dbGetSession(state.sessionId).notes).toBe('felt strong');

    el('session-notes').value = '';
    saveNotesNow();
    expect(dbGetSession(state.sessionId).notes).toBeNull();
  });
});

describe('plan day rotation (5.2)', () => {
  function makeSplit() {
    const planId = dbCreatePlan('Split', localDateStr(), null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Push', exercises: [{ exercise: 'Chest Press' }, { exercise: 'Shoulder Press' }] },
      { dayId: null, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown' }, { exercise: 'Seated Row' }] },
    ]);
    return { planId, days: dbGetPlanDays(planId) };
  }

  it('starts on the rotated day: first session Push, next session Pull', () => {
    makeSplit();
    _doStartSession();
    expect(state.exercise).toBe('Chest Press'); // Push day, first exercise
    dbFinishSession(state.sessionId);
    state.sessionId = null;

    _doStartSession();
    expect(state.exercise).toBe('Lat Pulldown'); // rotated to Pull
  });

  it('Up Next follows the session day, and re-scopes after a day switch', () => {
    const { days } = makeSplit();
    _doStartSession(); // lands on Push
    expect(computeUpNext('Chest Press')).toBe('Shoulder Press');

    dbUpdateSessionDay(state.sessionId, days[1].day_id); // chip switch → Pull
    expect(computeUpNext('Lat Pulldown')).toBe('Seated Row');
  });
});
