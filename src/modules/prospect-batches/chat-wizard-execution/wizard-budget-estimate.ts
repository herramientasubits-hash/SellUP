/**
 * wizard-budget-estimate.ts — Provider-aware credit estimation for wizard preflight.
 *
 * Resolves how many credits to reserve depending on the active discovery provider.
 * Apollo estimation uses apollo-cost-guardrails (env-configured, hard-capped).
 * Tavily estimation uses the adaptive pipeline config (4 rounds × 5 queries = 20).
 *
 * v1.16K-AG: Before this file, the wizard always reserved 20 credits regardless of
 * provider, causing Apollo executions with available=12 to be blocked even when the
 * actual Apollo ceiling was only 3 credits (1 query × 3 results).
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1: the Apollo estimate covered Organization
 * Search only. A run that also enriches spends Organization Enrichment credits
 * the reservation never accounted for — the QA batch was charged 4 against a
 * reservation of 3. The estimate now comes from apollo-operation-pricing, the
 * single pricing source shared by estimation, guardrails, usage logging and
 * reconciliation. No `3`, no `+ 1`, no `3 + 1` hardcoded here.
 *
 * Server-only. Never import from client components.
 */

import { estimateWizardAdaptiveMaxCredits } from './wizard-budget-reconciliation';
import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';
import {
  estimateApolloRunCreditBreakdown,
  toApolloRunCreditBreakdownMetadata,
  type ApolloRunCreditBreakdown,
  type ApolloRunCreditBreakdownMetadata,
} from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import {
  isApolloOrganizationEnrichmentCascadeEnabled,
  resolveApolloMaxEnrichmentsPerRun,
  isApolloTwoRoundDiscoveryEnabled,
} from '@/lib/feature-flags.server';
// A1-APOLLO-TWO-ROUND-QUALITY-1 § 10 — presupuesto del peor caso de dos rondas.
import {
  estimateApolloTwoRoundBudget,
  evaluateApolloTwoRoundBudgetPreflight,
  toApolloTwoRoundBudgetMetadata,
  BUDGET_EXCEEDED_TWO_ROUND_APOLLO,
  type ApolloTwoRoundBudgetBreakdown,
} from '@/server/agents/prospecting-toolkit/apollo-two-round';
import { resolveApolloTwoRoundConfigValues } from '@/server/agents/prospecting-toolkit/apollo-two-round/env.server';

// Re-exported so callers don't need to import apollo-cost-guardrails directly.
import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
  APOLLO_MAX_QUERIES_DEFAULT,
  APOLLO_MAX_RESULTS_DEFAULT,
  APOLLO_MAX_QUERIES_HARD_CAP,
  APOLLO_MAX_RESULTS_HARD_CAP,
} from '@/server/agents/prospecting-toolkit/apollo-cost-guardrails';

/**
 * Resolves the full Apollo credit breakdown for the current environment.
 *
 * Enrichment credits are reserved only when the cascade flag is ON: a disabled
 * cascade cannot issue an enrichment call, so reserving for it would over-hold
 * budget. When it is ON, its run-level cap is reserved up front — which is
 * exactly what the QA batch was missing.
 */
export function resolveApolloRunCreditBreakdown(): ApolloRunCreditBreakdown {
  return estimateApolloRunCreditBreakdown({
    maxQueriesPerRun: resolveApolloMaxQueriesPerRun(),
    maxResultsPerQuery: resolveApolloMaxResultsPerQuery(),
    maxEnrichmentsPerRun: resolveApolloMaxEnrichmentsPerRun(),
    enrichmentEnabled: isApolloOrganizationEnrichmentCascadeEnabled(),
  });
}

/**
 * A1-APOLLO-TWO-ROUND-QUALITY-1 § 10 — presupuesto de la modalidad de dos
 * rondas.
 *
 * Reserva el PEOR caso permitido (5 + 5 búsqueda + 2 enrichment = 12 con los
 * defaults), no el caso esperado. Una corrida que no puede cubrir su máximo
 * autorizado no debe empezar: no existe reserva parcial que la deje sin
 * cobertura a mitad de la ronda 2.
 */
