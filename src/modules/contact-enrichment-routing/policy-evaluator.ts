// Agente 2A — Contact Enrichment Routing: Pure Observation Policy Evaluator
// (Hito 17B.4X.7A)
//
// OBSERVE-ONLY. This module never calls Apollo/Lusha, never persists, never
// reads Supabase/env/feature flags/clocks, and never touches the Provider
// Effectiveness Read Model at runtime. Given identical inputs it must
// deep-equal the same output — no Date.now(), no Math.random().
//
// Two axes stay separate throughout (§ 12–14 of the hito prompt):
//   - OBSERVED ATTEMPT FALLBACK SIGNAL: derived only from the actual
//     attempt's technical outcome + reviewable count.
//   - POLICY FALLBACK MATCH: whether the draft observation policy *would*
//     have triggered a fallback, which requires the actual attempt's
//     provider to be the policy's candidate primary (primaryMatch). A signal
//     observed on a non-primary attempt never implies "the policy would
//     have fallen back" — that would be a counterfactual claim about a
//     provider call the policy never made (§ 17).

import {
  ROUTING_FALLBACK_REASONS_V1,
  ROUTING_MAX_PROVIDER_ATTEMPTS_V1,
  type RoutingAttemptInputValidationErrorV1,
  type RoutingAttemptInputValidationResultV1,
  type RoutingAttemptObservationInputDraftV1,
  type RoutingAttemptObservationInputV1,
  type RoutingFallbackReasonV1,
  type RoutingObservationPolicyDraftV1,
  type RoutingObservationPolicyV1,
  type RoutingObservationResultV1,
  type RoutingObservationStateV1,
  type RoutingPolicyValidationErrorV1,
  type RoutingPolicyValidationResultV1,
  type RoutingProviderKey,
} from './types';

const VALID_PROVIDERS: readonly RoutingProviderKey[] = ['apollo', 'lusha'];
const VALID_TECHNICAL_OUTCOMES = ['technical_success', 'technical_failure', 'technical_unknown'] as const;

