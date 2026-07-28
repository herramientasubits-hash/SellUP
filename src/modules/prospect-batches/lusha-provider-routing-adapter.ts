/**
 * Q3F-5BB.11D — Lusha ⇄ provider-routing adapter (PURE, OBSERVATIONAL).
 *
 * A thin, pure bridge that lets the LIVE Lusha "Generar con IA" flow emit the
 * standard provider-routing OBSERVATION (11B plan → 11C metadata) without ever
 * changing WHO decides Lusha runs. It builds the criteria/config/registry the
 * pure `resolveProviderRoutingPlan` expects and asserts the resolved plan is
 * safe for the Lusha path.
 *
 * ── OBSERVATIONAL policy (Q3F-5BB.11D decision) ─────────────────────────────
 * The routing plan produced here is for OBSERVATION + a safety assert ONLY. It
 * does NOT decide eligibility and it does NOT gate execution:
 *   - `resolveWizardLushaCriteria` remains the sole eligibility authority.
 *   - `guardLushaPreviewEnabled` / `isLushaPreviewEnabled` remain the last
 *     server-side barrier (a flag-off call never reaches this adapter).
 *   - The plan must NEVER block (or divert) a search the live guard already
 *     approved just because the 11B registry's conservative country/sector
 *     allowlist is narrower than the live sector-mapping. See
 *     `buildLushaObservationalRegistry`.
 *
 * ── PURITY (locked by static-safety tests) ──────────────────────────────────
 *   - never reads process.env (environment + flag state arrive as arguments),
 *   - never imports Supabase / a provider client (Lusha / Apollo / Tavily),
 *   - never performs I/O. It only builds inputs, calls the pure resolver's
 *     inputs, and inspects a pure plan.
 *
 * Config shape (11D):
 *   mode='manual', allowFallback=false, fallbackChain=[], intendedProvider='lusha',
 *   searchType='companies_by_criteria'. No Apollo, no Tavily, no fallback.
 */

import {
  COVERAGE_ALL,
  DEFAULT_PROVIDER_REGISTRY,
  type ProviderCapabilityRegistry,
  type ProviderRoutingConfig,
  type ProviderRoutingCriteria,
  type ProviderRoutingEnvironment,
  type ProviderRoutingPlan,
} from './provider-routing';

// ── Fixed 11D constants ──────────────────────────────────────────────────────

/** The Lusha "companies by criteria" search shape the routing plan observes. */
export const LUSHA_ROUTING_SEARCH_TYPE = 'companies_by_criteria' as const;

/** 11D always intends Lusha (never Apollo / Tavily / default_ai). */
export const LUSHA_ROUTING_INTENDED_PROVIDER = 'lusha' as const;

/** Minimum useful candidates target (mirrors the Lusha pending-review core). */
export const LUSHA_ROUTING_MIN_USEFUL_CANDIDATES = 5;

// ── Criteria ──────────────────────────────────────────────────────────────────

export interface BuildLushaRoutingCriteriaInput {
  countryCode?: string | null;
  sectorKey?: string | null;
}

/**
 * Build the routing CRITERIA for a Lusha search. Always intends Lusha and the
 * companies-by-criteria search shape. Country / sector are carried through from
 * the (already validated) live wizard input. Pure — never reads env.
 */
