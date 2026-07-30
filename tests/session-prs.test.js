// All-time PR summary on the completed screen (Agent 1 structured debrief).
//
// Driven against a REAL in-memory sql.js DB, not the mock signals.test.js uses,
// and deliberately so: the entire risk here is an interaction with real SQL.
// `dbGetAllTimeBestForExercise` filters `status = 'completed'`, and by the time
// the completed screen renders, dbFinishSession has already flipped this session
// to completed — so without an explicit exclusion the session is its own
// baseline and no PR can ever be detected. A mocked db would happily confirm
// whatever I assumed instead of catching that.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDB, dbGetAllTimeBestForExercise, dbFinishSession } from '../js/db.js';
import { state } from '../js/state.js';
import { computeSessionPRs, renderSessionPRs } from '../js/signals.js';
import { _doStartSession, logSet, finishWorkout, setActiveExercise, isAllTimePR } from '../js/workout.js';

const BENCH = 'Barbell Bench Press';
const ROW   = 'Bent Over Rows';
const el = id => document.getElementById(id);

function log(weight, reps) {
  el('input-weight').value = String(weight);
  el('input-reps').value   = String(reps);
  logSet();
}

// A completed session in the past, so later sessions have something to beat.
function completedSession(exercise, weight) {
  _doStartSession({ exercise });
  log(weight, 5);
  const id = state.sessionId;
  dbFinishSession(id);
  return id;
}

beforeEach(async () => {
  localStorage.clear();
  await initDB();
  vi.useFakeTimers();
  state.sessionId = null;
});

afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('computeSessionPRs', () => {
  it('reports an all-time PR set during the session', () => {
    completedSession(BENCH, 90);

    _doStartSession({ exercise: BENCH });
    log(95, 5);
    dbFinishSession(state.sessionId);

    const prs = computeSessionPRs(state.sessionId);
    expect(prs).toHaveLength(1);
    expect(prs[0].exercise).toBe(BENCH);
    expect(prs[0].weight).toBe(95);
  });

  // The bug this feature would have shipped with. Before the excludeSessionId
  // param, the just-finished session counted as its own history, so its best
  // could never exceed the all-time best — PRs would silently never appear.
  it('does not treat the just-finished session as its own baseline', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    const id = state.sessionId;
    dbFinishSession(id);

    // Unfiltered, this session IS the all-time best — which is why the
    // exclusion has to exist rather than the compute relying on ordering.
    expect(dbGetAllTimeBestForExercise(BENCH)).toBe(95);
    expect(dbGetAllTimeBestForExercise(BENCH, id)).toBe(90);
    expect(computeSessionPRs(id)).toHaveLength(1);
  });

  it('says nothing when the session merely matched the previous best', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(90, 8); // more reps, same weight — not a weight PR
    dbFinishSession(state.sessionId);
    expect(computeSessionPRs(state.sessionId)).toEqual([]);
  });

  it('says nothing when the session went backwards', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(85, 5);
    dbFinishSession(state.sessionId);
    expect(computeSessionPRs(state.sessionId)).toEqual([]);
  });

  // Matches isAllTimePR: a first-ever exercise has nothing to beat, so calling
  // it a personal record would be flattery rather than information.
  it('never calls a first-ever exercise a PR', () => {
    _doStartSession({ exercise: BENCH });
    log(100, 5);
    dbFinishSession(state.sessionId);
    expect(computeSessionPRs(state.sessionId)).toEqual([]);
  });

  it('reports every exercise that set one', () => {
    completedSession(BENCH, 90);
    completedSession(ROW, 60);

    _doStartSession({ exercise: BENCH });
    log(95, 5);
    setActiveExercise(ROW);
    log(65, 5);
    dbFinishSession(state.sessionId);

    const names = computeSessionPRs(state.sessionId).map(p => p.exercise).sort();
    expect(names).toEqual([BENCH, ROW].sort());
  });

  it('ignores an exercise that did not improve while another did', () => {
    completedSession(BENCH, 90);
    completedSession(ROW, 60);

    _doStartSession({ exercise: BENCH });
    log(95, 5);
    setActiveExercise(ROW);
    log(55, 5); // down
    dbFinishSession(state.sessionId);

    expect(computeSessionPRs(state.sessionId).map(p => p.exercise)).toEqual([BENCH]);
  });

  it('compares across mixed units by normalising to kg', () => {
    localStorage.setItem('gymops_weight_unit', 'lbs');
    completedSession(BENCH, 220); // lbs ≈ 99.8 kg
    localStorage.setItem('gymops_weight_unit', 'kg');

    _doStartSession({ exercise: BENCH });
    log(95, 5); // 95 kg < 99.8 kg — lower despite the bigger number
    dbFinishSession(state.sessionId);

    expect(computeSessionPRs(state.sessionId)).toEqual([]);
  });
});

