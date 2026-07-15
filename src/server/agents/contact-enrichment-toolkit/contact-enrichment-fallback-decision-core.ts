// Agente 2A — Automatic Fallback Decision Core (Hito 17B.4X.7C.5B)
//
// Pure decision logic consumed by contact-enrichment-routing-orchestrator.ts.
// No Supabase, no provider calls, no Date.now()/Math.random() — every
// function here is a deterministic mapping from explicit inputs to a
// decision, so the orchestrator's hardest-to-get-right branches (was Apollo
// actually called? does the policy recommend a fallback? is the fallback
// blocked by budget?) can be unit-tested without any mocks at all.
//
// This module never decides whether automatic routing is enabled — that
// gate lives in the orchestrator, one level up, and is checked before any
// of these helpers are ever invoked.

import { evaluateRoutingObservationV1, validateRoutingAttemptObservationInputV1 } from '@/modules/contact-enrichment-routing/policy-evaluator';
import type { RoutingObservationPolicyV1, RoutingFallbackReasonV1, RoutingProviderKey } from '@/modules/contact-enrichment-routing/types';
import type { RunTechnicalOutcome } from '@/modules/provider-effectiveness/types';
import type { FallbackReason } from '@/modules/contact-enrichment/request-attempt-types';
import { APOLLO_NOT_CONNECTED_REASON } from './apollo-people-adapter';

// ── Apollo attempt-1 signal derivation ───────────────────────────────────

/**
 * Distinguishes a REAL Apollo provider error/success from a branch that
 * never actually called Apollo (missing credentials or insufficient
 * identity data both surface here as `providerStatus: 'error'` with
 * `error === APOLLO_NOT_CONNECTED_REASON`, or `providerStatus: 'skipped'`).
 * A fallback must never be recommended for an attempt that never called out.
 */
export function resolveApolloProviderCallAttemptedV1(result: {
  providerStatus: 'success' | 'skipped' | 'error';
  error?: string;
}): boolean {
  if (result.providerStatus === 'skipped') return false;
  if (result.providerStatus === 'error' && result.error === APOLLO_NOT_CONNECTED_REASON) return false;
  return true;
}

export function deriveApolloTechnicalOutcomeV1(result: {
  providerStatus: 'success' | 'skipped' | 'error';
}): RunTechnicalOutcome {
  if (result.providerStatus === 'error') return 'technical_failure';
  if (result.providerStatus === 'success') return 'technical_success';
  return 'technical_unknown';
}

export interface Attempt1FallbackSignalV1 {
  wouldRecommendFallback: boolean;
  observedFallbackReason: RoutingFallbackReasonV1 | null;
  /** Value to persist on the run row / summary block — always a concrete FallbackReason, never null. */
  fallbackReasonForTelemetry: FallbackReason;
}

/**
 * Reuses the existing pure observe-only evaluator (17B.4X.7A) to decide
 * whether the policy recommends a fallback for attempt 1 — no duplicated
 * fallback-matching logic. Returns null only when the caller-supplied facts
 * fail the evaluator's own input validation (should not happen for
 * orchestrator-derived inputs; callers must treat null conservatively as
 * "no fallback").
 */
export function deriveAttempt1FallbackSignalV1(
  policy: RoutingObservationPolicyV1,
  attempt: {
    actualProvider: RoutingProviderKey;
    technicalOutcome: RunTechnicalOutcome;
    reviewableCandidateCount: number;
  },
): Attempt1FallbackSignalV1 | null {
  const validated = validateRoutingAttemptObservationInputV1({
    actualProvider: attempt.actualProvider,
    attemptOrder: 1,
    technicalOutcome: attempt.technicalOutcome,
    reviewableCandidateCount: attempt.reviewableCandidateCount,
  });
  if (!validated.valid) return null;

  const observation = evaluateRoutingObservationV1(policy, validated.input);
  const fallbackReasonForTelemetry: FallbackReason =
    observation.policyFallbackConditionMatched && observation.observedFallbackReason
      ? observation.observedFallbackReason
      : 'not_applicable';

  return {
    wouldRecommendFallback: observation.policyFallbackConditionMatched,
    observedFallbackReason: observation.observedFallbackReason,
    fallbackReasonForTelemetry,
  };
}

// ── Budget guardrail ─────────────────────────────────────────────────────

export type BudgetGuardrailEvaluationReasonV1 =
  | 'no_cap_configured'
  | 'within_cap'
  | 'unknown_fallback_cost'
  | 'cap_exceeded';

export interface BudgetGuardrailEvaluationV1 {
  blocked: boolean;
  reason: BudgetGuardrailEvaluationReasonV1;
}

/**
 * Lusha search has no authoritative pricing mapping (see the "UNKNOWN COST
 * != FREE COST" contract in lusha-enrichment-runner.ts) — an unknown
 * fallback cost estimate is treated as unsafe-to-proceed when a cap is
 * configured, never as free. This is the deliberate conservative choice
 * documented in §9 of 17B.4X.7C.5B: block rather than guess.
 */
export function evaluateBudgetGuardrailV1(input: {
  budgetGuardrailEnabled: boolean;
  perRequestMaxEstimatedCostUsd: number | null;
  accumulatedCostUsd: number;
  estimatedFallbackCostUsd: number | null;
}): BudgetGuardrailEvaluationV1 {
  if (!input.budgetGuardrailEnabled || input.perRequestMaxEstimatedCostUsd === null) {
    return { blocked: false, reason: 'no_cap_configured' };
  }
  if (input.estimatedFallbackCostUsd === null) {
    return { blocked: true, reason: 'unknown_fallback_cost' };
  }
  if (input.accumulatedCostUsd + input.estimatedFallbackCostUsd > input.perRequestMaxEstimatedCostUsd) {
    return { blocked: true, reason: 'cap_exceeded' };
  }
  return { blocked: false, reason: 'within_cap' };
}
