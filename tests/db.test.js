// Write-path tests for js/db.js (Story 1.3).
// Each test starts from a cleared localStorage + fresh initDB(), so every test
// runs against a brand-new in-memory sql.js database — no shared state.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDB, dbDiscardCorrupt, dbOnPersistStateChange,
  dbExportBackup, dbValidateBackup, dbRestoreBackup,
  dbCreateSession, dbGetSession, dbFinishSession,
  dbInsertSet, dbGetAllSets, dbGetSetCount,
  dbDeleteSetById, dbResequenceSets, dbDeleteLastSet,
  dbCreatePlan, dbGetPlan, dbClearAll,
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

describe('dbDeleteLastSet (scoped to one exercise — 4.2)', () => {
  it('deletes and returns the most recently logged set of the exercise', () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Squat', 1, 80, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 2, 85, 5, null, null, 'kg');

    const deleted = dbDeleteLastSet(sessionId, 'Squat');
    expect(deleted.weight).toBe(85);
    expect(dbGetSetCount(sessionId)).toBe(1);
  });

  it('returns null when the session has no sets for the exercise', () => {
    const sessionId = dbCreateSession('kg');
    expect(dbDeleteLastSet(sessionId, 'Squat')).toBeNull();
  });

  it('never deletes another exercise\'s set, even when logged later (#C5)', () => {
    // The verified bug: log Bench → log Squat → switch back to Bench → Undo
    // deleted the Squat set (session-global last). Undo must stay scoped.
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Bench', 1, 50, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 1, 100, 5, null, null, 'kg');

    const deleted = dbDeleteLastSet(sessionId, 'Bench');
    expect(deleted.exercise).toBe('Bench');
    expect(deleted.weight).toBe(50);

    const remaining = dbGetAllSets(sessionId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].exercise).toBe('Squat'); // untouched
  });

  it('deletes only the latest set of the exercise, not earlier ones', () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Bench', 1, 50, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Squat', 1, 100, 5, null, null, 'kg');
    dbInsertSet(sessionId, 'Bench', 2, 55, 6, null, null, 'kg');

    const deleted = dbDeleteLastSet(sessionId, 'Bench');
    expect(deleted.set_number).toBe(2);

    const remaining = dbGetAllSets(sessionId).map(s => `${s.exercise} ${s.set_number}`);
    expect(remaining.sort()).toEqual(['Bench 1', 'Squat 1']);
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

describe('persistence encoding (base64 with legacy JSON-array fallback)', () => {
  it('stores base64, not a JSON byte array', () => {
    dbCreateSession('kg');
    const stored = localStorage.getItem('gymops_db');
    expect(stored.startsWith('[')).toBe(false);
    expect(() => atob(stored)).not.toThrow();
  });

  it('loads a legacy JSON-array DB losslessly and upgrades it on next write', async () => {
    // Build real data, then rewrite storage in the legacy format
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');

    const base64 = localStorage.getItem('gymops_db');
    const binary = atob(base64);
    const bytes  = Array.from(binary, c => c.charCodeAt(0));
    localStorage.setItem('gymops_db', JSON.stringify(bytes)); // legacy format

    await initDB(); // must read the legacy format
    expect(dbGetSetCount(sessionId)).toBe(1);
    expect(dbGetAllSets(sessionId)[0].weight).toBe(60);

    dbCreateSession('kg'); // any write upgrades the stored format
    const upgraded = localStorage.getItem('gymops_db');
    expect(upgraded.startsWith('[')).toBe(false);

    await initDB(); // and the upgraded format round-trips
    expect(dbGetSetCount(sessionId)).toBe(1);
  });

  it('base64 is smaller than the legacy encoding', () => {
    // Base64 is a fixed ~1.33 chars/byte; legacy JSON is ≥2 chars/byte (zeros)
    // up to ~4 (values ≥100). A small mostly-empty DB is the WORST case for
    // this comparison — real data-dense DBs save closer to 3×.
    dbCreateSession('kg');
    for (let i = 1; i <= 50; i++) dbInsertSet(1, 'Chest Press', i, 60 + i, 8, null, null, 'kg');
    const base64 = localStorage.getItem('gymops_db');
    const legacyLength = JSON.stringify(Array.from(_legacyBytes(base64))).length;
    expect(base64.length).toBeLessThan(legacyLength / 1.4);
  });
});

