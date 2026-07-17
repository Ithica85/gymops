// ═══════════════════════════════════════════════════════
// GymOps — Database layer (sql.js + localStorage)
// ═══════════════════════════════════════════════════════

import { EXERCISES, getExerciseType } from './state.js';

const DB_KEY = 'gymops_db';
const CORRUPT_KEY_PREFIX = DB_KEY + '_corrupt_';
const PRERESTORE_KEY = DB_KEY + '_prerestore';

let _db = null;
let _SQL = null; // sql.js module — kept for opening throwaway DBs (backup validation)

// Persist-failure state (4.4). When localStorage.setItem fails (quota), the
// in-memory DB still holds every logged set — writes keep working and each
// one retries the persist. The listener lets the UI show/hide a warning
// without db.js knowing about the DOM.
let _persistFailed = false;
let _persistListener = null;

// Registers the (single) persist-state listener. Called with `true` when a
// persist fails, `false` when a later persist succeeds again. If a failure
// already happened before registration (e.g. during initDB's schema create),
// the listener is invoked immediately.
export function dbOnPersistStateChange(fn) {
  _persistListener = fn;
  if (_persistFailed) fn(true);
}

// ── Init ──────────────────────────────────────────────

// Boots the sql.js database. Restores an existing DB from localStorage, or
// creates a fresh schema when none is stored. If the stored blob can't be
// opened it is NEVER silently replaced: the original string is quarantined
// under gymops_db_corrupt_<ts> and `{ blob, quarantineKey }` is returned so
// boot() can show the recovery screen. Returns null on a normal boot.
export async function initDB() {
  const SQL = await initSqlJs({ locateFile: f => `lib/${f}` });
  _SQL = SQL;
  _persistFailed = false; // fresh boot starts with a clean persist state

  const saved = localStorage.getItem(DB_KEY);
  if (saved) {
    try {
      _db = new SQL.Database(_decodeDB(saved));
      _migrate(); // Apply any schema changes needed for this version
      _syncExercises();
      return null;
    } catch (_) {
      // gymops_db is left in place so every reload lands back on the recovery
      // screen until the user explicitly starts fresh (dbDiscardCorrupt).
      // The quarantine copies `saved` — the string read at boot — because a
      // half-completed _migrate() may already have rewritten gymops_db.
      _db = null;
      return { blob: saved, quarantineKey: _quarantine(saved) };
    }
  }
  _db = new SQL.Database();
  _createSchema();
  _syncExercises();
  return null;
}

// Copies a corrupt blob to gymops_db_corrupt_<ts>. Reuses an existing
// quarantine key holding identical content (reloads before the user acts on
// the recovery screen) and tolerates quota failure — the blob still exists
// in gymops_db and is passed to the recovery screen in memory.
function _quarantine(blob) {
  const existing = Object.keys(localStorage)
    .filter(k => k.startsWith(CORRUPT_KEY_PREFIX))
    .find(k => localStorage.getItem(k) === blob);
  if (existing) return existing;
  const key = CORRUPT_KEY_PREFIX + Date.now();
  try {
    localStorage.setItem(key, blob);
  } catch (_) {
    return null;
  }
  return key;
}

// Recovery-screen "Start Fresh": drops the unreadable gymops_db blob. The
// quarantine copy is kept (only "Clear All Data" removes it). The page must
// be reloaded afterwards — initDB() then creates a fresh schema.
export function dbDiscardCorrupt() {
  localStorage.removeItem(DB_KEY);
}

// ── Backup & restore (4.3) ────────────────────────────
// The "new phone" / disaster-recovery path. CSV export stays for spreadsheets;
// this round-trips the complete raw database. Deliberately excludes other
// gymops_* keys — credentials must never land in a shareable file.

// Returns the backup file contents: a JSON envelope around the base64 DB.
// Safe to call from Settings (idle) — _db.export() resets last_insert_rowid(),
// so this must never run between an INSERT and its ID read (see _runInsert).
export function dbExportBackup() {
  return JSON.stringify({
    app: 'gymops',
    format: 1,
    exported_at: new Date().toISOString(),
    db: _encodeDB(_db.export()),
  });
}

