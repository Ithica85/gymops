// Phase 5.5 — adherence rework: set-level session adherence measured against
// the day trained (computeSessionAdherence) and week-coverage day IDs for the
// plans-screen row (dbGetCompletedDayIdsSince). Real in-memory DB throughout.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbCreateSession, dbFinishSession, dbInsertSet,
  dbCreatePlan, dbSavePlanExercises, dbGetPlanDays, dbLinkSessionToPlan,
  dbGetCompletedDayIdsSince,
} from '../js/db.js';
import { computeSessionAdherence } from '../js/plans.js';

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

function makePPL() {
  const planId = dbCreatePlan('PPL', '2026-07-01', 8, null, 3);
  dbSavePlanExercises(planId, [
    { dayId: null, name: 'Push', exercises: [
      { exercise: 'Chest Press', targetSets: 4, targetReps: 8 },
      { exercise: 'Shoulder Press', targetSets: 3, targetReps: 10 },
      { exercise: 'Dips' }, // no target
    ] },
    { dayId: null, name: 'Pull', exercises: [{ exercise: 'Lat Pulldown', targetSets: 4 }] },
  ]);
  return { planId, days: dbGetPlanDays(planId) };
}

function startOnDay(planId, dayId) {
  const sessionId = dbCreateSession('kg');
  dbLinkSessionToPlan(sessionId, planId, dayId);
  return sessionId;
}

function logSets(sessionId, exercise, n) {
  for (let i = 1; i <= n; i++) dbInsertSet(sessionId, exercise, i, 60, 8, null, null, 'kg');
}

describe('computeSessionAdherence (5.5)', () => {
  it('counts planned sets per day-scoped exercise, capped at target', () => {
    const { planId, days } = makePPL();
    const sessionId = startOnDay(planId, days[0].day_id); // Push
    logSets(sessionId, 'Chest Press', 6);    // overshoots 4 → capped at 4
    logSets(sessionId, 'Shoulder Press', 2); // 2 of 3

    const a = computeSessionAdherence(sessionId);
    expect(a.dayName).toBe('Push');
    expect(a.planName).toBe('PPL');
    expect([a.done, a.total]).toEqual([2, 3]);
    // Planned sets counted only over targeted exercises (Dips has none):
    // capped 4 + 2 of a 4+3 budget
    expect([a.setsDone, a.setsPlanned]).toEqual([6, 7]);
    expect(a.skipped).toEqual(['Dips']);
    expect(a.weekTotal).toBe(8);
    expect(a.weekNum).toBeGreaterThanOrEqual(1);
  });

  it('adherence is scoped to the session day, not the flat plan', () => {
    const { planId, days } = makePPL();
    const sessionId = startOnDay(planId, days[1].day_id); // Pull: 1 exercise
    logSets(sessionId, 'Lat Pulldown', 4);

    const a = computeSessionAdherence(sessionId);
    expect(a.dayName).toBe('Pull');
    expect([a.done, a.total]).toEqual([1, 1]);
    expect([a.setsDone, a.setsPlanned]).toEqual([4, 4]);
    expect(a.skipped).toEqual([]);
  });

  it('no sets targets anywhere → setsPlanned 0 (renderer omits the clause)', () => {
    const planId = dbCreatePlan('Loose', '2026-07-01', null, null, null);
    dbSavePlanExercises(planId, [
      { dayId: null, name: 'Day 1', exercises: [{ exercise: 'Chest Press' }] },
    ]);
    const day = dbGetPlanDays(planId)[0];
    const sessionId = startOnDay(planId, day.day_id);
    logSets(sessionId, 'Chest Press', 2);

    const a = computeSessionAdherence(sessionId);
    expect(a.setsPlanned).toBe(0);
    // Single-day plan: the auto "Day 1" is an implementation detail, no label
    expect(a.dayName).toBeNull();
    expect(a.weekTotal).toBeNull();
  });

  it('returns null for plan-less sessions', () => {
    const sessionId = dbCreateSession('kg');
    logSets(sessionId, 'Chest Press', 2);
    expect(computeSessionAdherence(sessionId)).toBeNull();
  });
});

describe('dbGetCompletedDayIdsSince (5.5 week coverage)', () => {
  it('returns only this plan\'s completed session days in the window', () => {
    const { planId, days } = makePPL();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const s1 = startOnDay(planId, days[0].day_id); // Push — completed
    dbFinishSession(s1);
    startOnDay(planId, days[1].day_id);            // Pull — still active, must not count

    expect(dbGetCompletedDayIdsSince(planId, weekAgo)).toEqual([days[0].day_id]);
  });

  it('excludes sessions before the window and day-less sessions', () => {
    const { planId, days } = makePPL();
    const s1 = startOnDay(planId, days[0].day_id);
    dbFinishSession(s1);
    const s2 = startOnDay(planId, null); // legacy day-less session
    dbFinishSession(s2);

    const future = new Date(Date.now() + 86400000).toISOString();
    expect(dbGetCompletedDayIdsSince(planId, future)).toEqual([]);

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    expect(dbGetCompletedDayIdsSince(planId, weekAgo)).toEqual([days[0].day_id]);
  });
});
