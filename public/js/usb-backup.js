/**
 * usb-backup.js — File System Access API wrapper for USB disaster recovery.
 * Writes periodic backup snapshots to a user-selected directory (USB stick).
 * A spare laptop can restore from the backup file to resume racing.
 */

// ─── Module State ────────────────────────────────────────────────

let _dirHandle = null;
let _eventCounter = 0;

const BACKUP_FILENAME = 'rallylab-backup.json';
const WRITE_EVERY_N = 10;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Check if the File System Access API is available.
 * @returns {boolean}
 */
export function isSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

/**
 * Prompt the user to select a directory, then write an immediate backup.
 * @param {Function} getAllEvents - async fn returning all events from IndexedDB
 * @param {string} rallyId
 */
export async function configure(getAllEvents, rallyId) {
  _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  _eventCounter = 0;
  await writeBackup(getAllEvents, rallyId);
}

/**
 * @returns {boolean} Whether a directory handle is configured.
 */
export function isConfigured() {
  return _dirHandle !== null;
}

/**
 * Clear the directory handle, disabling backup.
 */
export function disable() {
  _dirHandle = null;
  _eventCounter = 0;
}

/**
 * Called after each event append. Writes a backup every N events.
 * Fire-and-forget — callers should .catch() to avoid unhandled rejections.
 * @param {Function} getAllEvents - async fn returning all events from IndexedDB
 * @param {string} rallyId
 */
export async function onEventAppended(getAllEvents, rallyId) {
  if (!_dirHandle) return;
  _eventCounter++;
  if (_eventCounter % WRITE_EVERY_N === 0) {
    await writeBackup(getAllEvents, rallyId);
  }
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