// Parses and validates backup-file text WITHOUT touching the live database.
// Accepts the format-1 JSON envelope, or a bare stored blob (base64 / legacy
// JSON byte array — covers files saved from the corrupt-DB recovery screen,
// should the data turn out to be readable after all).
// Opens the candidate in a throwaway sql.js instance and reads its counts.
// Returns { blob, sessions, sets, lastDate }; throws with a readable message
// if the file is not a restorable GymOps database.
export function dbValidateBackup(text) {
  let blob = text.trim();
  if (blob.startsWith('{')) {
    let envelope;
    try {
      envelope = JSON.parse(blob);
    } catch (_) {
      throw new Error('Not a GymOps backup file.');
    }
    if (envelope.app !== 'gymops' || typeof envelope.db !== 'string') {
      throw new Error('Not a GymOps backup file.');
    }
    blob = envelope.db;
  }

  let candidate;
  try {
    candidate = new _SQL.Database(_decodeDB(blob));
  } catch (_) {
    throw new Error("The file doesn't contain a readable database.");
  }
  try {
    const one = sql => {
      const stmt = candidate.prepare(sql);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    };
    const sessions = one('SELECT COUNT(*) AS n FROM sessions')?.n ?? 0;
    const sets     = one('SELECT COUNT(*) AS n FROM sets')?.n ?? 0;
    const lastDate = one('SELECT MAX(start_time) AS t FROM sessions')?.t ?? null;
    return { blob, sessions, sets, lastDate };
  } catch (_) {
    throw new Error("The file doesn't contain a GymOps database.");
  } finally {
    candidate.close();
  }
}

// Replaces the stored database with a validated backup blob. The current DB
// is stashed under gymops_db_prerestore first (one slot, quota-tolerant) as a
// last-ditch recovery layer under an already-confirmed destructive action.
// The page must be reloaded afterwards — initDB() migrates old-schema backups.
export function dbRestoreBackup(blob) {
  const current = localStorage.getItem(DB_KEY);
  if (current) {
    try {
      localStorage.setItem(PRERESTORE_KEY, current);
    } catch (_) { /* quota — proceed; the restore was explicitly confirmed */ }
  }
  localStorage.setItem(DB_KEY, blob);
}

