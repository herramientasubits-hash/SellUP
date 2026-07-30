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
 * the reservation never accounted for (the QA batch was charged 4 against a
 * reservation of 3). The estimate now comes from apollo-operation-pricing, the
 * single pricing source shared by estimation, guardrails, usage logging and
 * reconciliation — no `3`, no `+ 1`, no `3 + 1` hardcoded here.
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
} from '@/lib/feature-flags.server';

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
 * budget. When it is ON, its run-level cap is reserved up front.
 */
export function resolveApolloRunCreditBreakdown(): ApolloRunCreditBreakdown {
  return estimateApolloRunCreditBreakdown({
    maxQueriesPerRun: resolveApolloMaxQueriesPerRun(),
    maxResultsPerQuery: resolveApolloMaxResultsPerQuery(),
    maxEnrichmentsPerRun: resolveApolloMaxEnrichmentsPerRun(),
    enrichmentEnabled: isApolloOrganizationEnrichmentCascadeEnabled(),
  });
}

export type WizardBudgetValidationResult = {
  provider: WizardDiscoveryProviderKey;
  estimatedCredits: number;
  estimateSource: 'apollo_cost_guardrails' | 'tavily_adaptive_pipeline';
  /** Apollo credit breakdown (search vs enrichment). Null for non-Apollo providers. */
  apolloCreditBreakdown: ApolloRunCreditBreakdown | null;
  /** Resolved Apollo queries cap (only meaningful when provider = apollo_organizations) */
  apolloMaxQueriesPerRun: number | null;
  /** Resolved Apollo results cap (only meaningful when provider = apollo_organizations) */
  apolloMaxResultsPerQuery: number | null;
  availableCredits: number;
  maxCreditsPerExecution: number;
  passed: boolean;
  blockReason: 'exceeds_max_credits_per_execution' | 'insufficient_available_budget' | null;
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

  if (provider === 'apollo_organizations') {
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
    apolloMaxQueriesPerRun,
    apolloMaxResultsPerQuery,
    availableCredits,
    maxCreditsPerExecution,
  };

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
