// ═══════════════════════════════════════════════════════
// GymOps — Google Drive integration
// ═══════════════════════════════════════════════════════
//
// SETUP STEPS:
// 1. Go to https://console.cloud.google.com and create a new project
// 2. Enable the Google Drive API (APIs & Services → Enable APIs)
// 3. Create OAuth 2.0 credentials: APIs & Services → Credentials →
//    Create Credentials → OAuth client ID → Web application
// 4. Add your domain to "Authorized JavaScript origins"
//    (e.g. https://gymops-two.vercel.app and http://localhost:8080)
// 5. Replace the GOOGLE_CLIENT_ID value below with your OAuth client ID

const GOOGLE_CLIENT_ID = '437808702944-102a18ni81qk86lrae2ph0q5n5sppcgh.apps.googleusercontent.com';

// drive.file scope: grants access only to files created by this app,
// not the user's full Drive. Least-privilege approach.
const DRIVE_SCOPE         = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME         = 'GymOps';
const SESSION_DATA_FOLDER = 'Gym Session Data';
const TOKEN_STORAGE       = 'gymops_gdrive_token';
const MIGRATION_KEY       = 'gymops_gdrive_migrated'; // set after one-time folder migration
const ENABLED_KEY         = 'gymops_gdrive_enabled';  // 6.6 — explicit opt-in, set from Settings

// How long a background (non-interactive) token request may hang before we give
// up. Uploads are chained in workout.js, so a token promise that never settles
// would stall every later upload — not just its own.
const TOKEN_TIMEOUT_MS = 15000;

// Reused across calls so Google Identity Services doesn't re-initialise the client.
let _tokenClient = null;

// ── Token management ──────────────────────────────────

// Reads a stored OAuth token from localStorage. Returns null if absent or expired.
// Uses a 60-second safety buffer before the official expiry to avoid using a token
// that expires mid-request.
function _getStoredToken() {
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE);
    if (!stored) return null;
    const { token, expiry } = JSON.parse(stored);
    if (Date.now() > expiry) { localStorage.removeItem(TOKEN_STORAGE); return null; }
    return token;
  } catch (_) { return null; }
}

// Persists an OAuth token with a calculated expiry timestamp.
// expiresIn is in seconds (as returned by Google); we subtract 60s as a safety buffer.
function _storeToken(token, expiresIn) {
  const expiry = Date.now() + (expiresIn - 60) * 1000;
  localStorage.setItem(TOKEN_STORAGE, JSON.stringify({ token, expiry }));
}

// Tags an error as "the Drive grant is gone" so callers can tell a re-auth
// need (→ prompt the user to reconnect in Settings) apart from a transient
// network/API failure (→ retry next session).
function _authError(message) {
  const err = new Error(message);
  err.gdriveAuth = true;
  return err;
}

// Triggers the Google OAuth token flow and resolves with an access token.
// prompt: '' shows the consent UI only if this scope was never granted —
// used for the explicit Connect action in Settings.
// prompt: 'none' can never render UI; it fails instead. Every background path
// (i.e. session finish) uses it, so finishing a workout can't turn into a
// consent screen no matter what state the grant is in (6.6).
function _requestToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(_authError('Google sign-in unavailable — check your connection.'));
      return;
    }
    if (!_tokenClient) {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: () => {}, // Overridden per-request below
      });
    }
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    // GIS reports OAuth errors through the callback and popup-level failures
    // (blocked, dismissed) through error_callback — a silent prompt:'none'
    // request that is refused arrives on one or the other.
    _tokenClient.callback = (response) => {
      if (response.error) { finish(reject, _authError(response.error)); return; }
      _storeToken(response.access_token, response.expires_in);
      finish(resolve, response.access_token);
    };
    _tokenClient.error_callback = (err) => finish(reject, _authError(err?.type ?? 'popup_failed'));

    setTimeout(() => finish(reject, _authError('Google sign-in timed out.')), TOKEN_TIMEOUT_MS);
    _tokenClient.requestAccessToken({ prompt });
  });
}

// Returns a valid access token: the stored one if still valid, otherwise a
// fresh request. interactive:false is the background contract — never shows UI.
async function _getToken({ interactive } = { interactive: false }) {
  const stored = _getStoredToken();
  if (stored) return stored;
  return _requestToken(interactive ? '' : 'none');
}

// ── Drive API helpers ─────────────────────────────────

