/**
 * Q3F-5BB.11E — Apollo ⇄ provider-routing adapter (PURE, OBSERVATIONAL).
 *
 * A thin, pure bridge that lets the Agent 1 wizard's Apollo company-discovery
 * path emit the standard provider-routing OBSERVATION (11B plan → 11C metadata)
 * WITHOUT ever changing WHO decides Apollo runs. It builds the criteria / config
 * / registry the pure `resolveProviderRoutingPlan` expects and asserts the
 * resolved plan is safe for the Apollo path.
 *
 * ── OBSERVATIONAL policy (Q3F-5BB.11E decision) ─────────────────────────────
 * Apollo company discovery belongs to the `default_ai` world — it is NOT an
 * explicit user intent. The routing plan produced here is for OBSERVATION + a
 * safety assert ONLY; it does NOT decide the provider and it does NOT gate
 * execution:
 *   - `resolveWizardDiscoveryProvider` (double env gate:
 *     AGENT1_WIZARD_DISCOVERY_PROVIDER + ENABLE_APOLLO_COMPANY_SEARCH) remains
 *     the sole runtime authority on whether Apollo runs.
 *   - When that resolver has already selected Apollo, the plan expresses it as
 *     `intendedProvider='default_ai'` + `selectedProvider='apollo'`.
 *   - Apollo can NEVER be an automatic fallback (10C3): a Lusha intent must
 *     never route to Apollo, and this adapter never adds Apollo as a fallback.
 *
 * ── SEMANTICS DIFFER FROM LUSHA (do NOT copy 11D's assert verbatim) ─────────
 * Lusha's intent is EXPLICIT: a flag-ON Lusha run must resolve to Lusha or it is
 * a bug. Apollo enters via `default_ai`: when Apollo is OFF, `default_ai` may
 * legitimately resolve to Tavily or to nothing (null) — that is NOT unsafe.
 * Therefore `assertApolloRoutingPlanSafe` only requires `selectedProvider==='apollo'`
 * when Apollo is enabled; with Apollo disabled it tolerates Tavily / null.
 *
 * ── SCOPE BOUNDARY ──────────────────────────────────────────────────────────
 * This is COMPANY discovery routing only. It has nothing to do with Apollo
 * contact enrichment or Apollo phone reveal (the ASYNC phone flows). This module
 * imports none of those.
 *
 * ── PURITY (locked by static-safety tests) ──────────────────────────────────
 *   - never reads process.env (environment + flag state arrive as arguments),
 *   - never imports Supabase / a provider client (Apollo / Lusha / Tavily),
 *   - never imports contact-enrichment / apollo phone reveal,
 *   - never performs I/O. It only builds the resolver's inputs and inspects a
 *     pure plan.
 *
 * Config shape (11E):
 *   mode='observe_only', allowFallback=false, fallbackChain=[],
 *   intendedProvider='default_ai', defaultAiProvider='apollo',
 *   searchType='companies_by_criteria'. No Lusha, no fallback.
 */

import {
  DEFAULT_PROVIDER_REGISTRY,
  type ProviderCapabilityRegistry,
  type ProviderRoutingConfig,
  type ProviderRoutingCriteria,
  type ProviderRoutingEnvironment,
  type ProviderRoutingPlan,
  type RoutingProviderId,
} from './provider-routing';

// ── Fixed 11E constants ───────────────────────────────────────────────────────

/** The Apollo "companies by criteria" search shape the routing plan observes. */
export const APOLLO_ROUTING_SEARCH_TYPE = 'companies_by_criteria' as const;

/** 11E always intends `default_ai` — Apollo is never an explicit user intent. */
export const APOLLO_ROUTING_INTENDED_PROVIDER = 'default_ai' as const;

/** The default_ai primary Apollo represents when the resolver picked Apollo. */
export const APOLLO_ROUTING_DEFAULT_AI_PROVIDER: RoutingProviderId = 'apollo';

/** Minimum useful candidates target (mirrors the wizard Apollo pipeline). */
export const APOLLO_ROUTING_MIN_USEFUL_CANDIDATES = 5;

// ── Criteria ────────────────────────────────────────────────────────────────

export interface BuildApolloRoutingCriteriaInput {
  countryCode?: string | null;
  /** Mapped sector / industry key (informational for Apollo: coverage is ALL). */
  sectorKey?: string | null;
}

/**
 * Build the routing CRITERIA for an Apollo COMPANY search. Intends `default_ai`
 * (Apollo is not an explicit intent) with the companies-by-criteria shape.
 * `needsCompanySearch` is the only capability requested — this is company
 * discovery, never people/contact enrichment. Country / sector are carried
 * through from the (already validated) wizard input. Pure — never reads env.
 */
