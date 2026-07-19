// Phase 5.2 — multi-day program model: plan_days schema + migration backfill,
// day-scoped dbGetSessionPlan, day rotation, and the day-preserving save path.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbCreateSession, dbFinishSession,
  dbCreatePlan, dbSavePlanExercises,
  dbGetPlanDays, dbGetPlanExercises,
  dbGetSessionPlan, dbGetNextPlanDay,
  dbLinkSessionToPlan, dbUpdateSessionDay,
} from '../js/db.js';

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

// Helper: a saved PPL plan; returns { planId, days } with days re-read from the DB.
function makePPL() {
  const planId = dbCreatePlan('PPL', '2026-07-01', 8, null, 3);
  dbSavePlanExercises(planId, [
    { dayId: null, name: 'Push', exercises: [{ exercise: 'Chest Press', targetSets: 4, targetReps: 8 }, { exercise: 'Shoulder Press' }] },
    { dayId: null, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown' }] },
    { dayId: null, name: 'Legs', exercises: [{ exercise: 'Leg Press' }, { exercise: 'Chest Press' }] }, // same name on two days is legal
  ]);
  return { planId, days: dbGetPlanDays(planId) };
}

describe('dbSavePlanExercises (day shape)', () => {
  it('round-trips days in order with per-day exercises', () => {
    const { planId, days } = makePPL();
    expect(days.map(d => d.name)).toEqual(['Push', 'Pull', 'Legs']);

    const exs = dbGetPlanExercises(planId);
    expect(exs).toHaveLength(5);
    // Global sort_order preserves day order then within-day order
    expect(exs.map(e => e.exercise)).toEqual(
      ['Chest Press', 'Shoulder Press', 'Lat Pulldown', 'Leg Press', 'Chest Press']);
    expect(exs.filter(e => e.day_id === days[0].day_id).map(e => e.exercise))
      .toEqual(['Chest Press', 'Shoulder Press']);
    expect(exs[0].target_sets).toBe(4);
  });

  it('re-save preserves surviving day_ids, renames in place, deletes dropped days', () => {
    const { planId, days } = makePPL();
    dbSavePlanExercises(planId, [
      { dayId: days[1].day_id, name: 'Pull Day', exercises: [{ exercise: 'Lat Pulldown' }] },
      { dayId: null, name: 'Arms', exercises: [{ exercise: 'Bicep Curl' }] },
    ]);
    const after = dbGetPlanDays(planId);
    expect(after).toHaveLength(2);
    expect(after[0].day_id).toBe(days[1].day_id); // identity survived the edit
    expect(after[0].name).toBe('Pull Day');
    expect(after.map(d => d.day_id)).not.toContain(days[0].day_id); // Push deleted
  });
});

describe('dbGetSessionPlan day scoping', () => {
  it('returns only the linked day and its exercises', () => {
    const { planId, days } = makePPL();
    const sid = dbCreateSession('kg');
    dbLinkSessionToPlan(sid, planId, days[1].day_id);

    const plan = dbGetSessionPlan(sid);
    expect(plan.day.name).toBe('Pull');
    expect(plan.exercises.map(e => e.exercise)).toEqual(['Lat Pulldown']);
  });

  it('day_id NULL (pre-5.2 session) falls back to the whole plan', () => {
    const { planId } = makePPL();
    const sid = dbCreateSession('kg');
    dbLinkSessionToPlan(sid, planId); // no day
    const plan = dbGetSessionPlan(sid);
    expect(plan.day).toBeNull();
    expect(plan.exercises).toHaveLength(5);
  });

  it('a day deleted by a later plan edit falls back to the whole plan', () => {
    const { planId, days } = makePPL();
    const sid = dbCreateSession('kg');
    dbLinkSessionToPlan(sid, planId, days[0].day_id);
    dbSavePlanExercises(planId, [
      { dayId: days[1].day_id, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown' }] },
    ]); // Push (linked) removed
    const plan = dbGetSessionPlan(sid);
    expect(plan.day).toBeNull();
    expect(plan.exercises.map(e => e.exercise)).toEqual(['Lat Pulldown']);
  });

  it('dbUpdateSessionDay re-points the session', () => {
    const { planId, days } = makePPL();
    const sid = dbCreateSession('kg');
    dbLinkSessionToPlan(sid, planId, days[0].day_id);
    dbUpdateSessionDay(sid, days[2].day_id);
    expect(dbGetSessionPlan(sid).day.name).toBe('Legs');
  });
});

describe('dbGetNextPlanDay rotation', () => {
  it('lands on the first day with no history, then rotates and wraps', () => {
    const { planId, days } = makePPL();
    expect(dbGetNextPlanDay(planId).name).toBe('Push');

    const trainDay = (dayId) => {
      const sid = dbCreateSession('kg');
      dbLinkSessionToPlan(sid, planId, dayId);
      dbFinishSession(sid);
    };
    trainDay(days[0].day_id);
    expect(dbGetNextPlanDay(planId).name).toBe('Pull');
    trainDay(days[1].day_id);
    expect(dbGetNextPlanDay(planId).name).toBe('Legs');
    trainDay(days[2].day_id);
    expect(dbGetNextPlanDay(planId).name).toBe('Push'); // wrapped
  });

  it('ignores active (unfinished) and day-less legacy sessions', () => {
    const { planId, days } = makePPL();
    const legacy = dbCreateSession('kg');
    dbLinkSessionToPlan(legacy, planId); // NULL day
    dbFinishSession(legacy);
    const inFlight = dbCreateSession('kg');
    dbLinkSessionToPlan(inFlight, planId, days[2].day_id); // never finished
    expect(dbGetNextPlanDay(planId).name).toBe('Push');
  });

  it('a day deleted since it was last trained resolves to the first day', () => {
    const { planId, days } = makePPL();
    const sid = dbCreateSession('kg');
    dbLinkSessionToPlan(sid, planId, days[2].day_id);
    dbFinishSession(sid);
    dbSavePlanExercises(planId, [
      { dayId: days[0].day_id, name: 'Push', exercises: [{ exercise: 'Chest Press' }] },
      { dayId: days[1].day_id, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown' }] },
    ]); // Legs (the trained day) removed
    expect(dbGetNextPlanDay(planId).name).toBe('Push');
  });
});

describe('migration of a pre-5.2 database', () => {
  it('backfills one "Day 1" per plan and leaves sessions day-less', async () => {
    // Raw pre-5.2 schema: plans + flat plan_exercises, no plan_days/day_id.
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
      CREATE TABLE plans (
        plan_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        start_date TEXT NOT NULL, duration_weeks INTEGER, objectives_json TEXT,
        status TEXT NOT NULL DEFAULT 'active', target_sessions_per_week INTEGER
      );
      CREATE TABLE plan_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
        exercise TEXT NOT NULL, target_sets INTEGER, target_reps INTEGER,
        sort_order INTEGER NOT NULL
      );
      INSERT INTO plans (name, start_date, duration_weeks, status) VALUES ('Bulk', '2026-06-01', 8, 'active');
      INSERT INTO plan_exercises (plan_id, exercise, target_sets, target_reps, sort_order)
        VALUES (1, 'Chest Press', 4, 8, 0), (1, 'Lat Pulldown', 3, 10, 1);
      INSERT INTO sessions (start_time, end_time, status, plan_id)
        VALUES ('2026-06-02T10:00:00Z', '2026-06-02T11:00:00Z', 'completed', 1);
    `);
    localStorage.setItem('gymops_db', b64(legacy.export()));
    legacy.close();

    await initDB(); // migrate

    const days = dbGetPlanDays(1);
    expect(days).toHaveLength(1);
    expect(days[0].name).toBe('Day 1');
    for (const e of dbGetPlanExercises(1)) expect(e.day_id).toBe(days[0].day_id);

    // Historical session: no day, whole-plan fallback intact
    const plan = dbGetSessionPlan(1);
    expect(plan.day).toBeNull();
    expect(plan.exercises).toHaveLength(2);

    // Rotation on a migrated single-day plan trivially picks Day 1
    expect(dbGetNextPlanDay(1).name).toBe('Day 1');
  });
});
