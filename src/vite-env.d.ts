/// <reference types="vite/client" />

/**
 * Only the variables the app reads are declared, so a mistyped key fails the
 * build instead of silently resolving to undefined at runtime.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
