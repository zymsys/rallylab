/**
 * supabase.js — Mock Supabase layer for demo / offline development.
 *
 * Set USE_MOCK = false and provide real Supabase credentials to switch
 * to the real backend. App code uses the same API surface either way.
 */

const USE_MOCK = true;

// ─── Storage helpers ───────────────────────────────────────────────
const EVENTS_KEY = 'rallylab_domain_events';
const SESSION_KEY = 'rallylab_session';

function loadEvents() {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY)) || [];
  } catch { return []; }
}

function saveEvents(events) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

// ─── Module-level state ────────────────────────────────────────────
let _events = loadEvents();
let _session = null;
let _authCallbacks = [];

try {
  _session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
} catch { /* ignore */ }

// ─── Auth ──────────────────────────────────────────────────────────

function _notifyAuth(event, session) {
  for (const cb of _authCallbacks) {
    try { cb(event, session); } catch (e) { console.error('Auth callback error', e); }
  }
}

/**
 * Mock sign-in: provide email.
 * In real mode this would send a magic link via Supabase Auth.
 * Roles are derived per-rally from the event stream, not stored on the session.
 */
export function signIn(email) {
  _session = {
    user: {
      id: _deterministicId(email),
      email
    }
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
  _notifyAuth('SIGNED_IN', _session);
  return { data: _session, error: null };
}

export function signOut() {
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
  _notifyAuth('SIGNED_OUT', null);
  return { error: null };
}

export function getUser() {
  return _session ? _session.user : null;
}

export function onAuthChange(callback) {
  _authCallbacks.push(callback);
  // Fire immediately with current state
  if (_session) callback('INITIAL_SESSION', _session);
  else callback('INITIAL_SESSION', null);
  return () => {
    _authCallbacks = _authCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Initialize auth — restores existing session if any.
 * Returns the current session or null.
 */
export function initAuth() {
  return _session;
}

// ─── Deterministic ID from email (stable mock user IDs) ───────────
function _deterministicId(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  return '00000000-mock-user-' + Math.abs(hash).toString(16).padStart(12, '0');
}

// ─── MockQueryBuilder ──────────────────────────────────────────────
class MockQueryBuilder {
  constructor(table) {
    this._table = table;
    this._op = null;         // 'select' | 'insert'
    this._insertRows = null;
    this._filters = [];
    this._orderCol = null;
    this._orderAsc = true;
    this._single = false;
    this._selectCalled = false;
  }

  select(cols) {
    this._op = this._op || 'select';
    this._selectCalled = true;
    return this;
  }

  insert(rows) {
    this._op = 'insert';
    this._insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  eq(column, value) {
    this._filters.push({ column, value });
    return this;
  }

  order(column, opts) {
    this._orderCol = column;
    this._orderAsc = opts?.ascending !== false;
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  // Thenable — so `await builder` works
  then(resolve, reject) {
    try {
      resolve(this._execute());
    } catch (e) {
      if (reject) reject(e);
      else throw e;
    }
  }

  _execute() {
    if (this._table !== 'domain_events') {
      return { data: null, error: { message: `Unknown table: ${this._table}` } };
    }

    if (this._op === 'insert') {
      return this._executeInsert();
    }

    return this._executeSelect();
  }

  _executeInsert() {
    const inserted = [];

    for (const row of this._insertRows) {
      const record = {
        id: _events.length + 1,
        ...row,
        created_at: new Date().toISOString()
      };
      _events.push(record);
      inserted.push(record);
    }

    saveEvents(_events);

    // If .select().single() was chained after insert
    if (this._selectCalled && this._single) {
      return { data: inserted[0] || null, error: null };
    }
    if (this._selectCalled) {
      return { data: inserted, error: null };
    }
    return { data: inserted, error: null };
  }

  _executeSelect() {
    let rows = [..._events];

    for (const f of this._filters) {
      rows = rows.filter(r => r[f.column] === f.value);
    }

    if (this._orderCol) {
      rows.sort((a, b) => {
        const av = a[this._orderCol];
        const bv = b[this._orderCol];
        if (av < bv) return this._orderAsc ? -1 : 1;
        if (av > bv) return this._orderAsc ? 1 : -1;
        return 0;
      });
    }

    if (this._single) {
      return { data: rows[0] || null, error: rows.length === 0 ? { message: 'No rows found' } : null };
    }

    return { data: rows, error: null };
  }
}

// ─── Client ────────────────────────────────────────────────────────

const _mockClient = {
  from(table) {
    return new MockQueryBuilder(table);
  },
  auth: {
    getUser() {
      return Promise.resolve({
        data: { user: getUser() },
        error: getUser() ? null : { message: 'Not authenticated' }
      });
    },
    signInWithOtp({ email }) {
      console.log(`[Mock] Magic link would be sent to: ${email}`);
      return Promise.resolve({ data: {}, error: null });
    }
  }
};

export function getClient() {
  if (USE_MOCK) return _mockClient;
  // Real mode: import createClient from CDN
  // import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  // return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY for real mode');
}

/**
 * Check if the current user is an organizer.
 * Organizer is a global role: true if user has created any rally.
 * Also true for new users who haven't been invited as registrars (so they can bootstrap).
 */
export function isOrganizer() {
  const user = getUser();
  if (!user) return false;

  let createdAny = false;
  let invitedAsRegistrar = false;

  for (const e of _events) {
    const p = e.payload || {};
    if (e.event_type === 'RallyCreated' && p.created_by === user.email) {
      createdAny = true;
    }
    if (e.event_type === 'RegistrarInvited' && p.registrar_email === user.email) {
      invitedAsRegistrar = true;
    }
  }

  // Registrar-only users cannot create/manage rallies.
  // New users (neither organizer nor registrar) can create their first rally.
  return createdAny || !invitedAsRegistrar;
}

/**
 * Get rally IDs accessible to the current user.
 * Organizer: rallies they created. Registrar: rallies they're invited to
 * (unless subsequently removed without re-invite).
 */
export function getAccessibleRallyIds() {
  const user = getUser();
  if (!user) return [];

  const organizerIds = new Set();
  // Track registrar access per rally: process events in order
  const registrarAccess = new Map(); // rally_id -> boolean

  for (const e of _events) {
    const p = e.payload || {};
    if (e.event_type === 'RallyCreated' && p.created_by === user.email) {
      organizerIds.add(e.rally_id);
    }
    if (e.event_type === 'RegistrarInvited' && p.registrar_email === user.email) {
      registrarAccess.set(e.rally_id, true);
    }
    if (e.event_type === 'RegistrarRemoved' && p.registrar_email === user.email) {
      registrarAccess.set(e.rally_id, false);
    }
  }

  const ids = new Set(organizerIds);
  for (const [rallyId, hasAccess] of registrarAccess) {
    if (hasAccess) ids.add(rallyId);
    else ids.delete(rallyId);
  }

  return [...ids];
}

/**
 * Clear all stored events and session (for demo reset).
 */
export function clearAllData() {
  _events = [];
  saveEvents(_events);
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
}
