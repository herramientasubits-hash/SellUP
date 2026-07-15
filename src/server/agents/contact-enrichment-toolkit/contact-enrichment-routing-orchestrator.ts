// Agente 2A — Automatic Fallback Orchestrator (Hito 17B.4X.7C.5B)
//
// Coordinates the Apollo→Lusha automatic fallback described by
// ContactEnrichmentRoutingConfigV1 (17B.4X.7C.5A). GUARDED BY
// ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING (default false): when the flag
// is off, runAutomaticContactEnrichmentFallbackForRequest is a pure no-op —
// it does not create any attempt, does not call any provider, and does not
// write any telemetry. No caller in this codebase invokes this module yet
// (the manual request-level actions in contact-enrichment/actions.ts are
// untouched) — this hito ships the orchestrator dark, ready for a future
// hito to wire it behind the still-disabled flag.
//
// Coordination, not merging: this module imports BOTH
// executeContactEnrichmentApolloRun and executeContactEnrichmentLushaRun,
// but neither runner imports the other or this orchestrator. Apollo and
// Lusha stay fully independent; only this file knows about both.
//
// attempt_order=2 idempotency is NOT reimplemented here — migration 086's
// create_contact_enrichment_attempt RPC already guarantees at most one
// attempt per (request_id, attempt_order) via a row lock + unique index, so
// two concurrent orchestrator calls for the same request race safely at the
// database layer; the loser observes 'already_exists' and never calls Lusha.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  resolveApolloProviderCallAttemptedV1,
  deriveApolloTechnicalOutcomeV1,
  deriveAttempt1FallbackSignalV1,
  evaluateBudgetGuardrailV1,
} from './contact-enrichment-fallback-decision-core';
import { executeContactEnrichmentApolloRun, type ApolloEnrichmentRunResult } from './apollo-enrichment-runner';
import { executeContactEnrichmentLushaRun, type LushaRunnerResult } from './lusha-enrichment-runner';
import { createContactEnrichmentAttempt } from './contact-enrichment-attempt-creator';
import { isLushaContactEnrichmentEnabled } from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import {
  getContactEnrichmentRoutingConfigV1,
  buildContactEnrichmentRoutingPolicyFromConfig,
  CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
  type ContactEnrichmentRoutingConfigV1,
} from '@/modules/contact-enrichment-routing/routing-config.server';
import type { RoutingObservationPolicyV1, RoutingProviderKey } from '@/modules/contact-enrichment-routing/types';
import {
  resolveAttemptForRequestProvider,
  type ResolveAttemptForRequestOutcome,
  type ExistingAttemptProviderAndStatus,
} from '@/modules/contact-enrichment/request-attempt-resolution-core';
import type {
  AttemptCreationResult,
  IntendedProvider,
  FallbackReason,
  ProviderAttemptRole,
} from '@/modules/contact-enrichment/request-attempt-types';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Telemetry shapes (automatic mode) ────────────────────────────────────

export interface AutomaticRoutingRunColumnsV1 {
  routing_mode: 'automatic';
  provider_attempt_role: ProviderAttemptRole;
  fallback_reason: FallbackReason;
  routing_policy_version: string;
}

export interface AutomaticRoutingSummaryBlockV1 {
  mode: 'automatic';
  automatic_routing_enabled: true;
  provider_attempt_role: ProviderAttemptRole;
  primary_provider: RoutingProviderKey;
  fallback_provider: RoutingProviderKey;
  actual_provider: RoutingProviderKey;
  would_recommend_fallback: boolean;
  fallback_reason: FallbackReason;
  fallback_executed: boolean;
  fallback_attempt_run_id: string | null;
  triggered_by_attempt_run_id: string | null;
  routing_policy_version: string;
  evaluated_at: string;
  evidence: Record<string, unknown>;
}

function buildRunColumns(role: ProviderAttemptRole, fallbackReason: FallbackReason): AutomaticRoutingRunColumnsV1 {
  return {
    routing_mode: 'automatic',
    provider_attempt_role: role,
    fallback_reason: fallbackReason,
    routing_policy_version: CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
  };
}