export function buildApolloRoutingCriteria(
  input: BuildApolloRoutingCriteriaInput,
): ProviderRoutingCriteria {
  return {
    intendedProvider: APOLLO_ROUTING_INTENDED_PROVIDER,
    searchType: APOLLO_ROUTING_SEARCH_TYPE,
    countryCode: input.countryCode ?? null,
    sector: input.sectorKey ?? null,
    needsCompanySearch: true,
    needsPeopleSearch: false,
    needsEnrichment: false,
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface BuildApolloRoutingConfigInput {
  /** Target environment (resolved server-side by the caller; never read here). */
  environment: ProviderRoutingEnvironment;
  /** Resolved ENABLE_APOLLO_COMPANY_SEARCH state (read server-side by caller). */
  apolloEnabled: boolean;
}

/**
 * Build the RESOLVED routing config for the Apollo `default_ai` path.
 * `observe_only` mode with `allowFallback=false` and an empty `fallbackChain` —
 * a triple guarantee that NO fallback is ever built (11B suppresses a chain when
 * allowFallback is false). `defaultAiProvider='apollo'` tells the resolver which
 * concrete provider the `default_ai` intent maps to. Lusha is intentionally
 * absent from `enabledProviders` (⇒ disabled). Apollo's `riskLevel='high'`
 * descriptor already forces confirmation in the resolver, so we do NOT set
 * `requireCostConfirmation` here. Pure — env-derived values arrive as args.
 */
export function buildApolloRoutingConfig(
  input: BuildApolloRoutingConfigInput,
): ProviderRoutingConfig {
  return {
    mode: 'observe_only',
    allowFallback: false,
    minUsefulCandidates: APOLLO_ROUTING_MIN_USEFUL_CANDIDATES,
    // Fail-closed: only Apollo may be enabled, and only when the caller confirmed
    // the double gate is ON. Lusha / Tavily are intentionally absent (⇒ disabled).
    enabledProviders: { apollo: input.apolloEnabled },
    environment: input.environment,
    // Apollo is the concrete provider the default_ai intent resolves to.
    defaultAiProvider: APOLLO_ROUTING_DEFAULT_AI_PROVIDER,
    // No fallback surface whatsoever.
    fallbackChain: [],
    requireCostConfirmation: false,
  };
}

// ── Observational registry ──────────────────────────────────────────────────

/**
 * The registry the 11E plan resolves against. Apollo already declares
 * `supportedCountries/supportedIndustries = COVERAGE_ALL` in the default
 * registry, so — unlike Lusha (11D) — there is no conservative allowlist to
 * widen and no coverage false-negative to avoid. We return the default registry
 * unchanged. Kept as a builder for symmetry with the Lusha adapter and so the
 * wiring gets all three resolver inputs from one place.
 */
export function buildApolloObservationalRegistry(): ProviderCapabilityRegistry {
  return DEFAULT_PROVIDER_REGISTRY;
}

// ── Safety assert ───────────────────────────────────────────────────────────

/** Stable code surfaced when a resolved plan is unsafe for the Apollo path. */
export const APOLLO_ROUTING_PLAN_UNSAFE_CODE = 'APOLLO_ROUTING_PLAN_UNSAFE' as const;

/** Machine-readable reason an Apollo routing plan was rejected as unsafe. */
export type ApolloRoutingUnsafeReason =
  | 'would_use_lusha'
  | 'lusha_intent_would_use_apollo'
  | 'selected_provider_not_apollo';

/**
 * Thrown by `assertApolloRoutingPlanSafe` when the OBSERVED plan violates an
 * Apollo safety invariant. Typed so callers can react precisely and never
 * silently fall through to another provider.
 */
export class ApolloRoutingPlanUnsafeError extends Error {
  readonly code = APOLLO_ROUTING_PLAN_UNSAFE_CODE;
  readonly reason: ApolloRoutingUnsafeReason;
  readonly selectedProvider: string | null;

  constructor(reason: ApolloRoutingUnsafeReason, selectedProvider: string | null) {
    super(
      `${APOLLO_ROUTING_PLAN_UNSAFE_CODE}: ${reason} (selectedProvider="${selectedProvider ?? 'none'}")`,
    );
    this.name = 'ApolloRoutingPlanUnsafeError';
    this.reason = reason;
    this.selectedProvider = selectedProvider;
  }
}

export interface AssertApolloRoutingPlanSafeOptions {
  /** Resolved ENABLE_APOLLO_COMPANY_SEARCH state used to build the plan. */
  apolloEnabled: boolean;
}

/**
 * Assert a resolved plan is SAFE for the Apollo `default_ai` path. Throws
 * `ApolloRoutingPlanUnsafeError` when:
 *   - `wouldUseLusha` is true — the Apollo company-discovery path must never
 *     divert to Lusha,
 *   - the intent is Lusha AND `wouldUseApollo` is true — 10C3: an intended-Lusha
 *     plan must never route to Apollo (defensive; this adapter never sets a Lusha
 *     intent, but the assert refuses any plan that violates the invariant),
 *   - Apollo is ENABLED but the plan did not select Apollo — inside a real Apollo
 *     run the plan must resolve to Apollo; anything else means the observation
 *     diverged from the live decision (a routing bug), so fail-closed.
 *
 * IMPORTANT (semantics differ from Lusha): when `apolloEnabled === false`, a
 * `selectedProvider` of `'tavily'` or `null` is NOT unsafe — `default_ai`
 * legitimately resolves elsewhere (or nowhere) when Apollo is off. The assert
 * deliberately tolerates that. It also ignores execution gating
 * (`dryRunOnly` / `allowedToExecute`) — the live double gate, not this plan,
 * runs Apollo.
 */
export function assertApolloRoutingPlanSafe(
  plan: ProviderRoutingPlan,
  options: AssertApolloRoutingPlanSafeOptions,
): void {
  if (plan.wouldUseLusha) {
    throw new ApolloRoutingPlanUnsafeError('would_use_lusha', plan.selectedProvider);
  }
  if (plan.intendedProvider === 'lusha' && plan.wouldUseApollo) {
    throw new ApolloRoutingPlanUnsafeError(
      'lusha_intent_would_use_apollo',
      plan.selectedProvider,
    );
  }
  if (options.apolloEnabled && plan.selectedProvider !== 'apollo') {
    throw new ApolloRoutingPlanUnsafeError(
      'selected_provider_not_apollo',
      plan.selectedProvider,
    );
  }
}
