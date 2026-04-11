// ═══════════════════════════════════════════════════════
// GymOps — Database layer (sql.js + localStorage)
// ═══════════════════════════════════════════════════════

const DB_KEY = 'gymops_db';

let _db = null;

// ── Init ──────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs({ locateFile: f => `lib/${f}` });

  const saved = localStorage.getItem(DB_KEY);
  if (saved) {
    try {
      _db = new SQL.Database(new Uint8Array(JSON.parse(saved)));
      _migrate();
    } catch (_) {
      _db = new SQL.Database();
      _createSchema();
    }
  } else {
    _db = new SQL.Database();
    _createSchema();
  }
}

function _createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time  TEXT NOT NULL,
      end_time    TEXT,
      status      TEXT NOT NULL DEFAULT 'active'
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

// Migrate existing DB to add duration_mins / calories and make weight/reps nullable
function _migrate() {
  const cols = _all('PRAGMA table_info(sets)');
  const names = cols.map(c => c.name);

  if (!names.includes('duration_mins')) {
    // Recreate table with nullable weight/reps and new columns, preserving all data
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

function _persist() {
  localStorage.setItem(DB_KEY, JSON.stringify(Array.from(_db.export())));
}

// ── Query helpers ─────────────────────────────────────
function _all(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function _one(sql, params = []) {
  return _all(sql, params)[0] ?? null;
}

// ── Sessions ──────────────────────────────────────────
function dbCreateSession() {
  _db.run('INSERT INTO sessions (start_time, status) VALUES (?, ?)', [
    new Date().toISOString(), 'active',
  ]);
  _persist();
  return _one('SELECT last_insert_rowid() AS id').id;
}

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

function dbGetActiveSession() {
  return _one("SELECT * FROM sessions WHERE status = 'active' ORDER BY session_id DESC LIMIT 1");
}

function dbResumeSession(sessionId) {
  _db.run(
    "UPDATE sessions SET status = 'active', end_time = NULL WHERE session_id = ?",
    [sessionId]
  );
  _persist();
}

// ── Sets ──────────────────────────────────────────────
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

function dbGetRecentSets(sessionId, limit = 5) {
  return _all(
    'SELECT * FROM sets WHERE session_id = ? ORDER BY set_id DESC LIMIT ?',
    [sessionId, limit]
  );
}

function dbGetSetCount(sessionId) {
  return _one('SELECT COUNT(*) AS n FROM sets WHERE session_id = ?', [sessionId])?.n ?? 0;
}

function dbGetSetCountForExercise(sessionId, exercise) {
  return _one(
    'SELECT COUNT(*) AS n FROM sets WHERE session_id = ? AND exercise = ?',
    [sessionId, exercise]
  )?.n ?? 0;
}

function dbGetLastSetForExercise(sessionId, exercise) {
  return _one(
    'SELECT * FROM sets WHERE session_id = ? AND exercise = ? ORDER BY set_id DESC LIMIT 1',
    [sessionId, exercise]
  );
}

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
function dbClearAll() {
  localStorage.removeItem(DB_KEY);
}

// ── CSV Export ────────────────────────────────────────
function dbExportSessionCSV(sessionId) {
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status,
           st.set_id, st.timestamp, st.exercise, st.set_number,
           st.weight, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    WHERE st.session_id = ?
    ORDER BY st.set_id
  `, [sessionId]);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','reps','duration_mins','calories'];
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}


function dbExportCSV() {
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status,
           st.set_id, st.timestamp, st.exercise, st.set_number,
           st.weight, st.reps, st.duration_mins, st.calories
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    ORDER BY st.set_id
  `);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','reps','duration_mins','calories'];
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}
