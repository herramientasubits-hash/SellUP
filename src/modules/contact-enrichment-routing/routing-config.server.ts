// Agente 2A — Contact Enrichment Routing: Config/Policy Contract
// (Hito 17B.4X.7C.5A — Automatic Routing Config & Policy Contract)
//
// Server-only: reads process.env, must never be imported from client
// components (mirrors src/lib/feature-flags.server.ts).
//
// This module defines the automatic Apollo→Lusha fallback configuration
// contract. It does not itself execute a fallback, call Apollo/Lusha, or
// create a second provider attempt, and it is still imported by no PROVIDER
// RUNNER — see routing-config.server.test.ts's "no execution wiring"
// assertions, which scope that guarantee to the Apollo/Lusha runners, the
// observation wiring and the attempt creator.
//
// CONSUMED, NOT FUTURE (corrected by AGENT2A-LUSHA-LOCAL-REUSE-GATE-1): the
// original 17B.4X.7C.5A wording described a contract a future orchestrator
// "will consume". contact-enrichment-routing-orchestrator.ts (17B.4X.7C.5B)
// consumes it today, and the wizard CTA reaches that orchestrator
// (AGENT2-ROUTING-WIRE-1), so `automaticRoutingEnabled` is the live kill
// switch for a real Production code path — not a placeholder.
// `automaticRoutingEnabled` defaults to false and every other flag here
// defaults to the same safe values 17B.4X.7C.4C already ships with
// (Apollo primary, Lusha fallback, observe-only, no HubSpot auto-write, no
// phone reveal).
//
// V1 hard invariants (deliberately NOT env-configurable — no parsing code
// path exists for these at all, so no env value can flip them):
//   - primaryProvider is always 'apollo', fallbackProvider is always
//     'lusha'. 17B.4X.7C.5's decision was Apollo-default/Lusha-fallback for
//     V1; reversing that order is out of scope for this config contract.
//   - allowManualProviderSelection / requireHumanReview are always true;
//     allowHubSpotAutoWrite / allowPhoneReveal are always false — same
//     "always returns a fixed value, never reads an env var" pattern as
//     isLushaPhoneRevealEnabled() in src/lib/feature-flags.server.ts.

import {
  ROUTING_MAX_PROVIDER_ATTEMPTS_V1,
  type RoutingFallbackReasonV1,
  type RoutingObservationPolicyDraftV1,
  type RoutingPolicyValidationResultV1,
  type RoutingProviderKey,
} from './types';
import { validateRoutingObservationPolicyV1 } from './policy-evaluator';

/** Flag name constant for the future automatic Apollo→Lusha fallback. Default: false (disabled). */
export const CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG =
  'ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING';

/** Env var enabling provider_error as an automatic-fallback trigger reason. Default: false. */
export const CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG =
  'CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_ENABLED';

/** Env var enabling zero_reviewable_candidates as an automatic-fallback trigger reason. Default: true. */
export const CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG =
  'CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_ENABLED';

/** Env var for the max attempts cap. Clamped to [1, ROUTING_MAX_PROVIDER_ATTEMPTS_V1]. Default: 2. */
export const CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV =
  'CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS';

/** Env var for the per-request budget guardrail in USD. Unset/invalid → no cap. */
export const CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV =
  'CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD';

/**
 * Matches CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION in
 * routing-observation-wiring.ts (the string persisted to
 * contact_enrichment_runs.routing_policy_version by the existing observe-only
 * path). Duplicated as a literal — not imported — because that file lives in
 * src/server/agents and this module lives in src/modules; importing it here
 * would invert the existing dependency direction (server/agents already
 * imports from this module, not the reverse). Kept in sync by a static
 * equality test in routing-config.server.test.ts.
 */
export const CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION =
  'contact_enrichment_routing_v1_observe_only';

/**
 * Persisted to contact_enrichment_runs.routing_policy_version by the automatic
 * orchestrator's telemetry writes (buildRunColumns in
 * contact-enrichment-routing-orchestrator.ts) whenever automatic routing is
 * enabled. The original "no code path produces this value" note predated that
 * orchestrator and is no longer true.
 */
export const CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION =
  'contact_enrichment_routing_v1_automatic';

/** V1's approved first rollout trigger (17B.4X.7C.5 design decision). Not env-configurable. */
export const CONTACT_ENRICHMENT_ROUTING_FIRST_ROLLOUT_REASON: RoutingFallbackReasonV1 =
  'zero_reviewable_candidates';

export type ContactEnrichmentRoutingModeV1 = 'observe_only' | 'automatic';

export interface ContactEnrichmentRoutingConfigV1 {
  automaticRoutingEnabled: boolean;
  mode: ContactEnrichmentRoutingModeV1;
  primaryProvider: RoutingProviderKey;
  fallbackProvider: RoutingProviderKey;
  maxAttempts: number;
  enabledFallbackReasons: RoutingFallbackReasonV1[];
  firstRolloutReason: RoutingFallbackReasonV1;
  providerErrorFallbackEnabled: boolean;
  zeroReviewableFallbackEnabled: boolean;
  budgetGuardrailEnabled: boolean;
  perRequestMaxEstimatedCostUsd: number | null;
  allowManualProviderSelection: true;
  requireHumanReview: true;
  allowHubSpotAutoWrite: false;
  allowPhoneReveal: false;
  policyVersion: string;
}

