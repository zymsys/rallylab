/**
 * config.js — RallyLab configuration.
 *
 * Public values only — the anon key is safe to expose in client code
 * because all data access is controlled by Supabase RLS policies.
 *
 * To connect to a real Supabase project:
 *   1. Set USE_MOCK to false
 *   2. Fill in SUPABASE_URL and SUPABASE_ANON_KEY
 */

export const USE_MOCK = true;

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
