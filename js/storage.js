// ═══════════════════════════════════════════════════════
// GymOps — IndexedDB blob store (5.4)
// ═══════════════════════════════════════════════════════
// The persisted sql.js database's home since 5.4: raw Uint8Array in one IDB
// object store — no base64 inflation, async writes, far more quota headroom
// than localStorage, and navigator.storage.persist() eviction protection.
// db.js is the only intended consumer. If IDB can't open (ancient browser,
// some private modes, the Node test environment) storageInit() resolves
// false and db.js keeps using its legacy localStorage persistence unchanged.
// This module must stay dependency-free (no app imports — no cycle risk).

const IDB_NAME = 'gymops';
const STORE = 'blobs';

let _idb = null; // open IDBDatabase, or null when unavailable

// Wraps an IDBRequest in a promise.
function _req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

function _open() {
  const request = indexedDB.open(IDB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  return _req(request);
}

// Opens (or re-opens) the blob store. Returns true when IDB is usable.
// One retry: iOS Safari has a long history of spuriously failing the first
// open after a cold start.
export async function storageInit() {
  if (typeof indexedDB === 'undefined') return false;
  if (_idb) { try { _idb.close(); } catch (_) { /* already closed */ } _idb = null; }
  try {
    _idb = await _open();
  } catch (_) {
    try {
      _idb = await _open();
    } catch (_) {
      _idb = null;
      return false;
    }
  }
  // A dropped connection (e.g. the browser closing the DB under us) must not
  // strand a stale handle — next boot reopens.
  _idb.onclose = () => { _idb = null; };
  // Best-effort eviction protection; browsers grant this silently for
  // installed PWAs. Never blocks boot.
  try { navigator.storage?.persist?.(); } catch (_) { /* unsupported */ }
  return true;
}

function _store(mode) {
  return _idb.transaction(STORE, mode).objectStore(STORE);
}

// All four are async functions so a synchronous IDB throw (dead transaction,
// closed connection) surfaces as a rejection, never an exception in a caller
// that only handles .catch (db.js's fire-and-forget persist).

// Returns the stored value (Uint8Array or string) or null.
export async function blobGet(key) {
  const v = await _req(_store('readonly').get(key));
  return v === undefined ? null : v;
}

export async function blobPut(key, value) {
  return await _req(_store('readwrite').put(value, key));
}

export async function blobDelete(key) {
  return await _req(_store('readwrite').delete(key));
}

// All keys in the store (quarantine scans, Clear All Data).
export async function blobKeys() {
  return await _req(_store('readonly').getAllKeys());
}
