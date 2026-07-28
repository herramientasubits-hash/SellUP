/**
 * Q3F-5BB.11B — Pure provider routing resolver.
 *
 * `resolveProviderRoutingPlan(criteria, config, registry)` computes the ORDERED
 * routing plan [primary, ...fallbacks] for a discovery request. It is PURE:
 *   - never reads process.env (all env-derived state arrives via `config`),
 *   - never imports a provider / Supabase / HubSpot client,
 *   - never performs fetch / I/O / DB writes,
 *   - only computes a plan — it executes nothing.
 *
 * Product decisions encoded (Q3F-5BB.11A → 11B):
 *   1. mode default            → observe_only (dry-run; never executes).
 *   2. allowFallback default   → false.
 *   3. fallback rules          → Lusha→Apollo PROHIBITED always; Lusha→Tavily
 *                                not automatic; Tavily↔Apollo only inside the
 *                                default_ai context and only if config permits;
 *                                explicit/manual provider ⇒ NO fallback chain.
 *   4. minUsefulCandidates     → 5.
 *   5. cost confirmation       → required if riskLevel high OR cost unknown.
 *                                Unknown cost is NEVER treated as 0.
 *   6. manual selection        → admin-only (QA / manual_admin), no chain.
 *
 * HARD INVARIANT (inherited from 10C3):
 *   intendedProvider === 'lusha'  ⇒  wouldUseApollo === false
 * for EVERY combination of flags, mode, and allowFallback. Enforced in three
 * independent places (no Lusha fallback chain, per-step guard, final override).
 */

import { getProviderDescriptor } from './provider-registry';
import {
  COVERAGE_ALL,
  type ProviderBlockedReason,
  type ProviderCapabilityDescriptor,
  type ProviderCapabilityRegistry,
  type ProviderEstimatedCost,
  type ProviderRoutingConfig,
  type ProviderRoutingCriteria,
  type ProviderRoutingPlan,
  type ProviderRoutingPlanStep,
  type ProviderStepRole,
  type RoutingIntent,
  type RoutingProviderId,
  type RoutingRequiredCriterion,
} from './types';

/** Product default for the minimum useful candidate target. */
export const DEFAULT_MIN_USEFUL_CANDIDATES = 5;

// ============================================================
// Cost estimation
// ============================================================

/**
 * Derive a cost estimate from a descriptor's cost model. When `unitCostUsd` is
 * null the estimate is `unknown` and both USD bounds are `null` — NEVER 0.
 */
function estimateCost(descriptor: ProviderCapabilityDescriptor): ProviderEstimatedCost {
  const { costModel, riskLevel } = descriptor;
  const credits = costModel.expectedMaxCredits ?? costModel.creditsPerUnit ?? null;

  if (costModel.unitCostUsd === null) {
    return { unknown: true, usdMin: null, usdMax: null, credits, riskLevel };
  }

  const maxCredits = credits ?? 0;
  const usdMax = costModel.unitCostUsd * maxCredits;
  const usdMin = maxCredits >= 1 ? costModel.unitCostUsd : 0;
  return { unknown: false, usdMin, usdMax, credits, riskLevel };
}

/** Cost estimate used when no descriptor exists (unknown, high-risk). */
function unknownCost(): ProviderEstimatedCost {
  return { unknown: true, usdMin: null, usdMax: null, credits: null, riskLevel: 'high' };
}

// ============================================================
// Criteria / coverage predicates
// ============================================================

function criteriaHasField(
  criteria: ProviderRoutingCriteria,
  field: RoutingRequiredCriterion,
): boolean {
  switch (field) {
    case 'countryCode':
      return Boolean(criteria.countryCode && criteria.countryCode.trim());
    case 'sector':
      return Boolean(criteria.sector && criteria.sector.trim());
    case 'searchType':
      return Boolean(criteria.searchType && criteria.searchType.trim());
    // No descriptor requires these today; treated as absent (fail-closed) if ever required.
    case 'companyName':
    case 'domain':
      return false;
    default:
      return false;
  }
}

