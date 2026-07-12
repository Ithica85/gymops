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

// Triggers the Google OAuth consent flow and resolves with an access token.
// prompt: '' means "reuse the existing grant silently if possible; only show
// the consent UI if the user hasn't previously authorised this scope."
function _requestToken() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }
    if (!_tokenClient) {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: () => {}, // Overridden per-request below
      });
    }
    _tokenClient.callback = (response) => {
      if (response.error) { reject(new Error(response.error)); return; }
      _storeToken(response.access_token, response.expires_in);
      resolve(response.access_token);
    };
    _tokenClient.requestAccessToken({ prompt: '' });
  });
}

// Returns a valid access token: uses the stored token if still valid,
// otherwise triggers a new OAuth request (may show a consent popup on first use).
async function _getToken() {
  const stored = _getStoredToken();
  if (stored) return stored;
  return _requestToken();
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

// ── Public API ────────────────────────────────────────

// Uploads a session's CSV to GymOps/Gym Session Data/YYYY-MM/ in Drive.
// Runs a one-time migration of any legacy files still in the GymOps root.
// Failures throw so the caller can trigger a local fallback — all user-facing
// messaging lives with the drive-status line in app.js, not here.
export async function gdriveUpload(csv, sessionStartIso) {
  try {
    const token   = await _getToken();
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
