/**
 * sync-worker.js — Background sync: IndexedDB events → Supabase.
 *
 * Used by the Race Controller (operator) to upload race-day events
 * to Supabase when online. Racing is never blocked by sync status.
 *
 * See spec 02 section 7 for the sync pattern.
 */

import { getUnsyncedEvents, markSynced, hasServerEvent, appendEvent as storeAppend } from './event-store.js';

const SYNC_INTERVAL_MS = 5000;

let _client = null;
let _rallyId = null;
let _sectionId = null;
let _userId = null;
let _intervalId = null;
let _listeners = [];

// ─── Sync Status ──────────────────────────────────────────────────

/**
 * @typedef {'synced' | 'pending' | 'offline' | 'error'} SyncStatus
 */
let _status = 'synced';
let _pendingCount = 0;

function setStatus(status, pendingCount = 0) {
  _status = status;
  _pendingCount = pendingCount;
  for (const cb of _listeners) {
    try { cb({ status: _status, pendingCount: _pendingCount }); } catch { /* ignore */ }
  }
}

/**
 * Subscribe to sync status changes.
 * Callback receives { status: SyncStatus, pendingCount: number }.
 * Returns an unsubscribe function.
 */
export function onSyncStatus(callback) {
  _listeners.push(callback);
  callback({ status: _status, pendingCount: _pendingCount });
  return () => {
    _listeners = _listeners.filter(cb => cb !== callback);
  };
}

/**
 * Get current sync status.
 */
export function getSyncStatus() {
  return { status: _status, pendingCount: _pendingCount };
}

// ─── Sync Loop ────────────────────────────────────────────────────

/**
 * Start the background sync loop.
 * @param {Object} supabaseClient - Initialized supabase-js client
 * @param {string} rallyId
 * @param {string} sectionId
 * @param {string} userId - Current user ID for created_by
 */
export function startSync(supabaseClient, rallyId, sectionId, userId) {
  stopSync();
  _client = supabaseClient;
  _rallyId = rallyId;
  _sectionId = sectionId;
  _userId = userId;

  // Run immediately, then on interval
  syncOnce();
  _intervalId = setInterval(syncOnce, SYNC_INTERVAL_MS);
}

/**
 * Stop the background sync loop.
 */
export function stopSync() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _client = null;
}

/**
 * Run a single sync cycle. Safe to call manually.
 */
export async function syncOnce() {
  if (!_client || !_rallyId) return;

  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }

  try {
    const events = await getUnsyncedEvents();

    if (events.length === 0) {
      setStatus('synced');
      return;
    }

    setStatus('pending', events.length);

    const rows = events.map(e => ({
      rally_id: e.rally_id || _rallyId,
      section_id: e.section_id || _sectionId,
      client_event_id: e.id,
      event_type: e.type,
      payload: e,
      created_by: _userId
    }));

    const { data, error } = await _client
      .from('domain_events')
      .upsert(rows, { onConflict: 'rally_id,section_id,client_event_id' })
      .select('id, client_event_id');

    if (error) {
      console.warn('Sync error:', error.message);
      setStatus('error', events.length);
      return;
    }

    // Mark each event as synced with its server ID
    if (data) {
      for (const row of data) {
        await markSynced(row.client_event_id, String(row.id));
      }
    }

    // Check if everything was synced
    const remaining = await getUnsyncedEvents();
    setStatus(remaining.length === 0 ? 'synced' : 'pending', remaining.length);
  } catch (err) {
    console.warn('Sync error:', err.message);
    setStatus('error');
  }
}

// ─── Restore from Supabase ────────────────────────────────────────

/**
 * Pull existing race-day events from Supabase into IndexedDB.
 * Used when an operator selects a rally online and wants to restore
 * a previous session or sync from another device.
 *
 * @param {Object} supabaseClient
 * @param {string} rallyId
 * @param {string} sectionId
 * @returns {Promise<number>} Number of events imported
 */
export async function restoreFromSupabase(supabaseClient, rallyId, sectionId) {
  const { data: events, error } = await supabaseClient
    .from('domain_events')
    .select('*')
    .eq('rally_id', rallyId)
    .eq('section_id', sectionId)
    .not('client_event_id', 'is', null)
    .order('client_event_id');

  if (error) throw new Error('Restore failed: ' + error.message);
  if (!events || events.length === 0) return 0;

  let imported = 0;
  for (const event of events) {
    // Skip if we already have this event locally
    if (await hasServerEvent(String(event.id))) continue;

    await storeAppend({
      ...event.payload,
      type: event.event_type,
      rally_id: event.rally_id,
      section_id: event.section_id,
      synced: true,
      server_id: String(event.id)
    });
    imported++;
  }

  return imported;
}