function isCountrySupported(
  descriptor: ProviderCapabilityDescriptor,
  countryCode: string | null | undefined,
): boolean {
  if (descriptor.supportedCountries === COVERAGE_ALL) return true;
  const code = countryCode?.trim().toUpperCase();
  if (!code) return false;
  return descriptor.supportedCountries.some((c) => c.toUpperCase() === code);
}

function isIndustrySupported(
  descriptor: ProviderCapabilityDescriptor,
  sector: string | null | undefined,
): boolean {
  if (descriptor.supportedIndustries === COVERAGE_ALL) return true;
  const key = sector?.trim().toLowerCase();
  if (!key) return false;
  return descriptor.supportedIndustries.some((s) => s.toLowerCase() === key);
}

/** Environment gate: which capability flag applies in the target environment. */
function isRunnableInEnvironment(
  descriptor: ProviderCapabilityDescriptor,
  environment: ProviderRoutingConfig['environment'],
): boolean {
  if (environment === 'production') return descriptor.canRunInProduction;
  // preview + development (and any non-production env) use the preview capability.
  return descriptor.canRunInPreview;
}

// ============================================================
// Step evaluation
// ============================================================

interface StepEvalInput {
  provider: RoutingProviderId;
  role: ProviderStepRole;
  order: number;
  criteria: ProviderRoutingCriteria;
  config: ProviderRoutingConfig;
  registry: ProviderCapabilityRegistry;
  /** Effective intent (already resolved for explicit overrides). */
  intent: RoutingIntent;
}

function blockedStep(
  provider: RoutingProviderId,
  role: ProviderStepRole,
  order: number,
  reason: ProviderBlockedReason,
  cost: ProviderEstimatedCost,
  notes: string[],
): ProviderRoutingPlanStep {
  return {
    provider,
    role,
    order,
    status: 'blocked',
    blockedReason: reason,
    requiresUserConfirmation: false,
    estimatedCost: cost,
    notes,
  };
}

/**
 * Evaluate a single provider as a plan step. Pure. Never selects a step it is
 * not allowed to; a "selected" step may still require confirmation (execution
 * is gated separately at the plan level).
 */
