// Agente 2A — Automatic Fallback Orchestrator (Hito 17B.4X.7C.5B)
//
// Coordinates the Apollo→Lusha automatic fallback described by
// ContactEnrichmentRoutingConfigV1 (17B.4X.7C.5A). GUARDED BY
// ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING (default false): when the flag
// is off, runAutomaticContactEnrichmentFallbackForRequest is a pure no-op —
// it does not create any attempt, does not call any provider, and does not
// write any telemetry.
//
// LIVE, NOT DARK (corrected by AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1): the original
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
import { updateAgentRun as updateAgentRunRecord } from '@/modules/usage-tracking/logging';
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
  evaluateLocalReviewableCandidateReuseGate,
  type LocalReuseGateResultV1,
} from './local-reviewable-candidate-reuse-gate';
import {
  isLushaContactEnrichmentEnabled,
  isContactEnrichmentLocalReuseGateEnabled,
  isContactEnrichmentHubSpotFirstEnabled,
  isContactEnrichmentContactBankEnabled,
  isContactEnrichmentCompanySiteEnabled,
} from '@/lib/feature-flags.server';
import { runHubSpotFirstStage, type HubSpotFirstStageResult } from './hubspot-first-stage.server';
import { runContactBankStage, type ContactBankStageResult } from './contact-bank-stage.server';
import { runCompanySiteStage, type CompanySiteStageResult } from './company-site-stage.server';
import {
  evaluateRecentFallbackZeroGate,
  type RecentFallbackZeroGateResult,
} from './recent-fallback-zero-gate';
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
 * Pre-provider LOCAL reviewable-candidate reuse gate — guarded by its OWN flag
 * (ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE, code default false). With that
 * flag off the gate returns a MISS without issuing any query, so the router
 * keeps its exact pre-gate behaviour.
 */
async function defaultEvaluateLocalCandidateReuse(requestId: string): Promise<LocalReuseGateResultV1> {
  return evaluateLocalReviewableCandidateReuseGate(
    { requestId },
    { isGateEnabled: isContactEnrichmentLocalReuseGateEnabled },
  );
}

async function defaultRunHubSpotFirst(attemptId: string, triggeredBy?: string): Promise<HubSpotFirstStageResult | null> {
  if (!isContactEnrichmentHubSpotFirstEnabled()) return null;
  return runHubSpotFirstStage({ attemptId, triggeredBy: triggeredBy ?? null });
}

async function defaultMarkRunSatisfiedByHubSpot(
  attemptId: string,
  stage: Extract<HubSpotFirstStageResult, { status: 'done' }>,
): Promise<void> {
  await markRunSatisfiedByFreeStage(attemptId, stage.inserted, {
    hubspot_first: {
      satisfied: true,
      candidates_inserted: stage.inserted,
      relevant_with_email: stage.relevantWithEmail,
    },
  });
}

/**
 * Cierra una corrida que una etapa gratuita dejó lista para revisión (AGENT2-AUDIT-FIXES-1).
 * Antes sólo se cambiaba el estado de la búsqueda: el registro del agente (`agent_runs`) quedaba
 * «en curso» para siempre y `totalCandidates` en 0 aunque hubiera candidatos (Davivienda, 20-10).
 * Ahora escribe el total, cierra el registro del agente igual que Apollo y deja rastro si la
 * corrida ya no estaba en un estado que se pudiera cerrar.
 */
