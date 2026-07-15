// Agente 2A — Observe-Only Routing Policy Wiring (Hito 17B.4X.7C.4C)
//
// Connects the pure observe_only evaluator (17B.4X.7A,
// src/modules/contact-enrichment-routing) to the real Apollo/Lusha run
// completion paths WITHOUT executing any fallback. A manual attempt still
// only ever calls the provider the user picked; this module only computes
// what the Apollo-default/Lusha-fallback policy (17B.4X.7C.4A) would have
// recommended, for measurement.
//
// providerCallAttempted=false (missing credentials, disabled feature flag,
// insufficient identity data, invalid search context) means no observation is
// produced at all — routing_mode stays 'manual' via the migration 091
// column defaults. Observing a routing decision after a provider was never
// actually called would be a fabricated signal.

import {
  evaluateRoutingObservationV1,
  validateRoutingAttemptObservationInputV1,
} from '@/modules/contact-enrichment-routing/policy-evaluator';
import {
  ROUTING_MAX_PROVIDER_ATTEMPTS_V1,
  type RoutingObservationPolicyV1,
  type RoutingProviderKey,
} from '@/modules/contact-enrichment-routing/types';
import type { RunTechnicalOutcome } from '@/modules/provider-effectiveness/types';
import type { FallbackReason, RoutingMode, ProviderAttemptRole } from '@/modules/contact-enrichment/request-attempt-types';

/** Text identifier persisted to contact_enrichment_runs.routing_policy_version. */
export const CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION =
  'contact_enrichment_routing_v1_observe_only';

/**
 * V1 hypothesis (17B.4X.7C.4A): Apollo candidate primary, Lusha candidate
 * fallback, both V1-supported trigger reasons enabled. Only affects what
 * gets OBSERVED — never selects or calls a provider.
 */
const OBSERVE_ONLY_POLICY_V1: RoutingObservationPolicyV1 = {
  mode: 'observe_only',
  policyVersion: 1,
  candidatePrimaryProvider: 'apollo',
  fallbackProvider: 'lusha',
  enabledFallbackReasons: ['provider_error', 'zero_reviewable_candidates'],
  maxProviderAttempts: ROUTING_MAX_PROVIDER_ATTEMPTS_V1,
};

export interface RoutingObservationWiringInput {
  actualProvider: RoutingProviderKey;
  /** contact_enrichment_runs.attempt_order — legacy/bulk runs have none yet, so callers pass 1. */
  attemptOrder: number;
  /**
   * false when this terminal branch never actually called the provider
   * (missing credentials, disabled flag, insufficient identity data,
   * invalid search context). No observation is produced in that case.
   */
  providerCallAttempted: boolean;
  technicalOutcome: RunTechnicalOutcome;
  /** Candidates that ended up reviewable by a human (i.e. actually inserted pending_review), post-dedup. */
  reviewableCandidateCount: number;
  /** Caller-supplied ISO timestamp — keeps this module free of Date.now(). */
  evaluatedAt: string;
  evidence: {
    runStatus: string;
    insertedCandidatesCount: number;
    duplicatesSkippedCount: number;
    providerErrorPresent: boolean;
  };
}

export interface RoutingObservationRunColumns {
  routing_mode: RoutingMode;
  provider_attempt_role: ProviderAttemptRole;
  fallback_reason: FallbackReason;
  routing_policy_version: string;
}

export interface RoutingObservationSummaryBlock {
  mode: 'observed';
  policy_version: string;
  primary_provider: RoutingProviderKey;
  fallback_provider: RoutingProviderKey;
  actual_provider: RoutingProviderKey;
  actual_provider_was_policy_primary: boolean;
  provider_attempt_role: ProviderAttemptRole;
  would_recommend_fallback: boolean;
  fallback_reason: FallbackReason;
  /** Always false — observe-only never executes a fallback attempt. */
  fallback_executed: false;
  /** Always false — no automatic routing mode exists yet. */
  automatic_routing_enabled: false;
  evaluated_at: string;
  evidence: {
    run_status: string;
    inserted_candidates_count: number;
    duplicates_skipped_count: number;
    provider_error_present: boolean;
    technical_outcome: RunTechnicalOutcome;
    reviewable_candidate_count: number;
    attempt_order: number;
  };
}

export interface RoutingObservationWiringResult {
  runColumns: RoutingObservationRunColumns;
  summaryBlock: RoutingObservationSummaryBlock;
}

/**
 * Builds the routing observation run columns + summary block for a completed
 * manual attempt, or null when no observation should be attached (no real
 * provider call this branch, or malformed input). Never throws.
 */
export function buildRoutingObservation(
  input: RoutingObservationWiringInput,
): RoutingObservationWiringResult | null {
  if (!input.providerCallAttempted) return null;

  const attemptInput = validateRoutingAttemptObservationInputV1({
    actualProvider: input.actualProvider,
    attemptOrder: input.attemptOrder,
    technicalOutcome: input.technicalOutcome,
    reviewableCandidateCount: input.reviewableCandidateCount,
  });
  if (!attemptInput.valid) return null;

  const observation = evaluateRoutingObservationV1(OBSERVE_ONLY_POLICY_V1, attemptInput.input);

  const fallbackReason: FallbackReason =
    observation.policyFallbackConditionMatched && observation.observedFallbackReason
      ? observation.observedFallbackReason
      : 'not_applicable';

  return {
    runColumns: {
      routing_mode: 'observed',
      provider_attempt_role: 'manual',
      fallback_reason: fallbackReason,
      routing_policy_version: CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
    },
    summaryBlock: {
      mode: 'observed',
      policy_version: CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
      primary_provider: OBSERVE_ONLY_POLICY_V1.candidatePrimaryProvider,
      fallback_provider: OBSERVE_ONLY_POLICY_V1.fallbackProvider,
      actual_provider: observation.actualProvider,
      actual_provider_was_policy_primary: observation.primaryMatch,
      provider_attempt_role: 'manual',
      would_recommend_fallback: observation.policyFallbackConditionMatched,
      fallback_reason: fallbackReason,
      fallback_executed: false,
      automatic_routing_enabled: false,
      evaluated_at: input.evaluatedAt,
      evidence: {
        run_status: input.evidence.runStatus,
        inserted_candidates_count: input.evidence.insertedCandidatesCount,
        duplicates_skipped_count: input.evidence.duplicatesSkippedCount,
        provider_error_present: input.evidence.providerErrorPresent,
        technical_outcome: input.technicalOutcome,
        reviewable_candidate_count: input.reviewableCandidateCount,
        attempt_order: input.attemptOrder,
      },
    },
  };
}
