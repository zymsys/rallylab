/**
 * supabase.js — Auth layer for RallyLab.
 *
 * Currently uses mock auth with sessionStorage.
 * Set USE_MOCK = false and provide real Supabase credentials to switch
 * to the real backend.
 */

const USE_MOCK = true;

// ─── Storage helpers ───────────────────────────────────────────────
const SESSION_KEY = 'rallylab_session';

// ─── Module-level state ────────────────────────────────────────────
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

// ─── Client ────────────────────────────────────────────────────────

const _mockClient = {
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
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY for real mode');
}

/**
 * Clear all stored data (for demo reset).
 */
export async function clearAllData() {
  const { clear } = await import('./event-store.js');
  await clear();
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
}
