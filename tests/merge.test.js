// Phase 6.2 — merging one exercise identity into another.
//
// The counterpart to import's conservative "keep as new" default: keeping a
// variant separate is only safe advice because it can be folded in later.
//
// The test that matters most is the set-numbering one. A naive merge leaves a
// session with two sets numbered 1, which every per-set query assumes cannot
// happen.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB, dbMergeExercise, dbGetExercise, dbGetAllExercises,
  dbCreateSession, dbInsertSet, dbFinishSession, dbGetAllSets,
  dbCreatePlan, dbSavePlanExercises, dbGetPlanExercises,
} from '../js/db.js';

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

function sessionWithBoth() {
  const sid = dbCreateSession('kg');
  dbInsertSet(sid, 'Barbell Bench Press', 1, 100, 5, null, null, 'kg');
  dbInsertSet(sid, 'Barbell Bench Press', 2, 105, 3, null, null, 'kg');
  dbInsertSet(sid, 'Benchpress Variant', 1, 60, 8, null, null, 'kg');
  dbInsertSet(sid, 'Benchpress Variant', 2, 65, 6, null, null, 'kg');
  dbFinishSession(sid);
  return sid;
}

describe('dbMergeExercise', () => {
  it('moves every set onto the target identity and name', () => {
    const sid = sessionWithBoth();
    const from = dbGetExercise('Benchpress Variant');
    const into = dbGetExercise('Barbell Bench Press');

    const result = dbMergeExercise(from.exercise_id, into.exercise_id);

    expect(result).toEqual({ merged: 'Benchpress Variant', into: 'Barbell Bench Press', sessions: 1 });
    const sets = dbGetAllSets(sid);
    expect(sets).toHaveLength(4);
    expect(sets.every(s => s.exercise === 'Barbell Bench Press')).toBe(true);
    expect(sets.every(s => s.exercise_id === into.exercise_id)).toBe(true);
  });

  it('retires the source identity so it cannot be picked again', () => {
    const from = dbGetExercise('Barbell Curl');
    const into = dbGetExercise('Dumbbell Curl');
    dbMergeExercise(from.exercise_id, into.exercise_id);

    expect(dbGetExercise('Barbell Curl')).toBeNull();
    expect(dbGetAllExercises().some(e => e.name === 'Dumbbell Curl')).toBe(true);
  });

  it('resequences set numbers so a session never has two set 1s', () => {
    // The bug this exists for: both exercises had a set 1 and a set 2.
    const sid = sessionWithBoth();
    const from = dbGetExercise('Benchpress Variant');
    const into = dbGetExercise('Barbell Bench Press');

    dbMergeExercise(from.exercise_id, into.exercise_id);

    const numbers = dbGetAllSets(sid).map(s => s.set_number).sort();
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it('preserves original logging order through the resequence', () => {
    const sid = sessionWithBoth();
    dbMergeExercise(dbGetExercise('Benchpress Variant').exercise_id,
                    dbGetExercise('Barbell Bench Press').exercise_id);

    const byNumber = dbGetAllSets(sid).sort((a, b) => a.set_number - b.set_number);
    expect(byNumber.map(s => s.weight)).toEqual([100, 105, 60, 65]);
  });

  it('moves plan entries too, so a plan cannot reference a deleted identity', () => {
    const planId = dbCreatePlan('P', '2026-07-01', null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Day 1', exercises: [{ exercise: 'Barbell Curl', targetSets: 3, targetReps: 10 }] },
    ]);
    const from = dbGetExercise('Barbell Curl');
    const into = dbGetExercise('Dumbbell Curl');

    dbMergeExercise(from.exercise_id, into.exercise_id);

    const exs = dbGetPlanExercises(planId);
    expect(exs[0].exercise).toBe('Dumbbell Curl');
    expect(exs[0].exercise_id).toBe(into.exercise_id);
  });

  it('collapses a plan day that listed both exercises into one entry', () => {
    const planId = dbCreatePlan('P', '2026-07-01', null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Day 1', exercises: [
        { exercise: 'Barbell Curl',  targetSets: 3, targetReps: 10 },
        { exercise: 'Dumbbell Curl', targetSets: 4, targetReps: 8 },
      ] },
    ]);

    dbMergeExercise(dbGetExercise('Barbell Curl').exercise_id,
                    dbGetExercise('Dumbbell Curl').exercise_id);

    // Without the dedupe the day lists Dumbbell Curl twice, which shows as a
    // duplicate row in the plan viewer and double-counts in adherence.
    const exs = dbGetPlanExercises(planId);
    expect(exs).toHaveLength(1);
    expect(exs[0].exercise).toBe('Dumbbell Curl');
  });

  it('keeps one entry per day when the merged exercise spans several days', () => {
    const planId = dbCreatePlan('P', '2026-07-01', null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Push', exercises: [{ exercise: 'Barbell Curl',  targetSets: 3, targetReps: 10 }] },
      { dayId: null, name: 'Pull', exercises: [{ exercise: 'Dumbbell Curl', targetSets: 3, targetReps: 10 }] },
    ]);

    dbMergeExercise(dbGetExercise('Barbell Curl').exercise_id,
                    dbGetExercise('Dumbbell Curl').exercise_id);

    expect(dbGetPlanExercises(planId)).toHaveLength(2);
  });

  it('survives a reload', async () => {
    const sid = sessionWithBoth();
    dbMergeExercise(dbGetExercise('Benchpress Variant').exercise_id,
                    dbGetExercise('Barbell Bench Press').exercise_id);
    await initDB();
    expect(dbGetAllSets(sid).every(s => s.exercise === 'Barbell Bench Press')).toBe(true);
    expect(dbGetExercise('Benchpress Variant')).toBeNull();
  });

  it('refuses a self-merge and a missing identity', () => {
    const into = dbGetExercise('Barbell Bench Press');
    expect(() => dbMergeExercise(into.exercise_id, into.exercise_id)).toThrow(/different exercise/i);
    expect(() => dbMergeExercise(999999, into.exercise_id)).toThrow(/no longer exists/i);
  });

  it('works when the source has no history at all', () => {
    const from = dbGetExercise('Ski Erg');
    const into = dbGetExercise('Rowing Machine');
    expect(dbMergeExercise(from.exercise_id, into.exercise_id).sessions).toBe(0);
    expect(dbGetExercise('Ski Erg')).toBeNull();
  });
});