export function resolveApolloTwoRoundCreditEstimate(): {
  enabled: boolean;
  breakdown: ApolloTwoRoundBudgetBreakdown | null;
  estimatedCredits: number | null;
} {
  if (!isApolloTwoRoundDiscoveryEnabled()) {
    return { enabled: false, breakdown: null, estimatedCredits: null };
  }
  const breakdown = estimateApolloTwoRoundBudget(resolveApolloTwoRoundConfigValues());
  return {
    enabled: true,
    breakdown,
    estimatedCredits: breakdown.maximumInternalRecordedCredits,
  };
}

export type WizardBudgetValidationResult = {
  provider: WizardDiscoveryProviderKey;
  estimatedCredits: number;
  estimateSource:
    | 'apollo_cost_guardrails'
    | 'tavily_adaptive_pipeline'
    | 'apollo_two_round_worst_case';
  /**
   * Desglose del peor caso de dos rondas. Null cuando la modalidad está apagada
   * o el proveedor no es Apollo.
   */
  apolloTwoRoundBreakdown: ApolloTwoRoundBudgetBreakdown | null;
  /** Apollo search/enrichment credit split. Null for non-Apollo providers. */
  apolloCreditBreakdown: ApolloRunCreditBreakdown | null;
  /** Resolved Apollo queries cap (only meaningful when provider = apollo_organizations) */
  apolloMaxQueriesPerRun: number | null;
  /** Resolved Apollo results cap (only meaningful when provider = apollo_organizations) */
  apolloMaxResultsPerQuery: number | null;
  availableCredits: number;
  maxCreditsPerExecution: number;
  passed: boolean;
  blockReason:
    | 'exceeds_max_credits_per_execution'
    | 'insufficient_available_budget'
    /** § 10 — estado explicativo propio de la modalidad de dos rondas. */
    | typeof BUDGET_EXCEEDED_TWO_ROUND_APOLLO
    | null;
};

export type WizardBudgetEstimateInput = {
  provider: WizardDiscoveryProviderKey;
  availableCredits: number;
  maxCreditsPerExecution: number;
};

/**
 * Returns a provider-aware budget validation result for wizard preflight.
 *
 * For Apollo: estimate = resolvedMaxQueries × resolvedMaxResults × 1 credit/result.
 *   Hard caps apply: queries ≤ 3, results ≤ 5 → ceiling 15 credits.
 *   Defaults: 1 query × 3 results = 3 credits.
 *
 * For Tavily: estimate = estimateWizardAdaptiveMaxCredits() = 20.
 *
 * Block precedence: max_per_execution checked first, then available budget.
 */
export function resolveWizardExecutionCreditEstimate(
  input: WizardBudgetEstimateInput,
): WizardBudgetValidationResult {
  const { provider, availableCredits, maxCreditsPerExecution } = input;

  let estimatedCredits: number;
  let estimateSource: WizardBudgetValidationResult['estimateSource'];
  let apolloMaxQueriesPerRun: number | null = null;
  let apolloMaxResultsPerQuery: number | null = null;
  let apolloCreditBreakdown: ApolloRunCreditBreakdown | null = null;
  let apolloTwoRoundBreakdown: ApolloTwoRoundBudgetBreakdown | null = null;

  const twoRound =
    provider === 'apollo_organizations'
      ? resolveApolloTwoRoundCreditEstimate()
      : { enabled: false, breakdown: null, estimatedCredits: null };

  if (provider === 'apollo_organizations' && twoRound.enabled && twoRound.breakdown) {
    // § 10 — la modalidad de dos rondas tiene su propio peor caso, y es el que
    // manda: los guardrails legacy describen una corrida de otra forma.
    apolloTwoRoundBreakdown = twoRound.breakdown;
    apolloMaxResultsPerQuery = twoRound.breakdown.config.maxResultsPerRound;
    apolloMaxQueriesPerRun = twoRound.breakdown.config.maxRounds;
    estimatedCredits = twoRound.breakdown.maximumInternalRecordedCredits;
    estimateSource = 'apollo_two_round_worst_case';
  } else if (provider === 'apollo_organizations') {
    apolloCreditBreakdown = resolveApolloRunCreditBreakdown();
    apolloMaxQueriesPerRun = apolloCreditBreakdown.inputs.maxQueriesPerRun;
    apolloMaxResultsPerQuery = apolloCreditBreakdown.inputs.maxResultsPerQuery;
    estimatedCredits = apolloCreditBreakdown.totalReservedCredits;
    estimateSource = 'apollo_cost_guardrails';
  } else {
    estimatedCredits = estimateWizardAdaptiveMaxCredits();
    estimateSource = 'tavily_adaptive_pipeline';
  }

  const base = {
    provider,
    estimatedCredits,
    estimateSource,
    apolloCreditBreakdown,
    apolloTwoRoundBreakdown,
    apolloMaxQueriesPerRun,
    apolloMaxResultsPerQuery,
    availableCredits,
    maxCreditsPerExecution,
  };

  // § 10 — en la modalidad de dos rondas, cualquiera de los dos bloqueos se
  // reporta con el estado explicativo propio: quien lea el resultado necesita
  // saber que fue el techo de esta modalidad y no el guardrail legacy.
  if (twoRound.enabled && apolloTwoRoundBreakdown) {
    const preflight = evaluateApolloTwoRoundBudgetPreflight({
      config: apolloTwoRoundBreakdown.config,
      availableCredits,
      maxCreditsPerExecution,
    });
    if (!preflight.passed) {
      return { ...base, passed: false, blockReason: preflight.blockReason };
    }
    return { ...base, passed: true, blockReason: null };
  }

  // Block precedence: max_per_execution first, then available budget.
  if (estimatedCredits > maxCreditsPerExecution) {
    return { ...base, passed: false, blockReason: 'exceeds_max_credits_per_execution' };
  }

  if (estimatedCredits > availableCredits) {
    return { ...base, passed: false, blockReason: 'insufficient_available_budget' };
  }

  return { ...base, passed: true, blockReason: null };
}

