/**
 * supabase.js — Auth + Supabase client for RallyLab.
 *
 * Mode is chosen at runtime (localStorage):
 *   demo  → mock auth with sessionStorage, no server
 *   real  → real Supabase client with magic link auth
 *   null  → no mode chosen yet, treated as signed-out (shows login screen)
 */

import { isDemoMode, getMode, setMode, clearMode, SUPABASE_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ─── Real Supabase client (lazy-initialized) ─────────────────────
let _realClient = null;

async function getRealClient() {
  if (!SUPABASE_CONFIGURED) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js');
  }
  if (_realClient) return _realClient;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _realClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _realClient;
}

// ─── Mock auth state ──────────────────────────────────────────────
const SESSION_KEY = 'rallylab_session';
const REAL_SESSION_KEY = 'rallylab_real_session';
let _session = null;
let _authCallbacks = [];

try {
  _session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
} catch { /* ignore */ }

function _notifyAuth(event, session) {
  for (const cb of _authCallbacks) {
    try { cb(event, session); } catch (e) { console.error('Auth callback error', e); }
  }
}

// ─── Auth API ─────────────────────────────────────────────────────

/**
 * Sign in. Demo mode: instant sign-in. Real mode: sends magic link.
 * @param {string} email
 * @returns {Promise<{data, error}>}
 */
export async function signIn(email) {
  if (isDemoMode()) {
    _session = {
      user: { id: _deterministicId(email), email }
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
    _notifyAuth('SIGNED_IN', _session);
    return { data: _session, error: null };
  }

  const client = await getRealClient();
  const { data, error } = await client.auth.signInWithOtp({ email });
  return { data, error };
}

/**
 * Sign out. Always clears local state so the user can return to the
 * login screen even when offline or switching between demo/real modes.
 */
export async function signOut() {
  const wasReal = getMode() === 'real';

  // Always clear local state first — this guarantees the UI transitions
  // back to login even when the network is unavailable.
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(REAL_SESSION_KEY);
  clearMode();
  _notifyAuth('SIGNED_OUT', null);

  // Best-effort remote sign-out for real mode (non-blocking).
  if (wasReal && _realClient) {
    try { await _realClient.auth.signOut(); } catch { /* offline is fine */ }
  }

  return { error: null };
}

/**
 * Get current user (synchronous for mock, async-safe for real).
 */
export function getUser() {
  if (isDemoMode()) {
    return _session ? _session.user : null;
  }

  // In real mode, session is managed by supabase-js internally.
  // Callers should prefer onAuthChange for reactivity.
  return _session ? _session.user : null;
}

/**
 * Subscribe to auth state changes.
 * Callback receives (event, session).
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  // Always register in _authCallbacks so signOut() can notify via
  // _notifyAuth regardless of current mode (handles offline sign-out
  // and mode transitions).
  _authCallbacks.push(callback);

  if (_session) callback('INITIAL_SESSION', _session);
  else callback('INITIAL_SESSION', null);

  if (getMode() !== 'real') {
    return () => {
      _authCallbacks = _authCallbacks.filter(cb => cb !== callback);
    };
  }

  // Real mode: also subscribe for server-driven auth changes via supabase-js.
  let unsubFn = null;
  const subscribe = (client) => {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return; // already fired above
      _session = session ? { user: session.user } : null;
      callback(event, _session);
    });
    unsubFn = () => subscription.unsubscribe();
  };

  // Use cached client synchronously if available (initAuth pre-warms it)
  if (_realClient) {
    subscribe(_realClient);
  } else {
    getRealClient().then(subscribe).catch(e => {
      console.warn('onAuthChange: could not subscribe to real-time auth:', e.message);
    });
  }

  return () => {
    _authCallbacks = _authCallbacks.filter(cb => cb !== callback);
    if (unsubFn) unsubFn();
  };
}

/**
 * Initialize auth — restores existing session.
 */
export async function initAuth() {
  // A magic-link callback lands on the page with the access token in the URL
  // hash. Force real mode so supabase-js gets initialized below and can
  // consume the token via detectSessionInUrl. This handles users who clicked
  // the link in a different browser/profile or after signing out (which
  // clears the stored mode).
  if (typeof location !== 'undefined' && /[#&]access_token=/.test(location.hash)
      && SUPABASE_CONFIGURED && getMode() !== 'real') {
    setMode('real');
  }

  if (getMode() === null) return null;

  if (isDemoMode()) return _session;

  try {
    const client = await getRealClient();
    const { data: { session } } = await client.auth.getSession();
    _session = session ? { user: session.user } : null;
    if (_session) localStorage.setItem(REAL_SESSION_KEY, JSON.stringify(_session));
    else localStorage.removeItem(REAL_SESSION_KEY);
  } catch (e) {
    // Offline or supabase-js unavailable — use cached session
    console.warn('initAuth: falling back to cached session:', e.message);
    try { _session = JSON.parse(localStorage.getItem(REAL_SESSION_KEY)); } catch { /* ignore */ }
    if (!_session) console.warn('initAuth: no cached session available');
  }
  return _session;
}

// ─── Supabase Client Access ───────────────────────────────────────

/**
 * Get the Supabase client for direct table operations.
 * In demo mode, returns a stub that throws on table access.
 */
export async function getClient() {
  if (isDemoMode()) return _mockClient;
  return getRealClient();
}

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
  },
  from() {
    throw new Error('Supabase table access is not available in demo mode');
  }
};

// ─── Helpers ──────────────────────────────────────────────────────

function _deterministicId(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  return '00000000-mock-user-' + Math.abs(hash).toString(16).padStart(12, '0');
}

/**
 * Clear all stored data (for demo reset).
 */
export async function clearAllData() {
  const { clear } = await import('./event-store.js');
  await clear();
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(REAL_SESSION_KEY);
  clearMode();
}
