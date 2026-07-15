// Agente 2A — Apollo Enrichment Runner
// Hito 17A.3A — Ejecuta Apollo de forma controlada para un contact_enrichment_run
// en estado ready_to_enrich: busca, normaliza, deduplica, escribe candidatos en
// staging y actualiza estado + summary. NO crea contactos finales ni escribe en HubSpot.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
  updateAgentRun as updateAgentRunRecord,
} from '@/modules/usage-tracking/logging';
import type { UpdateAgentRunInput } from '@/modules/usage-tracking/types';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';
import {
  searchApolloPeopleForCompany,
  DEFAULT_MAX_CANDIDATES,
  APOLLO_NOT_CONNECTED_REASON,
  type ApolloPeopleAdapterResult,
  type SearchGuardrailMeta,
  type ApolloOrgResolutionMeta,
} from './apollo-people-adapter';
import { normalizeApolloPeople, type NormalizedApolloContact } from './contact-normalizer';
import {
  deduplicateContacts,
  type DeduplicationSnapshot,
  type DeduplicatedContact,
} from './contact-deduplicator';
import { writeContactCandidates, type WriteCandidatesResult } from './contact-candidate-writer';
import {
  classifyNormalizedContact,
  type ContactRelevanceResult,
  type ContactRelevanceStatus,
} from './contact-relevance-classifier';
import { checkCompanyConsistency } from './company-consistency-checker';
import {
  completeContactWithApollo,
  isActionableContactCandidate,
  selectCandidatesForCompletion,
  selectInsufficientsForCompletion,
  checkCompletionCostGuardrail,
  MAX_COMPLETION_CANDIDATES,
  PHONE_COMPLETION_ENABLED,
  MAX_COMPLETION_CREDITS_PER_RUN,
  type CompleteContactInput,
  type CompleteContactResult,
  type ClassifiedCandidate,
  type CompletionCostGuardrailResult,
  type CompletionMatchDiagnostics,
} from './contact-completion-adapter';
import {
  evaluateApolloBudgetAlertOnly,
  APOLLO_PROJECTED_CREDITS_CONSERVATIVE,
  type ApolloBudgetCheckMeta,
} from '@/modules/budgets/apollo-budget-alert';
import { claimContactEnrichmentAttemptForExecution } from './contact-enrichment-execution-claim';

const APOLLO_PROVIDER_KEY = 'apollo';
const APOLLO_OPERATION_KEY = 'people_search';
const APOLLO_MATCH_OPERATION_KEY = 'person_match';

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Tipos ──────────────────────────────────────────────────────

export interface ContactEnrichmentRunRow {
  id: string;
  agent_run_id: string | null;
  company_name: string;
  company_domain: string | null;
  company_country_code: string | null;
  status: ContactEnrichmentRunStatus;
  summary: Record<string, unknown>;
  /**
   * account_id de la cuenta SellUp (17B.4X.7C.3H.3 — necesario para el
   * check de candidatos pending_review de otros runs de la misma cuenta).
   * Optional: el claim atómico (ClaimableRunRow, superset) siempre lo trae;
   * harnesses de test que construyen ContactEnrichmentRunRow a mano pueden
   * omitirlo sin romper — writeCandidates simplemente no hace el check.
   */
  account_id?: string | null;
}

/**
 * Result of the atomic execution claim (Hito 17B.4X.7C.2), scoped to this
 * runner's own row shape (no account_id — Apollo never needed it). The
 * shared claim helper's row is a superset of ContactEnrichmentRunRow, so its
 * result is structurally assignable here without a cast.
 */
export type ApolloClaimExecutionResult =
  | { status: 'claimed'; row: ContactEnrichmentRunRow }
  | { status: 'not_ready'; currentStatus: ContactEnrichmentRunStatus | null }
  | { status: 'not_found' }
  | { status: 'error'; reason: string };

export interface ApolloEnrichmentRunResult {
  status: 'ready_for_review' | 'completed' | 'skipped' | 'error';
  runStatus: ContactEnrichmentRunStatus;
  candidatesCreated: number;
  duplicatesSkipped: number; // exact_duplicate omitidos
  possibleDuplicates: number;
  exactDuplicates: number;
  rawResultsCount: number;
  normalizedCount: number;
  /** Perfiles evaluados por el clasificador de relevancia/calidad. */
  evaluatedCount: number;
  /** Perfiles descartados por baja relevancia o datos insuficientes. */
  rejectedByRelevance: number;
  /** Apollo trajo perfiles pero ninguno pasó el filtro de revisión. */
  noReviewableContactsFound: boolean;
  /**
   * Candidatos omitidos por coincidir con un pending_review de OTRO run de
   * la misma cuenta (17B.4X.7C.3H.3). No incluye exact_duplicate contra
   * contacts oficiales/HubSpot — eso sigue en duplicatesSkipped/exactDuplicates.
   */
  existingPendingDuplicatesSkipped: number;
  /** Candidatos a los que se intentó completar datos vía people/match. */
  completionAttempted: number;
  /** Candidatos cuyos datos se completaron con éxito. */
  completionCompleted: number;
  /** Candidatos relevantes que quedaron con datos accionables tras completar. */
  actionableContactsCount: number;
  /** Apollo trajo perfiles relevantes pero ninguno quedó accionable. */
  noActionableContactsFound: boolean;
  providerStatus: 'success' | 'skipped' | 'error';
  estimatedCostUsd: number;
  totalCandidates: number;
  costGuardrail?: {
    phone_completion_enabled: boolean;
    estimated_credits_before_completion: number;
    max_credits_per_run: number;
    guardrail_blocked: boolean;
    blocked_reason?: string;
    actual_credits_email: number;
    actual_credits_phone: number;
    actual_credits_total: number;
    blocked_profiles_count: number;
  };
  /** Guardrail de presupuesto de búsqueda (Hito 17A.6D). */
  searchGuardrail?: SearchGuardrailMeta;
  /** Evaluación de presupuesto alert-only (Hito E). */
  budgetCheck?: ApolloBudgetCheckMeta;
  error?: string;
}

export interface RunPatch {
  status?: ContactEnrichmentRunStatus;
  summary?: Record<string, unknown>;
  estimated_cost_usd?: number;
  providers_used?: string[];
}

// ── Dependency injection (para tests) ──────────────────────────

