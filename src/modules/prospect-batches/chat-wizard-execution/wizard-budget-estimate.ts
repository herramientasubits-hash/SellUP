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
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§5): that Apollo ceiling covered ONLY
 * `organizations_search`. `organization_enrichment` charges its own credits and was
 * outside the reservation, so the controlled-pilot configuration reserved 3 and
 * recorded 4 (batch 7a75df68-aaa2-4558-9118-0846486a3e97). The estimate now covers
 * every Apollo operation the run can register, derived from the shared pricing
 * module — the `3 + 1` is never hardcoded here.
 *
 * Server-only. Never import from client components.
 */

import { estimateWizardAdaptiveMaxCredits } from './wizard-budget-reconciliation';
import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';
import {
  isApolloOrganizationEnrichmentCascadeEnabled,
  resolveApolloMaxEnrichmentsPerRun,
} from '@/lib/feature-flags.server';
import {
  resolveApolloRunReservationBreakdown,
  toApolloReservationBreakdownMetadata,
  type ApolloRunReservationBreakdown,
} from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';

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
 * Resolves the full Apollo reservation ceiling from live caps and flags.
 * Single place where env-configured caps meet the shared pricing table.
 */
export function resolveApolloWizardReservationBreakdown(): ApolloRunReservationBreakdown {
  return resolveApolloRunReservationBreakdown({
    maxQueriesPerRun: resolveApolloMaxQueriesPerRun(),
    maxResultsPerQuery: resolveApolloMaxResultsPerQuery(),
    maxEnrichmentsPerRun: resolveApolloMaxEnrichmentsPerRun(),
    enrichmentCascadeEnabled: isApolloOrganizationEnrichmentCascadeEnabled(),
  });
}

export type WizardBudgetValidationResult = {
  provider: WizardDiscoveryProviderKey;
  estimatedCredits: number;
  estimateSource: 'apollo_cost_guardrails' | 'tavily_adaptive_pipeline';
  /** Resolved Apollo queries cap (only meaningful when provider = apollo_organizations) */
  apolloMaxQueriesPerRun: number | null;
  /** Resolved Apollo results cap (only meaningful when provider = apollo_organizations) */
  apolloMaxResultsPerQuery: number | null;
  /**
   * Full per-operation reservation breakdown. Non-null only for Apollo, where the
   * estimate covers `organizations_search` AND `organization_enrichment`.
   */
  apolloReservationBreakdown: ApolloRunReservationBreakdown | null;
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
 * For Apollo: estimate = search ceiling + enrichment ceiling, both taken from
 *   apollo-operation-pricing:
 *     search     = resolvedMaxQueries × resolvedMaxResults × 1 credit/result
 *     enrichment = resolvedMaxEnrichments × 1 credit/call, or 0 when the cascade is off
 *   Hard caps apply: queries ≤ 3, results ≤ 5 → search ceiling 15 credits.
 *   Controlled-pilot defaults (1 query × 3 results, 1 enrichment, cascade on) = 4 credits.
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
  let apolloReservationBreakdown: ApolloRunReservationBreakdown | null = null;

  if (provider === 'apollo_organizations') {
    const breakdown = resolveApolloWizardReservationBreakdown();
    apolloMaxQueriesPerRun = breakdown.derivedFrom.maxQueriesPerRun;
    apolloMaxResultsPerQuery = breakdown.derivedFrom.maxResultsPerQuery;
    apolloReservationBreakdown = breakdown;
    estimatedCredits = breakdown.totalReservedCredits;
    estimateSource = 'apollo_cost_guardrails';
  } else {
    estimatedCredits = estimateWizardAdaptiveMaxCredits();
    estimateSource = 'tavily_adaptive_pipeline';
  }

  // Block precedence: max_per_execution first, then available budget.
  if (estimatedCredits > maxCreditsPerExecution) {
    return {
      provider,
      estimatedCredits,
      estimateSource,
      apolloMaxQueriesPerRun,
      apolloMaxResultsPerQuery,
      apolloReservationBreakdown,
      availableCredits,
      maxCreditsPerExecution,
      passed: false,
      blockReason: 'exceeds_max_credits_per_execution',
    };
  }

  if (estimatedCredits > availableCredits) {
    return {
      provider,
      estimatedCredits,
      estimateSource,
      apolloMaxQueriesPerRun,
      apolloMaxResultsPerQuery,
      apolloReservationBreakdown,
      availableCredits,
      maxCreditsPerExecution,
      passed: false,
      blockReason: 'insufficient_available_budget',
    };
  }

  return {
    provider,
    estimatedCredits,
    estimateSource,
    apolloMaxQueriesPerRun,
    apolloMaxResultsPerQuery,
    apolloReservationBreakdown,
    availableCredits,
    maxCreditsPerExecution,
    passed: true,
    blockReason: null,
  };
}

// ── Diagnostic metadata shape (no secrets) ───────────────────────────────────

export type WizardBudgetValidationMetadata = {
  provider: WizardDiscoveryProviderKey;
  estimated_credits: number;
  estimate_source: string;
  apollo_max_queries_per_run: number | null;
  apollo_max_results_per_query: number | null;
  /** Per-operation reservation detail; null for non-Apollo providers. */
  apollo_reservation_breakdown: Record<string, number | string | boolean> | null;
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
    apollo_max_queries_per_run: result.apolloMaxQueriesPerRun,
    apollo_max_results_per_query: result.apolloMaxResultsPerQuery,
    apollo_reservation_breakdown: result.apolloReservationBreakdown
      ? toApolloReservationBreakdownMetadata(result.apolloReservationBreakdown)
      : null,
    available_credits: result.availableCredits,
    max_credits_per_execution: result.maxCreditsPerExecution,
    passed: result.passed,
    block_reason: result.blockReason,
  };
}

/**
 * Returns just the estimated credit count for a provider.
 * Convenience wrapper for callers that only need the number (e.g., the wizard action).
 *
 * For Apollo this is the FULL ceiling (search + enrichment) — the same number
 * `resolveWizardExecutionCreditEstimate` reports, so the pre-flight check and the
 * actual reservation can never disagree.
 */
export function estimateCreditsForProvider(provider: WizardDiscoveryProviderKey): number {
  if (provider === 'apollo_organizations') {
    return resolveApolloWizardReservationBreakdown().totalReservedCredits;
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
