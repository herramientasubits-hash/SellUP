/**
 * Q3F-5BB.11B — Pure multi-provider routing plan contract.
 *
 * These are the pure types for the provider-routing CORE defined by the
 * Q3F-5BB.11A design. They describe HOW a decided plan looks — which provider
 * would run, whether a fallback exists, what it would cost, and whether it may
 * execute — WITHOUT touching env, DB, network, or any provider client.
 *
 * SCOPE (this slice ONLY): pure types + a declarative registry + a pure
 * resolver + tests. Nothing here is wired to the live wizard. It never runs
 * Lusha / Apollo / Tavily, never reads process.env, never writes the DB.
 *
 * ── Naming / mapping notes (required by 11A) ────────────────────────────────
 * The codebase already defines two provider concepts. This module reuses /
 * relates to them explicitly rather than inventing a colliding third:
 *
 *   - `ProspectIntakeProvider` (src/server/agents/prospect-intake/types.ts) —
 *     the SOURCE-identity enum ('lusha'|'apollo'|'tavily'|'web_ai'|(string&{})).
 *     `RoutingProviderId` is an ALIAS of it: the routing plan speaks the same
 *     provider vocabulary as the intake layer it feeds.
 *
 *   - `ProspectDiscoveryProvider`
 *     (src/modules/prospect-batches/prospect-discovery-provider.ts) — the
 *     Lusha-vs-default decision enum ('lusha'|'blocked_lusha_disabled'|
 *     'default_ai'). We do NOT reuse that type here; instead `RoutingIntent`
 *     adds a `'default_ai'` arm on top of `RoutingProviderId` so the plan can
 *     express "the caller did not intend a specific provider" without
 *     overloading the existing three-state Lusha decision.
 */

import type { ProspectIntakeProvider } from '@/server/agents/prospect-intake/types';

// ============================================================
// Provider identity
// ============================================================

/**
 * Which provider a routing step refers to. Alias of `ProspectIntakeProvider`
 * so the plan and the intake layer share one vocabulary.
 */
export type RoutingProviderId = ProspectIntakeProvider;

/**
 * The caller's intent. Either a concrete provider the caller wants to run, or
 * `'default_ai'` meaning "no specific provider intended — use the default
 * Agent 1 generation path (Tavily / Apollo per config)".
 */
export type RoutingIntent = RoutingProviderId | 'default_ai';

// ============================================================
// Cost model (registry-level, static)
// ============================================================

/**
 * Pricing status for a provider. `unknown` and `pending_provider_pricing_config`
 * both mean "USD cost is NOT authoritatively known" — such costs are NEVER
 * treated as zero (see `ProviderEstimatedCost.unknown`).
 */
export type ProviderPricingStatus =
  | 'known'
  | 'unknown'
  | 'pending_provider_pricing_config';

/**
 * Declarative cost shape for a provider. `unitCostUsd === null` means the USD
 * price is not authorized / not configured — the resolver must surface this as
 * `unknown`, never as 0.
 */
export interface ProviderCostModel {
  /** Provider credits consumed per billable unit (page / request). null = unknown. */
  creditsPerUnit: number | null;
  /** Results returned per credit (e.g. Lusha 10, Apollo 1). null = unknown. */
  resultsPerCredit: number | null;
  /** Structural anti-runaway cap on billable units per run. null = uncapped. */
  maxBillableUnits: number | null;
  /** Expected worst-case credits for a single run. null = unknown. */
  expectedMaxCredits: number | null;
  /** Authoritative USD cost per credit. null = UNKNOWN — never treat as 0. */
  unitCostUsd: number | null;
  /** ISO currency for `unitCostUsd`. */
  currency: 'USD';
  /** Whether/why the USD cost is authoritative. */
  pricingStatus: ProviderPricingStatus;
}

// ============================================================
// Capability descriptor (registry entry)
// ============================================================

/**
 * Sentinel for "all countries / all industries supported" (no allowlist).
 * Kept distinct from an empty array, which means "nothing supported".
 */
export const COVERAGE_ALL = 'all' as const;
export type CoverageAll = typeof COVERAGE_ALL;

/** Named criteria fields a provider may require to run. */
export type RoutingRequiredCriterion =
  | 'countryCode'
  | 'sector'
  | 'searchType'
  | 'companyName'
  | 'domain';

/** Static risk classification for a provider (drives confirmation gating). */
export type ProviderRiskLevel = 'low' | 'medium' | 'high';

/**
 * A declarative description of one provider's capabilities. This is DATA, not
 * behavior — the resolver reads it but the descriptor never reads env or runs
 * anything. `enabledFlag` is only the NAME of the env flag that governs the
 * provider; the RESOLVED on/off state arrives via `ProviderRoutingConfig`.
 */