function evaluateStep(input: StepEvalInput): ProviderRoutingPlanStep {
  const { provider, role, order, criteria, config, registry, intent } = input;
  const notes: string[] = [];

  const descriptor = getProviderDescriptor(registry, provider);
  if (!descriptor) {
    return blockedStep(provider, role, order, 'unknown_provider', unknownCost(), [
      `no descriptor for provider "${provider}"`,
    ]);
  }

  const cost = estimateCost(descriptor);

  // ── 10C3 hard guard (defensive): a Lusha intent can never route to Apollo ──
  if (intent === 'lusha' && provider === 'apollo') {
    return blockedStep(
      provider,
      role,
      order,
      'fallback_forbidden_lusha_to_apollo',
      cost,
      ['10C3 invariant: intended Lusha must never route to Apollo'],
    );
  }

  // ── Fallback eligibility (registry-level 10C3 guard) ──
  if (role === 'fallback' && !descriptor.fallbackEligible) {
    return blockedStep(provider, role, order, 'fallback_not_eligible', cost, [
      `provider "${provider}" is not an eligible automatic fallback target`,
    ]);
  }

  // ── Environment gate ──
  if (!isRunnableInEnvironment(descriptor, config.environment)) {
    return blockedStep(provider, role, order, 'not_runnable_in_environment', cost, [
      `provider "${provider}" cannot run in environment "${config.environment}"`,
    ]);
  }

  // ── Enabled gate (fail-closed) ──
  const enabled = config.enabledProviders[provider] === true;
  if (!enabled) {
    const reason: ProviderBlockedReason =
      provider === 'lusha' ? 'lusha_preview_disabled' : 'provider_disabled';
    return blockedStep(provider, role, order, reason, cost, [
      `provider "${provider}" is disabled by config (fail-closed)`,
    ]);
  }

  // ── Required criteria ──
  const missing = descriptor.requiredCriteria.filter((c) => !criteriaHasField(criteria, c));
  if (missing.length > 0) {
    return blockedStep(provider, role, order, 'missing_required_criteria', cost, [
      `missing required criteria: ${missing.join(', ')}`,
    ]);
  }

  // ── Coverage ──
  if (!isCountrySupported(descriptor, criteria.countryCode)) {
    return blockedStep(provider, role, order, 'unsupported_country', cost, [
      `country "${criteria.countryCode ?? ''}" not supported by "${provider}"`,
    ]);
  }
  if (!isIndustrySupported(descriptor, criteria.sector)) {
    return blockedStep(provider, role, order, 'unsupported_industry', cost, [
      `sector "${criteria.sector ?? ''}" not supported by "${provider}"`,
    ]);
  }

  // ── Capabilities ──
  if (
    (criteria.needsCompanySearch && !descriptor.supportsCompanySearch) ||
    (criteria.needsPeopleSearch && !descriptor.supportsPeopleSearch) ||
    (criteria.needsEnrichment && !descriptor.supportsEnrichment)
  ) {
    return blockedStep(provider, role, order, 'capability_unsupported', cost, [
      `provider "${provider}" lacks a requested capability`,
    ]);
  }

  // ── Eligible. Determine confirmation requirement. ──
  let requiresUserConfirmation = false;
  if (cost.unknown) {
    requiresUserConfirmation = true;
    notes.push('cost unknown → confirmation required (never treated as free)');
  } else if (descriptor.riskLevel === 'high') {
    requiresUserConfirmation = true;
    notes.push('high risk provider → confirmation required');
  } else if (config.requireCostConfirmation) {
    requiresUserConfirmation = true;
    notes.push('config requires cost confirmation');
  }

  // Controlled fallback is high-risk and deferred (11G) → always confirm.
  if (role === 'fallback') {
    requiresUserConfirmation = true;
    notes.push('fallback step → confirmation required (controlled fallback)');
  }

  return {
    provider,
    role,
    order,
    status: 'selected',
    blockedReason: null,
    requiresUserConfirmation,
    estimatedCost: cost,
    notes,
  };
}

// ============================================================
// Primary / fallback resolution
// ============================================================

/** Resolve the concrete primary provider for an intent. Never returns null. */
function resolvePrimaryProvider(
  intent: RoutingIntent,
  config: ProviderRoutingConfig,
): RoutingProviderId {
  if (intent === 'default_ai') {
    return config.defaultAiProvider ?? 'tavily';
  }
  return intent;
}

/**
 * Build the ordered fallback steps. Returns `[]` unless ALL of these hold:
 *   - no explicit provider selection (explicit ⇒ no chain),
 *   - `allowFallback` is true,
 *   - the intent is `'default_ai'` (Lusha / concrete-provider intents never chain),
 *   - `fallbackChain` lists candidates.
 * Apollo is filtered out at the step level (`fallbackEligible === false`).
 */
function buildFallbackSteps(
  intent: RoutingIntent,
  primaryProvider: RoutingProviderId,
  criteria: ProviderRoutingCriteria,
  config: ProviderRoutingConfig,
  registry: ProviderCapabilityRegistry,
  diagnostics: string[],
): ProviderRoutingPlanStep[] {
  if (config.explicitProvider) {
    diagnostics.push('fallback_suppressed: explicit provider selection');
    return [];
  }
  if (!config.allowFallback) {
    diagnostics.push('fallback_suppressed: allowFallback=false');
    return [];
  }
  if (intent === 'lusha') {
    diagnostics.push('fallback_suppressed: Lusha intent never chains (10C3)');
    return [];
  }
  if (intent !== 'default_ai') {
    diagnostics.push(`fallback_suppressed: intent "${intent}" does not permit a chain`);
    return [];
  }

  const chain = config.fallbackChain ?? [];
  const steps: ProviderRoutingPlanStep[] = [];
  let order = 1;
  const seen = new Set<string>([primaryProvider]);

  for (const provider of chain) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    steps.push(
      evaluateStep({ provider, role: 'fallback', order, criteria, config, registry, intent }),
    );
    order += 1;
  }

  return steps;
}

