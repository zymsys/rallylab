/**
 * usb-backup.js — File System Access API wrapper for USB disaster recovery.
 * Writes a backup snapshot on every event to a user-selected directory (USB stick).
 * The directory handle is persisted in IndexedDB so it survives browser refresh.
 * A spare laptop can restore from the backup file to resume racing.
 */

import { getSetting, setSetting } from './event-store.js';

// ─── Module State ────────────────────────────────────────────────

let _dirHandle = null;
let _writeQueue = Promise.resolve();

const BACKUP_FILENAME = 'rallylab-backup.json';
const HANDLE_SETTING_KEY = 'usb_backup_dir_handle';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Check if the File System Access API is available.
 * @returns {boolean}
 */
export function isSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

/**
 * Prompt the user to select a directory, persist the handle, and write an immediate backup.
 * @param {Function} getAllEvents - async fn returning all events from IndexedDB
 * @param {string} rallyId
 */
export async function configure(getAllEvents, rallyId) {
  _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await setSetting(HANDLE_SETTING_KEY, _dirHandle);
  await writeBackup(getAllEvents, rallyId);
}

/**
 * Attempt to restore a previously-configured handle from IndexedDB.
 * Resumes silently if permission is still 'granted'; otherwise leaves
 * the handle dormant so reauthorize() can re-prompt from a user gesture.
 * @param {Function} getAllEvents
 * @param {string} rallyId
 * @returns {Promise<'resumed'|'needs-permission'|'none'>}
 */
export async function restore(getAllEvents, rallyId) {
  const handle = await getSetting(HANDLE_SETTING_KEY);
  if (!handle) return 'none';
  _dirHandle = handle;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    await writeBackup(getAllEvents, rallyId);
    return 'resumed';
  }
  return 'needs-permission';
}

/**
 * Re-prompt the user to grant permission on a previously-saved handle.
 * MUST be called from a user gesture (button click).
 * @param {Function} getAllEvents
 * @param {string} rallyId
 * @returns {Promise<boolean>} true if permission is now granted
 */
export async function reauthorize(getAllEvents, rallyId) {
  if (!_dirHandle) return false;
  const perm = await _dirHandle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return false;
  await writeBackup(getAllEvents, rallyId);
  return true;
}

/**
 * @returns {boolean} Whether a directory handle is configured (permission may still be pending).
 */
export function isConfigured() {
  return _dirHandle !== null;
}

/**
 * Clear the directory handle and forget the saved handle.
 */
export async function disable() {
  _dirHandle = null;
  await setSetting(HANDLE_SETTING_KEY, null);
}

/**
 * Called after each event append. Writes a backup on every event,
 * serialized through a queue so rapid appends don't race.
 * Fire-and-forget — callers should .catch() to avoid unhandled rejections.
 * @param {Function} getAllEvents - async fn returning all events from IndexedDB
 * @param {string} rallyId
 */
export async function onEventAppended(getAllEvents, rallyId) {
  if (!_dirHandle) return;
  const next = _writeQueue.then(() => writeBackup(getAllEvents, rallyId));
  _writeQueue = next.catch(() => {});
  return next;
}

/**
 * Parse and validate a backup JSON file.
 * @param {File} file
 * @returns {Promise<Object>} Parsed backup object { version, rally_id, timestamp, events }
 */
export async function readBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (data.version !== 1) {
    throw new Error('Unsupported backup version: ' + data.version);
  }
  if (!Array.isArray(data.events)) {
    throw new Error('Invalid backup: missing events array');
  }
  if (!data.rally_id) {
    throw new Error('Invalid backup: missing rally_id');
  }

  return data;
}

// ─── Internal ────────────────────────────────────────────────────

/**
 * Write the full event log to the backup file.
 * @param {Function} getAllEvents
 * @param {string} rallyId
 */
async function writeBackup(getAllEvents, rallyId) {
  if (!_dirHandle) return;

  const events = await getAllEvents();
  const backup = {
    version: 1,
    rally_id: rallyId,
    timestamp: Date.now(),
    events
  };

  const fileHandle = await _dirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(backup));
  await writable.close();
}