// Creates the full schema on a brand-new database.
// Multi-statement SQL is passed as a single run() call (no params) which uses exec() internally.
function _createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time   TEXT NOT NULL,
      end_time     TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      notes        TEXT,
      default_unit TEXT,
      plan_id      INTEGER
    );
    CREATE TABLE IF NOT EXISTS exercises (
      exercise_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE,
      type         TEXT NOT NULL DEFAULT 'reps',
      muscle_group TEXT,
      is_custom    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sets (
      set_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL,
      timestamp     TEXT NOT NULL,
      exercise      TEXT NOT NULL,
      set_number    INTEGER NOT NULL,
      weight        REAL,
      reps          INTEGER,
      duration_mins REAL,
      calories      INTEGER,
      unit          TEXT NOT NULL DEFAULT 'lbs',
      exercise_id   INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(exercise_id)
    );
    CREATE TABLE IF NOT EXISTS plans (
      plan_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      start_date     TEXT NOT NULL,
      duration_weeks INTEGER,
      objectives_json TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      target_sessions_per_week INTEGER
    );
    CREATE TABLE IF NOT EXISTS plan_exercises (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id     INTEGER NOT NULL,
      exercise    TEXT NOT NULL,
      target_sets INTEGER,
      target_reps INTEGER,
      sort_order  INTEGER NOT NULL,
      exercise_id INTEGER,
      FOREIGN KEY (plan_id) REFERENCES plans(plan_id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(exercise_id)
    );
  `);
  _persist();
}

// Applies incremental schema migrations to an existing database.
// Simple nullable column additions use ALTER TABLE (safe, no data loss).
// Structural changes (e.g. making existing columns nullable) require full
// table recreation: create new → copy → drop old → rename.
function _migrate() {
  const sessionCols = _all('PRAGMA table_info(sessions)').map(c => c.name);
  if (!sessionCols.includes('notes')) {
    _db.run('ALTER TABLE sessions ADD COLUMN notes TEXT');
    _persist();
  }
  if (!sessionCols.includes('default_unit')) {
    _db.run('ALTER TABLE sessions ADD COLUMN default_unit TEXT');
    _persist();
  }

  let setNames = _all('PRAGMA table_info(sets)').map(c => c.name);

  if (!setNames.includes('duration_mins')) {
    // Recreate sets table to add duration_mins/calories and make weight/reps nullable.
    // Full migration preserves all existing rows.
    _db.run(`
      CREATE TABLE sets_migrated (
        set_id        INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    INTEGER NOT NULL,
        timestamp     TEXT NOT NULL,
        exercise      TEXT NOT NULL,
        set_number    INTEGER NOT NULL,
        weight        REAL,
        reps          INTEGER,
        duration_mins REAL,
        calories      INTEGER,
        unit          TEXT NOT NULL DEFAULT 'lbs',
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      )
    `);
    _db.run(`
      INSERT INTO sets_migrated
        (set_id, session_id, timestamp, exercise, set_number, weight, reps, duration_mins, calories)
      SELECT set_id, session_id, timestamp, exercise, set_number, weight, reps, NULL, NULL
      FROM sets
    `);
    _db.run('DROP TABLE sets');
    _db.run('ALTER TABLE sets_migrated RENAME TO sets');
    _persist();
    // Re-read after recreation so the unit check below runs against the new table
    setNames = _all('PRAGMA table_info(sets)').map(c => c.name);
  }

  if (!setNames.includes('unit')) {
    // Stamp all existing rows with 'lbs' — the DEFAULT handles this automatically.
    _db.run("ALTER TABLE sets ADD COLUMN unit TEXT NOT NULL DEFAULT 'lbs'");
    _persist();
  }

  if (!sessionCols.includes('plan_id')) {
    _db.run('ALTER TABLE sessions ADD COLUMN plan_id INTEGER');
    _persist();
  }

  const tables = _all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  if (!tables.includes('plans')) {
    _db.run(`
      CREATE TABLE plans (
        plan_id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        start_date     TEXT NOT NULL,
        duration_weeks INTEGER,
        objectives_json TEXT,
        status         TEXT NOT NULL DEFAULT 'active'
      )
    `);
    _persist();
  }
  // Phase 3 nudges: weekly session target on plans. Checked AFTER the plans
  // table exists (created above for pre-Phase-3 DBs; those get the column via
  // CREATE, so this ALTER only fires for DBs created between v3.0 and v3.5).
  const planCols = _all('PRAGMA table_info(plans)').map(c => c.name);
  if (!planCols.includes('target_sessions_per_week')) {
    _db.run('ALTER TABLE plans ADD COLUMN target_sessions_per_week INTEGER');
    _persist();
  }

  if (!tables.includes('plan_exercises')) {
    _db.run(`
      CREATE TABLE plan_exercises (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id     INTEGER NOT NULL,
        exercise    TEXT NOT NULL,
        target_sets INTEGER,
        target_reps INTEGER,
        sort_order  INTEGER NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
      )
    `);
    _persist();
  }

  // Phase 5.1 — exercise identity. The exercises table plus nullable
  // exercise_id columns; _syncExercises() (every boot) seeds the catalogue,
  // adopts historical custom names, and backfills the IDs.
  if (!tables.includes('exercises')) {
    _db.run(`
      CREATE TABLE exercises (
        exercise_id  INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL UNIQUE,
        type         TEXT NOT NULL DEFAULT 'reps',
        muscle_group TEXT,
        is_custom    INTEGER NOT NULL DEFAULT 0
      )
    `);
    _persist();
  }
  // Fresh PRAGMA reads — setNames from above may predate the duration_mins
  // table rebuild, and pre-Phase-3 DBs only just gained plan_exercises.
  if (!_all('PRAGMA table_info(sets)').some(c => c.name === 'exercise_id')) {
    _db.run('ALTER TABLE sets ADD COLUMN exercise_id INTEGER');
    _persist();
  }
  if (!_all('PRAGMA table_info(plan_exercises)').some(c => c.name === 'exercise_id')) {
    _db.run('ALTER TABLE plan_exercises ADD COLUMN exercise_id INTEGER');
    _persist();
  }
}

// ── Exercise identity (5.1) ───────────────────────────

// Runs on every boot, after schema create/migrate. Idempotent and cheap when
// there is nothing to do (three SELECTs, no writes):
//   1. Seeds catalogue entries that don't have a row yet (new app versions
//      can extend EXERCISES; 'Other' is a UI flow, not an exercise).
//   2. Adopts historical names found in sets/plan_exercises but not in the
//      table (custom "Other" exercises logged before 5.1) as is_custom rows —
//      type inferred from the data itself (a row with duration is timed).
//   3. Backfills exercise_id on any row still missing one.
function _syncExercises() {
  let changed = false;

  // 1. Catalogue first — orphan detection below depends on these rows existing,
  //    otherwise a historical 'Chest Press' would be adopted as a duplicate.
  for (const ex of EXERCISES) {
    if (ex.name === 'Other') continue;
    if (_one('SELECT 1 AS x FROM exercises WHERE name = ?', [ex.name])) continue;
    _db.run('INSERT INTO exercises (name, type, muscle_group) VALUES (?, ?, ?)',
      [ex.name, ex.type, ex.muscleGroup ?? null]);
    changed = true;
  }

  // 2. Historical custom names (pre-5.1 "Other" exercises).
  const orphans = _all(`
    SELECT exercise AS name, MAX(duration_mins IS NOT NULL) AS timed FROM sets
      WHERE exercise NOT IN (SELECT name FROM exercises) GROUP BY exercise
    UNION
    SELECT exercise AS name, NULL AS timed FROM plan_exercises
      WHERE exercise NOT IN (SELECT name FROM exercises)
        AND exercise NOT IN (SELECT exercise FROM sets)
  `);
  for (const o of orphans) {
    // Data wins over name heuristics; plan-only names fall back to the
    // cardio-keyword detection used by the "Other" flow.
    const type = o.timed != null ? (o.timed ? 'timed' : 'reps') : getExerciseType(o.name);
    _db.run('INSERT INTO exercises (name, type, is_custom) VALUES (?, ?, 1)', [o.name, type]);
    changed = true;
  }

  // 3. Backfill IDs on any row still missing one.
  const unlinked = _one(`
    SELECT (SELECT COUNT(*) FROM sets WHERE exercise_id IS NULL) +
           (SELECT COUNT(*) FROM plan_exercises WHERE exercise_id IS NULL) AS n
  `).n;
  if (unlinked) {
    _db.run(`UPDATE sets SET exercise_id =
      (SELECT e.exercise_id FROM exercises e WHERE e.name = sets.exercise)
      WHERE exercise_id IS NULL`);
    _db.run(`UPDATE plan_exercises SET exercise_id =
      (SELECT e.exercise_id FROM exercises e WHERE e.name = plan_exercises.exercise)
      WHERE exercise_id IS NULL`);
    changed = true;
  }

  if (changed) _persist();
}

// Resolves a name to its exercise_id, creating an is_custom row on first
// sight (the "Other" flow's new names arrive here). `type` comes from the
// write itself so a custom cardio name is typed by its data.
function _exerciseId(name, type) {
  const row = _one('SELECT exercise_id FROM exercises WHERE name = ?', [name]);
  if (row) return row.exercise_id;
  return _runInsert('INSERT INTO exercises (name, type, is_custom) VALUES (?, ?, 1)',
    [name, type ?? getExerciseType(name)]);
}

// Renames an exercise everywhere, atomically from the caller's view: the
// identity row plus the denormalised name copies on sets and plan_exercises.
// History cannot orphan — exercise_id never changes. Throws on a name that
// already belongs to a different exercise.
export function dbRenameExercise(exerciseId, newName) {
  const name = String(newName ?? '').trim();
  if (!name) throw new Error('Enter a name.');
  const clash = _one('SELECT exercise_id FROM exercises WHERE name = ?', [name]);
  if (clash && clash.exercise_id !== exerciseId) {
    throw new Error('An exercise with that name already exists.');
  }
  const row = _one('SELECT exercise_id FROM exercises WHERE exercise_id = ?', [exerciseId]);
  if (!row) return false;
  _db.run('UPDATE exercises SET name = ? WHERE exercise_id = ?', [name, exerciseId]);
  _db.run('UPDATE sets SET exercise = ? WHERE exercise_id = ?', [name, exerciseId]);
  _db.run('UPDATE plan_exercises SET exercise = ? WHERE exercise_id = ?', [name, exerciseId]);
  _persist();
  return true;
}

export function dbGetExercise(name) {
  return _one('SELECT * FROM exercises WHERE name = ?', [name]);
}

export function dbGetAllExercises() {
  return _all('SELECT * FROM exercises ORDER BY name');
}

// Serialises the in-memory sql.js database to localStorage.
// IMPORTANT: _db.export() resets last_insert_rowid() to 0. INSERTs must go
// through _runInsert(), which reads the ID before persisting.
// A setItem failure (quota) never throws out of here: the write that
// triggered it has already applied to the in-memory DB, so the session keeps
// working; the listener puts up the storage-full banner, and the next write's
// persist is the retry. State-change notifications only — not one per write.
function _persist() {
  try {
    localStorage.setItem(DB_KEY, _encodeDB(_db.export()));
    if (_persistFailed) {
      _persistFailed = false;
      _persistListener?.(false);
    }
  } catch (_) {
    if (!_persistFailed) {
      _persistFailed = true;
      _persistListener?.(true);
    }
  }
}

// Base64-encodes the exported DB bytes (~1.33× the raw size). The previous
// format — a JSON array of byte values — inflated every byte to ~4 characters
// and pushed large DBs toward the ~5MB localStorage quota much sooner.
// Chunked fromCharCode avoids blowing the argument-count limit on big exports.
function _encodeDB(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Decodes a stored DB string. Accepts both formats: legacy JSON byte arrays
// (start with '[') from pre-v3.6 installs, and base64. The first _persist()
// after loading a legacy DB rewrites it as base64 — a one-way, lossless upgrade.
function _decodeDB(stored) {
  if (stored.charCodeAt(0) === 0x5B /* '[' */) return new Uint8Array(JSON.parse(stored));
  const binary = atob(stored);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Query helpers ─────────────────────────────────────

// Returns all rows for a query as an array of plain objects.
// Uses prepare/bind/step rather than exec() so it supports parameterised queries.
function _all(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Returns the first row of a query, or null if no rows match.
function _one(sql, params = []) {
  return _all(sql, params)[0] ?? null;
}

// Runs a single-row INSERT, reads the new row's ID, then persists — in that order.
// _db.export() inside _persist() resets last_insert_rowid() to 0, so the ID must
// be read before persisting. All INSERTs route through this helper so the ordering
// is structural rather than a convention each call site has to remember.
function _runInsert(sql, params) {
  _db.run(sql, params);
  const id = _one('SELECT last_insert_rowid() AS id').id;
  _persist();
  return id;
}

// ── Sessions ──────────────────────────────────────────

// Creates a new active session and returns its session_id.
export function dbCreateSession(defaultUnit) {
  return _runInsert('INSERT INTO sessions (start_time, status, default_unit) VALUES (?, ?, ?)', [
    new Date().toISOString(), 'active', defaultUnit,
  ]);
}

// Marks a session as completed with the current timestamp.
export function dbFinishSession(sessionId) {
  _db.run(
    'UPDATE sessions SET end_time = ?, status = ? WHERE session_id = ?',
    [new Date().toISOString(), 'completed', sessionId]
  );
  _persist();
}

export function dbGetSession(sessionId) {
  return _one('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
}

// Returns the most recent active session, or null if none exists.
export function dbGetActiveSession() {
  return _one("SELECT * FROM sessions WHERE status = 'active' ORDER BY session_id DESC LIMIT 1");
}

// Reopens a completed session so the user can continue adding sets.
export function dbResumeSession(sessionId) {
  _db.run(
    "UPDATE sessions SET status = 'active', end_time = NULL WHERE session_id = ?",
    [sessionId]
  );
  _persist();
}

export function dbUpdateSessionNotes(sessionId, notes) {
  _db.run(
    'UPDATE sessions SET notes = ? WHERE session_id = ?',
    [notes, sessionId]
  );
  _persist();
}

// ── Sets ──────────────────────────────────────────────

// Inserts a set row for either a reps or timed exercise.
// A set must have EITHER (weight + reps) OR (duration_mins) — never both, never neither.
// Unused columns are omitted from the INSERT entirely rather than passed as null,
// because sql.js can silently fail when null is passed in a params array.
// `unit` is the weight unit active at log time ('lbs' or 'kg'). Stored on all sets;
// for timed exercises the value is the user's preference but is not used for display.
export function dbInsertSet(sessionId, exercise, setNumber, weight, reps, durationMins, calories, unit) {
  const now = new Date().toISOString();
  const exerciseId = _exerciseId(exercise, durationMins != null ? 'timed' : 'reps');
  if (durationMins != null) {
    if (calories != null) {
      _runInsert(
        `INSERT INTO sets (session_id, timestamp, exercise, exercise_id, set_number, duration_mins, calories, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, exerciseId, setNumber, durationMins, calories, unit]
      );
    } else {
      _runInsert(
        `INSERT INTO sets (session_id, timestamp, exercise, exercise_id, set_number, duration_mins, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, exerciseId, setNumber, durationMins, unit]
      );
    }
  } else {
    _runInsert(
      `INSERT INTO sets (session_id, timestamp, exercise, exercise_id, set_number, weight, reps, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, now, exercise, exerciseId, setNumber, weight, reps, unit]
    );
  }
}

