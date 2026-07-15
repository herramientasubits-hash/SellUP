// Agente 2A — 17B.4X.7C.5D.1 Environment Safety Guard
//
// Server-only: reads process.env, must never be imported from client
// components (mirrors src/lib/feature-flags.server.ts).
//
// Problem this closes: dozens of call sites across this codebase build a
// Supabase service-role client inline as
//   const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
// If NEXT_PUBLIC_SUPABASE_URL is unset in a Vercel Preview or an incomplete
// non-production environment, that fallback silently points the client at
// the real production project. This module gives call sites a fail-closed
// alternative: missing/incomplete config throws instead of falling back.
//
// This hito does NOT rewrite the existing inline call sites (that spans
// source-catalog, industry-mapping-adjacent, and provider credential files
// explicitly out of scope for this change) — it introduces the safe
// primitive so new code can use it and existing call sites can migrate
// incrementally. See the 17B.4X.7C.5D.1 report for the full inventory.

/** The only production Supabase project host. Comparison target — never used as a fallback value. */
export const PRODUCTION_SUPABASE_HOST = 'lrdruowtadwbdulndlph.supabase.co';

/** Explicit opt-in for local development to point at the production project. Never honored on Vercel. */
export const ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV =
  'ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD';

export type SupabaseEnvUnsafeReason =
  | 'missing_supabase_url'
  | 'missing_service_role_key'
  | 'non_production_environment_targets_production_supabase';

export class UnsafeSupabaseEnvironmentError extends Error {
  readonly reason: SupabaseEnvUnsafeReason;

  constructor(reason: SupabaseEnvUnsafeReason, message: string) {
    super(message);
    this.name = 'UnsafeSupabaseEnvironmentError';
    this.reason = reason;
  }
}

type EnvLike = Partial<Record<string, string | undefined>>;

export interface ResolvedSupabaseServiceRoleEnv {
  url: string;
  serviceRoleKey: string;
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Pure resolver — takes an explicit env-like record instead of reading
 * process.env directly, so tests never need to mutate global env state.
 * getSupabaseServiceRoleEnv() below is the process.env-backed wrapper
 * callers should use.
 *
 * Throws UnsafeSupabaseEnvironmentError (never falls back silently) when:
 *   - NEXT_PUBLIC_SUPABASE_URL is missing/blank
 *   - SUPABASE_SERVICE_ROLE_KEY is missing/blank
 *   - the resolved URL host is the production project AND VERCEL_ENV is not
 *     exactly 'production' (covers Preview, Vercel dev, and local shells)
 *     AND the local-only override is not explicitly set. The override is
 *     read from process.env directly (see getSupabaseServiceRoleEnv) and is
 *     never honored when VERCEL_ENV is present at all — Vercel Preview must
 *     never be able to silently target production, override or not.
 */
export function resolveSupabaseServiceRoleEnv(
  env: EnvLike,
  options: { allowProductionOverride: boolean } = { allowProductionOverride: false }
): ResolvedSupabaseServiceRoleEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new UnsafeSupabaseEnvironmentError(
      'missing_supabase_url',
      'NEXT_PUBLIC_SUPABASE_URL is not set. Refusing to fall back to a hardcoded Supabase project.'
    );
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new UnsafeSupabaseEnvironmentError(
      'missing_service_role_key',
      'SUPABASE_SERVICE_ROLE_KEY is not set. Refusing to create a Supabase admin client without it.'
    );
  }

  const vercelEnv = env.VERCEL_ENV?.trim();
  const isOnVercel = vercelEnv !== undefined && vercelEnv !== '';
  const isProductionVercelEnv = vercelEnv === 'production';
  const resolvedHost = extractHost(url);
  const targetsProductionProject = resolvedHost === PRODUCTION_SUPABASE_HOST;

  if (targetsProductionProject && !isProductionVercelEnv) {
    const overrideHonored = options.allowProductionOverride && !isOnVercel;
    if (!overrideHonored) {
      throw new UnsafeSupabaseEnvironmentError(
        'non_production_environment_targets_production_supabase',
        isOnVercel
          ? `A non-production Vercel environment (VERCEL_ENV=${vercelEnv}) resolved NEXT_PUBLIC_SUPABASE_URL to the production Supabase project. Refusing to create a client.`
          : `A local/non-Vercel environment resolved NEXT_PUBLIC_SUPABASE_URL to the production Supabase project without ${ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV}=true. Refusing to create a client.`
      );
    }
  }

  return { url, serviceRoleKey };
}

/**
 * process.env-backed accessor. Reads at call time — no module-level caching.
 * The production override is read here (not passed in by callers) so it can
 * only ever come from real process.env, never from an arbitrary caller-built
 * env-like object.
 */
export function getSupabaseServiceRoleEnv(): ResolvedSupabaseServiceRoleEnv {
  const allowProductionOverride =
    process.env[ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV]?.trim().toLowerCase() === 'true';
  return resolveSupabaseServiceRoleEnv(process.env, { allowProductionOverride });
}

/**
 * Pure check for whether it is safe to run contact-enrichment automatic
 * routing (ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING) in the current
 * environment. Does not read or change the routing flag itself — that stays
 * owned by src/modules/contact-enrichment-routing/routing-config.server.ts.
 * This is a standalone safety primitive: a caller that enables automatic
 * routing should also require this to be true before doing anything, and
 * it is exercised in isolation in this hito's tests (no orchestrator wiring
 * changed).
 */
export function isSafeEnvironmentForAutomaticRouting(env: EnvLike): boolean {
  try {
    resolveSupabaseServiceRoleEnv(env, { allowProductionOverride: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws UnsafeSupabaseEnvironmentError when automaticRoutingEnabled is true
 * but the environment is not a safe, fully-configured, isolated one. No-op
 * when automaticRoutingEnabled is false. See isSafeEnvironmentForAutomaticRouting.
 */
export function assertAutomaticRoutingEnvironmentIsSafe(
  automaticRoutingEnabled: boolean,
  env: EnvLike
): void {
  if (!automaticRoutingEnabled) return;
  resolveSupabaseServiceRoleEnv(env, { allowProductionOverride: false });
}