function buildSummaryBlock(args: {
  role: ProviderAttemptRole;
  policy: RoutingObservationPolicyV1;
  actualProvider: RoutingProviderKey;
  wouldRecommendFallback: boolean;
  fallbackReason: FallbackReason;
  fallbackExecuted: boolean;
  fallbackAttemptRunId: string | null;
  triggeredByAttemptRunId: string | null;
  evaluatedAt: string;
  evidence: Record<string, unknown>;
}): AutomaticRoutingSummaryBlockV1 {
  return {
    mode: 'automatic',
    automatic_routing_enabled: true,
    provider_attempt_role: args.role,
    primary_provider: args.policy.candidatePrimaryProvider,
    fallback_provider: args.policy.fallbackProvider,
    actual_provider: args.actualProvider,
    would_recommend_fallback: args.wouldRecommendFallback,
    fallback_reason: args.fallbackReason,
    fallback_executed: args.fallbackExecuted,
    fallback_attempt_run_id: args.fallbackAttemptRunId,
    triggered_by_attempt_run_id: args.triggeredByAttemptRunId,
    routing_policy_version: CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
    evaluated_at: args.evaluatedAt,
    evidence: args.evidence,
  };
}

// ── Default (real) dependencies ───────────────────────────────────────────

async function defaultLoadExistingAttemptProviderAndStatus(
  attemptId: string,
): Promise<ExistingAttemptProviderAndStatus | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('intended_provider, status')
    .eq('id', attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    intendedProvider: (data.intended_provider as IntendedProvider | null) ?? null,
    status: data.status as ContactEnrichmentRunStatus,
  };
}

async function defaultCreateAttemptAtOrder(
  requestId: string,
  attemptOrder: 1 | 2,
  intendedProvider: IntendedProvider,
  triggeredBy: string,
): Promise<AttemptCreationResult> {
  return createContactEnrichmentAttempt({ requestId, attemptOrder, intendedProvider, triggeredBy });
}

async function defaultResolveAttempt1(
  requestId: string,
  provider: RoutingProviderKey,
  triggeredBy: string,
): Promise<ResolveAttemptForRequestOutcome> {
  return resolveAttemptForRequestProvider(requestId, provider, triggeredBy, {
    createAttempt: (reqId, prov, trig) => defaultCreateAttemptAtOrder(reqId, 1, prov, trig),
    loadExistingAttempt: defaultLoadExistingAttemptProviderAndStatus,
  });
}

async function defaultRunApolloAttempt(attemptId: string, triggeredBy: string): Promise<ApolloEnrichmentRunResult> {
  return executeContactEnrichmentApolloRun(attemptId, triggeredBy);
}

/** V1 hard invariant: the fallback provider is always 'lusha' — any other value is unsupported and never available. */
async function defaultIsFallbackProviderAvailable(provider: RoutingProviderKey): Promise<boolean> {
  if (provider !== 'lusha') return false;
  if (!isLushaContactEnrichmentEnabled()) return false;
  try {
    const apiKey = await getLushaApiKey();
    return !!apiKey;
  } catch {
    return false;
  }
}

async function defaultCreateFallbackAttempt(
  requestId: string,
  provider: RoutingProviderKey,
  triggeredBy: string,
): Promise<AttemptCreationResult> {
  return defaultCreateAttemptAtOrder(requestId, 2, provider, triggeredBy);
}

async function defaultRunLushaAttempt(attemptId: string, triggeredBy: string): Promise<LushaRunnerResult> {
  return executeContactEnrichmentLushaRun(attemptId, triggeredBy);
}

async function defaultReadRunSummary(attemptId: string): Promise<Record<string, unknown>> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('contact_enrichment_runs')
    .select('summary')
    .eq('id', attemptId)
    .maybeSingle();
  return (data?.summary as Record<string, unknown>) ?? {};
}

