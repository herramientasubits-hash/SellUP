// Agente 2A — 17B.4X.7C.5D.1 Environment Safety Guard
//
// Server-only canonical factory for a Supabase service-role client. Unlike
// the ~40 inline `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ||
// 'https://lrdruowtadwbdulndlph.supabase.co', ...)` call sites elsewhere in
// this codebase, this factory never falls back to a hardcoded project — it
// fails closed via resolveSupabaseServiceRoleEnv (env-guard.server.ts) when
// config is missing or a non-production environment resolves to production.
//
// New server code that needs a service-role client should use this instead
// of duplicating the inline pattern. Existing call sites are not migrated by
// this hito (see the 17B.4X.7C.5D.1 report for scope and follow-up).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleEnv } from './env-guard.server';

/** Throws UnsafeSupabaseEnvironmentError instead of returning a client for missing/unsafe config. */
export function createSupabaseAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseServiceRoleEnv();
  return createClient(url, serviceRoleKey);
}
