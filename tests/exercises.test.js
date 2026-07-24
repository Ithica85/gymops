// Exercise identity tests (Phase 5.1): the exercises table, catalogue
// seeding, historical-name adoption, exercise_id stamping, and rename.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbCreateSession, dbInsertSet, dbGetAllSets,
  dbCreatePlan, dbSavePlanExercises, dbGetPlanExercises,
  dbGetExercise, dbGetAllExercises, dbRenameExercise,
} from '../js/db.js';
import { EXERCISES } from '../js/state.js';

function b64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

describe('catalogue seeding (fresh install)', () => {
  it("seeds every catalogue entry except 'Other', with type and muscle group", () => {
    const rows = dbGetAllExercises();
    expect(rows).toHaveLength(EXERCISES.length - 1);
    expect(dbGetExercise('Other')).toBeNull();

    const chest = dbGetExercise('Chest Press');
    expect(chest.type).toBe('reps');
    expect(chest.muscle_group).toBe('Chest');
    expect(chest.is_custom).toBe(0);
    expect(dbGetExercise('Elliptical').type).toBe('timed');
  });

  it('re-boot is idempotent — no duplicate rows', async () => {
    const before = dbGetAllExercises().length;
    await initDB(); // second boot on the same stored DB
    expect(dbGetAllExercises()).toHaveLength(before);
  });
});

describe('exercise_id stamping on writes', () => {
  it('dbInsertSet stamps the catalogue exercise_id', () => {
    const sid = dbCreateSession('kg');
    dbInsertSet(sid, 'Chest Press', 1, 60, 8, null, null, 'kg');
    const [row] = dbGetAllSets(sid);
    expect(row.exercise_id).toBe(dbGetExercise('Chest Press').exercise_id);
  });

  it('a brand-new custom name gets an is_custom row typed by its data', () => {
    const sid = dbCreateSession('kg');
    dbInsertSet(sid, 'Yoke Carry', 1, 80, 10, null, null, 'kg');
    dbInsertSet(sid, 'Jacobs Ladder', 1, null, null, 12, 90, 'kg');

    const sled = dbGetExercise('Yoke Carry');
    expect([sled.is_custom, sled.type]).toEqual([1, 'reps']);
    const ropes = dbGetExercise('Jacobs Ladder');
    expect([ropes.is_custom, ropes.type]).toEqual([1, 'timed']);

    const sets = dbGetAllSets(sid);
    expect(sets.find(s => s.exercise === 'Jacobs Ladder').exercise_id).toBe(ropes.exercise_id);
  });

  it('dbSavePlanExercises stamps exercise_id', () => {
    const planId = dbCreatePlan('Push Day', '2026-07-16', 8, null, 3);
    dbSavePlanExercises(planId, [{ dayId: null, name: 'Day 1', exercises: [{ exercise: 'Chest Press', targetSets: 4, targetReps: 8 }] }]);
    const [pe] = dbGetPlanExercises(planId);
    expect(pe.exercise_id).toBe(dbGetExercise('Chest Press').exercise_id);
  });
});

