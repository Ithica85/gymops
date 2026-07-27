// Phase 6.2 — Strong / Hevy CSV parsing.
//
// Fixtures are byte-faithful to real export files (verified 2026-07-26),
// including the details that break naive parsers: Strong's sentinel 0 in
// unused Distance/Seconds columns, Hevy's fully-quoted header and 0-based
// set_index, quoted notes containing commas, and the semicolon/decimal-comma
// locale variant.
import { describe, it, expect } from 'vitest';
import { parseImport, resolveImportExercises, detectImportSource } from '../js/import.js';

// Real Strong shape: selective quoting, sentinel zeros, 1-based Set Order.
const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2020-12-30 18:51:52,"Evening Workout",2h 38m,"Bench Press (Barbell)",1,40.0,3,0,0,"","",
2020-12-30 18:51:52,"Evening Workout",2h 38m,"Bench Press (Barbell)",2,50.0,2,0,0,,,
2020-12-30 18:51:52,"Evening Workout",2h 38m,"Squat (Barbell)",1,60.0,4,0,0,,,
2021-01-02 09:00:00,"Morning Workout",45m,"Treadmill Run",1,0,0,5000,1800,,,
`;

// Real Hevy shape: every field quoted in the header, empty numerics bare.
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Pull Up (Assisted)",,"",0,"normal",21,10,,0,8.5
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Leg Press (Machine)",,"",1,"normal",90,12,,0,7.5
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Leg Press (Machine)",,"",2,"warmup",40,15,,0,
`;

describe('format detection', () => {
  it('identifies each vendor from its headers', () => {
    expect(detectImportSource(STRONG).source).toBe('strong');
    expect(detectImportSource(HEVY).source).toBe('hevy');
  });

  it('flags that Strong needs the unit asked and Hevy does not', () => {
    expect(detectImportSource(STRONG).unitKnown).toBe(false);
    expect(detectImportSource(HEVY).unitKnown).toBe(true);
  });

  it('returns null for a file that is not an export', () => {
    expect(detectImportSource('name,age\nbob,3')).toBeNull();
  });

  it('locates columns by name, not position (survives reordering)', () => {
    const reordered = `Exercise Name,Reps,Weight,Date,Set Order,Seconds,Duration,Workout Name
"Squat (Barbell)",5,100,2024-03-01 10:00:00,1,0,1h,"A"
`;
    const p = parseImport(reordered, { unit: 'kg' });
    expect(p.stats.sets).toBe(1);
    expect(p.sessions[0].sets[0].weight).toBe(100);
  });
});

describe('Strong parsing', () => {
  it('groups rows into sessions by date', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    expect(p.stats.sessions).toBe(2);
    expect(p.stats.sets).toBe(4);
    expect(p.label).toBe('Strong');
  });

  it('refuses to guess the unit — the export does not record it', () => {
    expect(() => parseImport(STRONG)).toThrow(/kg or lbs/i);
  });

  it('stamps the caller-supplied unit onto every weighted set', () => {
    const p = parseImport(STRONG, { unit: 'lbs' });
    expect(p.unit).toBe('lbs');
    expect(p.sessions[0].sets[0].unit).toBe('lbs');
  });

  it('derives session end time from the "2h 38m" duration', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    const s = p.sessions[0];
    expect((s.endTime - s.startTime) / 60000).toBe(158); // 2h38m
  });

  it('treats a row with reps as a weight set and one with seconds as timed', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    const lift = p.sessions[0].sets[0];
    expect(lift.reps).toBe(3);
    expect(lift.durationMins).toBeNull();

    const cardio = p.sessions[1].sets[0]; // Treadmill Run, 1800s
    expect(cardio.durationMins).toBe(30);
    expect(cardio.reps).toBeNull();
    expect(cardio.weight).toBeNull();
  });

  it('is not fooled by the sentinel 0 in unused Distance/Seconds columns', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    // Seconds=0 on a lifting row must not make it a timed set
    expect(p.sessions[0].sets.every(s => s.durationMins === null)).toBe(true);
  });
});

