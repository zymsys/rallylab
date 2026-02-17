/**
 * event-store.js — IndexedDB append-only event log for race day.
 * Offline-first: events written to IndexedDB, synced to Supabase later.
 */

const DB_NAME = 'rallylab-races';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const SETTINGS_STORE = 'settings';

let _db = null;

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export async function openStore() {
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('event_id', 'event_id', { unique: true });
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
 * @param {Object} event - Domain event with at minimum { type, event_id, ... }
 * @returns {Promise<Object>} The stored event with its auto-incremented id
 */
export async function appendEvent(event) {
  const db = await openStore();

  const record = {
    ...event,
    event_id: event.event_id || crypto.randomUUID(),
    stored_at: Date.now()
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