async function markRunSatisfiedByFreeStage(
  attemptId: string,
  inserted: number,
  summaryPatch: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from('contact_enrichment_runs')
    .select('summary, agent_run_id')
    .eq('id', attemptId)
    .maybeSingle();
  const currentSummary = (current?.summary as Record<string, unknown> | null) ?? {};
  const { data: updated, error } = await admin
    .from('contact_enrichment_runs')
    .update({
      status: 'ready_for_review',
      summary: { ...currentSummary, ...summaryPatch, totalCandidates: inserted },
    })
    .eq('id', attemptId)
    .in('status', ['pending', 'resolving', 'ready_to_enrich'])
    .select('id');
  if (error || !updated || updated.length === 0) {
    console.error('[contact-enrichment] free stage could not close run', {
      attemptId,
      error: error?.message ?? 'run_not_in_closable_status',
    });
    return;
  }
  const agentRunId = typeof current?.agent_run_id === 'string' ? current.agent_run_id : null;
  if (agentRunId) {
    await updateAgentRunRecord(agentRunId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      results_generated: inserted,
      estimated_cost_usd: 0,
    });
  }
}

async function defaultRunContactBank(attemptId: string): Promise<ContactBankStageResult | null> {
  if (!isContactEnrichmentContactBankEnabled()) return null;
  return runContactBankStage({ attemptId });
}

async function defaultRunCompanySite(attemptId: string, triggeredBy: string): Promise<CompanySiteStageResult | null> {
  if (!isContactEnrichmentCompanySiteEnabled()) return null;
  return runCompanySiteStage({ attemptId, triggeredBy });
}

async function defaultMarkRunSatisfiedByContactBank(
  attemptId: string,
  stage: Extract<ContactBankStageResult, { status: 'done' }>,
): Promise<void> {
  await markRunSatisfiedByFreeStage(attemptId, stage.inserted, {
    contact_bank: {
      satisfied: true,
      candidates_inserted: stage.inserted,
      relevant_with_email: stage.relevantWithEmail,
      same_company_accounts: stage.siblingAccounts,
    },
  });
}

async function defaultEvaluateRecentFallbackZero(
  requestId: string,
  provider: RoutingProviderKey,
): Promise<RecentFallbackZeroGateResult> {
  return evaluateRecentFallbackZeroGate({ requestId, provider });
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
   * least one actionable same-company candidate in pending_review (source
   * 'apollo' or 'lusha') — so no Lusha availability lookup, no budget
   * evaluation, no attempt_order=2 and no provider call happened. Terminal
   * SUCCESS, not a block. The outcome name is provider-neutral by design.
   */
  | 'fallback_skipped_local_reuse'
  /**
   * AGENT2-HUBSPOT-FIRST-1 — HubSpot ya tenía suficientes contactos relevantes de la empresa
   * y quedaron como candidatos a revisión: no se llamó a Apollo ni a Lusha. Éxito terminal.
   */
  | 'hubspot_first_satisfied'
  /**
   * AGENT2-CONTACT-BANK-1 — lo que SellUp ya conocía de otra ficha de la misma compañía (más lo
   * de HubSpot, si corrió) bastó: no se llamó a Apollo ni a Lusha. Éxito terminal.
   */
  | 'contact_bank_satisfied'
  /**
   * AGENT2-AUDIT-FIXES-1 — Apollo no dejó candidatos, pero «Primero HubSpot» o el banco de
   * contactos sí dejaron gente con canal en ESTA búsqueda: no se paga Lusha. Éxito terminal.
   */
  | 'fallback_skipped_free_stage_candidates'
  /**
   * AGENT2-AUDIT-FIXES-1 — la última corrida de Lusha para la misma empresa, dentro de la
   * ventana, no dejó candidatos: no se vuelve a pagar Lusha. Ver recent-fallback-zero-gate.ts.
   */
  | 'fallback_skipped_recent_zero'
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
   * Count of ALREADY-EXISTING actionable pending_review candidates — Apollo or
   * Lusha — that made the provider fallback unnecessary. >= 1 only on the
   * 'fallback_skipped_local_reuse' branch; 0 on every other branch.
   *
   * Deliberately a SEPARATE counter: it is never merged into, added to, or
   * used to reinterpret `candidatesCreated` / `candidates_created`, which keep
   * meaning "rows this run created" and stay 0 on the reuse branch because the
   * reuse branch creates nothing.
   */
  reusedExistingCandidates: number;
  /**
   * AGENT2-HUBSPOT-FIRST-1 — presente sólo cuando la etapa «Primero HubSpot» corrió (bandera
   * encendida y la empresa tiene ID de HubSpot). `inserted` = candidatos de HubSpot dejados
   * en la corrida; `satisfied` = bastaron y se omitieron los proveedores.
   */
  hubspotFirst?: { attemptId: string; inserted: number; satisfied: boolean };
  /**
   * AGENT2-CONTACT-BANK-1 — presente sólo cuando el banco de contactos corrió (bandera encendida
   * y la empresa tiene ficha en SellUp). `inserted` = candidatos traídos de otras fichas de la
   * misma compañía; `satisfied` = bastaron y se omitieron los proveedores.
   */
  contactBank?: { attemptId: string; inserted: number; satisfied: boolean };
  /**
   * AGENT2-COMPANY-SITE-PEOPLE-1 — presente sólo cuando se leyó el sitio de la empresa (bandera
   * encendida y Apollo sin candidatos). `inserted` = personas del sitio dejadas para revisar.
   */
  companySite?: { attemptId: string; inserted: number };
  /**
   * AGENT2-AUDIT-FIXES-1 — qué hizo cada etapa gratuita en esta búsqueda, también cuando no
   * aportó nada (`disabled`, `no_hubspot_company`, `site_unreachable`, `error`…). Es lo que
   * permite explicarle al vendedor por qué la búsqueda quedó en cero.
   */
  freeStages: FreeStageStatusesV1;
  /** Presente sólo en 'fallback_skipped_recent_zero': cuándo dio cero Lusha la última vez. */
  recentFallbackZero?: { lastZeroAt: string; lookbackDays: number };
}

