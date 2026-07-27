// Phase 6.2 — exercise name resolution.
//
// The fixtures below use REAL exercise names as they appear in Strong and Hevy
// CSV exports (verified against published sample files, 2026-07-26), not names
// invented to make the resolver look good. Both sources name exercises
// `Base (Equipment)`; the GymOps catalogue mostly names them `Equipment Base`
// and leans British/plural. Bridging those two conventions mechanically is the
// entire job.
//
// The load-bearing test in this file is the last describe block: a near miss
// must NOT become a custom exercise. That is what stops a switcher's history
// fragmenting on import day.
import { describe, it, expect } from 'vitest';
import { resolveExerciseName, isConfidentMatch, _ALIASES } from '../js/aliases.js';
import { EXERCISES } from '../js/state.js';

const CATALOGUE = EXERCISES.filter(e => e.name !== 'Other').map(e => e.name);

describe('exact and normalised matching', () => {
  it('resolves every catalogue name to itself', () => {
    for (const name of CATALOGUE) {
      const r = resolveExerciseName(name);
      expect(r.name, name).toBe(name);
      expect(r.match, name).toBe('exact');
    }
  });

  it('is case, punctuation and spacing insensitive', () => {
    for (const raw of ['barbell bench press', 'BARBELL BENCH PRESS', 'Barbell  Bench-Press']) {
      expect(resolveExerciseName(raw).name).toBe('Barbell Bench Press');
    }
  });

  it('folds singular/plural in both directions', () => {
    expect(resolveExerciseName('Deadlift').name).toBe('Deadlifts');       // source singular
    expect(resolveExerciseName('Front Squats').name).toBe('Front Squat'); // source plural
    expect(resolveExerciseName('Lateral Raise').name).toBe('Lateral Raises');
  });

  it('does not mangle words ending in "ss"', () => {
    expect(resolveExerciseName('Chest Press').name).toBe('Chest Press');
    expect(resolveExerciseName('Leg Press (Machine)').name).toBe('Seated Leg Press');
  });
});

describe('equipment suffix — the Strong/Hevy convention', () => {
  // Reordering onto the front is what makes the alias table stay small.
  it('reorders "Base (Equipment)" into "Equipment Base"', () => {
    expect(resolveExerciseName('Bench Press (Barbell)').name).toBe('Barbell Bench Press');
    expect(resolveExerciseName('Shoulder Press (Dumbbell)').name).toBe('Dumbbell Shoulder Press');
    expect(resolveExerciseName('Bench Press (Dumbbell)').name).toBe('Dumbbell Bench Press');
    expect(resolveExerciseName('Curl (Barbell)').name).toBe('Barbell Curl');
    expect(resolveExerciseName('Shrug (Barbell)').name).toBe('Barbell Shrugs');
  });

  it('strips equipment when the base alone is the catalogue name', () => {
    expect(resolveExerciseName('Lat Pulldown (Cable)').name).toBe('Lat Pulldown');
    expect(resolveExerciseName('Hip Thrust (Barbell)').name).toBe('Hip Thrust');
    expect(resolveExerciseName('Face Pull (Cable)').name).toBe('Face Pulls');
  });

  it('handles real Hevy sample rows', () => {
    expect(resolveExerciseName('Pull Up (Assisted)').name).toBe('Assisted Pull Ups');
    expect(resolveExerciseName('Seated Shoulder Press (Machine)').name).toBe('Seated Shoulder Press');
    expect(resolveExerciseName('Leg Press (Machine)').name).toBe('Seated Leg Press');
  });

  it('marks equipment-derived matches so import can report how it resolved', () => {
    expect(resolveExerciseName('Bench Press (Barbell)').match).toBe('equipment');
  });

  it('refuses a match that contradicts the source equipment (regression)', () => {
    // Found by sweeping real export names: stripping "(Dumbbell)" and matching
    // the base alone resolved to "Incline Barbell Bench Press" — a confident,
    // silent merge of two different lifts. Equipment the source specified can
    // never be discarded in favour of hardware that contradicts it.
    expect(resolveExerciseName('Incline Bench Press (Dumbbell)').name).toBe('Incline Dumbbell Press');
    expect(resolveExerciseName('Incline Bench Press (Barbell)').name).toBe('Incline Barbell Bench Press');
    expect(resolveExerciseName('Bench Press (Dumbbell)').name).toBe('Dumbbell Bench Press');
    expect(resolveExerciseName('Bench Press (Barbell)').name).toBe('Barbell Bench Press');
  });

  it('non-hardware qualifiers do not count as contradictions', () => {
    // "Assisted"/"Weighted" describe how a lift was loaded, not what it was
    // performed on, so they must not block an otherwise good match.
    expect(resolveExerciseName('Pull Up (Assisted)').name).toBe('Assisted Pull Ups');
    expect(resolveExerciseName('Crunch (Weighted)').name).toBe('Crunches');
  });

  it('does NOT treat a non-equipment parenthetical as equipment', () => {
    // "(Left Arm)" is a different exercise, not a qualifier to discard —
    // merging it into the two-arm version would corrupt history.
    const r = resolveExerciseName('Bicep Curl (Left Arm)');
    expect(r.match).not.toBe('equipment');
    expect(r.name).toBe('Bicep Curl (Left Arm)');
  });
});