// Hard-deletes an incomplete session and all its sets. Used when the user
// explicitly discards an unfinished session to start fresh.
export function dbDeleteSession(sessionId) {
  _db.run('DELETE FROM sets WHERE session_id = ?', [sessionId]);
  _db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  _persist();
}

// Deletes a specific set by ID and returns the deleted row.
// Returns null if the set doesn't exist.
export function dbDeleteSetById(setId) {
  const row = _one('SELECT * FROM sets WHERE set_id = ?', [setId]);
  if (!row) return null;
  _db.run('DELETE FROM sets WHERE set_id = ?', [setId]);
  _persist();
  return row;
}

// Re-sequences set_number for all sets of a given exercise in a session so they
// are contiguous (1, 2, 3…) after a deletion. Uses insertion order (set_id) as
// the stable sort key so numbering matches the original logging order.
export function dbResequenceSets(sessionId, exercise) {
  const rows = _all(
    'SELECT set_id FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id ASC',
    [sessionId, exercise]
  );
  rows.forEach((r, i) => {
    _db.run('UPDATE sets SET set_number = ? WHERE set_id = ?', [i + 1, r.set_id]);
  });
  _persist();
}

// Deletes the most recently logged set of a given exercise within a session
// and returns the deleted row. Returns null if nothing matches. Scoped to one
// exercise so Undo can never delete another exercise's set (4.2 / review #C5) —
// the session-global last set may belong to an exercise no longer on screen.
export function dbDeleteLastSet(sessionId, exercise) {
  const last = _one(
    'SELECT * FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id DESC LIMIT 1',
    [sessionId, exercise]
  );
  if (!last) return null;
  _db.run('DELETE FROM sets WHERE set_id = ?', [last.set_id]);
  _persist();
  return last;
}