/**
 * Runs AFTER the underlying Apollo/Lusha runner has already completed its
 * own observe-only telemetry write (routing-observation-wiring.ts) — this
 * second write is authoritative for automatic-mode attempts and overwrites
 * routing_mode/provider_attempt_role/fallback_reason/routing_policy_version
 * plus summary.routing_observation with the automatic-mode shape. No
 * modification to either runner was needed or made.
 */
async function defaultWriteRoutingTelemetry(
  attemptId: string,
  columns: AutomaticRoutingRunColumnsV1,
  summaryPatch: AutomaticRoutingSummaryBlockV1,
): Promise<void> {
  const admin = getAdminClient();
  const currentSummary = await defaultReadRunSummary(attemptId);
  await admin
    .from('contact_enrichment_runs')
    .update({
      routing_mode: columns.routing_mode,
      provider_attempt_role: columns.provider_attempt_role,
      fallback_reason: columns.fallback_reason,
      routing_policy_version: columns.routing_policy_version,
      summary: { ...currentSummary, routing_observation: summaryPatch },
    })
    .eq('id', attemptId);
}

// ── Public contract ────────────────────────────────────────────────────

export type AutomaticRoutingOutcomeV1 =
  | 'automatic_routing_disabled'
  | 'invalid_policy'
  | 'attempt1_rejected'
  | 'attempt1_provider_not_called'
  | 'attempt1_invalid_signal'
  | 'no_fallback_needed'
  | 'fallback_provider_unavailable'
  | 'fallback_blocked_by_budget'
  | 'attempt2_already_exists'
  | 'attempt2_rejected'
  | 'fallback_executed';

export interface AutomaticRoutingOrchestratorInput {
  requestId: string;
  triggeredBy: string;
  /** Caller-supplied ISO timestamp — keeps this module free of Date.now() (mirrors routing-observation-wiring.ts). */
  evaluatedAt: string;
}

export interface AutomaticRoutingOrchestratorResult {
  outcome: AutomaticRoutingOutcomeV1;
  automaticRoutingEnabled: boolean;
  attempt1: { attemptId: string; result: ApolloEnrichmentRunResult } | null;
  /** result is null when attempt 2 already existed from a prior call — never re-executed. */
  attempt2: { attemptId: string; result: LushaRunnerResult | null } | null;
  fallbackExecuted: boolean;
  wouldRecommendFallback: boolean;
  fallbackReason: FallbackReason;
  blockedReason: string | null;
}

export interface AutomaticRoutingOrchestratorDeps {
  getConfig?: () => ContactEnrichmentRoutingConfigV1;
  resolveAttempt1?: (
    requestId: string,
    provider: RoutingProviderKey,
    triggeredBy: string,
  ) => Promise<ResolveAttemptForRequestOutcome>;
  runApolloAttempt?: (attemptId: string, triggeredBy: string) => Promise<ApolloEnrichmentRunResult>;
  isFallbackProviderAvailable?: (provider: RoutingProviderKey) => Promise<boolean>;
  createFallbackAttempt?: (
    requestId: string,
    provider: RoutingProviderKey,
    triggeredBy: string,
  ) => Promise<AttemptCreationResult>;
  runLushaAttempt?: (attemptId: string, triggeredBy: string) => Promise<LushaRunnerResult>;
  /** Conservative default: null (unknown cost) — see evaluateBudgetGuardrailV1. */
  estimateFallbackCostUsd?: () => number | null;
  writeRoutingTelemetry?: (
    attemptId: string,
    columns: AutomaticRoutingRunColumnsV1,
    summaryPatch: AutomaticRoutingSummaryBlockV1,
  ) => Promise<void>;
}

function notEngagedResult(
  outcome: AutomaticRoutingOutcomeV1,
  automaticRoutingEnabled: boolean,
  blockedReason: string | null,
): AutomaticRoutingOrchestratorResult {
  return {
    outcome,
    automaticRoutingEnabled,
    attempt1: null,
    attempt2: null,
    fallbackExecuted: false,
    wouldRecommendFallback: false,
    fallbackReason: 'not_applicable',
    blockedReason,
  };
}