export interface ApolloEnrichmentRunnerDeps {
  loadRun?: (runId: string) => Promise<ContactEnrichmentRunRow | null>;
  updateRun?: (runId: string, patch: RunPatch) => Promise<void>;
  /**
   * Atomic execution claim (Hito 17B.4X.7C.2): moves the run from
   * ready_to_enrich to enriching in a single conditional UPDATE, closing
   * the load→check→update race. Defaults to the real atomic claim against
   * Supabase — tests that inject their own loadRun/updateRun in-memory
   * store MUST also inject claimRunForExecution, or this default will try
   * to reach a real database.
   */
  claimRunForExecution?: (runId: string) => Promise<ApolloClaimExecutionResult>;
  runApollo?: (input: {
    runId: string;
    companyName: string;
    companyDomain?: string | null;
    companyCountryCode?: string | null;
    maxCandidates?: number;
  }) => Promise<ApolloPeopleAdapterResult>;
  writeCandidates?: (
    runId: string,
    candidates: DeduplicatedContact[],
    options?: { accountId?: string | null },
  ) => Promise<WriteCandidatesResult>;
  loadApolloUnitCost?: () => Promise<number>;
  /** Completa selectivamente un candidato vía people/match (Hito 17A.3C). */
  completeContact?: (
    input: CompleteContactInput,
  ) => Promise<CompleteContactResult>;
  logUsage?: typeof logProviderUsage;
  createStep?: typeof createAgentRunStep;
  finishStep?: typeof finishAgentRunStep;
  /** Evaluación de presupuesto alert-only (Hito E). Inyectable para tests. */
  evaluateBudget?: (userId: string, projectedCredits: number) => Promise<ApolloBudgetCheckMeta>;
  /**
   * Terminaliza agent_runs (Hito 17B.4X.7C.3B.2). Inyectable para tests —
   * el default real escribe en Supabase, así que cualquier harness in-memory
   * que ejercite una rama terminal DEBE inyectar su propio stub.
   */
  updateAgentRun?: (id: string, input: UpdateAgentRunInput) => Promise<boolean>;
}

// ── Implementaciones por defecto (DB real) ─────────────────────

async function defaultLoadRun(runId: string): Promise<ContactEnrichmentRunRow | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('id, agent_run_id, company_name, company_domain, company_country_code, status, summary')
    .eq('id', runId)
    .single();
  if (error || !data) return null;
  return data as ContactEnrichmentRunRow;
}

async function defaultUpdateRun(runId: string, patch: RunPatch): Promise<void> {
  const admin = getAdminClient();
  const payload: Record<string, unknown> = {};
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.estimated_cost_usd !== undefined) payload.estimated_cost_usd = patch.estimated_cost_usd;
  if (patch.providers_used !== undefined) payload.providers_used = patch.providers_used;
  await admin.from('contact_enrichment_runs').update(payload).eq('id', runId);
}

async function defaultClaimRunForExecution(runId: string): Promise<ApolloClaimExecutionResult> {
  return claimContactEnrichmentAttemptForExecution(runId);
}

async function defaultLoadApolloUnitCost(): Promise<number> {
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from('provider_pricing_config')
      .select('unit_cost_usd')
      .eq('provider_key', APOLLO_PROVIDER_KEY)
      .eq('operation_key', 'credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    const unit = Number(data?.unit_cost_usd);
    return Number.isFinite(unit) && unit >= 0 ? unit : 0;
  } catch {
    return 0;
  }
}

// ── Helpers de summary ─────────────────────────────────────────

/** Lee el snapshot de deduplicación desde summary.existing_contacts_snapshot.combined. */
export function readDeduplicationSnapshot(
  summary: Record<string, unknown>,
): DeduplicationSnapshot {
  const snapshot = (summary?.existing_contacts_snapshot ?? {}) as Record<string, unknown>;
  const combined = (snapshot?.combined ?? {}) as Record<string, unknown>;
  return {
    existingEmails: Array.isArray(combined.existing_emails)
      ? (combined.existing_emails as string[])
      : [],
    existingLinkedinUrls: Array.isArray(combined.existing_linkedin_urls)
      ? (combined.existing_linkedin_urls as string[])
      : [],
    existingContactNames: Array.isArray(combined.existing_contact_names)
      ? (combined.existing_contact_names as string[])
      : [],
  };
}

interface ApolloSearchAttemptSummary {
  attempt: string;
  filters: string;
  raw_results_count: number;
}

interface RelevanceFilterSummary {
  evaluated_count: number;
  inserted_for_review_count: number;
  rejected_count: number;
  high_relevance_count: number;
  medium_relevance_count: number;
  low_relevance_count: number;
  not_relevant_count: number;
  insufficient_data_count: number;
  top_rejection_reasons: string[];
  /** Perfiles insufficient_data con señal HR enviados a completion (Hito 17A.8B). */
  sent_to_completion_from_insufficient_count: number;
}

/** Resumen del completado selectivo de contactos (Hito 17A.3C/17A.6A/17A.8B). */
interface ContactCompletionSummary {
  eligible_count: number;
  /** Perfiles insufficient_data prometedores que entraron a completion (Hito 17A.8B). */
  eligible_from_insufficient_data_count: number;
  attempted_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  actionable_after_completion_count: number;
  rejected_missing_actionable_channel_count: number;
  completed_fields_count: { email: number; linkedin_url: number; phone: number };
  max_completion_candidates: number;
  /** Guardrail de costo (Hito 17A.6A). */
  cost_guardrail: {
    phone_completion_enabled: boolean;
    estimated_credits_before_completion: number;
    max_credits_per_run: number;
    guardrail_blocked: boolean;
    blocked_reason?: string;
    actual_credits_email: number;
    actual_credits_phone: number;
    actual_credits_total: number;
    blocked_profiles_count: number;
  };
  /** Diagnósticos seguros agregados de los intentos people/match (Hito 17A.8D). */
  completion_diagnostics?: {
    attempted_profile_count: number;
    profiles_with_apollo_person_id: number;
    profiles_with_linkedin_url: number;
    profiles_with_full_name: number;
    profiles_with_title: number;
    responses_with_person_object: number;
    responses_with_email_field: number;
    responses_with_linkedin_field: number;
    responses_with_phone_field: number;
    responses_with_locked_email_signal: number;
    phone_completion_enabled: false;
    skipped_sensitive_values: true;
  };
}

