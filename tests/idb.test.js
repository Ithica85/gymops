// 5.4 storage migration: db.js in IndexedDB mode, driven against
// fake-indexeddb. The rest of the suite runs with no indexedDB global and so
// covers the legacy localStorage fallback; this file covers the IDB path —
// fresh installs, the one-time LS→IDB adoption, the migration marker,
// corruption quarantine, backup restore, Clear All, and persist failure.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initDB, dbCreateSession, dbInsertSet, dbGetSession, dbGetSetCount,
  dbGetAllSets, dbExportBackup, dbValidateBackup, dbRestoreBackup,
  dbDiscardCorrupt, dbClearAll, dbOnPersistStateChange,
} from '../js/db.js';
import { blobGet, blobKeys } from '../js/storage.js';

const MIGRATED_KEY = 'gymops_idb_migrated';

// Waits for the fire-and-forget IDB persist to land.
function persisted(check) {
  return vi.waitFor(check, { timeout: 2000, interval: 20 });
}

function logOneSet() {
  const sessionId = dbCreateSession('kg');
  dbInsertSet(sessionId, 'Chest Press', 1, 60, 8, null, null, 'kg');
  return sessionId;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // pristine IDB per test
  localStorage.clear();
  dbOnPersistStateChange(() => {}); // detach any listener a prior test registered
  await initDB();
});

describe('IDB mode — fresh install', () => {
  it('persists writes to IDB, never to localStorage', async () => {
    const sessionId = logOneSet();
    await persisted(async () => expect(await blobGet('db')).toBeInstanceOf(Uint8Array));
    expect(localStorage.getItem('gymops_db')).toBeNull();

    await initDB(); // reboot
    expect(dbGetSetCount(sessionId)).toBe(1);
    expect(dbGetAllSets(sessionId)[0].weight).toBe(60);
  });

  it('a fresh install lands in IDB even before any user write', async () => {
    await persisted(async () => expect(await blobGet('db')).toBeInstanceOf(Uint8Array));
  });
});

describe('IDB mode — localStorage adoption', () => {
  // Builds a REAL pre-5.4 install: boot with no indexedDB global so db.js
  // uses legacy localStorage persistence, write data, then hand back IDB.
  async function seedLegacyInstall() {
    delete globalThis.indexedDB;
    // initDB first: it settles beforeEach's in-flight IDB persist, whose
    // success callback would otherwise re-set the migration marker AFTER the
    // localStorage.clear() below and block the adoption under test.
    await initDB();
    localStorage.clear();
    const sessionId = logOneSet();
    const legacyBlob = localStorage.getItem('gymops_db');
    // A real pre-5.4 device has an EMPTY IndexedDB — not the one beforeEach's
    // fresh-install boot already persisted a schema into.
    globalThis.indexedDB = new IDBFactory();
    return { sessionId, legacyBlob };
  }

  it('adopts the localStorage DB into IDB and freezes the old blob in place', async () => {
    const { sessionId, legacyBlob } = await seedLegacyInstall();
    expect(legacyBlob).toBeTruthy();

    await initDB(); // first boot with IDB available → adoption
    expect(dbGetSetCount(sessionId)).toBe(1);
    expect(await blobGet('db')).toBeInstanceOf(Uint8Array);
    expect(localStorage.getItem(MIGRATED_KEY)).toBeTruthy();
    // Rollback snapshot: the legacy blob is kept, byte-for-byte untouched
    expect(localStorage.getItem('gymops_db')).toBe(legacyBlob);

    // Post-adoption writes go to IDB only
    dbInsertSet(sessionId, 'Chest Press', 2, 62.5, 6, null, null, 'kg');
    await persisted(async () => {
      await initDB();
      expect(dbGetSetCount(sessionId)).toBe(2);
    });
    expect(localStorage.getItem('gymops_db')).toBe(legacyBlob);
  });

  it('adopts a legacy JSON-array blob (pre-v62 format)', async () => {
    const { sessionId, legacyBlob } = await seedLegacyInstall();
    // Re-encode the stored base64 as the ancient JSON byte-array format
    const binary = atob(legacyBlob);
    const bytes = Array.from(binary, c => c.charCodeAt(0));
    localStorage.setItem('gymops_db', JSON.stringify(bytes));

    await initDB();
    expect(dbGetSetCount(sessionId)).toBe(1);
    expect(await blobGet('db')).toBeInstanceOf(Uint8Array);
  });

  it('the migration marker stops an empty-IDB boot from resurrecting the frozen blob', async () => {
    const { sessionId } = await seedLegacyInstall();
    await initDB(); // adoption happened, marker set

    globalThis.indexedDB = new IDBFactory(); // IDB emptied (Start Fresh / eviction)
    await initDB();
    expect(dbGetSession(sessionId)).toBeNull(); // fresh schema, NOT the stale snapshot
  });
});