// ── Diagnostic metadata shape (no secrets) ───────────────────────────────────

export type WizardBudgetValidationMetadata = {
  provider: WizardDiscoveryProviderKey;
  estimated_credits: number;
  estimate_source: string;
  apollo_credit_breakdown: ApolloRunCreditBreakdownMetadata | null;
  /** § 10 — desglose del peor caso de dos rondas. Null cuando no aplica. */
  apollo_two_round_budget: Record<string, unknown> | null;
  apollo_max_queries_per_run: number | null;
  apollo_max_results_per_query: number | null;
  available_credits: number;
  max_credits_per_execution: number;
  passed: boolean;
  block_reason: string | null;
};

/**
 * Converts the validation result to the metadata shape used in wizard logs.
 * No secrets, no env raw values, no tokens.
 */
export function toWizardBudgetValidationMetadata(
  result: WizardBudgetValidationResult,
): WizardBudgetValidationMetadata {
  return {
    provider: result.provider,
    estimated_credits: result.estimatedCredits,
    estimate_source: result.estimateSource,
    apollo_credit_breakdown: result.apolloCreditBreakdown
      ? toApolloRunCreditBreakdownMetadata(result.apolloCreditBreakdown)
      : null,
    apollo_two_round_budget: result.apolloTwoRoundBreakdown
      ? toApolloTwoRoundBudgetMetadata(result.apolloTwoRoundBreakdown)
      : null,
    apollo_max_queries_per_run: result.apolloMaxQueriesPerRun,
    apollo_max_results_per_query: result.apolloMaxResultsPerQuery,
    available_credits: result.availableCredits,
    max_credits_per_execution: result.maxCreditsPerExecution,
    passed: result.passed,
    block_reason: result.blockReason,
  };
}

/**
 * Returns just the estimated credit count for a provider.
 * Convenience wrapper for callers that only need the number (e.g., the wizard action).
 */
export function estimateCreditsForProvider(provider: WizardDiscoveryProviderKey): number {
  if (provider === 'apollo_organizations') {
    // § 10 — con la modalidad de dos rondas activa se reserva su peor caso, que
    // incluye la segunda búsqueda y los dos enrichments. Reservar el desglose
    // legacy dejaría a la ronda 2 sin cobertura.
    const twoRound = resolveApolloTwoRoundCreditEstimate();
    if (twoRound.estimatedCredits !== null) return twoRound.estimatedCredits;
    return resolveApolloRunCreditBreakdown().totalReservedCredits;
  }
  return estimateWizardAdaptiveMaxCredits();
}

// ── Apollo hard cap reference (exported for tests) ───────────────────────────
export {
  APOLLO_MAX_QUERIES_DEFAULT,
  APOLLO_MAX_RESULTS_DEFAULT,
  APOLLO_MAX_QUERIES_HARD_CAP,
  APOLLO_MAX_RESULTS_HARD_CAP,
};
