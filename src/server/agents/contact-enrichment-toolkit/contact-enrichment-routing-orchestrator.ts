// Agente 2A — Automatic Fallback Orchestrator (Hito 17B.4X.7C.5B)
//
// Coordinates the Apollo→Lusha automatic fallback described by
// ContactEnrichmentRoutingConfigV1 (17B.4X.7C.5A). GUARDED BY
// ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING (default false): when the flag
// is off, runAutomaticContactEnrichmentFallbackForRequest is a pure no-op —
// it does not create any attempt, does not call any provider, and does not
// write any telemetry.
//
// LIVE, NOT DARK (corrected by AGENT2A-LUSHA-LOCAL-REUSE-GATE-1): the original
// 17B.4X.7C.5B header said no caller invoked this module. That stopped being
// true with AGENT2-ROUTING-WIRE-1 — the contact-enrichment wizard CTA now calls
// runAutomaticContactEnrichmentForRequestAction, which reaches this
// orchestrator through automatic-routing-action-core.ts. The flag above is the
// only thing standing between this code and a real Production run, so treat
// every branch here as executable.
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

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  assertAutomaticRoutingEnvironmentIsSafe,
  UnsafeSupabaseEnvironmentError,
} from '@/lib/supabase/env-guard.server';
import {
  resolveApolloProviderCallAttemptedV1,
  deriveApolloTechnicalOutcomeV1,
  deriveAttempt1FallbackSignalV1,
  evaluateBudgetGuardrailV1,
} from './contact-enrichment-fallback-decision-core';
import { executeContactEnrichmentApolloRun, type ApolloEnrichmentRunResult } from './apollo-enrichment-runner';
import { executeContactEnrichmentLushaRun, type LushaRunnerResult } from './lusha-enrichment-runner';
import { createContactEnrichmentAttempt } from './contact-enrichment-attempt-creator';
import {
  evaluateLushaLocalCandidateReuseGate,
  type LushaLocalReuseGateResultV1,
} from './lusha-local-candidate-reuse-gate';
import {
  isLushaContactEnrichmentEnabled,
  isLushaLocalReuseGateEnabled,
} from '@/lib/feature-flags.server';
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
  const admin = createSupabaseAdminClient();
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

/**
 * Pre-provider LOCAL reuse gate — guarded by its OWN flag
 * (ENABLE_LUSHA_LOCAL_REUSE_GATE, default false). With that flag off the gate
 * returns a MISS without issuing any query, so the router keeps its exact
 * pre-gate behaviour.
 */
async function defaultEvaluateLocalCandidateReuse(requestId: string): Promise<LushaLocalReuseGateResultV1> {
  return evaluateLushaLocalCandidateReuseGate(
    { requestId },
    { isGateEnabled: isLushaLocalReuseGateEnabled },
  );
}

async function defaultReadRunSummary(attemptId: string): Promise<Record<string, unknown>> {
  const admin = createSupabaseAdminClient();
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
  const admin = createSupabaseAdminClient();
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
  | 'unsafe_environment'
  | 'invalid_policy'
  | 'attempt1_rejected'
  | 'attempt1_provider_not_called'
  | 'attempt1_invalid_signal'
  | 'no_fallback_needed'
  /**
   * The policy DID recommend the Lusha fallback, and SellUp already held at
   * least one actionable same-company Lusha candidate in pending_review — so
   * no Lusha availability lookup, no budget evaluation, no attempt_order=2 and
   * no provider call happened. Terminal SUCCESS, not a block.
   */
  | 'fallback_skipped_local_reuse'
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
  /**
   * Count of ALREADY-EXISTING actionable pending_review Lusha candidates that
   * made the provider fallback unnecessary. >= 1 only on the
   * 'fallback_skipped_local_reuse' branch; 0 on every other branch.
   *
   * Deliberately a SEPARATE counter: it is never merged into, added to, or
   * used to reinterpret `candidatesCreated` / `candidates_created`, which keep
   * meaning "rows this run created" and stay 0 on the reuse branch because the
   * reuse branch creates nothing.
   */
  reusedExistingCandidates: number;
}