describe('migration of a pre-5.1 database', () => {
  it('adopts historical names, types them from data, and backfills IDs', async () => {
    // Build a raw legacy DB: pre-5.1 schema (no exercises table, no
    // exercise_id column) with catalogue history AND custom "Other" names.
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE sessions (
        session_id INTEGER PRIMARY KEY AUTOINCREMENT, start_time TEXT NOT NULL,
        end_time TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT,
        default_unit TEXT, plan_id INTEGER
      );
      CREATE TABLE sets (
        set_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL, exercise TEXT NOT NULL, set_number INTEGER NOT NULL,
        weight REAL, reps INTEGER, duration_mins REAL, calories INTEGER,
        unit TEXT NOT NULL DEFAULT 'lbs'
      );
      INSERT INTO sessions (start_time, end_time, status, default_unit)
        VALUES ('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z', 'completed', 'kg');
      INSERT INTO sets (session_id, timestamp, exercise, set_number, weight, reps, unit)
        VALUES (1, '2026-06-01T10:05:00Z', 'Chest Press', 1, 60, 8, 'kg');
      INSERT INTO sets (session_id, timestamp, exercise, set_number, weight, reps, unit)
        VALUES (1, '2026-06-01T10:15:00Z', 'Yoke Carry', 1, 80, 10, 'kg');
      INSERT INTO sets (session_id, timestamp, exercise, set_number, duration_mins, calories, unit)
        VALUES (1, '2026-06-01T10:25:00Z', 'Jacobs Ladder', 1, 12, 90, 'kg');
    `);
    localStorage.setItem('gymops_db', b64(legacy.export()));
    legacy.close();

    await initDB(); // migrate + sync

    // Catalogue seeded, historical customs adopted with data-derived types
    expect(dbGetAllExercises().length).toBe(EXERCISES.length - 1 + 2);
    expect(dbGetExercise('Yoke Carry').type).toBe('reps');
    expect(dbGetExercise('Yoke Carry').is_custom).toBe(1);
    expect(dbGetExercise('Jacobs Ladder').type).toBe('timed');

    // Every historical row got its ID backfilled
    const sets = dbGetAllSets(1);
    expect(sets).toHaveLength(3);
    for (const s of sets) {
      expect(s.exercise_id).toBe(dbGetExercise(s.exercise).exercise_id);
    }
  });
});

describe('rename (the point of 5.1)', () => {
  it('renames identity row + denormalised copies; history follows, ID stays', () => {
    const sid = dbCreateSession('kg');
    dbInsertSet(sid, 'Yoke Carry', 1, 80, 10, null, null, 'kg');
    const planId = dbCreatePlan('Conditioning', '2026-07-16', null, null, null);
    dbSavePlanExercises(planId, [{ dayId: null, name: 'Day 1', exercises: [{ exercise: 'Yoke Carry' }] }]);
    const id = dbGetExercise('Yoke Carry').exercise_id;

    expect(dbRenameExercise(id, 'Yoke Walk')).toBe(true);

    expect(dbGetExercise('Yoke Carry')).toBeNull();
    expect(dbGetExercise('Yoke Walk').exercise_id).toBe(id);
    expect(dbGetAllSets(sid)[0].exercise).toBe('Yoke Walk');
    expect(dbGetPlanExercises(planId)[0].exercise).toBe('Yoke Walk');
  });

  it('rejects a name already used by a different exercise', () => {
    const id = dbGetExercise('Chest Press').exercise_id;
    expect(() => dbRenameExercise(id, 'Elliptical')).toThrow(/already exists/);
    expect(() => dbRenameExercise(id, '   ')).toThrow(/Enter a name/);
    expect(dbRenameExercise(id, 'Chest Press')).toBe(true); // renaming to itself is fine
  });

  it('returns false for an unknown exercise_id', () => {
    expect(dbRenameExercise(99999, 'Ghost')).toBe(false);
  });

  it('renaming a catalogue exercise flips is_custom (5.7 blocker decision)', () => {
    expect(dbGetExercise('Chest Press').is_custom).toBe(0);
    const id = dbGetExercise('Chest Press').exercise_id;

    expect(dbRenameExercise(id, 'Chest Press')).toBe(true); // no-op save: flag untouched
    expect(dbGetExercise('Chest Press').is_custom).toBe(0);

    expect(dbRenameExercise(id, 'Chest Press Mk2')).toBe(true); // real rename: flag flips
    expect(dbGetExercise('Chest Press Mk2').is_custom).toBe(1);
    expect(dbGetExercise('Chest Press Mk2').exercise_id).toBe(id);
  });

  it('a re-synced boot re-seeds the vacated catalogue name as a fresh, historyless row', async () => {
    const id = dbGetExercise('Chest Press').exercise_id;
    dbInsertSet(dbCreateSession('kg'), 'Chest Press', 1, 60, 8, null, null, 'kg');
    dbRenameExercise(id, 'Chest Press Mk2');

    await initDB(); // re-reads the persisted DB and re-runs _syncExercises

    const reseeded = dbGetExercise('Chest Press');
    expect(reseeded).not.toBeNull();
    expect(reseeded.exercise_id).not.toBe(id);
    expect(reseeded.is_custom).toBe(0);
    // History stayed with the renamed identity, not the reseeded slot
    expect(dbGetExercise('Chest Press Mk2').exercise_id).toBe(id);
  });
});
