/**
 * sync-worker.js — Background sync: IndexedDB events → Supabase.
 *
 * Used by the Race Controller (operator) to upload race-day events
 * to Supabase when online. Racing is never blocked by sync status.
 *
 * See spec 02 section 7 for the sync pattern.
 */

import { getUnsyncedEvents, markSynced, hasServerEvent, appendEvent as storeAppend, getEventByLocalId } from './event-store.js';

const SYNC_INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 60000;

let _client = null;
let _userId = null;
let _intervalId = null;
let _listeners = [];
let _consecutiveErrors = 0;

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
 * @param {string} userId - Current user ID for created_by
 */
export function startSync(supabaseClient, userId) {
  stopSync();
  _client = supabaseClient;
  _userId = userId;
  _consecutiveErrors = 0;

  // Run immediately, then schedule next
  syncOnce();
  scheduleNext();
}

function scheduleNext() {
  if (_intervalId) clearTimeout(_intervalId);
  const delay = _consecutiveErrors === 0
    ? SYNC_INTERVAL_MS
    : Math.min(SYNC_INTERVAL_MS * 2 ** _consecutiveErrors, MAX_BACKOFF_MS);
  _intervalId = setTimeout(async () => {
    await syncOnce();
    if (_client) scheduleNext();
  }, delay);
}

/**
 * Stop the background sync loop.
 */
export function stopSync() {
  if (_intervalId) {
    clearTimeout(_intervalId);
    _intervalId = null;
  }
  _client = null;
  unsubscribeFromRally();
}

/**
 * Run a single sync cycle. Safe to call manually.
 */
export async function syncOnce() {
  if (!_client) return;

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
      rally_id: e.rally_id,
      section_id: e.section_id || null,
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
      _consecutiveErrors++;
      setStatus('error', events.length);
      return;
    }

    // Mark each event as synced with its server ID
    if (data) {
      for (const row of data) {
        await markSynced(row.client_event_id, String(row.id));
      }
    }

    _consecutiveErrors = 0;

    // Check if everything was synced
    const remaining = await getUnsyncedEvents();
    setStatus(remaining.length === 0 ? 'synced' : 'pending', remaining.length);
  } catch (err) {
    console.warn('Sync error:', err.message);
    _consecutiveErrors++;
    setStatus('error');
  }
}

// ─── Restore from Supabase ────────────────────────────────────────

/**
 * Pull existing race-day events from Supabase into IndexedDB.
 * Used when an operator loads a rally online and wants to restore
 * a previous session or sync from another device.
 *
 * @param {Object} supabaseClient
 * @param {string} rallyId
 * @param {string} [sectionId] - Optional: restrict to one section
 * @returns {Promise<number>} Number of events imported
 */
export async function restoreFromSupabase(supabaseClient, rallyId, sectionId) {
  let query = supabaseClient
    .from('domain_events')
    .select('*')
    .eq('rally_id', rallyId)
    .not('client_event_id', 'is', null)
    .order('client_event_id');

  if (sectionId) query = query.eq('section_id', sectionId);

  const { data: events, error } = await query;

  if (error) throw new Error('Restore failed: ' + error.message);
  if (!events || events.length === 0) return 0;

  let imported = 0;
  for (const event of events) {
    if (await _ingestServerRow(event)) imported++;
  }

  return imported;
}

// ─── Inbound: Realtime push + reconnect pull ──────────────────────
//
// While online, subscribe to Supabase Realtime so check-ins and other
// pre-race events from registrars land in the operator's IndexedDB
// immediately. On reconnect (window 'online' event), do a catch-up
// pull so anything missed while disconnected is recovered.
//
// Echo dedup: our own uploads come back through the same channel.
// We match on (created_by === _userId, client_event_id) and update
// the local record's server_id instead of appending a duplicate.

let _realtimeClient = null;
let _realtimeChannel = null;
let _realtimeRallyId = null;
let _inboundListeners = [];
let _onlineListenerAttached = false;

/**
 * @typedef {'idle' | 'connecting' | 'live' | 'offline' | 'error'} InboundStatus
 */
let _inboundStatus = 'idle';
let _inboundStatusListeners = [];

function _setInboundStatus(status) {
  if (_inboundStatus === status) return;
  _inboundStatus = status;
  for (const cb of _inboundStatusListeners) {
    try { cb(status); } catch { /* ignore */ }
  }
}

/**
 * Subscribe to inbound channel status changes.
 * Callback receives an InboundStatus string. Returns an unsubscribe function.
 */