export interface AutomaticRoutingOrchestratorDeps {
  getConfig?: () => ContactEnrichmentRoutingConfigV1;
  /**
   * Fail-closed environment guard. Throws UnsafeSupabaseEnvironmentError when
   * automatic routing is enabled but the environment is missing config or a
   * non-production environment resolves to the production Supabase project.
   * Default reads process.env; injectable so tests exercise it without
   * mutating global env state.
   */
  assertEnvironmentSafe?: (automaticRoutingEnabled: boolean) => void;
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
  /**
   * Read-only, zero-cost local reuse check. Runs AFTER the Apollo fallback
   * signal recommends a fallback but BEFORE isFallbackProviderAvailable and
   * BEFORE the budget guardrail — a free local result must not be rejected
   * because a hypothetical provider call would be unavailable or unaffordable.
   */
  evaluateLocalCandidateReuse?: (requestId: string) => Promise<LushaLocalReuseGateResultV1>;
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
    reusedExistingCandidates: 0,
  };
}

/**
 * Single entry point for the V1 automatic Apollo→Lusha fallback. This IS the
 * live path behind the wizard CTA (AGENT2-ROUTING-WIRE-1) — every branch below
 * is reachable in Production once ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING
 * is on. When `automaticRoutingEnabled` is false (the production default),
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
    evaluateLocalCandidateReuse = defaultEvaluateLocalCandidateReuse,
    estimateFallbackCostUsd = () => null,
    writeRoutingTelemetry = defaultWriteRoutingTelemetry,
    assertEnvironmentSafe = (automaticRoutingEnabled: boolean) =>
      assertAutomaticRoutingEnvironmentIsSafe(automaticRoutingEnabled, process.env),
  } = deps;

  const config = getConfig();

  if (!config.automaticRoutingEnabled) {
    return notEngagedResult('automatic_routing_disabled', false, 'automatic_routing_disabled');
  }

  // GAP-3 fail-closed guard: automatic routing is enabled, so refuse to touch
  // Supabase or any provider unless the environment is a safe, fully-configured,
  // isolated one. This runs BEFORE policy building, admin-client construction,
  // attempt creation, provider calls, and any telemetry write — a Preview or
  // misconfigured environment that resolves to the production Supabase project
  // (or lacks credentials) rejects here without side effects.
  try {
    assertEnvironmentSafe(config.automaticRoutingEnabled);
  } catch (error) {
    const reason =
      error instanceof UnsafeSupabaseEnvironmentError ? error.reason : 'unsafe_environment';
    return notEngagedResult('unsafe_environment', true, reason);
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
      reusedExistingCandidates: 0,
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
      reusedExistingCandidates: 0,
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
      reusedExistingCandidates: 0,
    };
  }

  // ── PRE-PROVIDER LOCAL REUSE GATE (AGENT2A-LUSHA-LOCAL-REUSE-GATE-1) ──
  //
  // The policy recommends a fallback. Before ANY Lusha provider-specific work,
  // ask the one question that costs nothing: does SellUp already hold at least
  // one actionable same-company Lusha candidate in pending_review?
  //
  // PLACEMENT IS THE POINT. This runs strictly BEFORE
  // isFallbackProviderAvailable (and therefore before getLushaApiKey), BEFORE
  // estimateFallbackCostUsd / evaluateBudgetGuardrailV1, BEFORE
  // createFallbackAttempt and BEFORE runLushaAttempt. Local reuse is not a
  // provider operation and costs 0, so it must not depend on Lusha API
  // availability, a Lusha API key, the provider budget, or an estimated
  // fallback cost: a FREE local result must never be rejected because a
  // hypothetical provider call would be unavailable or unaffordable.
  //
  // Guarded by its own default-OFF flag inside the gate module. With that flag
  // off the gate returns a MISS without issuing a single query, and control
  // falls through to the byte-identical pre-gate sequence below.
  const localReuse = await evaluateLocalCandidateReuse(input.requestId);
  if (localReuse.hit) {
    // Telemetry lands on ATTEMPT #1 with the ORIGINAL Apollo fallback reason
    // preserved. No provider_usage_logs row is written anywhere for this
    // branch: no provider call occurred, and a fake 0-credit Lusha usage row
    // would distort provider call counts, effectiveness and credit metrics.
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
        evidence: { local_lusha_reuse: localReuse.observability },
      }),
    );
    return {
      outcome: 'fallback_skipped_local_reuse',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: null,
      reusedExistingCandidates: localReuse.actionableReusableCandidateCount,
    };
  }

  // Local reuse MISS (or the gate is disabled / failed open): the existing
  // pipeline continues completely unchanged from here.
  // Apply the remaining no-fallback conditions (§7) before ever creating
  // attempt_order=2.
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
      reusedExistingCandidates: 0,
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
      reusedExistingCandidates: 0,
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
        reusedExistingCandidates: 0,
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
      reusedExistingCandidates: 0,
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
      reusedExistingCandidates: 0,
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
    reusedExistingCandidates: 0,
  };
}
