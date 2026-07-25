// AI routine import (js/plan-import.js) — the pure mapping/validation layer
// that turns untrusted model JSON into an editor draft. Network + DOM paths are
// covered by the browser smoke test; here we pin catalogue mapping and the
// clamping/limits that keep bad model output from reaching the editor.
import { describe, it, expect } from 'vitest';
import { EXERCISES, getExerciseType } from '../js/state.js';
import { _test } from '../js/plan-import.js';

const { _toDraft, _mapExercise } = _test;

// A known reps exercise from the catalogue (skip the placeholder at [0]).
const SAMPLE = EXERCISES.find((e, i) => i > 0 && e.type === 'reps');

describe('_mapExercise', () => {
  it('maps case/spacing/punctuation variants onto the canonical catalogue name', () => {
    expect(_mapExercise(SAMPLE.name.toUpperCase())).toEqual({ exercise: SAMPLE.name, type: SAMPLE.type });
    const messy = '  ' + SAMPLE.name.toLowerCase().replace(/\s+/g, '--') + ' ';
    expect(_mapExercise(messy).exercise).toBe(SAMPLE.name);
  });

  it('keeps an unknown name as custom, typed via getExerciseType', () => {
    const name = 'Zercher Zombie Curl';
    expect(_mapExercise(name)).toEqual({ exercise: name, type: getExerciseType(name) });
  });

  it('trims and tolerates empty/nullish names', () => {
    expect(_mapExercise('  Weird Move  ').exercise).toBe('Weird Move');
    expect(_mapExercise(null).exercise).toBe('');
  });
});

describe('_toDraft', () => {
  it('clamps numbers, caps lengths, and drops empty days/exercises', () => {
    const draft = _toDraft({
      name: 'X'.repeat(100),
      duration_weeks: 999,
      objectives: ['a', 'b', 'c', 'd', 'e'],
      days: [
        { name: 'Push', exercises: [
          { exercise: SAMPLE.name, sets: 50, reps: -3 },
          { exercise: '', sets: 3, reps: 8 }, // empty name → dropped
        ] },
        { name: 'Empty', exercises: [] },       // no exercises → dropped
      ],
    });
    expect(draft.name.length).toBe(60);
    expect(draft.durationWeeks).toBe(52);       // 999 → max 52
    expect(draft.objectives.length).toBe(3);
    expect(draft.days.length).toBe(1);          // empty day gone
    expect(draft.days[0].name).toBe('Push');
    expect(draft.days[0].exercises.length).toBe(1); // empty-name row gone
    expect(draft.days[0].exercises[0].targetSets).toBe(20); // 50 → max 20
    expect(draft.days[0].exercises[0].targetReps).toBe(1);  // -3 → min 1
    expect(draft.days[0].dayId).toBeNull();     // always a new day
  });

  it('caps days at 7 and exercises per day at 12', () => {
    const many = _toDraft({
      days: Array.from({ length: 10 }, (_, i) => ({
        name: 'D' + i,
        exercises: Array.from({ length: 15 }, () => ({ exercise: SAMPLE.name, sets: 3, reps: 8 })),
      })),
    });
    expect(many.days.length).toBe(7);
    expect(many.days[0].exercises.length).toBe(12);
  });

  it('null/empty targets survive as null, not 0', () => {
    const draft = _toDraft({ days: [{ name: 'A', exercises: [{ exercise: SAMPLE.name, sets: null, reps: null }] }] });
    expect(draft.days[0].exercises[0].targetSets).toBeNull();
    expect(draft.days[0].exercises[0].targetReps).toBeNull();
  });

  it('handles missing/nullish plans without throwing', () => {
    expect(_toDraft({}).days).toEqual([]);
    expect(_toDraft(null).name).toBe('Imported Plan');
    expect(_toDraft(undefined).durationWeeks).toBeNull();
  });
});
