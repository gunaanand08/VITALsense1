import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

/** Shown in the settings panel; never includes the key. */
export const supabaseProjectUrl = rawUrl;

/**
 * A hosted build has no local bridge, so hardware mode needs a cloud project.
 * Both values are absent in a plain checkout, and the app must still run: the
 * bridge fallback and simulation mode never require them.
 */
export const isSupabaseConfigured = /^https?:\/\//.test(rawUrl) && publishableKey.length > 0;

/**
 * The publishable key is public by design; row level security in
 * `supabase/schema.sql` is what limits it to read-only access. Sessions are a
 * separate, browser-local store, so nothing private passes through this client.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawUrl, publishableKey, {
      // No accounts yet: a persisted session and a token refresh timer would
      // only add background work to an app that never signs anyone in.
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;
