/**
 * event-store.js — IndexedDB append-only event log.
 * Offline-first: events written to IndexedDB, synced to Supabase later.
 * Shared by both pre-race and race day.
 */

const DB_NAME = 'rallylab';
const DB_VERSION = 2;
const EVENTS_STORE = 'events';
const SETTINGS_STORE = 'settings';

// IndexedDB does not allow boolean keys, so `synced` is persisted as 0/1.
const SYNCED_TRUE = 1;
const SYNCED_FALSE = 0;

let _db = null;

/**
 * Open (or create) the IndexedDB database.
 * Also deletes the old 'rallylab-races' DB if it exists.
 * @returns {Promise<IDBDatabase>}
 */
export async function openStore() {
  if (_db) return _db;

  // Clean up old DB name
  try { indexedDB.deleteDatabase('rallylab-races'); } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('rally_id', 'rally_id', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('server_id', 'server_id', { unique: false });
      } else if (e.oldVersion < 2) {
        // v1 stored `synced` as a boolean, which IndexedDB rejects when used
        // as an index key (`index.getAll(false)` throws). Rewrite each record
        // with 0/1 so the index becomes queryable again.
        const store = tx.objectStore(EVENTS_STORE);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const rec = cursor.value;
          const next = rec.synced === true || rec.synced === 1 ? SYNCED_TRUE : SYNCED_FALSE;
          if (rec.synced !== next) {
            rec.synced = next;
            cursor.update(rec);
          }
          cursor.continue();
        };
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      _db = e.target.result;
      // Another tab triggering a future upgrade should be allowed to proceed —
      // close our connection so we don't block them, then drop the cached ref.
      _db.onversionchange = () => {
        try { _db.close(); } catch { /* ignore */ }
        _db = null;
      };
      resolve(_db);
    };

    request.onerror = (e) => {
      reject(new Error('Failed to open IndexedDB: ' + e.target.error?.message));
    };

    request.onblocked = () => {
      reject(new Error('IndexedDB upgrade blocked: another tab has the database open at the previous version. Close other RallyLab tabs and reload.'));
    };
  });
}

/**
 * Append a domain event to the store.
 * @param {Object} event - Domain event with at minimum { type, rally_id, ... }
 * @returns {Promise<Object>} The stored event with its auto-incremented id
 */
export async function appendEvent(event) {
  const db = await openStore();

  const record = {
    ...event,
    rally_id: event.rally_id || crypto.randomUUID(),
    stored_at: Date.now(),
    synced: event.synced ? SYNCED_TRUE : SYNCED_FALSE,
    server_id: event.server_id ?? null
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(EVENTS_STORE);
    const request = store.add(record);

    request.onsuccess = () => {
      record.id = request.result;
      resolve(record);
    };

    request.onerror = (e) => {
      reject(new Error('Failed to append event: ' + e.target.error?.message));
    };
  });
}

/**
 * Get all events in insertion order.
 * @returns {Promise<Array>}
 */
export async function getAllEvents() {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => {
      reject(new Error('Failed to read events: ' + e.target.error?.message));
    };
  });
}

/**
 * Get all events for a specific rally_id, in insertion order.
 * @param {string} rallyId
 * @returns {Promise<Array>}
 */
export async function getEventsByRally(rallyId) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const index = store.index('rally_id');
    const request = index.getAll(rallyId);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => {
      reject(new Error('Failed to read events by rally: ' + e.target.error?.message));
    };
  });
}

/**
 * Get all distinct rally_ids from stored events.
 * @returns {Promise<Array<string>>}
 */
export async function getRallyIds() {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const index = store.index('rally_id');
    const request = index.openKeyCursor(null, 'nextunique');
    const ids = [];

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        ids.push(cursor.key);
        cursor.continue();
      } else {
        resolve(ids);
      }
    };
    request.onerror = (e) => {
      reject(new Error('Failed to get rally IDs: ' + e.target.error?.message));
    };
  });
}

/**
 * Get all unsynced events.
 *
 * Implementation note: this used to call `index.getAll(0)` on the `synced`
 * index, but iOS Safari has shown intermittent "parameter is not a valid
 * key" failures even with a numeric primitive. The race-day store is small
 * (a few hundred events at most), so a full scan with an in-JS filter is
 * fast enough and is robust across browsers and historical data shapes
 * (boolean, 0/1, undefined).
 *
 * @returns {Promise<Array>}
 */
export async function getUnsyncedEvents() {
  const all = await getAllEvents();
  return all.filter(e => !e.synced);
}

/**
 * Mark an event as synced with its server ID.
 * @param {number} localId - The local auto-incremented ID
 * @param {string} serverId - The server-assigned ID
 * @returns {Promise<void>}
 */
export async function markSynced(localId, serverId) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(EVENTS_STORE);
    const getReq = store.get(localId);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) { resolve(); return; }
      record.synced = SYNCED_TRUE;
      record.server_id = serverId;
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => {
      reject(new Error('Failed to mark synced: ' + e.target.error?.message));
    };
  });
}

/**
 * Get a single event by its local auto-incremented id.
 * @param {number} localId
 * @returns {Promise<Object|null>}
 */
export async function getEventByLocalId(localId) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const request = tx.objectStore(EVENTS_STORE).get(localId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => {
      reject(new Error('Failed to get event by id: ' + e.target.error?.message));
    };
  });
}

/**
 * Check if a server event already exists locally.
 * @param {string} serverId
 * @returns {Promise<boolean>}
 */
export async function hasServerEvent(serverId) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const index = store.index('server_id');
    const request = index.getKey(serverId);

    request.onsuccess = () => resolve(request.result != null);
    request.onerror = (e) => {
      reject(new Error('Failed to check server event: ' + e.target.error?.message));
    };
  });
}

/**
 * Clear all events and settings (for demo reset).
 * @returns {Promise<void>}
 */
export async function clear() {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([EVENTS_STORE, SETTINGS_STORE], 'readwrite');
    tx.objectStore(EVENTS_STORE).clear();
    tx.objectStore(SETTINGS_STORE).clear();

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => {
      reject(new Error('Failed to clear store: ' + e.target.error?.message));
    };
  });
}

/**
 * Get a setting value.
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getSetting(key) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const request = tx.objectStore(SETTINGS_STORE).get(key);

    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = (e) => reject(new Error('Failed to get setting: ' + e.target.error?.message));
  });
}

/**
 * Set a setting value.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key, value });

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(new Error('Failed to set setting: ' + e.target.error?.message));
  });
}