function _legacyBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('persist-failure handling (4.4)', () => {
  const _realSetItem = localStorage.setItem;
  const _breakStorage = () => {
    localStorage.setItem = () => { throw new Error('QuotaExceededError (simulated)'); };
  };

  afterEach(() => {
    localStorage.setItem = _realSetItem;
    dbOnPersistStateChange(() => {}); // detach this test's listener
  });

  it('a failed persist never throws; data stays available in memory', () => {
    const sessionId = dbCreateSession('kg');
    _breakStorage();
    expect(() => dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg')).not.toThrow();
    expect(dbGetAllSets(sessionId)).toHaveLength(1); // in-memory DB has the set
  });

  it('notifies the listener on failure and again on recovery — once each', () => {
    const calls = [];
    dbOnPersistStateChange(f => calls.push(f));
    const sessionId = dbCreateSession('kg');

    _breakStorage();
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Chest Press', 2, 60, 8, null, null, 'kg');
    expect(calls).toEqual([true]); // state change only, not one per failed write

    localStorage.setItem = _realSetItem;
    dbInsertSet(sessionId, 'Chest Press', 3, 60, 8, null, null, 'kg');
    dbInsertSet(sessionId, 'Chest Press', 4, 60, 8, null, null, 'kg');
    expect(calls).toEqual([true, false]);
  });

  it('sets logged while storage was full are persisted by the recovery write', async () => {
    const sessionId = dbCreateSession('kg');
    _breakStorage();
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg'); // not persisted
    localStorage.setItem = _realSetItem;
    dbInsertSet(sessionId, 'Chest Press', 2, 62.5, 8, null, null, 'kg'); // persist retries here

    await initDB(); // reload from localStorage — both sets must be there
    const sets = dbGetAllSets(sessionId);
    expect(sets).toHaveLength(2);
    expect(sets.map(s => s.weight)).toEqual([62.5, 60]); // dbGetAllSets is newest-first
  });

  it('a listener registered after a failure fires immediately', () => {
    const sessionId = dbCreateSession('kg');
    _breakStorage();
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    const calls = [];
    dbOnPersistStateChange(f => calls.push(f));
    expect(calls).toEqual([true]);
  });

  it('backup export still works while storage is full (the banner CTA)', () => {
    const sessionId = dbCreateSession('kg');
    _breakStorage();
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    const info = dbValidateBackup(dbExportBackup()); // reads the in-memory DB
    expect(info.sessions).toBe(1);
    expect(info.sets).toBe(1);
  });
});

describe('backup & restore (4.3)', () => {
  it('round-trips: export → wipe → restore → identical data', async () => {
    const sessionId = dbCreateSession('kg');
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
    dbFinishSession(sessionId);
    const backup = dbExportBackup();

    localStorage.clear();
    await initDB(); // brand-new device: empty DB
    expect(dbGetAllSets(sessionId)).toHaveLength(0);

    const info = dbValidateBackup(backup);
    expect(info.sessions).toBe(1);
    expect(info.sets).toBe(1);
    expect(info.lastDate).toBeTruthy();

    dbRestoreBackup(info.blob);
    await initDB(); // reboot onto the restored database
    expect(dbGetAllSets(sessionId)[0].weight).toBe(60);
    expect(dbGetSession(sessionId).status).toBe('completed');
  });

  it('backup file is a format-1 JSON envelope', () => {
    const env = JSON.parse(dbExportBackup());
    expect(env.app).toBe('gymops');
    expect(env.format).toBe(1);
    expect(env.exported_at).toBeTruthy();
    expect(typeof env.db).toBe('string');
  });

  it('validate accepts a bare stored blob (recovery-screen download)', () => {
    dbCreateSession('kg');
    const info = dbValidateBackup(localStorage.getItem('gymops_db'));
    expect(info.sessions).toBe(1);
  });

  it('validate rejects garbage, foreign JSON, and non-DB envelopes', () => {
    expect(() => dbValidateBackup('total garbage !!!')).toThrow(/readable database/);
    expect(() => dbValidateBackup('{"foo": 1}')).toThrow(/Not a GymOps backup/);
    expect(() => dbValidateBackup(JSON.stringify({ app: 'gymops', format: 1, db: btoa('nope') })))
      .toThrow(/GymOps database|readable database/);
  });

  it('validate never touches the live database', () => {
    const sessionId = dbCreateSession('kg');
    dbValidateBackup(dbExportBackup());
    dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg'); // live DB still writable
    expect(dbGetSetCount(sessionId)).toBe(1);
  });

  it('restore stashes the previous DB under gymops_db_prerestore', () => {
    dbCreateSession('kg');
    const before = localStorage.getItem('gymops_db');
    const backup = dbExportBackup();

    dbRestoreBackup(dbValidateBackup(backup).blob);
    expect(localStorage.getItem('gymops_db_prerestore')).toBe(before);
  });
});

describe('corrupt-DB quarantine (4.1)', () => {
  const CORRUPT_BASE64 = btoa('this is not a sqlite database, not even close');

  it('a normal boot returns null', async () => {
    localStorage.clear();
    expect(await initDB()).toBeNull();
  });

  it('quarantines an unreadable blob instead of silently wiping it', async () => {
    localStorage.clear();
    localStorage.setItem('gymops_db', CORRUPT_BASE64);

    const corrupt = await initDB();
    expect(corrupt).not.toBeNull();
    expect(corrupt.blob).toBe(CORRUPT_BASE64);
    expect(corrupt.quarantineKey.startsWith('gymops_db_corrupt_')).toBe(true);
    expect(localStorage.getItem(corrupt.quarantineKey)).toBe(CORRUPT_BASE64);
    // The original stays put so a plain reload lands back on recovery
    expect(localStorage.getItem('gymops_db')).toBe(CORRUPT_BASE64);
  });

  it('handles a blob that is not even decodable (atob throws)', async () => {
    localStorage.clear();
    localStorage.setItem('gymops_db', '!!!neither base64 nor a JSON array!!!');

    const corrupt = await initDB();
    expect(corrupt.blob).toBe('!!!neither base64 nor a JSON array!!!');
    expect(localStorage.getItem(corrupt.quarantineKey)).toBe(corrupt.blob);
  });

  it('reloads reuse the existing quarantine key — no duplicate copies', async () => {
    localStorage.clear();
    localStorage.setItem('gymops_db', CORRUPT_BASE64);

    const first  = await initDB();
    const second = await initDB(); // user reloaded without acting
    expect(second.quarantineKey).toBe(first.quarantineKey);

    const corruptKeys = Object.keys(localStorage).filter(k => k.startsWith('gymops_db_corrupt_'));
    expect(corruptKeys).toHaveLength(1);
  });

  it('dbDiscardCorrupt drops only gymops_db; next boot is fresh, quarantine survives', async () => {
    localStorage.clear();
    localStorage.setItem('gymops_db', CORRUPT_BASE64);
    const corrupt = await initDB();

    dbDiscardCorrupt();
    expect(localStorage.getItem('gymops_db')).toBeNull();

    expect(await initDB()).toBeNull(); // fresh schema, no recovery loop
    expect(dbCreateSession('kg')).toBe(1); // and the fresh DB works
    expect(localStorage.getItem(corrupt.quarantineKey)).toBe(CORRUPT_BASE64);
  });

  it('dbClearAll wipes quarantined blobs too', async () => {
    localStorage.clear();
    localStorage.setItem('gymops_db', CORRUPT_BASE64);
    const corrupt = await initDB();

    dbClearAll();
    expect(localStorage.getItem(corrupt.quarantineKey)).toBeNull();
  });
});

describe('dbClearAll', () => {
  it('wipes the DB and all gymops_* keys — credentials included', () => {
    dbCreateSession('kg');
    localStorage.setItem('gymops_anthropic_key', 'sk-ant-test');
    localStorage.setItem('gymops_gdrive_token', '{"token":"x","expiry":1}');
    localStorage.setItem('gymops_weight_unit', 'kg');
    localStorage.setItem('unrelated_key', 'survives');

    dbClearAll();

    expect(localStorage.getItem('gymops_db')).toBeNull();
    expect(localStorage.getItem('gymops_anthropic_key')).toBeNull();
    expect(localStorage.getItem('gymops_gdrive_token')).toBeNull();
    expect(localStorage.getItem('gymops_weight_unit')).toBeNull();
    expect(localStorage.getItem('unrelated_key')).toBe('survives');
  });
});