export interface ProviderCapabilityDescriptor {
  id: RoutingProviderId;
  label: string;
  /** Name of the env flag governing this provider (informational). null = none. */
  enabledFlag: string | null;

  canRunInProduction: boolean;
  canRunInPreview: boolean;

  supportsCompanySearch: boolean;
  supportsPeopleSearch: boolean;
  supportsEnrichment: boolean;

  /** ISO2 country allowlist, or `COVERAGE_ALL` when unrestricted. */
  supportedCountries: readonly string[] | CoverageAll;
  /** Sector-key allowlist, or `COVERAGE_ALL` when unrestricted. */
  supportedIndustries: readonly string[] | CoverageAll;

  requiredCriteria: readonly RoutingRequiredCriterion[];

  costModel: ProviderCostModel;

  /**
   * Whether this provider MAY EVER be used as an automatic fallback target.
   * Apollo is `false`: the 10C3 invariant forbids any silent fall-through to
   * Apollo. Fallback is additionally gated by config (`allowFallback`,
   * `fallbackChain`) and the intent (Lusha never chains).
   */
  fallbackEligible: boolean;

  riskLevel: ProviderRiskLevel;
}

/** The registry: a lookup from provider id to its capability descriptor. */
export type ProviderCapabilityRegistry = Readonly<
  Partial<Record<RoutingProviderId, ProviderCapabilityDescriptor>>
>;

// ============================================================
// Resolver INPUT — criteria
// ============================================================

/**
 * The search intent for which a plan is being resolved. Provider-neutral and
 * pre-resolved: the caller has already decided `intendedProvider` (e.g. from
 * the Lusha eligibility decision) before calling the resolver.
 */
export interface ProviderRoutingCriteria {
  /** What the caller intends to run. `'default_ai'` = no specific provider. */
  intendedProvider: RoutingIntent;
  /** Search shape (e.g. 'companies_by_criteria'). */
  searchType?: string | null;
  /** ISO2 country code of the search, if any. */
  countryCode?: string | null;
  /** Mapped sector key of the search, if any. */
  sector?: string | null;

  needsCompanySearch?: boolean;
  needsPeopleSearch?: boolean;
  needsEnrichment?: boolean;
}

// ============================================================
// Resolver INPUT — config (resolved server-side; NEVER read from env here)
// ============================================================

/**
 * Routing mode.
 *   - `observe_only` — plan is computed for observation; nothing may execute
 *     (dry-run). This is the product DEFAULT.
 *   - `manual`       — an operator/admin explicitly picks a provider; no chain.
 *   - `automatic`    — the plan MAY execute if allowed (future, gated).
 */
export type ProviderRoutingMode = 'observe_only' | 'manual' | 'automatic';

/** Runtime environment the plan targets (used only for capability gating). */
export type ProviderRoutingEnvironment =
  | 'production'
  | 'preview'
  | 'development'
  | (string & {});

/** How an explicit provider selection was made (both are admin-only paths). */
export type ExplicitProviderSource = 'qa' | 'manual_admin';

/**
 * The RESOLVED routing configuration. Every env-dependent value (which flags
 * are on, which environment) has already been read server-side by the caller
 * and is passed in here. The resolver itself never reads env.
 */
export interface ProviderRoutingConfig {
  /** Default: `observe_only`. */
  mode: ProviderRoutingMode;

  /** Default: `false`. Opt-in gate for any automatic fallback. */
  allowFallback: boolean;

  /** Minimum useful candidates before a run is considered sufficient. Default: 5. */
  minUsefulCandidates: number;

  /**
   * Resolved provider on/off map (from env flags, read server-side). A provider
   * absent or `false` here is treated as DISABLED → fail-closed.
   */
  enabledProviders: Readonly<Partial<Record<RoutingProviderId, boolean>>>;

  /** Target environment (for `canRunInProduction` / `canRunInPreview` gating). */
  environment: ProviderRoutingEnvironment;

  /**
   * The `'default_ai'` primary provider the caller permits (e.g. resolved from
   * AGENT1_WIZARD_DISCOVERY_PROVIDER). Only consulted when the intent is
   * `'default_ai'`. Defaults to `'tavily'` when omitted.
   */
  defaultAiProvider?: RoutingProviderId | null;

  /**
   * The ordered fallback chain the caller EXPLICITLY permits. Only honored in
   * the `'default_ai'` context, only if `allowFallback` is true, and never for
   * Apollo under a Lusha intent (10C3). Empty / omitted = no fallback.
   */
  fallbackChain?: readonly RoutingProviderId[];