interface ApolloEnrichmentSummaryBlock {
  status: 'success' | 'skipped' | 'error';
  searched_at: string;
  raw_results_count: number;
  normalized_count: number;
  inserted_candidates_count: number;
  duplicates_skipped_count: number;
  exact_duplicates_count: number;
  possible_duplicates_count: number;
  /**
   * Candidatos omitidos por coincidir con un pending_review de OTRO run de
   * la misma cuenta (17B.4X.7C.3H.3) — email, LinkedIn, source_contact_id o
   * nombre+cuenta. No se re-inserta la fila existente ni se aprueba nada.
   */
  existing_pending_duplicates_skipped_count: number;
  estimated_cost_usd: number;
  /** Metadata por capa de búsqueda (fallback). Sin payload crudo. */
  search_attempts: ApolloSearchAttemptSummary[];
  /** Guardrail de presupuesto de búsqueda (Hito 17A.6D). */
  search_guardrail?: SearchGuardrailMeta;
  /** Resolución de organización Apollo (Hito 17A.8A). */
  apollo_organization_resolution?: ApolloOrgResolutionMeta;
  /** Resultado del filtro de relevancia/calidad (Hito 17A.3B). */
  relevance_filter?: RelevanceFilterSummary;
  /** Resultado del completado selectivo de datos (Hito 17A.3C). */
  contact_completion?: ContactCompletionSummary;
  reason?: string;
}

/** Resultado vacío base: evita repetir los 16 campos en cada retorno temprano. */
function emptyRunResult(
  overrides: Partial<ApolloEnrichmentRunResult> & {
    status: ApolloEnrichmentRunResult['status'];
    runStatus: ContactEnrichmentRunStatus;
    providerStatus: ApolloEnrichmentRunResult['providerStatus'];
  },
): ApolloEnrichmentRunResult {
  return {
    candidatesCreated: 0,
    duplicatesSkipped: 0,
    possibleDuplicates: 0,
    exactDuplicates: 0,
    rawResultsCount: 0,
    normalizedCount: 0,
    evaluatedCount: 0,
    rejectedByRelevance: 0,
    noReviewableContactsFound: false,
    existingPendingDuplicatesSkipped: 0,
    completionAttempted: 0,
    completionCompleted: 0,
    actionableContactsCount: 0,
    noActionableContactsFound: false,
    estimatedCostUsd: 0,
    totalCandidates: 0,
    ...overrides,
  };
}

/** Contacto normalizado + su veredicto de relevancia (uso interno del runner). */
interface ClassifiedContact {
  contact: NormalizedApolloContact;
  relevance: ContactRelevanceResult;
}

const EMPTY_RELEVANCE_FILTER: RelevanceFilterSummary = {
  evaluated_count: 0,
  inserted_for_review_count: 0,
  rejected_count: 0,
  high_relevance_count: 0,
  medium_relevance_count: 0,
  low_relevance_count: 0,
  not_relevant_count: 0,
  insufficient_data_count: 0,
  top_rejection_reasons: [],
  sent_to_completion_from_insufficient_count: 0,
};

type RelevanceCountKey =
  | 'high_relevance_count'
  | 'medium_relevance_count'
  | 'low_relevance_count'
  | 'not_relevant_count'
  | 'insufficient_data_count';

const STATUS_COUNT_KEYS: Record<ContactRelevanceStatus, RelevanceCountKey> = {
  high_relevance: 'high_relevance_count',
  medium_relevance: 'medium_relevance_count',
  low_relevance: 'low_relevance_count',
  not_relevant: 'not_relevant_count',
  insufficient_data: 'insufficient_data_count',
};

/** Top-N motivos de rechazo más frecuentes (descendente). */
function topRejectionReasons(classified: ClassifiedContact[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const { relevance } of classified) {
    for (const reason of relevance.rejectionReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason]) => reason);
}

/** Construye el bloque relevance_filter a partir de los contactos clasificados. */
function buildRelevanceFilter(classified: ClassifiedContact[]): RelevanceFilterSummary {
  const filter: RelevanceFilterSummary = {
    ...EMPTY_RELEVANCE_FILTER,
    evaluated_count: classified.length,
  };
  for (const { relevance } of classified) {
    filter[STATUS_COUNT_KEYS[relevance.relevanceStatus]] += 1;
    if (relevance.shouldInsertForReview) filter.inserted_for_review_count += 1;
    else filter.rejected_count += 1;
  }
  filter.top_rejection_reasons = topRejectionReasons(classified);
  return filter;
}

/** Mapea el veredicto de relevancia al formato snake_case de enrichment_metadata. */
function relevanceMetadata(relevance: ContactRelevanceResult): Record<string, unknown> {
  return {
    status: relevance.relevanceStatus,
    score: relevance.relevanceScore,
    quality_score: relevance.qualityScore,
    matched_keywords: relevance.matchedKeywords,
    matched_category: relevance.matchedCategory,
    rejection_reasons: relevance.rejectionReasons,
  };
}

/** Mapea la metadata de intentos del adapter al formato snake_case del summary. */
function toAttemptSummaries(
  attempts: ApolloPeopleAdapterResult['attempts'],
): ApolloSearchAttemptSummary[] {
  return (attempts ?? []).map((a) => ({
    attempt: a.attempt,
    filters: a.filters,
    raw_results_count: a.rawResultsCount,
  }));
}

/** Construye un summary nuevo preservando existing_contacts_snapshot. */
function buildSummary(
  prev: Record<string, unknown>,
  totalCandidates: number,
  apolloBlock: ApolloEnrichmentSummaryBlock,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...prev,
    totalCandidates,
    apollo_enrichment: apolloBlock,
    ...extra,
  };
}

/**
 * Metadata resumida de completion para un candidato insertado (sin payload crudo).
 *  - completed → campos completados + canal accionable.
 *  - skipped/error → status + motivo.
 *  - sin intento (no seleccionado) → skipped/not_selected_for_completion.
 */
function buildCompletionMetadata(
  res: CompleteContactResult | undefined,
  hadActionableChannel: boolean,
): Record<string, unknown> {
  if (!res) {
    return { status: 'skipped', reason: 'not_selected_for_completion' };
  }
  if (res.status === 'completed') {
    return {
      status: 'completed',
      provider: 'apollo',
      operation: 'person_match',
      completed_fields: res.completedFields,
      had_actionable_channel: hadActionableChannel,
    };
  }
  return { status: res.status, reason: res.reason ?? null };
}

