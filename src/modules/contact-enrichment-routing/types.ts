// Agente 2A — Contact Enrichment Routing: Observation Types (Hito 17B.4X.7A)
//
// PARENT_REQUEST_PROVIDER_ATTEMPTS is the accepted future architecture
// (17B.4X.7): a logical REQUEST may span up to two PROVIDER ATTEMPTS. That
// request/attempt linkage entity does not exist yet, so Phase A defines only
// pure, in-memory observation types — no persistence, no request id, no
// provider execution. See policy-evaluator.ts for the pure evaluator.
//
// `RunTechnicalOutcome` is reused type-only from provider-effectiveness:
// that module's types.ts has zero runtime imports (only `import type`), so
// this reuse creates no runtime coupling to historical effectiveness
// analytics — see § 27 static isolation audit.

import type { RunTechnicalOutcome } from '@/modules/provider-effectiveness/types';

export type RoutingProviderKey = 'apollo' | 'lusha';

export type RoutingFallbackReasonV1 = 'provider_error' | 'zero_reviewable_candidates';

export const ROUTING_FALLBACK_REASONS_V1: readonly RoutingFallbackReasonV1[] = [
  'provider_error',
  'zero_reviewable_candidates',
];

/** V1 structural anti-loop cap. Fixed at 2 — see policy validation. */
export const ROUTING_MAX_PROVIDER_ATTEMPTS_V1 = 2;

// ── Policy (explicit input, not a decided routing configuration) ──────────
// Provider order is an explicit input the caller supplies. This evaluator
// does not encode "Apollo is primary" or any effectiveness-derived winner.

export interface RoutingObservationPolicyV1 {
  mode: 'observe_only';
  policyVersion: number;
  candidatePrimaryProvider: RoutingProviderKey;
  fallbackProvider: RoutingProviderKey;
  enabledFallbackReasons: RoutingFallbackReasonV1[];
  maxProviderAttempts: 2;
}

/** Loosely-typed draft accepted by the validator — see § 10 invariants. */
export interface RoutingObservationPolicyDraftV1 {
  mode: 'observe_only';
  policyVersion: number;
  candidatePrimaryProvider: string;
  fallbackProvider: string;
  enabledFallbackReasons: string[];
  maxProviderAttempts: number;
}

// ── Attempt observation input ──────────────────────────────────────────────

export interface RoutingAttemptObservationInputV1 {
  actualProvider: RoutingProviderKey;
  attemptOrder: number;
  technicalOutcome: RunTechnicalOutcome;
  reviewableCandidateCount: number;
}

/** Loosely-typed draft accepted by the validator — see § 10 invariants. */
export interface RoutingAttemptObservationInputDraftV1 {
  actualProvider: string;
  attemptOrder: number;
  technicalOutcome: string;
  reviewableCandidateCount: number;
}

// ── Output ──────────────────────────────────────────────────────────────

export type RoutingObservationStateV1 =
  | 'policy_primary_observed'
  | 'actual_provider_differs_from_policy_primary'
  | 'technical_outcome_unknown'
  | 'no_fallback_condition'
  | 'fallback_condition_matched'
  | 'attempt_cap_reached';

export interface RoutingObservationResultV1 {
  mode: 'observe_only';
  policyVersion: number;

  actualProvider: RoutingProviderKey;
  candidatePrimaryProvider: RoutingProviderKey;
  fallbackProvider: RoutingProviderKey;
  attemptOrder: number;

  /** true only when the observed attempt's provider is the policy's candidate primary. */
  primaryMatch: boolean;

  /** Signal derived from the ACTUAL attempt outcome — always visible, independent of policy config. */
  observedFallbackReason: RoutingFallbackReasonV1 | null;

  /** Whether `observedFallbackReason` (if any) is in the policy's enabled list. */
  fallbackReasonEnabled: boolean;

  /** True only when ALL § 14 conditions hold. Never true when primaryMatch is false. */
  policyFallbackConditionMatched: boolean;

  fallbackEligibleWithinAttemptCap: boolean;

  wouldFallbackToProvider: RoutingProviderKey | null;

  /** Always true — observation mode never invokes a provider. */
  fallbackNotExecuted: true;

  state: RoutingObservationStateV1;
}

// ── Validation results ──────────────────────────────────────────────────

export type RoutingPolicyValidationErrorCodeV1 =
  | 'invalid_primary_provider'
  | 'invalid_fallback_provider'
  | 'primary_equals_fallback'
  | 'invalid_policy_version'
  | 'invalid_max_provider_attempts'
  | 'invalid_fallback_reason'
  | 'duplicate_fallback_reason';

export interface RoutingPolicyValidationErrorV1 {
  code: RoutingPolicyValidationErrorCodeV1;
  message: string;
}

export type RoutingPolicyValidationResultV1 =
  | { valid: true; policy: RoutingObservationPolicyV1 }
  | { valid: false; errors: RoutingPolicyValidationErrorV1[] };

export type RoutingAttemptInputValidationErrorCodeV1 =
  | 'invalid_actual_provider'
  | 'invalid_attempt_order'
  | 'invalid_technical_outcome'
  | 'invalid_reviewable_candidate_count';

export interface RoutingAttemptInputValidationErrorV1 {
  code: RoutingAttemptInputValidationErrorCodeV1;
  message: string;
}

export type RoutingAttemptInputValidationResultV1 =
  | { valid: true; input: RoutingAttemptObservationInputV1 }
  | { valid: false; errors: RoutingAttemptInputValidationErrorV1[] };
