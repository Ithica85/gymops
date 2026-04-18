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
const DRIVE_SCOPE   = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME   = 'GymOps';
const TOKEN_STORAGE = 'gymops_gdrive_token';

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

// Finds the GymOps folder in the user's Drive, or creates it if it doesn't exist.
// Idempotent — safe to call on every upload without creating duplicates.
async function _findOrCreateFolder(token) {
  const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  // Folder doesn't exist yet — create it
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await create.json();
  return folder.id;
}

// Determines the correct filename for today's upload, handling same-day collisions.
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

// Uploads a session's CSV to the GymOps Drive folder. Called non-blocking from
// finishWorkout() — failures show a toast but do not interrupt the completed screen.
// sessionStartIso is used to derive the date-stamped filename.
async function gdriveUpload(csv, sessionStartIso) {
  try {
    const token    = await _getToken();
    const folderId = await _findOrCreateFolder(token);

    const d       = new Date(sessionStartIso);
    const dateStr = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;
    const filename = await _resolveFilename(token, folderId, dateStr);

    await _uploadFile(token, folderId, filename, csv);
    showToast('Saved to Google Drive');
  } catch (err) {
    console.error('Drive upload failed:', err);
    showToast('Drive save failed — tap Export to save manually', true);
  }
}