// Returns up to `limit` most recent sets for a session, newest first.
export function dbGetRecentSets(sessionId, limit = 5) {
  return _all(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC LIMIT ?',
    [sessionId, limit]
  );
}

// Returns all sets for a session, newest first (used for the full session log).
export function dbGetAllSets(sessionId) {
  return _all(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC',
    [sessionId]
  );
}

// Returns the total number of sets logged for a session.
export function dbGetSetCount(sessionId) {
  return _one('SELECT COUNT(*) AS n FROM sets WHERE session_id = ?', [sessionId])?.n ?? 0;
}

// Returns how many sets of a specific exercise have been logged in a session.
// Used to determine the next set number when switching exercises.
export function dbGetSetCountForExercise(sessionId, exercise) {
  return _one(
    'SELECT COUNT(*) AS n FROM sets WHERE session_id = ? AND exercise = ?',
    [sessionId, exercise]
  )?.n ?? 0;
}

// Returns the most recently logged set for a specific exercise within a session.
export function dbGetLastSetForExercise(sessionId, exercise) {
  return _one(
    'SELECT * FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id DESC LIMIT 1',
    [sessionId, exercise]
  );
}

// Returns all sets for a given exercise from the most recent COMPLETED session
// that contains at least one set of that exercise. Used for ghost-text placeholders
// and the "Last session" reference display.
// Two-step query: first find the qualifying session, then fetch its sets ordered by set_number.
export function dbGetLastSessionSetsForExercise(exercise) {
  const lastSession = _one(`
    SELECT s.session_id
    FROM sessions s
    JOIN sets st ON st.session_id = s.session_id
    WHERE s.status = 'completed' AND st.exercise = ?
    ORDER BY s.session_id DESC
    LIMIT 1
  `, [exercise]);

  if (!lastSession) return [];

  return _all(
    'SELECT * FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_number ASC',
    [lastSession.session_id, exercise]
  );
}

