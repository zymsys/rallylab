/**
 * supabase.js — Auth + Supabase client for RallyLab.
 *
 * Mode is chosen at runtime (localStorage):
 *   demo  → mock auth with sessionStorage, no server
 *   real  → real Supabase client with magic link auth
 *   null  → no mode chosen yet, treated as signed-out (shows login screen)
 */

import { isDemoMode, getMode, clearMode, SUPABASE_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
 * Sign out.
 */
export async function signOut() {
  if (isDemoMode()) {
    _session = null;
    sessionStorage.removeItem(SESSION_KEY);
    clearMode();
    _notifyAuth('SIGNED_OUT', null);
    return { error: null };
  }

  const client = await getRealClient();
  const result = await client.auth.signOut();
  clearMode();
  return result;
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
  if (getMode() !== 'real') {
    // No mode chosen yet or demo mode — use mock auth.
    // Register callback so it fires when signIn/signOut are called later.
    _authCallbacks.push(callback);
    if (_session) callback('INITIAL_SESSION', _session);
    else callback('INITIAL_SESSION', null);
    return () => {
      _authCallbacks = _authCallbacks.filter(cb => cb !== callback);
    };
  }

  // Real mode: delegate to supabase-js onAuthStateChange
  let unsubFn = null;
  getRealClient().then(client => {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      _session = session ? { user: session.user } : null;
      callback(event, _session);
    });
    unsubFn = () => subscription.unsubscribe();
  });

  return () => { if (unsubFn) unsubFn(); };
}

/**
 * Initialize auth — restores existing session.
 */
export async function initAuth() {
  if (getMode() === null) return null;

  if (isDemoMode()) return _session;

  const client = await getRealClient();
  const { data: { session } } = await client.auth.getSession();
  _session = session ? { user: session.user } : null;
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
  clearMode();
}
