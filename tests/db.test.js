// Write-path tests for js/db.js (Story 1.3).
// Each test starts from a cleared localStorage + fresh initDB(), so every test
// runs against a brand-new in-memory sql.js database — no shared state.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbCreateSession, dbGetSession, dbFinishSession,
  dbInsertSet, dbGetAllSets, dbGetSetCount,
  dbDeleteSetById, dbResequenceSets, dbDeleteLastSet,
  dbCreatePlan, dbGetPlan,
} from '../js/db.js';

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

describe('dbCreateSession', () => {
  it('returns real incrementing IDs across multiple calls', () => {
    const a = dbCreateSession('kg');
    const b = dbCreateSession('kg');
    const c = dbCreateSession('lbs');
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(c).toBe(3);
  });

  it('persists the session with unit and active status', () => {
    const id = dbCreateSession('kg');
    const session = dbGetSession(id);
    expect(session.status).toBe('active');
    expect(session.default_unit).toBe('kg');
    expect(session.start_time).toBeTruthy();
  });

  it('IDs survive a persist/reload round-trip (the export-resets-rowid bug)', async () => {
    const first = dbCreateSession('kg');
    dbInsertSet(first, 'Chest Press', 1, 60, 8, null, null, 'kg');
    // Reload the DB from localStorage — a fresh initDB() without clearing
    await initDB();
    const next = dbCreateSession('kg');
    expect(next).toBe(first + 1);
    // The set must be attached to the real session, not session_id=0
    expect(dbGetAllSets(first)).toHaveLength(1);
    expect(dbGetAllSets(0)).toHaveLength(0);
  });
});

describe('dbInsertSet', () => {
  let sessionId;
  beforeEach(() => { sessionId = dbCreateSession('kg'); });

  it('persists a reps set (weight + reps, no duration/calories)', () => {
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    const [row] = dbGetAllSets(sessionId);
    expect(row.exercise).toBe('Chest Press');
    expect(row.set_number).toBe(1);
    expect(row.weight).toBe(60);
    expect(row.reps).toBe(8);
    expect(row.duration_mins).toBeNull();
    expect(row.calories).toBeNull();
    expect(row.unit).toBe('kg');
  });

  it('persists a timed set with calories (no weight/reps)', () => {
    dbInsertSet(sessionId, 'Elliptical', 1, null, null, 20, 180, 'kg');
    const [row] = dbGetAllSets(sessionId);
    expect(row.duration_mins).toBe(20);
    expect(row.calories).toBe(180);
    expect(row.weight).toBeNull();
    expect(row.reps).toBeNull();
  });

  it('persists a timed set without calories', () => {
    dbInsertSet(sessionId, 'Stairmaster', 1, null, null, 15, null, 'kg');
    const [row] = dbGetAllSets(sessionId);
    expect(row.duration_mins).toBe(15);
    expect(row.calories).toBeNull();
  });

  it('rows survive a persist/reload round-trip', async () => {
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Chest Press', 2, 65, 6, null, null, 'kg');
    await initDB(); // reload from localStorage
    expect(dbGetSetCount(sessionId)).toBe(2);
  });
});

describe('mid-session delete + resequence', () => {
  it('set_number is contiguous after deleting a middle set', () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Squat', 1, 80, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 2, 85, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 3, 90, 3, null, null, 'kg');

    // dbGetAllSets is newest-first; the middle set is weight 85
    const middle = dbGetAllSets(sessionId).find(s => s.weight === 85);
    const deleted = dbDeleteSetById(middle.set_id);
    expect(deleted.weight).toBe(85);
    dbResequenceSets(sessionId, 'Squat');

    const remaining = dbGetAllSets(sessionId).sort((a, b) => a.set_id - b.set_id);
    expect(remaining.map(s => s.set_number)).toEqual([1, 2]);
    expect(remaining.map(s => s.weight)).toEqual([80, 90]); // logging order kept
  });

  it('dbDeleteSetById returns null for a nonexistent set', () => {
    expect(dbDeleteSetById(999)).toBeNull();
  });

  it('resequence only touches the given exercise', () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Squat', 1, 80, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Bench', 1, 50, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 2, 85, 5, null, null, 'kg');

    const first = dbGetAllSets(sessionId).find(s => s.weight === 80);
    dbDeleteSetById(first.set_id);
    dbResequenceSets(sessionId, 'Squat');

    const bench = dbGetAllSets(sessionId).find(s => s.exercise === 'Bench');
    expect(bench.set_number).toBe(1); // untouched
    const squat = dbGetAllSets(sessionId).find(s => s.exercise === 'Squat');
    expect(squat.set_number).toBe(1); // resequenced from 2 → 1
  });
});

describe('dbDeleteLastSet', () => {
  it('deletes and returns the most recently logged set', () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Squat', 1, 80, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 2, 85, 5, null, null, 'kg');

    const deleted = dbDeleteLastSet(sessionId);
    expect(deleted.weight).toBe(85);
    expect(dbGetSetCount(sessionId)).toBe(1);
  });

  it('returns null when the session has no sets', () => {
    const sessionId = dbCreateSession('kg');
    expect(dbDeleteLastSet(sessionId)).toBeNull();
  });
});

describe('dbCreatePlan', () => {
  it('returns real incrementing plan IDs and persists fields', () => {
    const a = dbCreatePlan('Bulk', '2026-07-01', 6, '["hit 100kg bench"]', 3);
    const b = dbCreatePlan('Cut', '2026-08-15', null, null, null);
    expect(a).toBe(1);
    expect(b).toBe(2);

    const plan = dbGetPlan(a);
    expect(plan.name).toBe('Bulk');
    expect(plan.duration_weeks).toBe(6);
    expect(plan.target_sessions_per_week).toBe(3);
    expect(plan.status).toBe('active');
  });
});

describe('session lifecycle', () => {
  it('finish stamps end_time and completed status', () => {
    const id = dbCreateSession('kg');
    dbFinishSession(id);
    const session = dbGetSession(id);
    expect(session.status).toBe('completed');
    expect(session.end_time).toBeTruthy();
  });
});