// ── Progression signal queries ───────────────────────

// Returns the last `limit` completed sessions containing exercise X, newest first.
// Each row: { session_id, start_time, best_weight_kg } where best_weight_kg is the
// highest weight in that session for the exercise, normalised to kg for cross-unit comparison.
// beforeSessionId: when provided, restricts to sessions with session_id < beforeSessionId.
// Used by F-06 completion signal to exclude the just-finished session (now 'completed').
export function dbGetRecentSessionsBestForExercise(exercise, limit = 6, beforeSessionId = null) {
  const beforeClause = beforeSessionId != null ? 'AND s.session_id < ?' : '';
  const params = beforeSessionId != null ? [exercise, beforeSessionId, limit] : [exercise, limit];
  return _all(`
    SELECT s.session_id, s.start_time,
           MAX(CASE WHEN st.unit = 'lbs' THEN st.weight / 2.2046 ELSE st.weight END) AS best_weight_kg
    FROM sessions s
    JOIN sets st ON st.session_id = s.session_id
    WHERE s.status = 'completed' AND st.exercise = ? AND st.weight IS NOT NULL
    ${beforeClause}
    GROUP BY s.session_id
    ORDER BY s.session_id DESC
    LIMIT ?
  `, params);
}

// Returns the best weight (kg-normalised) for an exercise in a given session, or null.
// Works on both active and completed sessions — used to get the current session's best.
export function dbGetSessionBestForExercise(sessionId, exercise) {
  return _one(`
    SELECT MAX(CASE WHEN unit = 'lbs' THEN weight / 2.2046 ELSE weight END) AS best_weight_kg
    FROM sets
    WHERE session_id = ? AND exercise = ? AND weight IS NOT NULL
  `, [sessionId, exercise])?.best_weight_kg ?? null;
}

// ── Session completion signal queries ────────────────

// Total volume (kg-normalised weight × reps) for all reps sets in a session.
export function dbGetSessionVolume(sessionId) {
  return _one(`
    SELECT SUM(CASE WHEN unit = 'lbs' THEN weight / 2.2046 ELSE weight END * reps) AS volume_kg
    FROM sets WHERE session_id = ? AND weight IS NOT NULL AND reps IS NOT NULL
  `, [sessionId])?.volume_kg ?? 0;
}

// Count of distinct exercises logged in a session.
export function dbGetSessionExerciseCount(sessionId) {
  return _one(
    'SELECT COUNT(DISTINCT exercise) AS n FROM sets WHERE session_id = ?',
    [sessionId]
  )?.n ?? 0;
}

// Returns the most recent completed session before the given session_id, or null.
export function dbGetPreviousCompletedSession(sessionId) {
  return _one(
    "SELECT * FROM sessions WHERE status = 'completed' AND session_id < ? ORDER BY session_id DESC LIMIT 1",
    [sessionId]
  );
}

// Returns distinct exercise names that have reps data (weight IS NOT NULL) in a session.
// Used to iterate exercises when computing improvement deltas for the completion signal.
export function dbGetSessionRepsExercises(sessionId) {
  return _all(
    'SELECT DISTINCT exercise FROM sets WHERE session_id = ? AND weight IS NOT NULL',
    [sessionId]
  ).map(r => r.exercise);
}

// ── Exercise navigation queries ──────────────────────

// Returns exercises ordered by most recent use (MAX session start_time DESC).
// Used to sort the exercise picker by recency.
export function dbGetExerciseRecency() {
  return _all(`
    SELECT st.exercise, MAX(s.start_time) AS last_used
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    GROUP BY st.exercise
    ORDER BY last_used DESC
  `);
}