export function onInboundStatus(callback) {
  _inboundStatusListeners.push(callback);
  callback(_inboundStatus);
  return () => {
    _inboundStatusListeners = _inboundStatusListeners.filter(cb => cb !== callback);
  };
}

export function getInboundStatus() {
  return _inboundStatus;
}

/**
 * Subscribe to inbound events callbacks.
 * Callback receives (count, kind) where kind is 'pull' or 'push'.
 * Returns an unsubscribe function.
 */
export function onInboundEvents(callback) {
  _inboundListeners.push(callback);
  return () => {
    _inboundListeners = _inboundListeners.filter(cb => cb !== callback);
  };
}

function _notifyInbound(count, kind) {
  for (const cb of _inboundListeners) {
    try { cb(count, kind); } catch { /* ignore */ }
  }
}

/**
 * Ingest one server-side event row into IndexedDB.
 * Returns true if a new local record was appended, false if it was
 * a duplicate or an echo of one of our own writes.
 */
async function _ingestServerRow(row) {
  if (!row || row.id == null) return false;
  const serverId = String(row.id);
  if (await hasServerEvent(serverId)) return false;

  // Echo of our own write — promote the local record instead of duplicating.
  if (_userId && row.created_by === _userId && row.client_event_id != null) {
    const local = await getEventByLocalId(row.client_event_id);
    if (local) {
      if (!local.synced || local.server_id !== serverId) {
        await markSynced(row.client_event_id, serverId);
      }
      return false;
    }
  }

  await storeAppend({
    ...row.payload,
    type: row.event_type,
    rally_id: row.rally_id,
    section_id: row.section_id,
    synced: true,
    server_id: serverId
  });
  return true;
}

/**
 * Subscribe to inbound events for a rally: initial catch-up pull,
 * then a Realtime push channel. Idempotent — calling twice with the
 * same rallyId is a no-op; with a different rallyId, swaps subscription.
 *
 * @param {Object} supabaseClient
 * @param {string} rallyId
 */
export async function subscribeToRally(supabaseClient, rallyId) {
  if (!supabaseClient || !rallyId) return;
  if (_realtimeRallyId === rallyId && _realtimeChannel) return;

  unsubscribeFromRally();
  _realtimeClient = supabaseClient;
  _realtimeRallyId = rallyId;
  _setInboundStatus(navigator.onLine ? 'connecting' : 'offline');

  // Catch-up pull first (idempotent; uses _ingestServerRow under the hood)
  if (navigator.onLine) {
    try {
      const imported = await restoreFromSupabase(supabaseClient, rallyId);
      if (imported > 0) _notifyInbound(imported, 'pull');
    } catch (e) {
      console.warn('Inbound initial pull failed:', e.message);
    }
  }

  // Realtime push
  try {
    _realtimeChannel = supabaseClient
      .channel(`domain_events_${rallyId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'domain_events',
        filter: `rally_id=eq.${rallyId}`
      }, async (payload) => {
        try {
          if (await _ingestServerRow(payload.new)) {
            _notifyInbound(1, 'push');
          }
        } catch (e) {
          console.warn('Inbound event ingest failed:', e.message);
        }
      })
      .subscribe((state) => {
        // supabase-js channel state: SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED
        if (state === 'SUBSCRIBED') _setInboundStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') _setInboundStatus('error');
        else if (state === 'CLOSED') _setInboundStatus(navigator.onLine ? 'connecting' : 'offline');
      });
  } catch (e) {
    console.warn('Realtime subscribe failed:', e.message);
    _setInboundStatus('error');
  }

  if (!_onlineListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('online', _onlineReconnect);
    window.addEventListener('offline', _onlineGoOffline);
    _onlineListenerAttached = true;
  }
}

/**
 * Tear down the Realtime subscription and online listener.
 */
export function unsubscribeFromRally() {
  if (_realtimeChannel) {
    try { _realtimeChannel.unsubscribe(); } catch { /* ignore */ }
    _realtimeChannel = null;
  }
  _realtimeClient = null;
  _realtimeRallyId = null;
  if (_onlineListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('online', _onlineReconnect);
    window.removeEventListener('offline', _onlineGoOffline);
    _onlineListenerAttached = false;
  }
  _setInboundStatus('idle');
}

async function _onlineReconnect() {
  if (!_realtimeClient || !_realtimeRallyId) return;
  _setInboundStatus('connecting');
  try {
    const imported = await restoreFromSupabase(_realtimeClient, _realtimeRallyId);
    if (imported > 0) _notifyInbound(imported, 'pull');
  } catch (e) {
    console.warn('Reconnect pull failed:', e.message);
  }
}

function _onlineGoOffline() {
  _setInboundStatus('offline');
}