describe('Hevy parsing', () => {
  it('parses the "22 Dec 2025, 08:00" timestamp format', () => {
    const p = parseImport(HEVY);
    const d = p.sessions[0].startTime;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(8);
  });

  it('needs no unit question — weight_kg is explicit', () => {
    const p = parseImport(HEVY);
    expect(p.unit).toBe('kg');
    expect(p.unitWasAsked).toBe(false);
  });

  it('keeps set_type so warmups stay identifiable', () => {
    const p = parseImport(HEVY);
    const types = p.sessions[0].sets.map(s => s.setType);
    expect(types).toContain('warmup');
    expect(types).toContain('normal');
  });
});

describe('set numbering is derived, never trusted', () => {
  // Strong is 1-based, Hevy 0-based, and real Hevy exports have been seen
  // running set_index across exercises rather than within one. The DB needs
  // dense per-exercise numbering, so it is recomputed from row order.
  it('numbers sets per exercise within a session, starting at 1', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    const bench = p.sessions[0].sets.filter(s => s.exerciseRaw.startsWith('Bench'));
    const squat = p.sessions[0].sets.filter(s => s.exerciseRaw.startsWith('Squat'));
    expect(bench.map(s => s.setNumber)).toEqual([1, 2]);
    expect(squat.map(s => s.setNumber)).toEqual([1]);
  });

  it('ignores Hevy\'s 0-based cross-exercise set_index', () => {
    const p = parseImport(HEVY);
    const legPress = p.sessions[0].sets.filter(s => s.exerciseRaw.startsWith('Leg Press'));
    expect(legPress.map(s => s.setNumber)).toEqual([1, 2]);
  });
});

describe('messy real-world files', () => {
  it('handles quoted notes containing commas and escaped quotes', () => {
    const csv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-03-01 10:00:00,"Push, Pull",1h,"Squat (Barbell)",1,100,5,0,0,"felt ""easy"", went up","Good, solid day",
`;
    const p = parseImport(csv, { unit: 'kg' });
    expect(p.stats.sets).toBe(1);
    expect(p.sessions[0].name).toBe('Push, Pull');
    expect(p.sessions[0].notes).toBe('Good, solid day');
  });

  it('handles the semicolon + decimal-comma locale variant', () => {
    const csv = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2024-03-01 10:00:00;Abend;1h;Bankdrücken;1;62,5;8;0;0;;;
`;
    const p = parseImport(csv, { unit: 'kg' });
    expect(p.sessions[0].sets[0].weight).toBe(62.5);
  });

  it('skips unreadable rows without losing the rest of the file', () => {
    const csv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
not-a-date,"X",1h,"Squat (Barbell)",1,100,5,0,0,,,
2024-03-01 10:00:00,"X",1h,"Squat (Barbell)",1,100,5,0,0,,,
`;
    const p = parseImport(csv, { unit: 'kg' });
    expect(p.stats.sets).toBe(1);
    expect(p.stats.skipped).toBe(1);
    expect(p.warnings[0]).toMatch(/unreadable date/);
  });

  it('tolerates a UTF-8 BOM and CRLF line endings', () => {
    const csv = '﻿Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\r\n2024-03-01 10:00:00,"X",1h,"Squat (Barbell)",1,100,5,0,0,,,\r\n';
    expect(parseImport(csv, { unit: 'kg' }).stats.sets).toBe(1);
  });

  it('gives actionable errors rather than stack traces', () => {
    expect(() => parseImport('')).toThrow(/empty/i);
    expect(() => parseImport('a,b\n')).toThrow(/Strong or Hevy/i);
  });
});

describe('exercise resolution over a parsed file', () => {
  it('resolves confident names and isolates the ones needing a decision', () => {
    const p = parseImport(STRONG, { unit: 'kg' });
    const { resolved, needsDecision } = resolveImportExercises(p);

    expect(resolved.get('Bench Press (Barbell)').name).toBe('Barbell Bench Press');
    expect(resolved.get('Squat (Barbell)').name).toBe('Barbell Back Squat');
    expect(resolved.get('Treadmill Run').name).toBe('Treadmill Run');
    expect(needsDecision).toHaveLength(0);
  });

  it('surfaces an unrecognised name for the user instead of writing it blind', () => {
    const csv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-03-01 10:00:00,"X",1h,"Incline Bench Press Machine Thing",1,50,8,0,0,,,
`;
    const { needsDecision } = resolveImportExercises(parseImport(csv, { unit: 'kg' }));
    expect(needsDecision).toHaveLength(1);
    expect(needsDecision[0].candidates.length).toBeGreaterThan(0);
  });
});