type EnvLike = Partial<Record<string, string | undefined>>;

function parseBooleanFlag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/** Unset/blank → the safe default; present → parsed as a boolean flag. */
function parseBooleanFlagWithDefault(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return parseBooleanFlag(raw);
}

/** Invalid/absent → default 2. Values > cap clamp down; values < 1 fall back to default. */
function parseMaxAttempts(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return ROUTING_MAX_PROVIDER_ATTEMPTS_V1;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return ROUTING_MAX_PROVIDER_ATTEMPTS_V1;
  return Math.min(parsed, ROUTING_MAX_PROVIDER_ATTEMPTS_V1);
}

/** Invalid/absent/non-positive → null (no cap configured). */
function parseMaxEstimatedCostUsd(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Pure builder — takes an explicit env-like record instead of reading
 * process.env directly, so tests never need to mutate global env state.
 * getContactEnrichmentRoutingConfigV1() below is the process.env-backed
 * wrapper callers should use.
 */
export function buildContactEnrichmentRoutingConfigV1(env: EnvLike): ContactEnrichmentRoutingConfigV1 {
  const automaticRoutingEnabled = parseBooleanFlag(env[CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG]);

  const providerErrorFallbackEnabled = parseBooleanFlagWithDefault(
    env[CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG],
    false,
  );
  const zeroReviewableFallbackEnabled = parseBooleanFlagWithDefault(
    env[CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG],
    true,
  );

  // Reasons are derived from the two dedicated flags above (single source of
  // truth), not from a separate CSV env var — that would let a comma list
  // and the two booleans disagree with each other.
  const enabledFallbackReasons: RoutingFallbackReasonV1[] = [];
  if (zeroReviewableFallbackEnabled) enabledFallbackReasons.push('zero_reviewable_candidates');
  if (providerErrorFallbackEnabled) enabledFallbackReasons.push('provider_error');

  const maxAttempts = parseMaxAttempts(env[CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]);
  const perRequestMaxEstimatedCostUsd = parseMaxEstimatedCostUsd(
    env[CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV],
  );

  return {
    automaticRoutingEnabled,
    mode: automaticRoutingEnabled ? 'automatic' : 'observe_only',
    primaryProvider: 'apollo',
    fallbackProvider: 'lusha',
    maxAttempts,
    enabledFallbackReasons,
    firstRolloutReason: CONTACT_ENRICHMENT_ROUTING_FIRST_ROLLOUT_REASON,
    providerErrorFallbackEnabled,
    zeroReviewableFallbackEnabled,
    budgetGuardrailEnabled: perRequestMaxEstimatedCostUsd !== null,
    perRequestMaxEstimatedCostUsd,
    allowManualProviderSelection: true,
    requireHumanReview: true,
    allowHubSpotAutoWrite: false,
    allowPhoneReveal: false,
    policyVersion: automaticRoutingEnabled
      ? CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION
      : CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
  };
}

/** process.env-backed accessor. Reads at call time — no module-level caching. */
export function getContactEnrichmentRoutingConfigV1(): ContactEnrichmentRoutingConfigV1 {
  return buildContactEnrichmentRoutingConfigV1(process.env);
}

/**
 * Maps a resolved config to a RoutingObservationPolicyDraftV1 and validates
 * it with the existing pure evaluator (policy-evaluator.ts). Called by
 * contact-enrichment-routing-orchestrator.ts, which uses the validated policy
 * for the fallback signal and the automatic-mode telemetry block; its output
 * is still never handed to evaluateRoutingObservationV1 nor to any provider
 * runner. The underlying draft type only supports `mode: 'observe_only'`
 * today (no 'automatic' mode exists in policy-evaluator.ts / types.ts yet),
 * so this builder cannot produce anything but an observe-only-shaped policy
 * regardless of config.mode — that is intentional and still unchanged: the
 * evaluator type would have to grow an 'automatic' mode before a truly
 * automatic-shaped policy could exist at all. The orchestrator's
 * automatic-mode identity lives in its telemetry columns
 * (routing_mode/routing_policy_version), not in this draft's `mode`.
 */
export function buildContactEnrichmentRoutingPolicyFromConfig(
  config: ContactEnrichmentRoutingConfigV1,
): RoutingPolicyValidationResultV1 {
  const draft: RoutingObservationPolicyDraftV1 = {
    mode: 'observe_only',
    policyVersion: 1,
    candidatePrimaryProvider: config.primaryProvider,
    fallbackProvider: config.fallbackProvider,
    enabledFallbackReasons: config.enabledFallbackReasons,
    maxProviderAttempts: config.maxAttempts,
  };
  return validateRoutingObservationPolicyV1(draft);
}