// ============================================================
// Public resolver
// ============================================================

/**
 * Compute the ordered routing plan for a discovery request. Pure — see the file
 * header for the guarantees and encoded product decisions.
 */
export function resolveProviderRoutingPlan(
  criteria: ProviderRoutingCriteria,
  config: ProviderRoutingConfig,
  registry: ProviderCapabilityRegistry,
): ProviderRoutingPlan {
  const diagnostics: string[] = [];

  // 1. Effective intent — an explicit (admin) selection overrides the criteria.
  const explicit = config.explicitProvider ?? null;
  const effectiveIntent: RoutingIntent = explicit ?? criteria.intendedProvider;
  if (explicit) {
    diagnostics.push(
      `explicit provider "${explicit}" (${config.explicitProviderSource ?? 'unspecified'}) — no fallback chain`,
    );
  }

  // 2. Primary provider + step.
  const primaryProvider = resolvePrimaryProvider(effectiveIntent, config);
  const primaryStep = evaluateStep({
    provider: primaryProvider,
    role: 'primary',
    order: 0,
    criteria,
    config,
    registry,
    intent: effectiveIntent,
  });

  // 3. Fallback steps (may be empty).
  const fallbackSteps = buildFallbackSteps(
    effectiveIntent,
    primaryProvider,
    criteria,
    config,
    registry,
    diagnostics,
  );

  const steps: ProviderRoutingPlanStep[] = [primaryStep, ...fallbackSteps];

  // 4. Selected provider = first step that is actually selectable.
  const selectedStep = steps.find((s) => s.status === 'selected') ?? null;
  const selectedProvider = selectedStep?.provider ?? null;

  // 5. Would-use flags (from SELECTED steps only).
  let wouldUseLusha = steps.some((s) => s.provider === 'lusha' && s.status === 'selected');
  let wouldUseApollo = steps.some((s) => s.provider === 'apollo' && s.status === 'selected');
  const wouldUseTavily = steps.some((s) => s.provider === 'tavily' && s.status === 'selected');

  // 6. HARD 10C3 override — belt-and-suspenders. An effective Lusha intent can
  //    NEVER use Apollo, regardless of anything above.
  if (effectiveIntent === 'lusha') {
    wouldUseApollo = false;
  }
  // Consistency guard: `wouldUseLusha` must reflect a selected Lusha step.
  wouldUseLusha = wouldUseLusha && steps.some((s) => s.provider === 'lusha' && s.status === 'selected');

  // 7. Execution gating.
  const dryRunOnly = config.mode === 'observe_only';
  const requiresUserConfirmation = selectedStep?.requiresUserConfirmation ?? false;
  const allowedToExecute =
    config.mode === 'automatic' && selectedProvider !== null && !requiresUserConfirmation;

  const blockedReason = selectedProvider === null ? primaryStep.blockedReason : null;
  const estimatedCost = (selectedStep ?? primaryStep).estimatedCost;

  return {
    intendedProvider: criteria.intendedProvider,
    mode: config.mode,
    selectedProvider,
    wouldUseLusha,
    wouldUseApollo,
    wouldUseTavily,
    allowedToExecute,
    dryRunOnly,
    requiresUserConfirmation,
    blockedReason,
    steps,
    fallbackChain: fallbackSteps,
    estimatedCost,
    invariants: {
      lushaNeverFallsBackToApollo: true,
      unknownCostNeverTreatedAsZero: true,
    },
    diagnostics,
  };
}
