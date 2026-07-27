// Phase 6.2 — the import write path.
//
// This is the largest irreversible write in the app, so the tests that matter
// most here are not "does it insert rows" but:
//   · is a snapshot taken before anything is written (A6)
//   · can the whole import be undone
//   · does re-importing the same file double the user's history
//   · do imported sets carry their ORIGINAL dates, not the import moment
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbImportSessions, dbSnapshotBeforeImport, dbUndoImport,
  dbHasImportSnapshot, dbDiscardImportSnapshot, dbResetWorkoutData,
  dbGetAllSets, dbGetAllPlans, dbCreateSession, dbInsertSet, dbFinishSession,
} from '../js/db.js';
import { parseImport, resolveImportExercises } from '../js/import.js';

const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2020-12-30 18:51:52,"Evening Workout",2h 38m,"Bench Press (Barbell)",1,40.0,3,0,0,,,
2020-12-30 18:51:52,"Evening Workout",2h 38m,"Bench Press (Barbell)",2,50.0,2,0,0,,"felt good",
2021-01-02 09:00:00,"Cardio",45m,"Treadmill Run",1,0,0,5000,1800,,,
`;

// Mirrors what the UI will do: parse, resolve names, then hand final names in.
function prepare(csv, unit = 'kg') {
  const parsed = parseImport(csv, { unit });
  const { resolved } = resolveImportExercises(parsed);
  for (const s of parsed.sessions) {
    for (const set of s.sets) set.exercise = resolved.get(set.exerciseRaw).name;
  }
  return parsed;
}

function allSets() {
  // Node test env runs the localStorage path; read every set across sessions.
  return [1, 2, 3, 4, 5].flatMap(id => dbGetAllSets(id));
}

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

describe('writing an import', () => {
  it('creates completed sessions and their sets', () => {
    const parsed = prepare(STRONG);
    const result = dbImportSessions(parsed.sessions, { unit: parsed.unit });

    expect(result.sessions).toBe(2);
    expect(result.sets).toBe(3);
    expect(result.duplicateSessions).toBe(0);
  });

  it('resolves names on the way in — history lands on catalogue exercises', () => {
    const parsed = prepare(STRONG);
    dbImportSessions(parsed.sessions, { unit: parsed.unit });

    const names = allSets().map(s => s.exercise);
    expect(names).toContain('Barbell Bench Press'); // not "Bench Press (Barbell)"
    expect(names).toContain('Treadmill Run');
  });

  it('stamps sets with the ORIGINAL session date, not the import moment', () => {
    // The bug this guards: using now() would collapse years of training onto
    // today and break every chart and progression query in the app.
    const parsed = prepare(STRONG);
    dbImportSessions(parsed.sessions, { unit: parsed.unit });

    const stamps = allSets().map(s => s.timestamp);
    expect(stamps.every(t => t.startsWith('2020') || t.startsWith('2021'))).toBe(true);
  });

  it('honours the unit the user chose for a Strong file', () => {
    const parsed = prepare(STRONG, 'lbs');
    dbImportSessions(parsed.sessions, { unit: parsed.unit });
    expect(allSets().filter(s => s.weight != null).every(s => s.unit === 'lbs')).toBe(true);
  });

  it('writes timed and weighted sets in the schema-legal shape', () => {
    const parsed = prepare(STRONG);
    dbImportSessions(parsed.sessions, { unit: parsed.unit });

    for (const s of allSets()) {
      const weighted = s.weight != null && s.reps != null;
      const timed    = s.duration_mins != null;
      expect(weighted !== timed).toBe(true); // exactly one, never both, never neither
    }
  });
});

describe('re-import does not double history', () => {
  it('skips sessions whose start time already exists', () => {
    const first = dbImportSessions(prepare(STRONG).sessions, { unit: 'kg' });
    expect(first.sessions).toBe(2);

    const second = dbImportSessions(prepare(STRONG).sessions, { unit: 'kg' });
    expect(second.sessions).toBe(0);
    expect(second.sets).toBe(0);
    expect(second.duplicateSessions).toBe(2);
  });
});

describe('snapshot and undo (A6)', () => {
  it('has no snapshot before one is taken', async () => {
    expect(await dbHasImportSnapshot()).toBe(false);
  });

  it('undo restores the database to exactly its pre-import state', async () => {
    // Pre-existing history that must survive the round trip
    const sid = dbCreateSession('kg');
    dbInsertSet(sid, 'Barbell Bench Press', 1, 100, 5, null, null, 'kg');
    dbFinishSession(sid);

    await dbSnapshotBeforeImport();
    expect(await dbHasImportSnapshot()).toBe(true);

    dbImportSessions(prepare(STRONG).sessions, { unit: 'kg' });
    await initDB(); // reboot to prove the import really landed
    expect(allSets().length).toBeGreaterThan(1);

    expect(await dbUndoImport()).toBe(true);
    await initDB(); // reboot onto the restored snapshot

    const after = allSets();
    expect(after).toHaveLength(1);
    expect(after[0].weight).toBe(100);
  });

  it('undo is a one-shot — the snapshot is consumed', async () => {
    await dbSnapshotBeforeImport();
    expect(await dbUndoImport()).toBe(true);
    expect(await dbHasImportSnapshot()).toBe(false);
    expect(await dbUndoImport()).toBe(false);
  });

  it('the import snapshot does not survive a workout-data reset', async () => {
    // Otherwise "Undo import" after a reset would restore the pre-reset
    // database and silently undo the reset itself.
    await dbSnapshotBeforeImport();
    await dbResetWorkoutData();
    expect(await dbHasImportSnapshot()).toBe(false);
  });

  it('can be discarded explicitly once the user accepts the import', async () => {
    await dbSnapshotBeforeImport();
    await dbDiscardImportSnapshot();
    expect(await dbHasImportSnapshot()).toBe(false);
  });
});

describe('imported history is queryable like any other', () => {
  it('survives a reload and leaves plans untouched', async () => {
    dbImportSessions(prepare(STRONG).sessions, { unit: 'kg' });
    await initDB();
    expect(allSets().length).toBe(3);
    expect(dbGetAllPlans()).toHaveLength(0);
  });
});
