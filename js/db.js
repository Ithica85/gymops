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
      set_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL,
      timestamp   TEXT NOT NULL,
      exercise    TEXT NOT NULL,
      set_number  INTEGER NOT NULL,
      weight      REAL NOT NULL,
      reps        INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);
  _persist();
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

function dbGetActiveSession() {
  return _one("SELECT * FROM sessions WHERE status = 'active' ORDER BY session_id DESC LIMIT 1");
}

// ── Sets ──────────────────────────────────────────────
function dbInsertSet(sessionId, exercise, setNumber, weight, reps) {
  _db.run(
    'INSERT INTO sets (session_id, timestamp, exercise, set_number, weight, reps) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, new Date().toISOString(), exercise, setNumber, weight, reps]
  );
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

// ── CSV Export ────────────────────────────────────────
function dbExportCSV() {
  const rows = _all(`
    SELECT s.session_id, s.start_time, s.end_time, s.status,
           st.set_id, st.timestamp, st.exercise, st.set_number, st.weight, st.reps
    FROM sets st
    JOIN sessions s ON s.session_id = st.session_id
    ORDER BY st.set_id
  `);
  if (!rows.length) return null;
  const headers = ['session_id','start_time','end_time','status','set_id','timestamp','exercise','set_number','weight','reps'];
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}