export function buildLushaRoutingCriteria(
  input: BuildLushaRoutingCriteriaInput,
): ProviderRoutingCriteria {
  return {
    intendedProvider: LUSHA_ROUTING_INTENDED_PROVIDER,
    searchType: LUSHA_ROUTING_SEARCH_TYPE,
    countryCode: input.countryCode ?? null,
    sector: input.sectorKey ?? null,
    needsCompanySearch: true,
    needsPeopleSearch: false,
    needsEnrichment: false,
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface BuildLushaRoutingConfigInput {
  /** Target environment (resolved server-side by the caller; never read here). */
  environment: ProviderRoutingEnvironment;
  /** Resolved ENABLE_LUSHA_PREVIEW state (read server-side by the caller). */
  lushaEnabled: boolean;
}

/**
 * Build the RESOLVED routing config for the Lusha path. `manual` mode with
 * `allowFallback=false` and an empty `fallbackChain` — a triple guarantee that
 * NO fallback is ever built (11B suppresses a chain when allowFallback is false,
 * and additionally whenever the intent is Lusha). Apollo / Tavily can never be
 * selected. Pure — the env-derived `environment` + `lushaEnabled` arrive as args.
 */
export function buildLushaRoutingConfig(
  input: BuildLushaRoutingConfigInput,
): ProviderRoutingConfig {
  return {
    mode: 'manual',
    allowFallback: false,
    minUsefulCandidates: LUSHA_ROUTING_MIN_USEFUL_CANDIDATES,
    // Fail-closed: only Lusha may be enabled, and only when the guard confirmed
    // the flag ON. Apollo / Tavily are intentionally absent (⇒ disabled).
    enabledProviders: { lusha: input.lushaEnabled },
    environment: input.environment,
    // No fallback surface whatsoever.
    fallbackChain: [],
    requireCostConfirmation: false,
  };
}

// ── Observational registry (coverage never blocks a live-approved Lusha run) ──

/**
 * The registry the 11D plan resolves against: the DEFAULT registry with Lusha's
 * country/sector coverage widened to `COVERAGE_ALL`.
 *
 * WHY: the 11B default registry encodes a deliberately conservative Lusha
 * allowlist (3 sectors / ~20 countries). Under the OBSERVATIONAL policy the live
 * eligibility (`resolveWizardLushaCriteria`) + `guardLushaPreviewEnabled` are the
 * sole authority on whether Lusha runs; a plan that BLOCKED a live-approved
 * search merely because its country/sector sits outside that narrow allowlist
 * would be a false negative — and would trip `assertLushaRoutingPlanSafe`
 * (selectedProvider≠'lusha'). Widening ONLY Lusha's coverage removes that false
 * block while keeping every other safety property intact: cost stays unknown,
 * the enabled-gate stays fail-closed, and Apollo stays fallback-ineligible. It
 * does NOT touch required criteria (searchType/sector/countryCode still
 * required) — an incomplete search still blocks, as it should.
 */
export function buildLushaObservationalRegistry(): ProviderCapabilityRegistry {
  const lusha = DEFAULT_PROVIDER_REGISTRY.lusha;
  if (!lusha) return DEFAULT_PROVIDER_REGISTRY;
  return Object.freeze({
    ...DEFAULT_PROVIDER_REGISTRY,
    lusha: {
      ...lusha,
      supportedCountries: COVERAGE_ALL,
      supportedIndustries: COVERAGE_ALL,
    },
  });
}

// ── Safety assert ─────────────────────────────────────────────────────────────

/** Stable code surfaced when a resolved plan is unsafe for the Lusha path. */
export const LUSHA_ROUTING_PLAN_UNSAFE_CODE = 'LUSHA_ROUTING_PLAN_UNSAFE' as const;

/** Machine-readable reason a Lusha routing plan was rejected as unsafe. */
export type LushaRoutingUnsafeReason =
  | 'would_use_apollo'
  | 'would_use_tavily'
  | 'selected_provider_not_lusha';

/**
 * Thrown by `assertLushaRoutingPlanSafe` when the OBSERVED plan violates a Lusha
 * safety invariant (10C3: never Apollo; never Tavily; the selected provider must
 * be Lusha inside a flag-ON run). Typed so callers can react precisely and never
 * silently fall through to another provider.
 */
export class LushaRoutingPlanUnsafeError extends Error {
  readonly code = LUSHA_ROUTING_PLAN_UNSAFE_CODE;
  readonly reason: LushaRoutingUnsafeReason;
  readonly selectedProvider: string | null;

  constructor(reason: LushaRoutingUnsafeReason, selectedProvider: string | null) {
    super(
      `${LUSHA_ROUTING_PLAN_UNSAFE_CODE}: ${reason} (selectedProvider="${selectedProvider ?? 'none'}")`,
    );
    this.name = 'LushaRoutingPlanUnsafeError';
    this.reason = reason;
    this.selectedProvider = selectedProvider;
  }
}

/**
 * Assert a resolved plan is SAFE for the Lusha path. Invoked ONLY inside the
 * guard's `run()` callback (i.e. the flag is confirmed ON). Throws
 * `LushaRoutingPlanUnsafeError` when:
 *   - `wouldUseApollo` is true  — 10C3: an intended-Lusha plan must never use Apollo,
 *   - `wouldUseTavily` is true  — a Lusha intent must never divert to Tavily,
 *   - `selectedProvider !== 'lusha'` — inside a flag-ON run the plan must resolve
 *     to Lusha; anything else means the observation diverged from the live
 *     decision (a routing bug), so fail-closed rather than proceed.
 *
 * IMPORTANT (observational): `allowedToExecute === false` / `dryRunOnly` (from
 * observe/confirmation gating) is NOT unsafe and NEVER triggers a fallback — the
 * assert deliberately ignores execution gating. The live guard, not this plan,
 * executes Lusha.
 */
export function assertLushaRoutingPlanSafe(plan: ProviderRoutingPlan): void {
  if (plan.wouldUseApollo) {
    throw new LushaRoutingPlanUnsafeError('would_use_apollo', plan.selectedProvider);
  }
  if (plan.wouldUseTavily) {
    throw new LushaRoutingPlanUnsafeError('would_use_tavily', plan.selectedProvider);
  }
  if (plan.selectedProvider !== 'lusha') {
    throw new LushaRoutingPlanUnsafeError('selected_provider_not_lusha', plan.selectedProvider);
  }
}