// The contradiction guard. If these two ever disagree, the completed screen
// tells the user something different from the celebration they just watched.
describe('agrees with the in-session celebration', () => {
  it('summarises exactly the PRs isAllTimePR fired on', () => {
    completedSession(BENCH, 90);
    completedSession(ROW, 60);

    _doStartSession({ exercise: BENCH });
    const celebrated = [];

    // isAllTimePR is evaluated BEFORE the insert, exactly as logSet does it.
    const attempt = (exercise, kg) => {
      if (isAllTimePR(exercise, state.sessionId, kg)) celebrated.push(exercise);
      log(kg, 5);
    };
    attempt(BENCH, 95);   // PR
    setActiveExercise(ROW);
    attempt(ROW, 58);     // below 60 — no PR
    dbFinishSession(state.sessionId);

    expect(celebrated).toEqual([BENCH]);
    expect(computeSessionPRs(state.sessionId).map(p => p.exercise)).toEqual(celebrated);
  });

  it('reports one PR per exercise even when it was beaten twice in a session', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    // Both celebrate in-session (that is deliberate in isAllTimePR), but the
    // debrief is a summary — it states the session's best once.
    expect(isAllTimePR(BENCH, state.sessionId, 92)).toBe(true);
    log(92, 5);
    expect(isAllTimePR(BENCH, state.sessionId, 95)).toBe(true);
    log(95, 3);
    dbFinishSession(state.sessionId);

    const prs = computeSessionPRs(state.sessionId);
    expect(prs).toHaveLength(1);
    expect(prs[0].weight).toBe(95);
  });
});

describe('renderSessionPRs', () => {
  it('renders a single PR and reveals the line', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    dbFinishSession(state.sessionId);

    renderSessionPRs(state.sessionId);
    expect(el('session-prs').classList.contains('hidden')).toBe(false);
    expect(el('session-prs').textContent).toBe(`🏆 All-time PR — ${BENCH} 95 kg`);
  });

  it('lists multiple PRs one per line rather than wrapping a run-on', () => {
    completedSession(BENCH, 90);
    completedSession(ROW, 60);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    setActiveExercise(ROW);
    log(65, 5);
    dbFinishSession(state.sessionId);

    renderSessionPRs(state.sessionId);
    const lines = el('session-prs').textContent.split('\n');
    expect(lines[0]).toBe('\u{1F3C6} All-time PRs');
    expect(lines.slice(1).sort()).toEqual([`${BENCH} 95\u00A0kg`, `${ROW} 65\u00A0kg`].sort());
  });

  // Both invisible, both load-bearing, both easy for an editor to 'tidy' away:
  // the NBSP stops a wrap splitting "95 kg", and pre-line is what turns the
  // newlines above into actual lines instead of collapsed whitespace.
  it('keeps the weight and its unit unbreakable', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    dbFinishSession(state.sessionId);
    renderSessionPRs(state.sessionId);
    expect(el('session-prs').textContent).toContain('95\u00A0kg');
    expect(el('session-prs').textContent).not.toContain('95 kg');
  });

  // The leak class this codebase keeps meeting: hiding without clearing leaves
  // last session's PR sitting in the DOM, ready to reappear.
  it('clears the text, not just the visibility, when there is no PR', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    dbFinishSession(state.sessionId);
    renderSessionPRs(state.sessionId);
    expect(el('session-prs').textContent).not.toBe('');

    // A later session with no PR must leave nothing behind.
    _doStartSession({ exercise: BENCH });
    log(80, 5);
    dbFinishSession(state.sessionId);
    renderSessionPRs(state.sessionId);
    expect(el('session-prs').textContent).toBe('');
    expect(el('session-prs').classList.contains('hidden')).toBe(true);
  });

  it('is wired into finishWorkout, not just callable', () => {
    completedSession(BENCH, 90);
    _doStartSession({ exercise: BENCH });
    log(95, 5);
    el('session-prs').textContent = '';
    finishWorkout();
    expect(el('session-prs').textContent).toContain(BENCH);
    expect(el('session-prs').classList.contains('hidden')).toBe(false);
  });
});