// Returns exercise names in first-logged order from the most recent completed session.
// Used to compute the "Up Next" suggestion during an active session.
export function dbGetLastSessionExerciseOrder() {
  return _all(`
    SELECT exercise, MIN(set_id) AS first_set_id
    FROM sets
    WHERE session_id = (
      SELECT session_id FROM sessions WHERE status = 'completed'
      ORDER BY session_id DESC LIMIT 1
    )
    GROUP BY exercise
    ORDER BY first_set_id ASC
  `).map(r => r.exercise);
}

// ── PR detection query ───────────────────────────────

// All-time best kg-normalised weight for an exercise across COMPLETED sessions,
// or null if the exercise has never been logged in one. The current session is
// checked separately (dbGetSessionBestForExercise) so a PR beaten twice in one
// session celebrates both times.
export function dbGetAllTimeBestForExercise(exercise) {
  return _one(`
    SELECT MAX(CASE WHEN st.unit = 'lbs' THEN st.weight / 2.2046 ELSE st.weight END) AS best_kg
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE s.status = 'completed' AND st.exercise = ? AND st.weight IS NOT NULL
  `, [exercise])?.best_kg ?? null;
}

// ── Idle dashboard queries ───────────────────────────

// Returns the most recent completed session, or null. Used by the idle screen
// hook line ("Chest Press hit 65 kg on Tuesday — beat it?").
export function dbGetLastCompletedSession() {
  return _one("SELECT * FROM sessions WHERE status = 'completed' ORDER BY session_id DESC LIMIT 1");
}

// Returns start_time strings of completed sessions on or after the given ISO
// timestamp, ascending. Powers the week strip and streak on the idle screen.
export function dbGetCompletedSessionsSince(sinceISO) {
  return _all(
    "SELECT start_time FROM sessions WHERE status = 'completed' AND start_time >= ? ORDER BY start_time ASC",
    [sinceISO]
  ).map(r => r.start_time);
}

// Returns { exercise, set_count } rows for all sets logged in completed
// sessions on or after the given ISO timestamp. Muscle-group mapping happens
// in JS (the catalogue lives in state.js, not the DB) — powers the weekly
// muscle-coverage row on the idle screen.
export function dbGetSetCountsByExerciseSince(sinceISO) {
  return _all(`
    SELECT st.exercise, COUNT(*) AS set_count
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE s.status = 'completed' AND s.start_time >= ?
    GROUP BY st.exercise
  `, [sinceISO]);
}

// ── Exercise history queries ─────────────────────────

// Returns exercises that appear in at least one completed session, with
// session count and last-used date, most recently used first.
// Powers the exercise list on the History screen.
export function dbGetExercisesWithHistory() {
  return _all(`
    SELECT st.exercise,
           COUNT(DISTINCT s.session_id) AS session_count,
           MAX(s.start_time)            AS last_used
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE s.status = 'completed'
    GROUP BY st.exercise
    ORDER BY last_used DESC
  `);
}

// Per-session history for one exercise across completed sessions, oldest first.
// best_weight_kg is kg-normalised for cross-unit comparison. reps_at_best is a
// bare column: SQLite resolves it from the same row that produced the MAX, so it
// is the rep count of the heaviest set. Sessions with only timed sets have null
// best_weight_kg and carry total_mins / total_cals instead.
export function dbGetExerciseSessionHistory(exercise) {
  return _all(`
    SELECT s.session_id, s.start_time,
           MAX(CASE WHEN st.unit = 'lbs' THEN st.weight / 2.2046 ELSE st.weight END) AS best_weight_kg,
           st.reps               AS reps_at_best,
           COUNT(*)              AS set_count,
           SUM(st.duration_mins) AS total_mins,
           SUM(st.calories)      AS total_cals
    FROM sessions s
    JOIN sets st ON st.session_id = s.session_id
    WHERE s.status = 'completed' AND st.exercise = ?
    GROUP BY s.session_id
    ORDER BY s.session_id ASC
  `, [exercise]);
}

// ── Session reminder queries ─────────────────────────

// Returns ISO start_time strings for the last N completed sessions, newest first.
// Used to compute the user's typical training time pattern.
export function dbGetRecentSessionStartTimes(limit = 10) {
  return _all(
    "SELECT start_time FROM sessions WHERE status = 'completed' ORDER BY session_id DESC LIMIT ?",
    [limit]
  ).map(r => r.start_time);
}

// Returns true if the user has at least one completed session that started today (local time).
export function dbHasSessionToday() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return !!_one(
    "SELECT session_id FROM sessions WHERE status = 'completed' AND start_time >= ? LIMIT 1",
    [startOfDay.toISOString()]
  );
}

// ── Plans ─────────────────────────────────────────────

export function dbCreatePlan(name, startDate, durationWeeks, objectivesJson, targetSessionsPerWeek) {
  return _runInsert(
    'INSERT INTO plans (name, start_date, duration_weeks, objectives_json, status, target_sessions_per_week) VALUES (?, ?, ?, ?, ?, ?)',
    [name, startDate, durationWeeks ?? null, objectivesJson ?? null, 'active', targetSessionsPerWeek ?? null]
  );
}