/** Estado de cada etapa gratuita. `not_reached` = la búsqueda terminó antes de llegar a ella. */
export interface FreeStageStatusesV1 {
  hubspot_first: string;
  contact_bank: string;
  company_site: string;
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
  evaluateLocalCandidateReuse?: (requestId: string) => Promise<LocalReuseGateResultV1>;
  /**
   * AGENT2-HUBSPOT-FIRST-1 — etapa «Primero HubSpot». Devuelve `null` cuando la bandera
   * ENABLE_CONTACT_ENRICHMENT_HUBSPOT_FIRST está apagada (default): no se lee HubSpot ni se
   * escribe nada. Falla abierto: ante cualquier error el flujo sigue con Apollo/Lusha.
   */
  runHubSpotFirst?: (attemptId: string, triggeredBy?: string) => Promise<HubSpotFirstStageResult | null>;
  /** Marca la corrida como lista para revisión cuando HubSpot bastó. */
  markRunSatisfiedByHubSpot?: (attemptId: string, stage: Extract<HubSpotFirstStageResult, { status: 'done' }>) => Promise<void>;
  /**
   * AGENT2-CONTACT-BANK-1 — banco de contactos por empresa. Devuelve `null` cuando la bandera
   * ENABLE_CONTACT_ENRICHMENT_CONTACT_BANK está apagada (default): no se lee nada ni se escribe
   * nada. Falla abierto: ante cualquier error el flujo sigue con Apollo/Lusha.
   */
  runContactBank?: (attemptId: string) => Promise<ContactBankStageResult | null>;
  /** Marca la corrida como lista para revisión cuando el banco bastó. */
  markRunSatisfiedByContactBank?: (
    attemptId: string,
    stage: Extract<ContactBankStageResult, { status: 'done' }>,
  ) => Promise<void>;
  /**
   * AGENT2-COMPANY-SITE-PEOPLE-1 — lee el sitio oficial cuando Apollo no dejó candidatos.
   * `null` con la bandera ENABLE_CONTACT_ENRICHMENT_COMPANY_SITE apagada (default). No cambia
   * la decisión de pasar a Lusha. Falla abierto.
   */
  runCompanySite?: (attemptId: string, triggeredBy: string) => Promise<CompanySiteStageResult | null>;
  /**
   * AGENT2-AUDIT-FIXES-1 — ¿la última corrida del proveedor de respaldo para esta empresa dio
   * cero hace poco? Sólo lectura; falla abierto (sin acierto ⇒ el respaldo corre como siempre).
   */
  evaluateRecentFallbackZero?: (
    requestId: string,
    provider: RoutingProviderKey,
  ) => Promise<RecentFallbackZeroGateResult>;
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
): Omit<AutomaticRoutingOrchestratorResult, 'freeStages'> {
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
 * is on. When `automaticRoutingEnabled` is false — the CODE default when the
 * env flag is absent, which is NOT a claim about what Production currently
 * sets — this function returns immediately without creating any attempt,
 * calling any provider, or writing any telemetry.
 */
export async function runAutomaticContactEnrichmentFallbackForRequest(
  input: AutomaticRoutingOrchestratorInput,
  deps: AutomaticRoutingOrchestratorDeps = {},
): Promise<AutomaticRoutingOrchestratorResult> {
  const freeStagesCtx: FreeStagesCtx = {
    hubspotFirst: null,
    contactBank: null,
    companySite: null,
    statuses: { hubspot_first: 'not_reached', contact_bank: 'not_reached', company_site: 'not_reached' },
  };
  const result = await runAutomaticRoutingCore(input, deps, freeStagesCtx);
  return {
    ...result,
    freeStages: { ...freeStagesCtx.statuses },
    ...(freeStagesCtx.hubspotFirst ? { hubspotFirst: freeStagesCtx.hubspotFirst } : {}),
    ...(freeStagesCtx.contactBank ? { contactBank: freeStagesCtx.contactBank } : {}),
    ...(freeStagesCtx.companySite ? { companySite: freeStagesCtx.companySite } : {}),
  };
}

/** Lo que las etapas gratuitas (HubSpot, banco de contactos) dejaron en la corrida. */
interface FreeStagesCtx {
  hubspotFirst: NonNullable<AutomaticRoutingOrchestratorResult['hubspotFirst']> | null;
  contactBank: NonNullable<AutomaticRoutingOrchestratorResult['contactBank']> | null;
  companySite: NonNullable<AutomaticRoutingOrchestratorResult['companySite']> | null;
  statuses: FreeStageStatusesV1;
}

/** null = bandera apagada; un fallo inesperado de la etapa = 'error'. */
function freeStageStatus(stage: { status: string } | null, threw: boolean): string {
  if (threw) return 'error';
  return stage ? stage.status : 'disabled';
}

/** Corre una etapa gratuita sin dejar que un fallo corte la búsqueda (falla abierto). */
async function runFreeStage<T extends { status: string }>(
  run: () => Promise<T | null>,
): Promise<{ stage: T | null; status: string }> {
  try {
    const stage = await run();
    return { stage, status: freeStageStatus(stage, false) };
  } catch {
    return { stage: null, status: freeStageStatus(null, true) };
  }
}

function satisfiedByFreeStageResult(
  outcome: 'hubspot_first_satisfied' | 'contact_bank_satisfied',
): Omit<AutomaticRoutingOrchestratorResult, 'freeStages'> {
  return {
    outcome,
    automaticRoutingEnabled: true,
    attempt1: null,
    attempt2: null,
    fallbackExecuted: false,
    wouldRecommendFallback: false,
    fallbackReason: 'not_applicable',
    blockedReason: null,
    reusedExistingCandidates: 0,
  };
}

async function runAutomaticRoutingCore(
  input: AutomaticRoutingOrchestratorInput,
  deps: AutomaticRoutingOrchestratorDeps,
  freeStagesCtx: FreeStagesCtx,
): Promise<Omit<AutomaticRoutingOrchestratorResult, 'freeStages'>> {
  const {
    getConfig = getContactEnrichmentRoutingConfigV1,
    resolveAttempt1 = defaultResolveAttempt1,
    runApolloAttempt = defaultRunApolloAttempt,
    isFallbackProviderAvailable = defaultIsFallbackProviderAvailable,
    createFallbackAttempt = defaultCreateFallbackAttempt,
    runLushaAttempt = defaultRunLushaAttempt,
    runHubSpotFirst = defaultRunHubSpotFirst,
    markRunSatisfiedByHubSpot = defaultMarkRunSatisfiedByHubSpot,
    runContactBank = defaultRunContactBank,
    markRunSatisfiedByContactBank = defaultMarkRunSatisfiedByContactBank,
    runCompanySite = defaultRunCompanySite,
    evaluateRecentFallbackZero = defaultEvaluateRecentFallbackZero,
    evaluateLocalCandidateReuse = defaultEvaluateLocalCandidateReuse,
    estimateFallbackCostUsd = () => null,
    writeRoutingTelemetry: writeRoutingTelemetryDep = defaultWriteRoutingTelemetry,
    assertEnvironmentSafe = (automaticRoutingEnabled: boolean) =>
      assertAutomaticRoutingEnvironmentIsSafe(automaticRoutingEnabled, process.env),
  } = deps;

  // Toda la telemetría de la búsqueda lleva qué hizo cada etapa gratuita: así un cero queda
  // explicado en la base aunque ninguna etapa haya aportado (AGENT2-AUDIT-FIXES-1).
  const writeRoutingTelemetry: typeof writeRoutingTelemetryDep = (attemptId, columns, summaryPatch) =>
    writeRoutingTelemetryDep(attemptId, columns, {
      ...summaryPatch,
      evidence: { ...summaryPatch.evidence, free_stages: { ...freeStagesCtx.statuses } },
    });

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

  // AGENT2-HUBSPOT-FIRST-1 — primero lo que HubSpot ya sabe de la empresa (gratis). Con la
  // bandera apagada `runHubSpotFirst` devuelve null y esta rama no existe. Falla abierto.
  const hubspotRun = await runFreeStage(() => runHubSpotFirst(resolved1.attemptId, input.triggeredBy));
  const hubspotFirst = hubspotRun.stage;
  freeStagesCtx.statuses.hubspot_first = hubspotRun.status;
  if (hubspotFirst?.status === 'done') {
    freeStagesCtx.hubspotFirst = {
      attemptId: resolved1.attemptId,
      inserted: hubspotFirst.inserted,
      satisfied: hubspotFirst.satisfied,
    };
    if (hubspotFirst.satisfied) {
      await markRunSatisfiedByHubSpot(resolved1.attemptId, hubspotFirst);
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
          evidence: {
            hubspot_first_satisfied: true,
            hubspot_candidates_inserted: hubspotFirst.inserted,
            hubspot_relevant_with_email: hubspotFirst.relevantWithEmail,
          },
        }),
      );
      return satisfiedByFreeStageResult('hubspot_first_satisfied');
    }
  }

  // AGENT2-CONTACT-BANK-1 — después, lo que SellUp ya conocía de otra ficha de la misma compañía
  // (gratis). Con la bandera apagada `runContactBank` devuelve null y esta rama no existe.
  const bankRun = await runFreeStage(() => runContactBank(resolved1.attemptId));
  const contactBank = bankRun.stage;
  freeStagesCtx.statuses.contact_bank = bankRun.status;
  if (contactBank?.status === 'done') {
    freeStagesCtx.contactBank = {
      attemptId: resolved1.attemptId,
      inserted: contactBank.inserted,
      satisfied: contactBank.satisfied,
    };
    if (contactBank.satisfied) {
      await markRunSatisfiedByContactBank(resolved1.attemptId, contactBank);
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
          evidence: {
            contact_bank_satisfied: true,
            contact_bank_candidates_inserted: contactBank.inserted,
            contact_bank_relevant_with_email: contactBank.relevantWithEmail,
            contact_bank_same_company_accounts: contactBank.siblingAccounts,
          },
        }),
      );
      return satisfiedByFreeStageResult('contact_bank_satisfied');
    }
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

  // AGENT2-COMPANY-SITE-PEOPLE-1 — Apollo no dejó a nadie: el sitio oficial suele nombrar a quien
  // buscamos. Se suma a la misma corrida y NO cambia la decisión de pasar a Lusha (que busca
  // correos, cosa que el sitio no da).
  if (attempt1Result.candidatesCreated === 0) {
    const siteRun = await runFreeStage(() => runCompanySite(resolved1.attemptId, input.triggeredBy));
    const site = siteRun.stage;
    freeStagesCtx.statuses.company_site = siteRun.status;
    if (site?.status === 'done') {
      freeStagesCtx.companySite = { attemptId: resolved1.attemptId, inserted: site.inserted };
    }
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

  // ── PRE-PROVIDER LOCAL REUSE GATE ────────────────────────────────────
  // AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1.1
  //
  // The policy recommends a fallback. Before ANY Lusha provider-specific work,
  // ask the one question that costs nothing: does SellUp already hold at least
  // one actionable same-company candidate in pending_review — from Apollo OR
  // from Lusha?
  //
  // PROVIDER-AGNOSTIC ON PURPOSE. The fallback signal above is derived from
  // attempt1Result.candidatesCreated, and #315 removes already-known Apollo
  // person_ids BEFORE the paid /people/match leg — so a repeat run can reach
  // zero_reviewable_candidates while an actionable APOLLO candidate for this
  // same company is already waiting for a human. A Lusha-source-only predicate
  // would ignore it and start Lusha provider work anyway. This gate answers a
  // COMPANY-LEVEL reviewability question and makes no cross-provider identity
  // claim: no Apollo person_id is equated to a Lusha contactId, no alias is
  // created, and the existing candidate keeps its own source.
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
        evidence: { local_candidate_reuse: localReuse.observability },
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

  // AGENT2-AUDIT-FIXES-1 — gente con canal que «Primero HubSpot» o el banco ya dejaron en ESTA
  // búsqueda. Se decide aquí, como compuerta propia, y NO se suma al conteo de Apollo: la señal
  // de respaldo sigue siendo la verdad de Apollo. El sitio web no cuenta (no trae correos, que
  // es lo que Lusha sí puede aportar).
  const freeStageReviewable =
    (freeStagesCtx.hubspotFirst?.inserted ?? 0) + (freeStagesCtx.contactBank?.inserted ?? 0);
  if (freeStageReviewable > 0) {
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
        evidence: { blocked_reason: 'free_stage_candidates', free_stage_candidates: freeStageReviewable },
      }),
    );
    return {
      outcome: 'fallback_skipped_free_stage_candidates',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: 'free_stage_candidates',
      reusedExistingCandidates: 0,
    };
  }

  // AGENT2-AUDIT-FIXES-1 — si Lusha ya dio cero hace poco para esta empresa, no se repite.
  const recentZero = await evaluateRecentFallbackZero(input.requestId, config.fallbackProvider).catch(
    () => null,
  );
  if (recentZero?.hit && recentZero.lastZeroAt) {
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
        evidence: {
          blocked_reason: 'fallback_recent_zero',
          last_zero_at: recentZero.lastZeroAt,
          lookback_days: recentZero.lookbackDays,
        },
      }),
    );
    return {
      outcome: 'fallback_skipped_recent_zero',
      automaticRoutingEnabled: true,
      attempt1,
      attempt2: null,
      fallbackExecuted: false,
      wouldRecommendFallback: true,
      fallbackReason: signal.fallbackReasonForTelemetry,
      blockedReason: 'fallback_recent_zero',
      reusedExistingCandidates: 0,
      recentFallbackZero: { lastZeroAt: recentZero.lastZeroAt, lookbackDays: recentZero.lookbackDays },
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