/**
 * Metadata post-completion que refleja el estado real del candidato después de
 * people/match. Permite distinguir el estado pre-completion (relevance.status)
 * del estado final accionable sin perder trazabilidad.
 *
 * - is_actionable: true si el candidato tiene al menos un canal después de completion.
 * - actionable_channels: lista de canales presentes (email/linkedin_url/phone).
 * - became_reviewable_after_completion: true para perfiles insufficient_data que
 *   completion convirtió en accionables (17A.8B). false para perfiles que ya eran
 *   revisables antes de completion.
 * - pre_completion_status: veredicto de relevancia ANTES de completion para trazabilidad.
 */
function buildPostCompletionMetadata(
  finalContact: NormalizedApolloContact,
  preCompletionStatus: ContactRelevanceStatus,
  becameReviewableAfterCompletion: boolean,
): Record<string, unknown> {
  const actionableChannels: string[] = [];
  if (finalContact.email?.trim()) actionableChannels.push('email');
  if (finalContact.linkedinUrl?.trim()) actionableChannels.push('linkedin_url');
  if (finalContact.phone?.trim()) actionableChannels.push('phone');
  return {
    is_actionable: actionableChannels.length > 0,
    actionable_channels: actionableChannels,
    became_reviewable_after_completion: becameReviewableAfterCompletion,
    pre_completion_status: preCompletionStatus,
  };
}

// ── Runner principal ───────────────────────────────────────────

