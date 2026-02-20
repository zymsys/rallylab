/**
 * event-store.js — IndexedDB append-only event log.
 * Offline-first: events written to IndexedDB, synced to Supabase later.
 * Shared by both pre-race and race day.
 */

const DB_NAME = 'rallylab';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const SETTINGS_STORE = 'settings';

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
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('rally_id', 'rally_id', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('server_id', 'server_id', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    request.onerror = (e) => {
      reject(new Error('Failed to open IndexedDB: ' + e.target.error?.message));
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
    synced: false,
    server_id: null
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
 * @returns {Promise<Array>}
 */
export async function getUnsyncedEvents() {
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const index = store.index('synced');
    const request = index.getAll(false);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => {
      reject(new Error('Failed to read unsynced events: ' + e.target.error?.message));
    };
  });
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
      record.synced = true;
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
