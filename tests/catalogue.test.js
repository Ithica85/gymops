// Integrity tests for the exercise catalogue (v3.6 expansion).
// These guard the rules documented on EXERCISES in state.js — especially name
// stability, since logged sets reference exercises by name.
import { describe, it, expect } from 'vitest';
import { EXERCISES, MUSCLE_GROUPS, getExerciseType, getExerciseGroup } from '../js/state.js';

// The pre-v3.6 catalogue. These names are stored in the user's set history —
// if one of these assertions fails, a rename just orphaned real logged data.
const LEGACY = [
  ['Seated Shoulder Press', 'reps'], ['Goblet Squats', 'reps'],
  ['Rear Delt Fly', 'reps'], ['Hamstring Curls', 'reps'],
  ['Elliptical', 'timed'], ['Stairmaster', 'timed'],
  ['Assisted Dips', 'reps'], ['Assisted Pull Ups', 'reps'],
  ['Press Ups', 'reps'], ['Bent Over Rows', 'reps'],
  ['Push Up to Downward Dog', 'reps'], ['Staggered Kettlebell Halo', 'reps'],
  ["Farmer's Carries", 'reps'], ['Seated Leg Press', 'reps'],
  ['Chest Press', 'reps'], ['Deadlifts', 'reps'],
];

describe('exercise catalogue integrity', () => {
  it('all names are unique', () => {
    const names = EXERCISES.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every entry has a valid type and muscle group', () => {
    for (const e of EXERCISES) {
      expect(['reps', 'timed'], `${e.name} type`).toContain(e.type);
      if (e.name === 'Other') expect(e.muscleGroup).toBeNull();
      else expect(MUSCLE_GROUPS, `${e.name} group`).toContain(e.muscleGroup);
    }
  });

  it('every legacy exercise survives with its exact name and type', () => {
    for (const [name, type] of LEGACY) {
      const entry = EXERCISES.find(e => e.name === name);
      expect(entry, `legacy exercise "${name}" missing — this orphans history`).toBeDefined();
      expect(entry.type, `legacy exercise "${name}" changed type`).toBe(type);
    }
  });

  it('EXERCISES[0] is the default plan-less starting exercise', () => {
    expect(EXERCISES[0].name).toBe('Seated Shoulder Press');
  });

  it('Other is the last entry', () => {
    expect(EXERCISES[EXERCISES.length - 1].name).toBe('Other');
  });

  it('catalogue is genuinely expanded (≥100 real exercises)', () => {
    expect(EXERCISES.length - 1).toBeGreaterThanOrEqual(100); // excluding Other
  });

  it('every muscle group has a healthy number of exercises', () => {
    for (const g of MUSCLE_GROUPS) {
      const count = EXERCISES.filter(e => e.muscleGroup === g).length;
      expect(count, `${g} has only ${count}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('all Cardio entries are timed; timed entries are only Cardio or Core', () => {
    for (const e of EXERCISES.filter(e => e.muscleGroup === 'Cardio')) {
      expect(e.type, `${e.name} should be timed`).toBe('timed');
    }
    for (const e of EXERCISES.filter(e => e.type === 'timed')) {
      expect(['Cardio', 'Core'], `${e.name} is timed but in ${e.muscleGroup}`).toContain(e.muscleGroup);
    }
  });

  it('getExerciseGroup resolves catalogue names and nulls unknowns', () => {
    expect(getExerciseGroup('Deadlifts')).toBe('Back');
    expect(getExerciseGroup('Plank')).toBe('Core');
    expect(getExerciseGroup('My Custom Movement')).toBeNull();
    expect(getExerciseGroup('Other')).toBeNull();
  });

  it('getExerciseType still resolves new entries and falls back to reps', () => {
    expect(getExerciseType('Rowing Machine')).toBe('timed');
    expect(getExerciseType('Barbell Curl')).toBe('reps');
    expect(getExerciseType('Some Custom Thing')).toBe('reps');
  });
});