export async function executeContactEnrichmentApolloRun(
  runId: string,
  triggeredBy?: string | null,
  deps: ApolloEnrichmentRunnerDeps = {},
): Promise<ApolloEnrichmentRunResult> {
  const {
    loadRun = defaultLoadRun,
    updateRun = defaultUpdateRun,
    claimRunForExecution = defaultClaimRunForExecution,
    runApollo = searchApolloPeopleForCompany,
    writeCandidates = writeContactCandidates,
    loadApolloUnitCost = defaultLoadApolloUnitCost,
    completeContact = completeContactWithApollo,
    logUsage = logProviderUsage,
    createStep = createAgentRunStep,
    finishStep = finishAgentRunStep,
    evaluateBudget = evaluateApolloBudgetAlertOnly,
    updateAgentRun = updateAgentRunRecord,
  } = deps;

  const startMs = Date.now();

  // 1+2+3. Atomic claim: closes the load→check→update(enriching) race
  // (Hito 17B.4X.7C.2). Two concurrent callers on the same runId can never
  // both win — only a 'claimed' result may proceed to call Apollo.
  const claim = await claimRunForExecution(runId);

  if (claim.status === 'not_found') {
    return emptyRunResult({
      status: 'error',
      runStatus: 'failed',
      providerStatus: 'error',
      error: 'Run de enriquecimiento no encontrado',
    });
  }

  if (claim.status === 'error') {
    return emptyRunResult({
      status: 'error',
      runStatus: 'failed',
      providerStatus: 'error',
      error: `Error reclamando el run para ejecución: ${claim.reason}`,
    });
  }

  if (claim.status === 'not_ready') {
    const currentStatus = claim.currentStatus ?? 'failed';
    return emptyRunResult({
      status: 'error',
      runStatus: currentStatus,
      providerStatus: 'error',
      error: `El run no está en estado ready_to_enrich (actual: ${currentStatus})`,
    });
  }

  const run = claim.row;
  const prevSummary = run.summary ?? {};
  const searchedAt = new Date().toISOString();

  // 2b. Evaluación de presupuesto alert-only (Hito E).
  //     Nunca bloquea. triggeredBy es internalUserId cuando viene de actions.ts.
  //     Si no hay triggeredBy, produce metadata con technical_error='no_triggered_by'
  //     para que budget_check nunca quede null en provider_usage_logs.
  const budgetMeta: ApolloBudgetCheckMeta = triggeredBy
    ? await evaluateBudget(triggeredBy, APOLLO_PROJECTED_CREDITS_CONSERVATIVE)
    : {
        mode: 'alert_only',
        provider_key: APOLLO_PROVIDER_KEY,
        allowed: true,
        would_block_in_enforcement: false,
        scope_applied: 'unknown',
        matched_rule_id: null,
        on_exceed: null,
        reason: null,
        consumed_credits: 0,
        projected_credits: APOLLO_PROJECTED_CREDITS_CONSERVATIVE,
        remaining_credits: null,
        technical_error: 'no_triggered_by',
      };

  // 3. Abrir step (el claim atómico ya marcó el run como 'enriching')
  const step = run.agent_run_id
    ? await createStep({
        agent_run_id: run.agent_run_id,
        step_key: 'apollo_people_search',
        step_name: 'Búsqueda de contactos en Apollo',
        provider_key: APOLLO_PROVIDER_KEY,
        metadata: { companyName: run.company_name, companyDomain: run.company_domain },
      })
    : null;

  // 4. Snapshot de deduplicación
  const dedupSnapshot = readDeduplicationSnapshot(prevSummary);

  // 5. Consultar Apollo
  const apollo = await runApollo({
    runId,
    companyName: run.company_name,
    companyDomain: run.company_domain,
    companyCountryCode: run.company_country_code,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
  });

  // 5a. Apollo no conectado o error de proveedor → failed controlado
  if (apollo.status === 'error') {
    const apolloBlock: ApolloEnrichmentSummaryBlock = {
      status: 'error',
      searched_at: searchedAt,
      raw_results_count: 0,
      normalized_count: 0,
      inserted_candidates_count: 0,
      duplicates_skipped_count: 0,
      exact_duplicates_count: 0,
      possible_duplicates_count: 0,
      existing_pending_duplicates_skipped_count: 0,
      estimated_cost_usd: 0,
      search_attempts: toAttemptSummaries(apollo.attempts),
      search_guardrail: apollo.searchGuardrail,
      apollo_organization_resolution: apollo.organizationResolution,
      reason: apollo.reason,
    };
    // providers_used solo se marca cuando hubo un intento real de llamada a
    // Apollo (network error / respuesta de error del proveedor). El caso
    // "no conectado" (sin credenciales) nunca llegó a intentar la llamada —
    // paridad con el missing_api_key de Lusha, que tampoco marca providers_used.
    const apolloProviderCallAttempted = apollo.reason !== APOLLO_NOT_CONNECTED_REASON;
    await updateRun(runId, {
      status: 'failed',
      summary: buildSummary(prevSummary, 0, apolloBlock),
      ...(apolloProviderCallAttempted ? { providers_used: ['apollo'] } : {}),
    });
    if (step) {
      await finishStep(step.id, {
        status: 'error',
        error_message: apollo.reason,
        duration_ms: Date.now() - startMs,
      });
    }
    // Registrar intento fallido — hubo una llamada real a Apollo aunque resultó en error.
    await logUsage({
      agent_run_id: run.agent_run_id ?? undefined,
      agent_run_step_id: step?.id,
      provider_key: APOLLO_PROVIDER_KEY,
      operation_key: APOLLO_OPERATION_KEY,
      credits_used: 0,
      results_returned: 0,
      estimated_cost_usd: 0,
      status: 'error',
      error_message: apollo.reason,
      duration_ms: Date.now() - startMs,
      triggered_by: triggeredBy ?? undefined,
      metadata: {
        company_name: run.company_name,
        company_domain: run.company_domain,
        search_guardrail: apollo.searchGuardrail ?? null,
        budget_check: budgetMeta,
      },
    });
    // Terminaliza agent_runs (Hito 17B.4X.7C.3B.2) — sin tocar metadata para
    // no perder requestId/attemptOrder/intendedProvider ya guardados.
    if (run.agent_run_id) {
      await updateAgentRun(run.agent_run_id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        results_generated: 0,
        error_message: apollo.reason,
      });
    }
    return emptyRunResult({
      status: 'error',
      runStatus: 'failed',
      providerStatus: 'error',
      error: apollo.reason,
    });
  }

  // 5b. Datos insuficientes → skipped, vuelve a ready_to_enrich para reintentar
  if (apollo.status === 'skipped') {
    const apolloBlock: ApolloEnrichmentSummaryBlock = {
      status: 'skipped',
      searched_at: searchedAt,
      raw_results_count: 0,
      normalized_count: 0,
      inserted_candidates_count: 0,
      duplicates_skipped_count: 0,
      exact_duplicates_count: 0,
      possible_duplicates_count: 0,
      existing_pending_duplicates_skipped_count: 0,
      estimated_cost_usd: 0,
      search_attempts: toAttemptSummaries(apollo.attempts),
      reason: apollo.reason,
    };
    await updateRun(runId, {
      status: 'ready_to_enrich',
      summary: buildSummary(prevSummary, 0, apolloBlock),
    });
    if (step) {
      await finishStep(step.id, {
        status: 'skipped',
        error_message: apollo.reason,
        duration_ms: Date.now() - startMs,
      });
    }
    return emptyRunResult({
      status: 'skipped',
      runStatus: 'ready_to_enrich',
      providerStatus: 'skipped',
      error: apollo.reason,
    });
  }

  // 6. Normalizar
  const rawResultsCount = apollo.providerUsage?.rawResultsCount ?? apollo.people.length;
  const { normalized } = normalizeApolloPeople(apollo.people);

  // 7. Clasificar relevancia/calidad. Solo los revisables avanzan a completado/
  //    dedup/inserción; los demás se contabilizan (relevance_filter) sin payload crudo.
  const classified: ClassifiedContact[] = normalized.map((contact) => ({
    contact,
    relevance: classifyNormalizedContact(contact),
  }));
  const relevanceFilter = buildRelevanceFilter(classified);
  const chosenAttempt = apollo.chosenAttempt ?? null;
  const rejectedByRelevance = relevanceFilter.rejected_count;

  // Revisables (relevancia/calidad OK), conservando su veredicto de relevancia.
  const reviewableClassified: ClassifiedCandidate[] = classified.filter(
    ({ relevance }) => relevance.shouldInsertForReview,
  );

  // 7b. Completado selectivo (Hito 17A.3C / 17A.6A / 17A.6D / 17A.8B):
  //     - Tope duro de candidatos (MAX_COMPLETION_CANDIDATES = 3).
  //     - Guardrail de búsqueda (17A.6D): si el presupuesto de search fue excedido,
  //       no seguimos a completion para no acumular más créditos.
  //     - Guardrail de costo PRE-vuelo: estima créditos antes de llamar a Apollo.
  //     - Si el estimado supera MAX_COMPLETION_CREDITS_PER_RUN → salta toda la completion.
  //     - Modelo de créditos interno (n8n): email=1, phone=8.
  //     - Los ya accionables se omiten sin consumir créditos.
  //     - 17A.8B: perfiles insufficient_data con señal HR también entran a completion
  //       si hay cupo y tienen identidad mínima para people/match.
  const unitCost = await loadApolloUnitCost();
  const selected = selectCandidatesForCompletion(reviewableClassified, MAX_COMPLETION_CANDIDATES);

  // 17A.8B: perfiles insufficient_data prometedores (señal HR + identidad mínima).
  const allClassifiedAsCandidates: ClassifiedCandidate[] = classified.map((c) => ({
    contact: c.contact,
    relevance: c.relevance,
  }));
  const selectedInsufficients = selectInsufficientsForCompletion(
    allClassifiedAsCandidates,
    selected.length,
    MAX_COMPLETION_CANDIDATES,
  );

  // Pool total para completion: revisables primero, luego prometedores insuficientes.
  const allForCompletion = [...selected, ...selectedInsufficients];

  // Actualizar relevance_filter con los insufficient enviados a completion.
  relevanceFilter.sent_to_completion_from_insufficient_count = selectedInsufficients.length;

  const searchBudgetExceeded = apollo.searchGuardrail?.blocked_by_search_budget ?? false;

  const guardrail: CompletionCostGuardrailResult = searchBudgetExceeded
    ? {
        allowed: false,
        estimatedCredits: apollo.searchGuardrail?.estimated_search_credits ?? 0,
        maxCredits: MAX_COMPLETION_CREDITS_PER_RUN,
        blockedReason: 'search_budget_exceeded',
      }
    : checkCompletionCostGuardrail(allForCompletion.length, {
        phoneEnabled: PHONE_COMPLETION_ENABLED,
        maxCreditsPerRun: MAX_COMPLETION_CREDITS_PER_RUN,
      });

  const completionByContact = new Map<NormalizedApolloContact, CompleteContactResult>();
  let completionCredits = 0;
  let creditsEmail = 0;
  let creditsPhone = 0;

  const completionSummary: ContactCompletionSummary = {
    eligible_count: selected.length,
    eligible_from_insufficient_data_count: selectedInsufficients.length,
    attempted_count: 0,
    completed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    actionable_after_completion_count: 0,
    rejected_missing_actionable_channel_count: 0,
    completed_fields_count: { email: 0, linkedin_url: 0, phone: 0 },
    max_completion_candidates: MAX_COMPLETION_CANDIDATES,
    cost_guardrail: {
      phone_completion_enabled: PHONE_COMPLETION_ENABLED,
      estimated_credits_before_completion: guardrail.estimatedCredits,
      max_credits_per_run: guardrail.maxCredits,
      guardrail_blocked: !guardrail.allowed,
      blocked_reason: guardrail.blockedReason,
      actual_credits_email: 0,
      actual_credits_phone: 0,
      actual_credits_total: 0,
      blocked_profiles_count: guardrail.allowed ? 0 : allForCompletion.length,
    },
  };

  // Acumulador de diagnósticos seguros (Hito 17A.8D).
  const diagAcc = {
    attempted: 0,
    with_apollo_id: 0,
    with_linkedin: 0,
    with_full_name: 0,
    with_title: 0,
    resp_person: 0,
    resp_email: 0,
    resp_linkedin: 0,
    resp_phone: 0,
    resp_locked_email: 0,
    all: [] as CompletionMatchDiagnostics[],
  };

  if (guardrail.allowed) {
    for (const item of allForCompletion) {
      const res = await completeContact({
        candidate: item.contact,
        companyName: run.company_name,
        companyDomain: run.company_domain,
        relevanceStatus: item.relevance.relevanceStatus,
      });
      completionByContact.set(item.contact, res);
      if (res.providerUsage?.creditsUsed) completionCredits += res.providerUsage.creditsUsed;

      if (res.matchDiagnostics) {
        const d = res.matchDiagnostics;
        diagAcc.attempted += 1;
        if (d.had_apollo_person_id) diagAcc.with_apollo_id += 1;
        if (d.had_linkedin_url) diagAcc.with_linkedin += 1;
        if (d.had_full_name) diagAcc.with_full_name += 1;
        if (d.had_title) diagAcc.with_title += 1;
        if (d.response_had_person_object) diagAcc.resp_person += 1;
        if (d.response_had_email_field) diagAcc.resp_email += 1;
        if (d.response_had_linkedin_field) diagAcc.resp_linkedin += 1;
        if (d.response_had_phone_field) diagAcc.resp_phone += 1;
        if (d.response_had_locked_email_signal) diagAcc.resp_locked_email += 1;
        diagAcc.all.push(d);
      }

      if (res.status === 'completed') {
        completionSummary.attempted_count += 1;
        completionSummary.completed_count += 1;
        for (const field of res.completedFields) {
          if (field === 'email') {
            completionSummary.completed_fields_count.email += 1;
            creditsEmail += 1;
          } else if (field === 'linkedin_url') {
            completionSummary.completed_fields_count.linkedin_url += 1;
          } else if (field === 'phone') {
            completionSummary.completed_fields_count.phone += 1;
            creditsPhone += 8;
          }
        }
      } else if (res.status === 'error' || res.reason === 'no_match_data') {
        completionSummary.attempted_count += 1;
        completionSummary.failed_count += 1;
      } else {
        completionSummary.skipped_count += 1;
      }
    }

    // Inyectar diagnósticos agregados en el summary (sin valores sensibles).
    if (diagAcc.attempted > 0) {
      completionSummary.completion_diagnostics = {
        attempted_profile_count: diagAcc.attempted,
        profiles_with_apollo_person_id: diagAcc.with_apollo_id,
        profiles_with_linkedin_url: diagAcc.with_linkedin,
        profiles_with_full_name: diagAcc.with_full_name,
        profiles_with_title: diagAcc.with_title,
        responses_with_person_object: diagAcc.resp_person,
        responses_with_email_field: diagAcc.resp_email,
        responses_with_linkedin_field: diagAcc.resp_linkedin,
        responses_with_phone_field: diagAcc.resp_phone,
        responses_with_locked_email_signal: diagAcc.resp_locked_email,
        phone_completion_enabled: false,
        skipped_sensitive_values: true,
      };
    }
  } else {
    // Guardrail bloqueó — todos los seleccionados quedan sin intentar.
    completionSummary.skipped_count = allForCompletion.length;
  }

  // All non-phone completion credits are attributed to email/basic data lookup
  // because person_match always costs 1 credit per call regardless of what fields it returns.
  completionSummary.cost_guardrail.actual_credits_email = completionCredits - creditsPhone;
  completionSummary.cost_guardrail.actual_credits_phone = creditsPhone;
  completionSummary.cost_guardrail.actual_credits_total = completionCredits;

  // 7c. Filtro accionable final: cada revisable (completado o no) debe quedar con
  //     nombre + cargo + al menos un canal (email/linkedin/phone). Sin canal → fuera.
  const actionableContacts: NormalizedApolloContact[] = [];
  let reviewableActionableCount = 0;

  for (const item of reviewableClassified) {
    const res = completionByContact.get(item.contact);
    const finalContact = res?.contact ?? item.contact;
    if (!isActionableContactCandidate(finalContact, item.relevance.relevanceStatus)) continue;

    reviewableActionableCount += 1;
    const org = finalContact.enrichmentMetadata?.organization as
      | { name?: string | null; website_url?: string | null }
      | null
      | undefined;
    actionableContacts.push({
      ...finalContact,
      enrichmentMetadata: {
        ...finalContact.enrichmentMetadata,
        relevance: relevanceMetadata(item.relevance),
        apollo_search_attempt: chosenAttempt,
        completion: buildCompletionMetadata(res, true),
        post_completion: buildPostCompletionMetadata(finalContact, item.relevance.relevanceStatus, false),
        company_consistency: checkCompanyConsistency({
          email: finalContact.email,
          apolloOrganizationName: org?.name ?? null,
          apolloOrganizationWebsiteUrl: org?.website_url ?? null,
          companyDomain: run.company_domain,
          companyName: run.company_name,
        }),
        ...(res?.apolloPersonIdentityObservation
          ? { apollo_person_identity_observation: res.apolloPersonIdentityObservation }
          : {}),
      },
    });
  }

  // 17A.8B: perfiles insufficient_data que completion convirtió en accionables.
  for (const item of selectedInsufficients) {
    const res = completionByContact.get(item.contact);
    // Solo pasan si completion los completó Y quedaron con canal accionable.
    if (!res || res.status !== 'completed' || !res.isActionableAfter) continue;

    const org2 = res.contact.enrichmentMetadata?.organization as
      | { name?: string | null; website_url?: string | null }
      | null
      | undefined;
    actionableContacts.push({
      ...res.contact,
      enrichmentMetadata: {
        ...res.contact.enrichmentMetadata,
        relevance: relevanceMetadata(item.relevance),
        apollo_search_attempt: chosenAttempt,
        // FIX 17A.8E: hadActionableChannel debe ser true porque res.isActionableAfter === true.
        // Antes hardcodeado en false, lo que era incorrecto para perfiles que completion
        // convirtió en accionables (e.g., completion agrega linkedin_url).
        completion: buildCompletionMetadata(res, res.isActionableAfter),
        post_completion: buildPostCompletionMetadata(res.contact, item.relevance.relevanceStatus, true),
        company_consistency: checkCompanyConsistency({
          email: res.contact.email,
          apolloOrganizationName: org2?.name ?? null,
          apolloOrganizationWebsiteUrl: org2?.website_url ?? null,
          companyDomain: run.company_domain,
          companyName: run.company_name,
        }),
        ...(res.apolloPersonIdentityObservation
          ? { apollo_person_identity_observation: res.apolloPersonIdentityObservation }
          : {}),
      },
    });
  }

  completionSummary.actionable_after_completion_count = actionableContacts.length;
  completionSummary.rejected_missing_actionable_channel_count =
    reviewableClassified.length - reviewableActionableCount;

  // 8. Deduplicar (solo accionables) contra snapshot + intra-run.
  const dedup = deduplicateContacts(actionableContacts, dedupSnapshot);

  // 9. Costo estimado: créditos de people_search + people/match (ya consumidos).
  const searchCredits = apollo.providerUsage?.creditsUsed ?? rawResultsCount;
  const totalCredits = searchCredits + completionCredits;
  const estimatedCostUsd = Number((totalCredits * unitCost).toFixed(6));

  // 10. Escribir candidatos accionables (no_match + possible_duplicate).
  //     accountId habilita el check cross-run contra pending_review de otros
  //     runs de la misma cuenta (17B.4X.7C.3H.3).
  const writeResult = await writeCandidates(runId, dedup.toInsert, {
    accountId: run.account_id ?? null,
  });

  // 10a. Error de escritura → failed controlado (créditos ya gastados se reportan).
  if (writeResult.error) {
    const apolloBlock: ApolloEnrichmentSummaryBlock = {
      status: 'error',
      searched_at: searchedAt,
      raw_results_count: rawResultsCount,
      normalized_count: normalized.length,
      inserted_candidates_count: 0,
      duplicates_skipped_count: dedup.exactDuplicateCount,
      exact_duplicates_count: dedup.exactDuplicateCount,
      possible_duplicates_count: dedup.possibleDuplicateCount,
      existing_pending_duplicates_skipped_count: writeResult.skippedExistingPending ?? 0,
      estimated_cost_usd: estimatedCostUsd,
      search_attempts: toAttemptSummaries(apollo.attempts),
      search_guardrail: apollo.searchGuardrail,
      apollo_organization_resolution: apollo.organizationResolution,
      relevance_filter: relevanceFilter,
      contact_completion: completionSummary,
      reason: `Error al escribir candidatos: ${writeResult.error}`,
    };
    // Apollo ya ejecutó people_search (y opcionalmente person_match) con éxito
    // antes de este fallo de escritura — siempre marca providers_used.
    await updateRun(runId, {
      status: 'failed',
      estimated_cost_usd: estimatedCostUsd,
      summary: buildSummary(prevSummary, 0, apolloBlock),
      providers_used: ['apollo'],
    });
    if (step) {
      await finishStep(step.id, {
        status: 'error',
        error_message: writeResult.error,
        duration_ms: Date.now() - startMs,
      });
    }
    // Apollo se ejecutó y posiblemente consumió créditos; registrar igual.
    await logUsage({
      agent_run_id: run.agent_run_id ?? undefined,
      agent_run_step_id: step?.id,
      provider_key: APOLLO_PROVIDER_KEY,
      operation_key: APOLLO_OPERATION_KEY,
      credits_used: searchCredits,
      results_returned: rawResultsCount,
      estimated_cost_usd: Number((searchCredits * unitCost).toFixed(6)),
      status: 'error',
      error_message: `write_candidates_failed: ${writeResult.error}`,
      duration_ms: Date.now() - startMs,
      triggered_by: triggeredBy ?? undefined,
      metadata: {
        company_name: run.company_name,
        company_domain: run.company_domain,
        raw_results_count: rawResultsCount,
        write_error: writeResult.error,
        budget_check: budgetMeta,
      },
    });
    // Terminaliza agent_runs (Hito 17B.4X.7C.3B.2) — sin tocar metadata para
    // no perder requestId/attemptOrder/intendedProvider ya guardados.
    if (run.agent_run_id) {
      await updateAgentRun(run.agent_run_id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        results_generated: 0,
        error_message: `write_candidates_failed: ${writeResult.error}`,
      });
    }
    return emptyRunResult({
      status: 'error',
      runStatus: 'failed',
      providerStatus: 'success',
      duplicatesSkipped: dedup.exactDuplicateCount,
      possibleDuplicates: dedup.possibleDuplicateCount,
      exactDuplicates: dedup.exactDuplicateCount,
      rawResultsCount,
      normalizedCount: normalized.length,
      evaluatedCount: relevanceFilter.evaluated_count,
      rejectedByRelevance,
      existingPendingDuplicatesSkipped: writeResult.skippedExistingPending ?? 0,
      completionAttempted: completionSummary.attempted_count,
      completionCompleted: completionSummary.completed_count,
      actionableContactsCount: actionableContacts.length,
      estimatedCostUsd,
      error: writeResult.error,
    });
  }

  const insertedCount = writeResult.inserted;

  // 11. Registro de uso del proveedor: people_search siempre; people/match si hubo.
  await logUsage({
    agent_run_id: run.agent_run_id ?? undefined,
    agent_run_step_id: step?.id,
    provider_key: APOLLO_PROVIDER_KEY,
    operation_key: APOLLO_OPERATION_KEY,
    credits_used: searchCredits,
    results_returned: rawResultsCount,
    estimated_cost_usd: Number((searchCredits * unitCost).toFixed(6)),
    status: 'success',
    duration_ms: Date.now() - startMs,
    triggered_by: triggeredBy ?? undefined,
    metadata: {
      company_name: run.company_name,
      company_domain: run.company_domain,
      raw_results_count: rawResultsCount,
      normalized_count: normalized.length,
      evaluated_count: relevanceFilter.evaluated_count,
      inserted_candidates_count: insertedCount,
      rejected_by_relevance_count: rejectedByRelevance,
      exact_duplicates_count: dedup.exactDuplicateCount,
      possible_duplicates_count: dedup.possibleDuplicateCount,
      pricing_source: 'provider_pricing_config',
      pricing_basis: 'per_result_as_credit',
      unit_cost_usd: unitCost,
      search_guardrail: apollo.searchGuardrail ?? null,
      budget_check: budgetMeta,
    },
  });

  if (completionSummary.attempted_count > 0) {
    await logUsage({
      agent_run_id: run.agent_run_id ?? undefined,
      agent_run_step_id: step?.id,
      provider_key: APOLLO_PROVIDER_KEY,
      operation_key: APOLLO_MATCH_OPERATION_KEY,
      credits_used: completionCredits,
      results_returned: completionSummary.completed_count,
      estimated_cost_usd: Number((completionCredits * unitCost).toFixed(6)),
      status: 'success',
      duration_ms: Date.now() - startMs,
      triggered_by: triggeredBy ?? undefined,
      metadata: {
        company_name: run.company_name,
        company_domain: run.company_domain,
        attempted_count: completionSummary.attempted_count,
        completed_count: completionSummary.completed_count,
        completed_fields_count: completionSummary.completed_fields_count,
        actual_completion_credits_total: completionCredits,
        actual_completion_credits_phone: creditsPhone,
        phone_completion_enabled: PHONE_COMPLETION_ENABLED,
        source: 'contact_enrichment_completion',
        pricing_source: 'provider_pricing_config',
        pricing_basis: 'per_result_as_credit',
        unit_cost_usd: unitCost,
      },
    });
  }

  // 12. Estado final + summary preservando snapshot.
  //  - rawResultsCount === 0                  → Apollo no encontró a nadie.
  //  - perfiles > 0, inserted 0               → encontró perfiles pero ninguno revisable.
  //  - revisables > 0, accionables 0          → ninguno con canal accionable.
  const noContactsFound = rawResultsCount === 0;
  const noReviewableContactsFound = !noContactsFound && insertedCount === 0;
  const noActionableContactsFound =
    !noContactsFound && reviewableClassified.length > 0 && actionableContacts.length === 0;
  const finalStatus: ContactEnrichmentRunStatus =
    insertedCount > 0 ? 'ready_for_review' : 'completed';

  const apolloBlock: ApolloEnrichmentSummaryBlock = {
    status: 'success',
    searched_at: searchedAt,
    raw_results_count: rawResultsCount,
    normalized_count: normalized.length,
    inserted_candidates_count: insertedCount,
    duplicates_skipped_count: dedup.exactDuplicateCount,
    exact_duplicates_count: dedup.exactDuplicateCount,
    possible_duplicates_count: dedup.possibleDuplicateCount,
    existing_pending_duplicates_skipped_count: writeResult.skippedExistingPending ?? 0,
    estimated_cost_usd: estimatedCostUsd,
    search_attempts: toAttemptSummaries(apollo.attempts),
    search_guardrail: apollo.searchGuardrail,
    apollo_organization_resolution: apollo.organizationResolution,
    relevance_filter: relevanceFilter,
    contact_completion: completionSummary,
  };

  const summaryFlags: Record<string, unknown> = {
    no_contacts_found: noContactsFound,
    no_reviewable_contacts_found: noReviewableContactsFound,
    no_actionable_contacts_found: noActionableContactsFound,
  };

  // Apollo ejecutó people_search con éxito (con o sin candidatos insertados) —
  // siempre marca providers_used, paridad con el 'lusha' que Lusha ya persiste
  // en su propia rama de éxito.
  await updateRun(runId, {
    status: finalStatus,
    estimated_cost_usd: estimatedCostUsd,
    summary: buildSummary(prevSummary, insertedCount, apolloBlock, summaryFlags),
    providers_used: ['apollo'],
  });

  // Terminaliza agent_runs (Hito 17B.4X.7C.3B.2): tanto 'completed' como
  // 'ready_for_review' en contact_enrichment_runs significan que ESTA
  // ejecución del agente terminó (candidatos insertados o no) — sin tocar
  // metadata para no perder requestId/attemptOrder/intendedProvider.
  if (run.agent_run_id) {
    await updateAgentRun(run.agent_run_id, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      results_generated: insertedCount,
      estimated_cost_usd: estimatedCostUsd,
    });
  }

  if (step) {
    await finishStep(step.id, {
      status: 'success',
      results_returned: rawResultsCount,
      results_useful: insertedCount,
      estimated_cost_usd: estimatedCostUsd,
      duration_ms: Date.now() - startMs,
      metadata: {
        evaluated_count: relevanceFilter.evaluated_count,
        inserted_candidates_count: insertedCount,
        rejected_by_relevance_count: rejectedByRelevance,
        completion_attempted_count: completionSummary.attempted_count,
        completion_completed_count: completionSummary.completed_count,
        actionable_after_completion_count: actionableContacts.length,
        exact_duplicates_count: dedup.exactDuplicateCount,
        possible_duplicates_count: dedup.possibleDuplicateCount,
        existing_pending_duplicates_skipped_count: writeResult.skippedExistingPending ?? 0,
      },
    });
  }

  return {
    status: finalStatus === 'ready_for_review' ? 'ready_for_review' : 'completed',
    runStatus: finalStatus,
    candidatesCreated: insertedCount,
    duplicatesSkipped: dedup.exactDuplicateCount,
    possibleDuplicates: dedup.possibleDuplicateCount,
    exactDuplicates: dedup.exactDuplicateCount,
    rawResultsCount,
    normalizedCount: normalized.length,
    evaluatedCount: relevanceFilter.evaluated_count,
    rejectedByRelevance,
    noReviewableContactsFound,
    existingPendingDuplicatesSkipped: writeResult.skippedExistingPending ?? 0,
    completionAttempted: completionSummary.attempted_count,
    completionCompleted: completionSummary.completed_count,
    actionableContactsCount: actionableContacts.length,
    noActionableContactsFound,
    providerStatus: 'success',
    estimatedCostUsd,
    totalCandidates: insertedCount,
    costGuardrail: completionSummary.cost_guardrail,
    searchGuardrail: apollo.searchGuardrail,
    budgetCheck: budgetMeta,
  };
}
