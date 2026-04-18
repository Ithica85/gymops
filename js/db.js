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
      session_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time  TEXT NOT NULL,
      end_time    TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      notes       TEXT
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
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
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

  const cols = _all('PRAGMA table_info(sets)');
  const names = cols.map(c => c.name);

  if (!names.includes('duration_mins')) {
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
function dbCreateSession() {
  _db.run('INSERT INTO sessions (start_time, status) VALUES (?, ?)', [
    new Date().toISOString(), 'active',
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
function dbInsertSet(sessionId, exercise, setNumber, weight, reps, durationMins, calories) {
  const now = new Date().toISOString();
  if (durationMins != null) {
    if (calories != null) {
      _db.run(
        `INSERT INTO sets (session_id, timestamp, exercise, set_number, duration_mins, calories)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, setNumber, durationMins, calories]
      );
    } else {
      _db.run(
        `INSERT INTO sets (session_id, timestamp, exercise, set_number, duration_mins)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, now, exercise, setNumber, durationMins]
      );
    }
  } else {
    _db.run(
      `INSERT INTO sets (session_id, timestamp, exercise, set_number, weight, reps)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, now, exercise, setNumber, weight, reps]
    );
  }
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
           st.weight, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE st.session_id = ?
    ORDER BY st.set_id
  `, [sessionId]);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','reps','duration_mins','calories'];
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
           st.weight, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    ORDER BY st.set_id
  `);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','reps','duration_mins','calories'];
  if (rows.some(r => r.session_notes)) headers.push('session_notes');
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}
