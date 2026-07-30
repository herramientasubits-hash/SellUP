/**
 * A1-LEGACY-PATH-FENCE-1 — server-side capability gate for the legacy Agente 1
 * company-discovery action (`generateAIProspectBatch`).
 *
 * Pure + dependency-injected on purpose. `actions.ts` is a 4k-line server-action
 * module that pulls in Supabase, HubSpot and every provider client, so it cannot
 * be imported from a unit test. Keeping the decision here means the gate's
 * ORDER and its refusal semantics are provable at runtime instead of only by
 * reading source text.
 *
 * The P0 this closes: a failed industry-catalog read became `catalog=null`, which
 * the experience resolver turned into the legacy Apollo form, whose CTA called
 * `generateAIProspectBatch` and could spend up to 25 Apollo credits per click —
 * no reservation, no spend confirmation, no idempotency. The UI layers now fail
 * closed, but the action is a server action and stays directly invocable, so this
 * gate is the authoritative defence.
 *
 * Nothing here reads the caller's input. The decision is a function of the
 * authenticated session's role plus two server-only env flags, so no
 * client-supplied field (`source`, `origin`, `provider`, `legacyAllowed`, …) can
 * unlock it.
 */

/** Why an invocation was refused. Static codes — safe to log, safe to return. */
export type LegacyPathBlockedReason =
  | 'not_admin'
  | 'legacy_capability_disabled'
  | 'apollo_company_search_disabled';

export type LegacyPathGateDecision =
  | { allowed: true }
  | { allowed: false; reason: LegacyPathBlockedReason };

export interface LegacyApolloPathGateDeps {
  /** Resolves whether the authenticated caller has the admin role. Must fail-closed. */
  isAdmin: () => Promise<boolean>;
  /** Reads ENABLE_LEGACY_APOLLO_PROSPECT_GENERATION through the canonical parser. */
  isLegacyCapabilityEnabled: () => boolean;
  /** Reads ENABLE_APOLLO_COMPANY_SEARCH through the canonical parser. */
  isApolloCompanySearchEnabled: () => boolean;
  /** PII-free observability sink. Receives a static reason code only. */
  logBlocked?: (reason: LegacyPathBlockedReason) => void;
}

export interface LegacyApolloPathGateInput {
  /**
   * Whether the execution path that would run implies an Apollo call. The writer
   * pipeline runs on Tavily and does not, so demanding the Apollo company-search
   * flag there would block a path that never touches Apollo.
   */
  impliesApollo: boolean;
}

/**
 * Evaluates the gate. Checks are ordered cheapest-blast-radius first: identity,
 * then capability, then provider. Every negative branch returns without touching
 * the database, any provider, or any billing surface.
 */
export async function evaluateLegacyApolloPathGate(
  input: LegacyApolloPathGateInput,
  deps: LegacyApolloPathGateDeps,
): Promise<LegacyPathGateDecision> {
  const block = (reason: LegacyPathBlockedReason): LegacyPathGateDecision => {
    deps.logBlocked?.(reason);
    return { allowed: false, reason };
  };

  if (!(await deps.isAdmin())) return block('not_admin');
  if (!deps.isLegacyCapabilityEnabled()) return block('legacy_capability_disabled');
  if (input.impliesApollo && !deps.isApolloCompanySearchEnabled()) {
    return block('apollo_company_search_disabled');
  }
  return { allowed: true };
}

/**
 * The shape returned to the client when the gate refuses. Deliberately carries no
 * batch id, no candidates, no cost and no authorization detail — a blocked call
 * must be indistinguishable from any other unavailable state, and must never hint
 * at which flag or role would unlock it.
 */
export function buildLegacyPathBlockedResult(reason: LegacyPathBlockedReason): {
  ok: false;
  blocked: true;
  blockedReason: LegacyPathBlockedReason;
  batchId: null;
  candidatesCreated: 0;
  estimatedCostUsd: 0;
  message: string;
} {
  return {
    ok: false,
    blocked: true,
    blockedReason: reason,
    batchId: null,
    candidatesCreated: 0,
    estimatedCostUsd: 0,
    message: 'La búsqueda de empresas no está disponible.',
  };
}

/**
 * PII-free log line for a blocked invocation: static event name + static reason
 * code. Never the query, country, sector, company, person or user id.
 */
export function logLegacyPathBlocked(reason: LegacyPathBlockedReason): void {
  console.warn(
    `[generateAIProspectBatch] event=legacy_fallback_blocked reason=${reason}`,
  );
}
