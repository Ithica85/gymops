// ═══════════════════════════════════════════════════════
// GymOps — Database layer (sql.js + localStorage)
// ═══════════════════════════════════════════════════════

const DB_KEY = 'gymops_db';

let _db = null;

// ── Init ──────────────────────────────────────────────

// Boots the sql.js database. Tries to restore an existing DB from localStorage;
// falls back to a fresh schema if the stored data is missing or corrupt.
async function initDB() {
  const SQL = await initSqlJs({ locateFile: f => `lib/${f}` });

  const saved = localStorage.getItem(DB_KEY);
  if (saved) {
    try {
      _db = new SQL.Database(new Uint8Array(JSON.parse(saved)));
      _migrate(); // Apply any schema changes needed for this version
    } catch (_) {
      // Corrupt DB — start fresh rather than leaving the app broken
      _db = new SQL.Database();
      _createSchema();
    }
  } else {
    _db = new SQL.Database();
    _createSchema();
  }
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
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    CREATE TABLE IF NOT EXISTS plans (
      plan_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      start_date     TEXT NOT NULL,
      duration_weeks INTEGER,
      objectives_json TEXT,
      status         TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS plan_exercises (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id     INTEGER NOT NULL,
      exercise    TEXT NOT NULL,
      target_sets INTEGER,
      target_reps INTEGER,
      sort_order  INTEGER NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
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
}

// Serialises the in-memory sql.js database to localStorage.
// IMPORTANT: _db.export() resets last_insert_rowid() to 0. Always read
// last_insert_rowid() BEFORE calling _persist() after an INSERT.
function _persist() {
  localStorage.setItem(DB_KEY, JSON.stringify(Array.from(_db.export())));
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

// ── Sessions ──────────────────────────────────────────

// Creates a new active session and returns its session_id.
// last_insert_rowid() MUST be called before _persist() — _db.export() inside
// _persist() resets it to 0, which would cause all sets to be stored under session_id=0.
function dbCreateSession(defaultUnit) {
  _db.run('INSERT INTO sessions (start_time, status, default_unit) VALUES (?, ?, ?)', [
    new Date().toISOString(), 'active', defaultUnit,
  ]);
  const id = _one('SELECT last_insert_rowid() AS id').id;
  _persist();
  return id;
}

// Marks a session as completed with the current timestamp.
function dbFinishSession(sessionId) {
  _db.run(
    'UPDATE sessions SET end_time = ?, status = ? WHERE session_id = ?',
    [new Date().toISOString(), 'completed', sessionId]
  );
  _persist();
}

function dbGetSession(sessionId) {
  return _one('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
}

// Returns the most recent active session, or null if none exists.
function dbGetActiveSession() {
  return _one("SELECT * FROM sessions WHERE status = 'active' ORDER BY session_id DESC LIMIT 1");
}

// Reopens a completed session so the user can continue adding sets.
function dbResumeSession(sessionId) {
  _db.run(
    "UPDATE sessions SET status = 'active', end_time = NULL WHERE session_id = ?",
    [sessionId]
  );
  _persist();
}

function dbUpdateSessionNotes(sessionId, notes) {
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
function dbInsertSet(sessionId, exercise, setNumber, weight, reps, durationMins, calories, unit) {
  const now = new Date().toISOString();
  if (durationMins != null) {
    if (calories != null) {
      _db.run(
        `INSERT INTO sets (session_id, timestamp, exercise, set_number, duration_mins, calories, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, setNumber, durationMins, calories, unit]
      );
    } else {
      _db.run(
        `INSERT INTO sets (session_id, timestamp, exercise, set_number, duration_mins, unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, setNumber, durationMins, unit]
      );
    }
  } else {
    _db.run(
      `INSERT INTO sets (session_id, timestamp, exercise, set_number, weight, reps, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, now, exercise, setNumber, weight, reps, unit]
    );
  }
  _persist();
}

// Hard-deletes an incomplete session and all its sets. Used when the user
// explicitly discards an unfinished session to start fresh.
function dbDeleteSession(sessionId) {
  _db.run('DELETE FROM sets WHERE session_id = ?', [sessionId]);
  _db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  _persist();
}

// Deletes a specific set by ID and returns the deleted row.
// Returns null if the set doesn't exist.
function dbDeleteSetById(setId) {
  const row = _one('SELECT * FROM sets WHERE set_id = ?', [setId]);
  if (!row) return null;
  _db.run('DELETE FROM sets WHERE set_id = ?', [setId]);
  _persist();
  return row;
}

// Re-sequences set_number for all sets of a given exercise in a session so they
// are contiguous (1, 2, 3…) after a deletion. Uses insertion order (set_id) as
// the stable sort key so numbering matches the original logging order.
function dbResequenceSets(sessionId, exercise) {
  const rows = _all(
    'SELECT set_id FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id ASC',
    [sessionId, exercise]
  );
  rows.forEach((r, i) => {
    _db.run('UPDATE sets SET set_number = ? WHERE set_id = ?', [i + 1, r.set_id]);
  });
  _persist();
}

// Deletes the most recently logged set for a session and returns the deleted row.
// Returns null if the session has no sets (nothing to undo).
function dbDeleteLastSet(sessionId) {
  const last = _one(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC LIMIT 1',
    [sessionId]
  );
  if (!last) return null;
  _db.run('DELETE FROM sets WHERE set_id = ?', [last.set_id]);
  _persist();
  return last;
}

// Returns up to `limit` most recent sets for a session, newest first.
function dbGetRecentSets(sessionId, limit = 5) {
  return _all(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC LIMIT ?',
    [sessionId, limit]
  );
}

// Returns all sets for a session, newest first (used for the full session log).
function dbGetAllSets(sessionId) {
  return _all(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC',
    [sessionId]
  );
}

// Returns the total number of sets logged for a session.
function dbGetSetCount(sessionId) {
  return _one('SELECT COUNT(*) AS n FROM sets WHERE session_id = ?', [sessionId])?.n ?? 0;
}

// Returns how many sets of a specific exercise have been logged in a session.
// Used to determine the next set number when switching exercises.
function dbGetSetCountForExercise(sessionId, exercise) {
  return _one(
    'SELECT COUNT(*) AS n FROM sets WHERE session_id = ? AND exercise = ?',
    [sessionId, exercise]
  )?.n ?? 0;
}

// Returns the most recently logged set for a specific exercise within a session.
function dbGetLastSetForExercise(sessionId, exercise) {
  return _one(
    'SELECT * FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id DESC LIMIT 1',
    [sessionId, exercise]
  );
}

// Returns all sets for a given exercise from the most recent COMPLETED session
// that contains at least one set of that exercise. Used for ghost-text placeholders
// and the "Last session" reference display.
// Two-step query: first find the qualifying session, then fetch its sets ordered by set_number.
function dbGetLastSessionSetsForExercise(exercise) {
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
function dbGetRecentSessionsBestForExercise(exercise, limit = 6, beforeSessionId = null) {
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
function dbGetSessionBestForExercise(sessionId, exercise) {
  return _one(`
    SELECT MAX(CASE WHEN unit = 'lbs' THEN weight / 2.2046 ELSE weight END) AS best_weight_kg
    FROM sets
    WHERE session_id = ? AND exercise = ? AND weight IS NOT NULL
  `, [sessionId, exercise])?.best_weight_kg ?? null;
}

// ── Session completion signal queries ────────────────

// Total volume (kg-normalised weight × reps) for all reps sets in a session.
function dbGetSessionVolume(sessionId) {
  return _one(`
    SELECT SUM(CASE WHEN unit = 'lbs' THEN weight / 2.2046 ELSE weight END * reps) AS volume_kg
    FROM sets WHERE session_id = ? AND weight IS NOT NULL AND reps IS NOT NULL
  `, [sessionId])?.volume_kg ?? 0;
}

// Count of distinct exercises logged in a session.
function dbGetSessionExerciseCount(sessionId) {
  return _one(
    'SELECT COUNT(DISTINCT exercise) AS n FROM sets WHERE session_id = ?',
    [sessionId]
  )?.n ?? 0;
}

// Returns the most recent completed session before the given session_id, or null.
function dbGetPreviousCompletedSession(sessionId) {
  return _one(
    "SELECT * FROM sessions WHERE status = 'completed' AND session_id < ? ORDER BY session_id DESC LIMIT 1",
    [sessionId]
  );
}

// Returns distinct exercise names that have reps data (weight IS NOT NULL) in a session.
// Used to iterate exercises when computing improvement deltas for the completion signal.
function dbGetSessionRepsExercises(sessionId) {
  return _all(
    'SELECT DISTINCT exercise FROM sets WHERE session_id = ? AND weight IS NOT NULL',
    [sessionId]
  ).map(r => r.exercise);
}

// ── Exercise navigation queries ──────────────────────

// Returns exercises ordered by most recent use (MAX session start_time DESC).
// Used to sort the exercise picker by recency.
function dbGetExerciseRecency() {
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
function dbGetLastSessionExerciseOrder() {
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
function dbGetAllTimeBestForExercise(exercise) {
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
function dbGetLastCompletedSession() {
  return _one("SELECT * FROM sessions WHERE status = 'completed' ORDER BY session_id DESC LIMIT 1");
}

// Returns start_time strings of completed sessions on or after the given ISO
// timestamp, ascending. Powers the week strip and streak on the idle screen.
function dbGetCompletedSessionsSince(sinceISO) {
  return _all(
    "SELECT start_time FROM sessions WHERE status = 'completed' AND start_time >= ? ORDER BY start_time ASC",
    [sinceISO]
  ).map(r => r.start_time);
}

// ── Exercise history queries ─────────────────────────

// Returns exercises that appear in at least one completed session, with
// session count and last-used date, most recently used first.
// Powers the exercise list on the History screen.
function dbGetExercisesWithHistory() {
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
function dbGetExerciseSessionHistory(exercise) {
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
function dbGetRecentSessionStartTimes(limit = 10) {
  return _all(
    "SELECT start_time FROM sessions WHERE status = 'completed' ORDER BY session_id DESC LIMIT ?",
    [limit]
  ).map(r => r.start_time);
}

// Returns true if the user has at least one completed session that started today (local time).
function dbHasSessionToday() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return !!_one(
    "SELECT session_id FROM sessions WHERE status = 'completed' AND start_time >= ? LIMIT 1",
    [startOfDay.toISOString()]
  );
}

// ── Plans ─────────────────────────────────────────────

function dbCreatePlan(name, startDate, durationWeeks, objectivesJson) {
  _db.run(
    'INSERT INTO plans (name, start_date, duration_weeks, objectives_json, status) VALUES (?, ?, ?, ?, ?)',
    [name, startDate, durationWeeks ?? null, objectivesJson ?? null, 'active']
  );
  const row = _one('SELECT last_insert_rowid() AS id');
  _persist();
  return row.id;
}

function dbUpdatePlan(planId, name, durationWeeks, objectivesJson) {
  _db.run(
    'UPDATE plans SET name = ?, duration_weeks = ?, objectives_json = ? WHERE plan_id = ?',
    [name, durationWeeks ?? null, objectivesJson ?? null, planId]
  );
  _persist();
}

function dbUpdatePlanStatus(planId, status) {
  _db.run('UPDATE plans SET status = ? WHERE plan_id = ?', [status, planId]);
  _persist();
}

function dbGetActivePlan() {
  return _one("SELECT * FROM plans WHERE status = 'active' ORDER BY plan_id DESC LIMIT 1");
}

function dbGetPlan(planId) {
  return _one('SELECT * FROM plans WHERE plan_id = ?', [planId]);
}

function dbGetAllPlans() {
  return _all('SELECT * FROM plans ORDER BY plan_id DESC');
}

function dbGetPlanExercises(planId) {
  return _all('SELECT * FROM plan_exercises WHERE plan_id = ? ORDER BY sort_order ASC', [planId]);
}

// Replaces all exercises for a plan atomically.
// exercises: array of { exercise, targetSets, targetReps }
function dbSavePlanExercises(planId, exercises) {
  _db.run('DELETE FROM plan_exercises WHERE plan_id = ?', [planId]);
  exercises.forEach((ex, i) => {
    _db.run(
      'INSERT INTO plan_exercises (plan_id, exercise, target_sets, target_reps, sort_order) VALUES (?, ?, ?, ?, ?)',
      [planId, ex.exercise, ex.targetSets ?? null, ex.targetReps ?? null, i]
    );
  });
  _persist();
}

function dbLinkSessionToPlan(sessionId, planId) {
  _db.run('UPDATE sessions SET plan_id = ? WHERE session_id = ?', [planId, sessionId]);
  _persist();
}

// Returns the plan and its exercises for a given session, or null if no plan was linked.
function dbGetSessionPlan(sessionId) {
  const session = _one('SELECT plan_id FROM sessions WHERE session_id = ?', [sessionId]);
  if (!session?.plan_id) return null;
  const plan = dbGetPlan(session.plan_id);
  if (!plan) return null;
  return { ...plan, exercises: dbGetPlanExercises(session.plan_id) };
}

// ── Clear all data ────────────────────────────────────

// Wipes the entire database from localStorage. The page must be reloaded after this
// to reinitialise the in-memory DB.
function dbClearAll() {
  localStorage.removeItem(DB_KEY);
}

// ── CSV Export ────────────────────────────────────────

// Exports all sets for a single session as CSV. Used for the post-session
// auto-upload to Google Drive and the manual Export button on the completed screen.
// The session_notes column is included only when the session has notes, to keep
// the CSV clean for sessions that don't use the notes field.
function dbExportSessionCSV(sessionId) {
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
function dbExportCSV() {
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
function dbExportCSVByRange(from, to) {
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
