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
} from '../js/db.js';
import { EXERCISES, state } from '../js/state.js';
import {
  _doStartSession, startSession, logSet, quickLogSet, undoSet,
  finishWorkout, resumeLastWorkout, setActiveExercise,
  saveNotesNow, stopRestTimer, _restEndTime,
} from '../js/workout.js';

const DEFAULT_EXERCISE = EXERCISES[0].name; // plan-less starting exercise
const OTHER_EXERCISE   = EXERCISES.find(e => e.type === 'reps' && e.name !== DEFAULT_EXERCISE).name;

function el(id) { return document.getElementById(id); }

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
  it('start creates an active session on the default exercise at set 1', () => {
    _doStartSession();
    expect(state.sessionId).toBe(1);
    expect(state.exercise).toBe(DEFAULT_EXERCISE);
    expect(state.setNumber).toBe(1);
    expect(dbGetActiveSession().session_id).toBe(1);
  });

  it('logging sets advances setNumber and persists rows', () => {
    _doStartSession();
    typeAndLog('60', '8');
    typeAndLog('62.5', '6');
    expect(state.setNumber).toBe(3);
    const sets = dbGetAllSets(state.sessionId); // newest first
    expect(sets.map(s => [s.set_number, s.weight, s.reps])).toEqual([[2, 62.5, 6], [1, 60, 8]]);
    expect(sets.every(s => s.exercise === DEFAULT_EXERCISE)).toBe(true);
  });

  it('finish completes the session in the DB and stamps end_time', () => {
    _doStartSession();
    typeAndLog('60', '8');
    finishWorkout();
    const session = dbGetSession(state.sessionId);
    expect(session.status).toBe('completed');
    expect(session.end_time).toBeTruthy();
    expect(dbGetActiveSession()).toBeNull();
  });

  it('startSession() refuses to trample an existing active session', () => {
    _doStartSession();
    const first = state.sessionId;
    startSession(); // must show the discard modal instead of creating session 2
    expect(state.sessionId).toBe(first);
    expect(el('confirm-discard').classList.contains('hidden')).toBe(false);
    expect(dbGetActiveSession().session_id).toBe(first);
  });
});

describe('logSet validation', () => {
  beforeEach(() => _doStartSession());

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
  beforeEach(() => _doStartSession());

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
    _doStartSession();
    typeAndLog('60', '8');
    setActiveExercise(OTHER_EXERCISE); // switched but never logged
    finishWorkout();

    resumeLastWorkout();
    expect(dbGetSession(state.sessionId).status).toBe('active');
    expect(state.exercise).toBe(OTHER_EXERCISE); // not the last-logged exercise
    expect(state.setNumber).toBe(1);
  });

  it('resume is refused once the 60-minute window has passed', () => {
    _doStartSession();
    typeAndLog('60', '8');
    finishWorkout();
    vi.advanceTimersByTime(61 * 60 * 1000); // fake clock: push Date past the window
    resumeLastWorkout();
    expect(dbGetSession(state.sessionId).status).toBe('completed');
  });
});

describe('cross-session behaviours', () => {
  function completeFirstSession(weight = '60') {
    _doStartSession();
    typeAndLog(weight, '8');
    finishWorkout();
  }

  it('quick-log repeats last session\'s matching set without typing', () => {
    completeFirstSession('60');
    _doStartSession();
    setActiveExercise(DEFAULT_EXERCISE);
    quickLogSet();
    const [row] = dbGetAllSets(state.sessionId);
    expect([row.weight, row.reps, row.set_number]).toEqual([60, 8, 1]);
    expect(state.setNumber).toBe(2);
  });

  it('an all-time PR still logs the set (celebration never blocks logging)', () => {
    completeFirstSession('60');
    _doStartSession();
    typeAndLog('70', '8'); // beats 60 kg all-time best → PR path
    const [row] = dbGetAllSets(state.sessionId);
    expect(row.weight).toBe(70);
    expect(el('pr-celebration').classList.contains('hidden')).toBe(false);
    expect(state.setNumber).toBe(2);
  });

  it('ghost/quick-log reference never bleeds in from the current session (beforeSessionId guard)', () => {
    completeFirstSession('60');
    _doStartSession();
    typeAndLog('65', '8');
    quickLogSet(); // set 2 — last session had only 1 set → falls back to repeat-last (65)
    const sets = dbGetAllSets(state.sessionId);
    expect(sets.map(s => s.weight)).toEqual([65, 65]);
  });
});

describe('rest timer auto-start (4.6)', () => {
  it('arms after a reps set, not after a timed set', () => {
    _doStartSession();
    typeAndLog('60', '8');
    expect(_restEndTime).not.toBeNull(); // live ESM binding

    stopRestTimer();
    setActiveExercise('Elliptical');
    typeAndLog('20', '150');
    expect(_restEndTime).toBeNull();
  });
});

describe('session notes', () => {
  it('saveNotesNow flushes the textarea to the DB (null when empty)', () => {
    _doStartSession();
    el('session-notes').value = '  felt strong  ';
    saveNotesNow();
    expect(dbGetSession(state.sessionId).notes).toBe('felt strong');

    el('session-notes').value = '';
    saveNotesNow();
    expect(dbGetSession(state.sessionId).notes).toBeNull();
  });
});