function isRoutingProviderKey(value: string): value is RoutingProviderKey {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

// ── Policy validation ─────────────────────────────────────────────────────

/**
 * Validates a draft observation policy against the V1 invariants (§ 10).
 * Rejects rather than coerces: NaN/Infinity/decimals/negatives/unknown
 * provider or reason strings all fail explicitly.
 */
export function validateRoutingObservationPolicyV1(
  draft: RoutingObservationPolicyDraftV1,
): RoutingPolicyValidationResultV1 {
  const collected: RoutingPolicyValidationErrorV1[] = [];

  const validPrimary = isRoutingProviderKey(draft.candidatePrimaryProvider);
  if (!validPrimary) {
    collected.push({
      code: 'invalid_primary_provider',
      message: `candidatePrimaryProvider must be "apollo" or "lusha", got "${draft.candidatePrimaryProvider}".`,
    });
  }

  const validFallback = isRoutingProviderKey(draft.fallbackProvider);
  if (!validFallback) {
    collected.push({
      code: 'invalid_fallback_provider',
      message: `fallbackProvider must be "apollo" or "lusha", got "${draft.fallbackProvider}".`,
    });
  }

  if (validPrimary && validFallback && draft.candidatePrimaryProvider === draft.fallbackProvider) {
    collected.push({
      code: 'primary_equals_fallback',
      message: 'candidatePrimaryProvider must not equal fallbackProvider.',
    });
  }

  if (!Number.isInteger(draft.policyVersion) || draft.policyVersion <= 0) {
    collected.push({
      code: 'invalid_policy_version',
      message: `policyVersion must be a positive integer, got ${draft.policyVersion}.`,
    });
  }

  if (draft.maxProviderAttempts !== ROUTING_MAX_PROVIDER_ATTEMPTS_V1) {
    collected.push({
      code: 'invalid_max_provider_attempts',
      message: `maxProviderAttempts must equal ${ROUTING_MAX_PROVIDER_ATTEMPTS_V1} in V1, got ${draft.maxProviderAttempts}.`,
    });
  }

  const unknownReasons = draft.enabledFallbackReasons.filter(
    (reason) => !(ROUTING_FALLBACK_REASONS_V1 as readonly string[]).includes(reason),
  );
  if (unknownReasons.length > 0) {
    collected.push({
      code: 'invalid_fallback_reason',
      message: `enabledFallbackReasons contains unknown reason(s): ${unknownReasons.join(', ')}.`,
    });
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const reason of draft.enabledFallbackReasons) {
    if (seen.has(reason)) duplicates.add(reason);
    seen.add(reason);
  }
  if (duplicates.size > 0) {
    collected.push({
      code: 'duplicate_fallback_reason',
      message: `enabledFallbackReasons contains duplicate reason(s): ${Array.from(duplicates).join(', ')}.`,
    });
  }

  if (collected.length > 0) {
    return { valid: false, errors: collected };
  }

  return {
    valid: true,
    policy: {
      mode: 'observe_only',
      policyVersion: draft.policyVersion,
      candidatePrimaryProvider: draft.candidatePrimaryProvider as RoutingProviderKey,
      fallbackProvider: draft.fallbackProvider as RoutingProviderKey,
      enabledFallbackReasons: draft.enabledFallbackReasons as RoutingFallbackReasonV1[],
      maxProviderAttempts: ROUTING_MAX_PROVIDER_ATTEMPTS_V1,
    },
  };
}

// ── Attempt input validation ──────────────────────────────────────────────

function isValidTechnicalOutcome(
  value: string,
): value is RoutingAttemptObservationInputV1['technicalOutcome'] {
  return (VALID_TECHNICAL_OUTCOMES as readonly string[]).includes(value);
}

/** Validates a draft attempt observation input against the V1 invariants (§ 10). */
export function validateRoutingAttemptObservationInputV1(
  draft: RoutingAttemptObservationInputDraftV1,
): RoutingAttemptInputValidationResultV1 {
  const errors: RoutingAttemptInputValidationErrorV1[] = [];

  const validProvider = isRoutingProviderKey(draft.actualProvider);
  if (!validProvider) {
    errors.push({
      code: 'invalid_actual_provider',
      message: `actualProvider must be "apollo" or "lusha", got "${draft.actualProvider}".`,
    });
  }

  if (!Number.isInteger(draft.attemptOrder) || draft.attemptOrder <= 0) {
    errors.push({
      code: 'invalid_attempt_order',
      message: `attemptOrder must be a positive integer, got ${draft.attemptOrder}.`,
    });
  }

  const validOutcome = isValidTechnicalOutcome(draft.technicalOutcome);
  if (!validOutcome) {
    errors.push({
      code: 'invalid_technical_outcome',
      message: `technicalOutcome must be one of ${VALID_TECHNICAL_OUTCOMES.join(', ')}, got "${draft.technicalOutcome}".`,
    });
  }

  if (!Number.isInteger(draft.reviewableCandidateCount) || draft.reviewableCandidateCount < 0) {
    errors.push({
      code: 'invalid_reviewable_candidate_count',
      message: `reviewableCandidateCount must be a non-negative integer, got ${draft.reviewableCandidateCount}.`,
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    input: {
      actualProvider: draft.actualProvider as RoutingProviderKey,
      attemptOrder: draft.attemptOrder,
      technicalOutcome: draft.technicalOutcome as RoutingAttemptObservationInputV1['technicalOutcome'],
      reviewableCandidateCount: draft.reviewableCandidateCount,
    },
  };
}

// ── Signal derivation (§ 11) ──────────────────────────────────────────────

/**
 * Derives the observed fallback signal from the actual attempt outcome only.
 * `technical_failure` always wins over a zero-reviewable read: a failed
 * provider call that happens to report zero candidates is a technical
 * failure, never reinterpreted as a commercial zero-output outcome.
 */
export function deriveObservedFallbackReasonV1(
  attempt: RoutingAttemptObservationInputV1,
): RoutingFallbackReasonV1 | null {
  if (attempt.technicalOutcome === 'technical_failure') return 'provider_error';
  if (attempt.technicalOutcome === 'technical_success' && attempt.reviewableCandidateCount === 0) {
    return 'zero_reviewable_candidates';
  }
  return null;
}

// ── State derivation ──────────────────────────────────────────────────────

function deriveObservationStateV1(args: {
  primaryMatch: boolean;
  attemptOrder: number;
  maxProviderAttempts: number;
  technicalOutcome: RoutingAttemptObservationInputV1['technicalOutcome'];
  observedFallbackReason: RoutingFallbackReasonV1 | null;
  policyFallbackConditionMatched: boolean;
}): RoutingObservationStateV1 {
  const {
    primaryMatch,
    attemptOrder,
    maxProviderAttempts,
    technicalOutcome,
    observedFallbackReason,
    policyFallbackConditionMatched,
  } = args;

  // Counterfactual safety (§ 12, § 17) dominates every other signal: a
  // mismatch means the draft policy never executed this attempt's provider.
  if (!primaryMatch) return 'actual_provider_differs_from_policy_primary';

  // Anti-loop safety (§ 15): cap reached whenever a signal exists, whether
  // or not that reason happens to be enabled in the policy.
  if (attemptOrder >= maxProviderAttempts && observedFallbackReason !== null) {
    return 'attempt_cap_reached';
  }

  if (technicalOutcome === 'technical_unknown') return 'technical_outcome_unknown';

  if (policyFallbackConditionMatched) return 'fallback_condition_matched';

  // A signal was observed but did not produce a policy match (disabled
  // reason) — the signal stays visible on the result, but no policy
  // fallback condition matched (§ 16).
  if (observedFallbackReason !== null) return 'no_fallback_condition';

  return 'policy_primary_observed';
}

// ── Main evaluator ──────────────────────────────────────────────────────

/**
 * Pure observation evaluator. Never invokes a provider — `fallbackNotExecuted`
 * is always `true`. Deterministic: identical (policy, attempt) input always
 * produces a deep-equal result.
 */
export function evaluateRoutingObservationV1(
  policy: RoutingObservationPolicyV1,
  attempt: RoutingAttemptObservationInputV1,
): RoutingObservationResultV1 {
  const primaryMatch = attempt.actualProvider === policy.candidatePrimaryProvider;
  const observedFallbackReason = deriveObservedFallbackReasonV1(attempt);
  const fallbackReasonEnabled =
    observedFallbackReason !== null && policy.enabledFallbackReasons.includes(observedFallbackReason);
  const fallbackEligibleWithinAttemptCap = attempt.attemptOrder < policy.maxProviderAttempts;

  const policyFallbackConditionMatched =
    primaryMatch &&
    observedFallbackReason !== null &&
    fallbackReasonEnabled &&
    fallbackEligibleWithinAttemptCap &&
    policy.fallbackProvider !== attempt.actualProvider;

  const wouldFallbackToProvider = policyFallbackConditionMatched ? policy.fallbackProvider : null;

  const state = deriveObservationStateV1({
    primaryMatch,
    attemptOrder: attempt.attemptOrder,
    maxProviderAttempts: policy.maxProviderAttempts,
    technicalOutcome: attempt.technicalOutcome,
    observedFallbackReason,
    policyFallbackConditionMatched,
  });

  return {
    mode: 'observe_only',
    policyVersion: policy.policyVersion,
    actualProvider: attempt.actualProvider,
    candidatePrimaryProvider: policy.candidatePrimaryProvider,
    fallbackProvider: policy.fallbackProvider,
    attemptOrder: attempt.attemptOrder,
    primaryMatch,
    observedFallbackReason,
    fallbackReasonEnabled,
    policyFallbackConditionMatched,
    fallbackEligibleWithinAttemptCap,
    wouldFallbackToProvider,
    fallbackNotExecuted: true,
    state,
  };
}