describe('IDB mode — corruption and recovery', () => {
  it('quarantines an unreadable blob and recovers via Start Fresh', async () => {
    const sessionId = logOneSet();
    await persisted(async () => expect(await blobGet('db')).toBeInstanceOf(Uint8Array));

    const { blobPut } = await import('../js/storage.js');
    const garbage = new Uint8Array([1, 2, 3, 4]);
    await blobPut('db', garbage);

    const corrupt = await initDB();
    expect(corrupt).not.toBeNull();
    expect(corrupt.quarantineKey).toMatch(/^corrupt_/);
    expect(await blobGet(corrupt.quarantineKey)).toEqual(garbage);
    expect(typeof corrupt.blob).toBe('string'); // base64 for the recovery download

    // Reload before acting → same quarantine key reused, no duplicates
    const again = await initDB();
    expect(again.quarantineKey).toBe(corrupt.quarantineKey);

    await dbDiscardCorrupt();
    expect(await initDB()).toBeNull(); // boots fresh
    expect(dbGetSession(sessionId)).toBeNull();
    expect(await blobGet(corrupt.quarantineKey)).toEqual(garbage); // quarantine survives Start Fresh
  });
});

describe('IDB mode — backup, restore, clear', () => {
  it('restore stashes the current DB and boots the backup', async () => {
    const sessionId = logOneSet();
    const backup = dbExportBackup();

    dbInsertSet(sessionId, 'Chest Press', 2, 65, 5, null, null, 'kg');
    await persisted(async () => {
      await initDB();
      expect(dbGetSetCount(sessionId)).toBe(2);
    });

    const { blob } = dbValidateBackup(backup);
    await dbRestoreBackup(blob);
    expect(await blobGet('prerestore')).toBeInstanceOf(Uint8Array);

    await initDB();
    expect(dbGetSetCount(sessionId)).toBe(1); // back to the backup's state
  });

  it('dbClearAll wipes the IDB store and every gymops_* key', async () => {
    logOneSet();
    await persisted(async () => expect(await blobGet('db')).toBeInstanceOf(Uint8Array));
    localStorage.setItem('gymops_weight_unit', 'kg');

    await dbClearAll();
    expect(await blobKeys()).toEqual([]);
    expect(Object.keys(localStorage).filter(k => k.startsWith('gymops_'))).toEqual([]);
  });
});

describe('IDB mode — persist failure (4.4 contract)', () => {
  it('notifies on failure, keeps working in memory, recovers on a later persist', async () => {
    const states = [];
    dbOnPersistStateChange(s => states.push(s));

    const sessionId = logOneSet();
    await persisted(async () => expect(await blobGet('db')).toBeInstanceOf(Uint8Array));

    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => { throw new Error('quota'); };
    dbInsertSet(sessionId, 'Chest Press', 2, 62.5, 6, null, null, 'kg');
    await persisted(() => expect(states).toContain(true));
    expect(dbGetSetCount(sessionId)).toBe(2); // in-memory DB unaffected

    IDBObjectStore.prototype.put = origPut;
    dbInsertSet(sessionId, 'Chest Press', 3, 60, 8, null, null, 'kg');
    await persisted(() => expect(states[states.length - 1]).toBe(false));

    await initDB(); // reboot: everything logged during the outage was persisted by the retry
    expect(dbGetSetCount(sessionId)).toBe(3);
  });
});
