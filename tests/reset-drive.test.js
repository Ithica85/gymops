// Phase 6.6 (Drive connect moves to Settings) + 6.8 (reset options split).
//
// Both items exist to keep two things apart that used to be fused: what the
// app does locally, and what it sends to Google. The tests below pin the two
// boundaries that matter — a disconnected user's finish never touches Drive,
// and a reset that keeps credentials really does keep them.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  dbResetWorkoutData,
  dbCreateSession, dbFinishSession, dbGetSession, dbInsertSet,
  dbGetAllSets, dbGetAllExercises,
  dbCreatePlan, dbGetAllPlans, dbGetPlanDays, dbSavePlanExercises,
} from '../js/db.js';
import { gdriveIsConnected, gdriveDisconnect } from '../js/gdrive.js';
import { EXERCISES, state } from '../js/state.js';
import { _doStartSession, finishWorkout, logSet, stopRestTimer } from '../js/workout.js';

const EX = EXERCISES[0].name;

function el(id) { return document.getElementById(id); }

// Seeds a completed session, a custom exercise and a plan — one of everything
// the reset is supposed to remove.
function seedHistory() {
  const sid = dbCreateSession('kg');
  dbInsertSet(sid, EX, 1, 60, 8, null, null, 'kg');
  dbInsertSet(sid, 'Sandbag Carry', 1, 40, 5, null, null, 'kg'); // custom identity
  dbFinishSession(sid);
  const planId = dbCreatePlan('Block A', '2026-07-01', 8, null, 3);
  dbSavePlanExercises(planId, [
    { dayId: null, name: 'Day 1', exercises: [{ exercise: EX, targetSets: 4, targetReps: 8 }] },
  ]);
  return { sid, planId };
}

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

describe('dbResetWorkoutData (6.8)', () => {
  it('deletes sessions, sets and plans', async () => {
    const { sid, planId } = seedHistory();
    expect(dbGetAllSets(sid)).toHaveLength(2);
    expect(dbGetPlanDays(planId)).toHaveLength(1); // guards the assertion below from being vacuous

    await dbResetWorkoutData();

    expect(dbGetSession(sid)).toBeNull();
    expect(dbGetAllSets(sid)).toHaveLength(0);
    expect(dbGetAllPlans()).toHaveLength(0);
    expect(dbGetPlanDays(planId)).toHaveLength(0);
  });

  it('keeps preferences and credentials — the whole point of the split', async () => {
    seedHistory();
    localStorage.setItem('gymops_weight_unit', 'kg');
    localStorage.setItem('gymops_rest_secs', '120');
    localStorage.setItem('gymops_anthropic_key', 'sk-ant-test');
    localStorage.setItem('gymops_gdrive_enabled', 'true');

    await dbResetWorkoutData();

    expect(localStorage.getItem('gymops_weight_unit')).toBe('kg');
    expect(localStorage.getItem('gymops_rest_secs')).toBe('120');
    expect(localStorage.getItem('gymops_anthropic_key')).toBe('sk-ant-test');
    expect(localStorage.getItem('gymops_gdrive_enabled')).toBe('true');
  });

  it('reseeds the catalogue and drops custom identities', async () => {
    seedHistory();
    const before = dbGetAllExercises();
    expect(before.some(e => e.name === 'Sandbag Carry')).toBe(true);

    await dbResetWorkoutData();

    const after = dbGetAllExercises();
    expect(after.some(e => e.name === 'Sandbag Carry')).toBe(false);
    // Every catalogue entry is back ('Other' is a UI flow, never a row)
    expect(after).toHaveLength(EXERCISES.filter(e => e.name !== 'Other').length);
    expect(after.every(e => e.is_custom === 0)).toBe(true);
  });

  it('leaves a working database — the reset is not a wipe', async () => {
    seedHistory();
    await dbResetWorkoutData();

    const sid = dbCreateSession('kg');
    dbInsertSet(sid, EX, 1, 70, 5, null, null, 'kg');
    expect(dbGetAllSets(sid)).toHaveLength(1);
  });

  it('survives a reload (the emptied DB is persisted, not just in memory)', async () => {
    seedHistory();
    await dbResetWorkoutData();
    await initDB(); // reboot from the persisted blob

    expect(dbGetAllPlans()).toHaveLength(0);
    expect(dbGetAllSets(1)).toHaveLength(0);
  });
});

describe('Drive connection state (6.6)', () => {
  it('a fresh install is not connected', () => {
    expect(gdriveIsConnected()).toBe(false);
  });

  it('adopts a pre-6.6 install that was already uploading (stored token)', () => {
    localStorage.setItem('gymops_gdrive_token', JSON.stringify({ token: 'x', expiry: Date.now() + 1e6 }));
    expect(gdriveIsConnected()).toBe(true);
    expect(localStorage.getItem('gymops_gdrive_enabled')).toBe('true');
  });

  it('adopts a pre-6.6 install via the folder-migration flag (token expired)', () => {
    localStorage.setItem('gymops_gdrive_migrated', 'true');
    expect(gdriveIsConnected()).toBe(true);
  });

  it('disconnect sticks even with the migration flag still present', () => {
    localStorage.setItem('gymops_gdrive_migrated', 'true');
    expect(gdriveIsConnected()).toBe(true);

    gdriveDisconnect();

    // Written as 'false' rather than removed, precisely so the adoption above
    // can't silently reconnect on the next boot.
    expect(localStorage.getItem('gymops_gdrive_enabled')).toBe('false');
    expect(localStorage.getItem('gymops_gdrive_token')).toBeNull();
    expect(gdriveIsConnected()).toBe(false);
  });
});

describe('session finish is local-first (6.6)', () => {
  beforeEach(() => {
    state.sessionId = null;
    state.exercise = null;
    state.exerciseType = null;
    state.setNumber = 1;
    state.finishedAt = null;
    el('input-weight').value = '';
    el('input-reps').value = '';
    el('drive-status').textContent = '';
  });

  function logOneAndFinish() {
    _doStartSession({ exercise: EX });
    el('input-weight').value = '60';
    el('input-reps').value = '8';
    logSet();
    finishWorkout();
    stopRestTimer();
  }

  it('never touches Drive when the user has not connected it', async () => {
    logOneAndFinish();

    // No status line at all — an unconnected user should see no sign that a
    // cloud integration exists, let alone an OAuth prompt.
    expect(el('drive-status').classList.contains('hidden')).toBe(true);
    expect(el('drive-status').textContent).toBe('');
  });

  it('uploads when connected, and a dead grant asks for a reconnect instead of downloading a CSV', async () => {
    localStorage.setItem('gymops_gdrive_enabled', 'true');
    logOneAndFinish();

    expect(el('drive-status').textContent).toBe('Saving to Drive…');

    // Google Identity Services is absent in the test environment, which is
    // exactly the shape of a dead/unusable grant: the background token request
    // can't produce a token and can't show UI. That must resolve to a
    // reconnect prompt, NOT the generic failure path (which downloads a CSV).
    await new Promise(r => setTimeout(r, 0));
    expect(el('drive-status').textContent).toBe('Drive needs reconnecting — see Settings');
  });
});