  /**
   * An explicit provider selection (admin-only: QA or manual). When set, the
   * plan uses exactly this provider and NEVER builds a fallback chain.
   */
  explicitProvider?: RoutingProviderId | null;
  explicitProviderSource?: ExplicitProviderSource | null;

  /** Force cost confirmation even for known/low-risk providers. Default: false. */
  requireCostConfirmation?: boolean;
}

// ============================================================
// Resolver OUTPUT — plan
// ============================================================

/** Why a given step cannot be selected / executed. */
export type ProviderBlockedReason =
  | 'unknown_provider'
  | 'provider_disabled'
  | 'lusha_preview_disabled'
  | 'not_runnable_in_environment'
  | 'missing_required_criteria'
  | 'unsupported_country'
  | 'unsupported_industry'
  | 'capability_unsupported'
  | 'fallback_disabled'
  | 'fallback_not_eligible'
  | 'fallback_forbidden_lusha_to_apollo'
  | 'explicit_provider_no_fallback'
  | 'cost_confirmation_required'
  | 'cost_unknown_confirmation_required'
  | 'high_risk_confirmation_required'
  | 'no_provider_intended';

/** Role of a step within the ordered plan. */
export type ProviderStepRole = 'primary' | 'fallback';

/** Outcome of evaluating a step (no execution happens — this is a plan). */
export type ProviderStepStatus = 'selected' | 'blocked' | 'skipped';

/**
 * A cost estimate for a single provider step. `unknown === true` means the USD
 * amount could not be derived from an authoritative price; in that case
 * `usdMin`/`usdMax` are `null` and MUST NOT be interpreted as 0.
 */
export interface ProviderEstimatedCost {
  unknown: boolean;
  usdMin: number | null;
  usdMax: number | null;
  credits: number | null;
  riskLevel: ProviderRiskLevel;
}

/** One ordered step of the routing plan (primary or a fallback candidate). */
export interface ProviderRoutingPlanStep {
  provider: RoutingProviderId;
  role: ProviderStepRole;
  order: number;
  status: ProviderStepStatus;
  blockedReason: ProviderBlockedReason | null;
  requiresUserConfirmation: boolean;
  estimatedCost: ProviderEstimatedCost;
  notes: string[];
}

/**
 * Compile-time-fixed invariant markers carried on every plan. These are always
 * the literal values shown — they document the guarantees the resolver upholds
 * and let tests/telemetry assert on a stable shape.
 */
export interface ProviderRoutingInvariants {
  /** 10C3: an intended-Lusha plan never routes to Apollo. Always `true`. */
  lushaNeverFallsBackToApollo: true;
  /** Unknown cost is never treated as free. Always `true`. */
  unknownCostNeverTreatedAsZero: true;
}

/**
 * The resolved routing plan. Ordered `steps` = [primary, ...fallbacks].
 * `selectedProvider` is the provider that WOULD run first (null when the
 * primary is blocked and fail-closed). This is a PLAN only: `allowedToExecute`
 * being false / `dryRunOnly` being true means nothing runs.
 */
export interface ProviderRoutingPlan {
  intendedProvider: RoutingIntent;
  mode: ProviderRoutingMode;

  selectedProvider: RoutingProviderId | null;

  wouldUseLusha: boolean;
  wouldUseApollo: boolean;
  wouldUseTavily: boolean;

  allowedToExecute: boolean;
  dryRunOnly: boolean;
  requiresUserConfirmation: boolean;

  /** Reason the primary is blocked (null when a primary was selected). */
  blockedReason: ProviderBlockedReason | null;

  /** Ordered plan: index 0 is the primary, the rest are fallback candidates. */
  steps: ProviderRoutingPlanStep[];
  /** Convenience view of just the fallback steps (subset of `steps`). */
  fallbackChain: ProviderRoutingPlanStep[];

  /** Cost estimate for the selected provider (or the primary step's estimate). */
  estimatedCost: ProviderEstimatedCost;

  invariants: ProviderRoutingInvariants;
  diagnostics: string[];
}

// ============================================================
// Post-run observation (type only — not produced by the resolver)
// ============================================================

/** Technical outcome of an executed provider attempt (future use). */
export type ProviderRunStatus = 'success' | 'error' | 'skipped' | 'not_executed';

/**
 * The result of a provider run. Defined here for the future execution layer;
 * the pure resolver NEVER produces one (it does not execute anything).
 */
export interface ProviderRunResult {
  provider: RoutingProviderId;
  status: ProviderRunStatus;
  usefulCandidateCount: number;
  creditsSpent: number | null;
  /** null = unknown USD spend — never assume 0. */
  usdSpent: number | null;
  error: string | null;
}