// Finds a named folder in Drive, or creates it. parentId scopes the search to a
// specific parent folder; null searches without a parent constraint (top-level).
async function _findOrCreateFolder(token, name, parentId = null) {
  const parentQ = parentId ? `'${parentId}' in parents and ` : '';
  const q = `${parentQ}name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  const folder = await create.json();
  return folder.id;
}

// Resolves the full folder hierarchy for a session upload, creating folders as needed:
// GymOps/ → Gym Session Data/ → YYYY-MM/
// dateStr is in YYYY_MM_DD format (underscores); month folder uses YYYY-MM (hyphen).
async function _getMonthFolder(token, dateStr) {
  const gymOpsId      = await _findOrCreateFolder(token, FOLDER_NAME);
  const sessionDataId = await _findOrCreateFolder(token, SESSION_DATA_FOLDER, gymOpsId);
  const monthLabel    = `${dateStr.slice(0, 4)}-${dateStr.slice(5, 7)}`; // YYYY-MM
  const monthId       = await _findOrCreateFolder(token, monthLabel, sessionDataId);
  return { gymOpsId, sessionDataId, monthId };
}

// One-time migration: moves any gym_* files sitting directly in the GymOps root
// into the correct YYYY-MM subfolder under Gym Session Data. Skipped on subsequent
// uploads once the localStorage migration flag is set.
async function _migrateToMonthFolders(token, gymOpsId, sessionDataId) {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const q = `'${gymOpsId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const gymFiles = (data.files ?? []).filter(f => /^gym_\d{4}_\d{2}_\d{2}/.test(f.name));

  const failed = [];
  for (const file of gymFiles) {
    try {
      const m = file.name.match(/^gym_(\d{4})_(\d{2})_\d{2}/);
      if (!m) continue;
      const monthLabel = `${m[1]}-${m[2]}`;
      const monthId = await _findOrCreateFolder(token, monthLabel, sessionDataId);
      // Move file by updating its parents (add new, remove old) — no copy, no data loss
      const move = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?addParents=${monthId}&removeParents=${gymOpsId}&fields=id`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      if (!move.ok) throw new Error(`Move failed: ${move.status}`);
    } catch (err) {
      failed.push(file.name);
      console.error('Migration failed for:', file.name, err);
      // Non-blocking — continue migrating remaining files
    }
  }

  // Only mark migration done if every file moved. On partial failure the flag
  // stays unset so the next upload retries — already-moved files are no longer
  // in the GymOps root, so the query above naturally excludes them.
  if (failed.length) {
    console.error(`Drive migration incomplete — ${failed.length} file(s) will retry next upload:`, failed);
    return;
  }
  localStorage.setItem(MIGRATION_KEY, 'true');
}

// Determines the correct filename within the target folder, handling same-day collisions.
// Base name: gym_YYYY_MM_DD. If that already exists, finds the highest existing
// numeric suffix (e.g. gym_2026_04_17_2) and increments it.
async function _resolveFilename(token, folderId, dateStr) {
  const base  = `gym_${dateStr}`;
  const q     = `'${folderId}' in parents and name contains '${base}' and trashed=false`;
  const res   = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data  = await res.json();
  const files = data.files ?? [];

  if (!files.length) return base; // No existing file for this date — use base name

  // Find the highest existing suffix to append the next one
  let max = 1;
  files.forEach(f => {
    const m = f.name.match(new RegExp(`^${base}_(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${base}_${max + 1}`;
}

// Uploads a CSV file to Drive using a multipart request.
// The mimeType 'application/vnd.google-apps.spreadsheet' instructs Drive to
// auto-convert the CSV into a native Google Sheet on upload.
async function _uploadFile(token, folderId, filename, csv) {
  const boundary = 'gymops_boundary';
  const metadata = JSON.stringify({
    name: filename,
    parents: [folderId],
    mimeType: 'application/vnd.google-apps.spreadsheet', // Convert CSV → Google Sheet
  });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/csv',
    '',
    csv,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

// ── Connection state (6.6) ────────────────────────────
//
// Drive is opt-in and owned by Settings. Before 6.6 the first session finish
// itself triggered the OAuth consent screen — cloud consent interrupting the
// one moment the app must be local-first. Now nothing touches Google until the
// user taps Connect on a screen they navigated to deliberately.

// True when the user has connected Drive. Pre-6.6 installs that were already
// auto-uploading are adopted once, on first read: a stored token or the folder-
// migration flag both prove a completed grant, so an existing user's uploads
// keep working without having to reconnect.
export function gdriveIsConnected() {
  if (localStorage.getItem(ENABLED_KEY) === null) {
    const wasUsing = localStorage.getItem(TOKEN_STORAGE) || localStorage.getItem(MIGRATION_KEY);
    if (wasUsing) localStorage.setItem(ENABLED_KEY, 'true');
  }
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

// Explicit user action from Settings — this is the ONLY path allowed to show a
// consent screen. Marks the connection enabled only after a token is in hand,
// so a cancelled consent leaves the app exactly as it was.
export async function gdriveConnect() {
  await _requestToken('');
  localStorage.setItem(ENABLED_KEY, 'true');
}

// Drops the local grant and tells Google to revoke it. Written as 'false'
// rather than removed so gdriveIsConnected can't re-adopt a stale migration
// flag and silently reconnect on the next boot.
export function gdriveDisconnect() {
  const token = _getStoredToken();
  if (token) {
    try { google.accounts?.oauth2?.revoke(token, () => {}); } catch (_) { /* best effort */ }
  }
  localStorage.removeItem(TOKEN_STORAGE);
  localStorage.setItem(ENABLED_KEY, 'false');
}

// ── Public API ────────────────────────────────────────

// Uploads a session's CSV to GymOps/Gym Session Data/YYYY-MM/ in Drive.
// Runs a one-time migration of any legacy files still in the GymOps root.
// Failures throw so the caller can trigger a local fallback — all user-facing
// messaging lives with the drive-status line in app.js, not here.
export async function gdriveUpload(csv, sessionStartIso) {
  try {
    const token   = await _getToken({ interactive: false });
    const d       = new Date(sessionStartIso);
    const dateStr = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;

    const { gymOpsId, sessionDataId, monthId } = await _getMonthFolder(token, dateStr);
    await _migrateToMonthFolders(token, gymOpsId, sessionDataId);

    const filename = await _resolveFilename(token, monthId, dateStr);
    await _uploadFile(token, monthId, filename, csv);
  } catch (err) {
    console.error('Drive upload failed:', err);
    throw err; // propagate so _startDriveUpload() can show fail state + local fallback
  }
}
