/**
 * config.js — RallyLab configuration.
 *
 * Public values only — the anon key is safe to expose in client code
 * because all data access is controlled by Supabase RLS policies.
 *
 * Mode is chosen at runtime on the login screen:
 *   - "Try Demo" sets demo mode (IndexedDB + fake auth)
 *   - "Sign In with Email" sets real mode (Supabase + magic links)
 */

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/** True when both Supabase URL and anon key are configured. */
export const SUPABASE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ─── Runtime Mode ────────────────────────────────────────────────

const MODE_KEY = 'rallylab_mode';

/** @returns {'demo' | 'real' | null} */
export function getMode() {
  return localStorage.getItem(MODE_KEY);
}

/** @param {'demo' | 'real'} mode */
export function setMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function clearMode() {
  localStorage.removeItem(MODE_KEY);
}

/** Convenience: true when running in local demo mode. */
export function isDemoMode() {
  return getMode() === 'demo';
}