export function dbUpdatePlan(planId, name, durationWeeks, objectivesJson, targetSessionsPerWeek) {
  _db.run(
    'UPDATE plans SET name = ?, duration_weeks = ?, objectives_json = ?, target_sessions_per_week = ? WHERE plan_id = ?',
    [name, durationWeeks ?? null, objectivesJson ?? null, targetSessionsPerWeek ?? null, planId]
  );
  _persist();
}

export function dbUpdatePlanStatus(planId, status) {
  _db.run('UPDATE plans SET status = ? WHERE plan_id = ?', [status, planId]);
  _persist();
}

export function dbGetActivePlan() {
  return _one("SELECT * FROM plans WHERE status = 'active' ORDER BY plan_id DESC LIMIT 1");
}

export function dbGetPlan(planId) {
  return _one('SELECT * FROM plans WHERE plan_id = ?', [planId]);
}

export function dbGetAllPlans() {
  return _all('SELECT * FROM plans ORDER BY plan_id DESC');
}

export function dbGetPlanExercises(planId) {
  return _all('SELECT * FROM plan_exercises WHERE plan_id = ? ORDER BY sort_order ASC', [planId]);
}

// Replaces all exercises for a plan atomically.
// exercises: array of { exercise, targetSets, targetReps }
export function dbSavePlanExercises(planId, exercises) {
  _db.run('DELETE FROM plan_exercises WHERE plan_id = ?', [planId]);
  exercises.forEach((ex, i) => {
    _db.run(
      'INSERT INTO plan_exercises (plan_id, exercise, exercise_id, target_sets, target_reps, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [planId, ex.exercise, _exerciseId(ex.exercise), ex.targetSets ?? null, ex.targetReps ?? null, i]
    );
  });
  _persist();
}

export function dbLinkSessionToPlan(sessionId, planId) {
  _db.run('UPDATE sessions SET plan_id = ? WHERE session_id = ?', [planId, sessionId]);
  _persist();
}

// Returns the plan and its exercises for a given session, or null if no plan was linked.
export function dbGetSessionPlan(sessionId) {
  const session = _one('SELECT plan_id FROM sessions WHERE session_id = ?', [sessionId]);
  if (!session?.plan_id) return null;
  const plan = dbGetPlan(session.plan_id);
  if (!plan) return null;
  return { ...plan, exercises: dbGetPlanExercises(session.plan_id) };
}

// ── Clear all data ────────────────────────────────────

// Wipes the entire database from localStorage. The page must be reloaded after this
// to reinitialise the in-memory DB.
// Removes the database AND every other gymops_* localStorage key — credentials
// (Anthropic API key, Drive OAuth token) and preferences included. "Clear All
// Data" must leave nothing readable behind on a shared or handed-over device.
export function dbClearAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('gymops_'))
    .forEach(k => localStorage.removeItem(k));
}

// ── CSV Export ────────────────────────────────────────

// Exports all sets for a single session as CSV. Used for the post-session
// auto-upload to Google Drive and the manual Export button on the completed screen.
// The session_notes column is included only when the session has notes, to keep
// the CSV clean for sessions that don't use the notes field.
export function dbExportSessionCSV(sessionId) {
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status, s.notes AS session_notes,
           st.set_id, st.timestamp, st.exercise, st.set_number,
           st.weight, st.unit, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE st.session_id = ?
    ORDER BY st.set_id
  `, [sessionId]);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','unit','reps','duration_mins','calories'];
  if (rows[0].session_notes) headers.push('session_notes');
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}

// Exports the full workout history across all sessions as CSV.
// Used as a fallback when no specific session is in scope.
// session_notes column is included only when at least one session has notes.
export function dbExportCSV() {
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status, s.notes AS session_notes,
           st.set_id, st.timestamp, st.exercise, st.set_number,
           st.weight, st.unit, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    ORDER BY st.set_id
  `);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','unit','reps','duration_mins','calories'];
  if (rows.some(r => r.session_notes)) headers.push('session_notes');
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}

// Exports sessions whose start_time falls within the given date range (YYYY-MM-DD strings).
// Either bound may be omitted (null / empty string) to mean "no limit".
export function dbExportCSVByRange(from, to) {
  const conditions = [];
  const params = [];
  if (from) { conditions.push("date(s.start_time) >= ?"); params.push(from); }
  if (to)   { conditions.push("date(s.start_time) <= ?"); params.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status, s.notes AS session_notes,
           st.set_id, st.timestamp, st.exercise, st.set_number,
           st.weight, st.unit, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    ${where}
    ORDER BY st.set_id
  `, params);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','unit','reps','duration_mins','calories'];
  if (rows.some(r => r.session_notes)) headers.push('session_notes');
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}