/**
 * Single entry point for the V1 automatic Apollo→Lusha fallback. No caller
 * in this codebase invokes this yet (see module header) — every branch
 * below is exercised exclusively by this hito's own tests via injected
 * deps. When `automaticRoutingEnabled` is false (the production default),
 * this function returns immediately without creating any attempt, calling
 * any provider, or writing any telemetry.
 */
export async function runAutomaticContactEnrichmentFallbackForRequest(
  input: AutomaticRoutingOrchestratorInput,
  deps: AutomaticRoutingOrchestratorDeps = {},
): Promise<AutomaticRoutingOrchestratorResult> {
  const {
    getConfig = getContactEnrichmentRoutingConfigV1,
    resolveAttempt1 = defaultResolveAttempt1,
    runApolloAttempt = defaultRunApolloAttempt,
    isFallbackProviderAvailable = defaultIsFallbackProviderAvailable,
    createFallbackAttempt = defaultCreateFallbackAttempt,
    runLushaAttempt = defaultRunLushaAttempt,
    estimateFallbackCostUsd = () => null,
    writeRoutingTelemetry = defaultWriteRoutingTelemetry,
  } = deps;

  const config = getConfig();

  if (!config.automaticRoutingEnabled) {
    return notEngagedResult('automatic_routing_disabled', false, 'automatic_routing_disabled');
  }

  const policyResult = buildContactEnrichmentRoutingPolicyFromConfig(config);
  if (!policyResult.valid) {
    return notEngagedResult('invalid_policy', true, policyResult.errors.map((e) => e.code).join(','));
  }
  const policy = policyResult.policy;

  const resolved1 = await resolveAttempt1(input.requestId, config.primaryProvider, input.triggeredBy);
  if (resolved1.outcome === 'rejected') {
    return notEngagedResult('attempt1_rejected', true, resolved1.reason);
  }

  const attempt1Result = await runApolloAttempt(resolved1.attemptId, input.triggeredBy);
  const attempt1 = { attemptId: resolved1.attemptId, result: attempt1Result };

  const providerCallAttempted = resolveApolloProviderCallAttemptedV1(attempt1Result);
  if (!providerCallAttempted) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', 'not_applicable'),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: false,
        fallbackReason: 'not_applicable',
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { blocked_reason: 'apollo_provider_not_called' },
      }),
    );
    return {
      outcome: 'attempt1_provider_not_called',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: false,
      fallbackReason: 'not_applicable',
      blockedReason: 'apollo_provider_not_called',
    };
  }

  const technicalOutcome = deriveApolloTechnicalOutcomeV1(attempt1Result);
  const signal = deriveAttempt1FallbackSignalV1(policy, {
    actualProvider: config.primaryProvider,
    technicalOutcome,
    reviewableCandidateCount: attempt1Result.candidatesCreated,
  });

  if (!signal) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', 'not_applicable'),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: false,
        fallbackReason: 'not_applicable',
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { blocked_reason: 'invalid_attempt_signal' },
      }),
    );
    return {
      outcome: 'attempt1_invalid_signal',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: false,
      fallbackReason: 'not_applicable',
      blockedReason: 'invalid_attempt_signal',
    };
  }

  if (!signal.wouldRecommendFallback) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', signal.fallbackReasonForTelemetry),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: false,
        fallbackReason: signal.fallbackReasonForTelemetry,
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: {},
      }),
    );
    return {
      outcome: 'no_fallback_needed',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: false,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: null,
    };
  }

  // From here on, the policy recommends a fallback — apply the remaining
  // no-fallback conditions (§7) before ever creating attempt_order=2.
  const fallbackAvailable = await isFallbackProviderAvailable(config.fallbackProvider);
  if (!fallbackAvailable) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', signal.fallbackReasonForTelemetry),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: true,
        fallbackReason: signal.fallbackReasonForTelemetry,
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { blocked_reason: 'fallback_provider_unavailable' },
      }),
    );
    return {
      outcome: 'fallback_provider_unavailable',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: 'fallback_provider_unavailable',
    };
  }

  const budgetEvaluation = evaluateBudgetGuardrailV1({
    budgetGuardrailEnabled: config.budgetGuardrailEnabled,
    perRequestMaxEstimatedCostUsd: config.perRequestMaxEstimatedCostUsd,
    accumulatedCostUsd: attempt1Result.estimatedCostUsd ?? 0,
    estimatedFallbackCostUsd: estimateFallbackCostUsd(),
  });

  if (budgetEvaluation.blocked) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', 'budget_guardrail'),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: true,
        fallbackReason: 'budget_guardrail',
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { blocked_reason: budgetEvaluation.reason },
      }),
    );
    return {
      outcome: 'fallback_blocked_by_budget',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: 'budget_guardrail',
      blockedReason: budgetEvaluation.reason,
    };
  }

  const creation2 = await createFallbackAttempt(input.requestId, config.fallbackProvider, input.triggeredBy);

  if (creation2.status === 'already_exists') {
    if (!creation2.attemptId) {
      return {
        outcome: 'attempt2_rejected',
        automaticRoutingEnabled: true,
        attempt1,
        attempt2: null,
        fallbackExecuted: false,
        wouldRecommendFallback: true,
        fallbackReason: signal.fallbackReasonForTelemetry,
        blockedReason: 'already_exists_without_attempt_id',
      };
    }
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', signal.fallbackReasonForTelemetry),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: true,
        fallbackReason: signal.fallbackReasonForTelemetry,
        fallbackExecuted: true,
        fallbackAttemptRunId: creation2.attemptId,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { note: 'attempt_order_2_already_existed' },
      }),
    );
    return {
      outcome: 'attempt2_already_exists',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: { attemptId: creation2.attemptId, result: null },
      fallbackExecuted: true,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: null,
    };
  }

  if (creation2.status !== 'created' || !creation2.attemptId) {
    await writeRoutingTelemetry(
      resolved1.attemptId,
      buildRunColumns('primary', signal.fallbackReasonForTelemetry),
      buildSummaryBlock({
        role: 'primary',
        policy,
        actualProvider: config.primaryProvider,
        wouldRecommendFallback: true,
        fallbackReason: signal.fallbackReasonForTelemetry,
        fallbackExecuted: false,
        fallbackAttemptRunId: null,
        triggeredByAttemptRunId: null,
        evaluatedAt: input.evaluatedAt,
        evidence: { blocked_reason: creation2.status },
      }),
    );
    return {
      outcome: 'attempt2_rejected',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: creation2.status,
    };
  }

  const attempt2Result = await runLushaAttempt(creation2.attemptId, input.triggeredBy);

  await writeRoutingTelemetry(
    creation2.attemptId,
    buildRunColumns('fallback', signal.fallbackReasonForTelemetry),
    buildSummaryBlock({
      role: 'fallback',
      policy,
      actualProvider: config.fallbackProvider,
      wouldRecommendFallback: false,
      fallbackReason: signal.fallbackReasonForTelemetry,
      fallbackExecuted: false,
      fallbackAttemptRunId: null,
      triggeredByAttemptRunId: resolved1.attemptId,
      evaluatedAt: input.evaluatedAt,
      evidence: {},
    }),
  );

  await writeRoutingTelemetry(
    resolved1.attemptId,
    buildRunColumns('primary', signal.fallbackReasonForTelemetry),
    buildSummaryBlock({
      role: 'primary',
      policy,
      actualProvider: config.primaryProvider,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      fallbackExecuted: true,
      fallbackAttemptRunId: creation2.attemptId,
      triggeredByAttemptRunId: null,
      evaluatedAt: input.evaluatedAt,
      evidence: {},
    }),
  );

  return {
    outcome: 'fallback_executed',
    automaticRoutingEnabled: true,
    attempt1,
    attempt2: { attemptId: creation2.attemptId, result: attempt2Result },
    fallbackExecuted: true,
    wouldRecommendFallback: true,
    fallbackReason: signal.fallbackReasonForTelemetry,
    blockedReason: null,
  };
}