describe('curated aliases', () => {
  it('bridges names the mechanical rules cannot', () => {
    expect(resolveExerciseName('Squat (Barbell)').name).toBe('Barbell Back Squat');
    expect(resolveExerciseName('Seated Row (Cable)').name).toBe('Seated Cable Row');
    expect(resolveExerciseName('Lying Leg Curl (Machine)').name).toBe('Hamstring Curls');
    expect(resolveExerciseName('Push Up').name).toBe('Press Ups'); // British catalogue
    expect(resolveExerciseName('RDL').name).toBe('Romanian Deadlift');
  });

  it('maps cardio names onto the right catalogue entries', () => {
    expect(resolveExerciseName('Running').name).toBe('Treadmill Run');
    expect(resolveExerciseName('Rowing').name).toBe('Rowing Machine');
    expect(resolveExerciseName('Cycling').name).toBe('Stationary Bike');
  });

  it('every alias target is a real catalogue name (table cannot rot silently)', () => {
    for (const [from, to] of Object.entries(_ALIASES)) {
      expect(CATALOGUE, `alias "${from}" → "${to}"`).toContain(to);
    }
  });

  it('carries the resolved exercise type, not a guess', () => {
    expect(resolveExerciseName('Running').type).toBe('timed');
    expect(resolveExerciseName('Bench Press (Barbell)').type).toBe('reps');
  });
});

describe('a near miss is never silently made custom', () => {
  // The rule the whole module exists for.
  it('returns candidates for confirmation instead of inventing an exercise', () => {
    const r = resolveExerciseName('Incline Bench Press Machine Thing');
    expect(r.match).toBe('ambiguous');
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(isConfidentMatch(r)).toBe(false);
  });

  it('keeps the cleaned original as the name so "keep as new" is one tap', () => {
    const r = resolveExerciseName('  Weird Row Variation  ');
    expect(r.name).toBe('Weird Row Variation');
  });

  it('only confident matches may be written without asking', () => {
    expect(isConfidentMatch(resolveExerciseName('Barbell Bench Press'))).toBe(true);  // exact
    expect(isConfidentMatch(resolveExerciseName('barbell bench press'))).toBe(true);  // normalised
    expect(isConfidentMatch(resolveExerciseName('Bench Press (Barbell)'))).toBe(true); // equipment
    expect(isConfidentMatch(resolveExerciseName('RDL'))).toBe(true);                   // alias
  });

  it('a genuinely novel name resolves to custom with an inferred type', () => {
    const r = resolveExerciseName('Zercher Yoke Carry');
    expect(r.match).toBe('custom');
    expect(r.candidates).toHaveLength(0);
    expect(r.name).toBe('Zercher Yoke Carry');
  });

  it('infers timed for a custom cardio name', () => {
    expect(resolveExerciseName('Airdyne Bike Sprint').type).toBe('timed');
  });

  it('handles empty and junk input without throwing', () => {
    expect(resolveExerciseName('').match).toBe('custom');
    expect(resolveExerciseName(null).name).toBe('');
    expect(resolveExerciseName(undefined).name).toBe('');
  });
});
