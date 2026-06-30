// Agente 2A — Apollo Enrichment Runner
// Hito 17A.3A — Ejecuta Apollo de forma controlada para un contact_enrichment_run
// en estado ready_to_enrich: busca, normaliza, deduplica, escribe candidatos en
// staging y actualiza estado + summary. NO crea contactos finales ni escribe en HubSpot.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
} from '@/modules/usage-tracking/logging';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';
import {
  searchApolloPeopleForCompany,
  DEFAULT_MAX_CANDIDATES,
  type ApolloPeopleAdapterResult,
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
import {
  completeContactWithApollo,
  isActionableContactCandidate,
  selectCandidatesForCompletion,
  MAX_COMPLETION_CANDIDATES,
  type CompleteContactInput,
  type CompleteContactResult,
  type ClassifiedCandidate,
} from './contact-completion-adapter';

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
}

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
  error?: string;
}

export interface RunPatch {
  status?: ContactEnrichmentRunStatus;
  summary?: Record<string, unknown>;
  estimated_cost_usd?: number;
}

// ── Dependency injection (para tests) ──────────────────────────

export interface ApolloEnrichmentRunnerDeps {
  loadRun?: (runId: string) => Promise<ContactEnrichmentRunRow | null>;
  updateRun?: (runId: string, patch: RunPatch) => Promise<void>;
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
  ) => Promise<WriteCandidatesResult>;
  loadApolloUnitCost?: () => Promise<number>;
  /** Completa selectivamente un candidato vía people/match (Hito 17A.3C). */
  completeContact?: (
    input: CompleteContactInput,
  ) => Promise<CompleteContactResult>;
  logUsage?: typeof logProviderUsage;
  createStep?: typeof createAgentRunStep;
  finishStep?: typeof finishAgentRunStep;
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
  await admin.from('contact_enrichment_runs').update(payload).eq('id', runId);
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
}

/** Resumen del completado selectivo de contactos (Hito 17A.3C). */
interface ContactCompletionSummary {
  eligible_count: number;
  attempted_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  actionable_after_completion_count: number;
  rejected_missing_actionable_channel_count: number;
  completed_fields_count: { email: number; linkedin_url: number; phone: number };
  max_completion_candidates: number;
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
  estimated_cost_usd: number;
  /** Metadata por capa de búsqueda (fallback). Sin payload crudo. */
  search_attempts: ApolloSearchAttemptSummary[];
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

// ── Runner principal ───────────────────────────────────────────

export async function executeContactEnrichmentApolloRun(
  runId: string,
  triggeredBy?: string | null,
  deps: ApolloEnrichmentRunnerDeps = {},
): Promise<ApolloEnrichmentRunResult> {
  const {
    loadRun = defaultLoadRun,
    updateRun = defaultUpdateRun,
    runApollo = searchApolloPeopleForCompany,
    writeCandidates = writeContactCandidates,
    loadApolloUnitCost = defaultLoadApolloUnitCost,
    completeContact = completeContactWithApollo,
    logUsage = logProviderUsage,
    createStep = createAgentRunStep,
    finishStep = finishAgentRunStep,
  } = deps;

  const startMs = Date.now();

  // 1. Cargar run
  const run = await loadRun(runId);
  if (!run) {
    return emptyRunResult({
      status: 'error',
      runStatus: 'failed',
      providerStatus: 'error',
      error: 'Run de enriquecimiento no encontrado',
    });
  }

  // 2. Validar estado
  if (run.status !== 'ready_to_enrich') {
    return emptyRunResult({
      status: 'error',
      runStatus: run.status,
      providerStatus: 'error',
      error: `El run no está en estado ready_to_enrich (actual: ${run.status})`,
    });
  }

  const prevSummary = run.summary ?? {};
  const searchedAt = new Date().toISOString();

  // 3. Marcar enriching + abrir step
  await updateRun(runId, { status: 'enriching' });

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
      estimated_cost_usd: 0,
      search_attempts: toAttemptSummaries(apollo.attempts),
      reason: apollo.reason,
    };
    await updateRun(runId, {
      status: 'failed',
      summary: buildSummary(prevSummary, 0, apolloBlock),
    });
    if (step) {
      await finishStep(step.id, {
        status: 'error',
        error_message: apollo.reason,
        duration_ms: Date.now() - startMs,
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

  // 7b. Completado selectivo (Hito 17A.3C): solo los mejores revisables, tope duro.
  //     Los ya accionables se omiten sin consumir créditos.
  const unitCost = await loadApolloUnitCost();
  const selected = selectCandidatesForCompletion(reviewableClassified, MAX_COMPLETION_CANDIDATES);
  const completionByContact = new Map<NormalizedApolloContact, CompleteContactResult>();
  let completionCredits = 0;

  const completionSummary: ContactCompletionSummary = {
    eligible_count: selected.length,
    attempted_count: 0,
    completed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    actionable_after_completion_count: 0,
    rejected_missing_actionable_channel_count: 0,
    completed_fields_count: { email: 0, linkedin_url: 0, phone: 0 },
    max_completion_candidates: MAX_COMPLETION_CANDIDATES,
  };

  for (const item of selected) {
    const res = await completeContact({
      candidate: item.contact,
      companyName: run.company_name,
      companyDomain: run.company_domain,
      relevanceStatus: item.relevance.relevanceStatus,
    });
    completionByContact.set(item.contact, res);
    if (res.providerUsage?.creditsUsed) completionCredits += res.providerUsage.creditsUsed;

    if (res.status === 'completed') {
      completionSummary.attempted_count += 1;
      completionSummary.completed_count += 1;
      for (const field of res.completedFields) {
        if (field === 'email') completionSummary.completed_fields_count.email += 1;
        else if (field === 'linkedin_url') completionSummary.completed_fields_count.linkedin_url += 1;
        else if (field === 'phone') completionSummary.completed_fields_count.phone += 1;
      }
    } else if (res.status === 'error' || res.reason === 'no_match_data') {
      // Consumió crédito (o falló el proveedor) pero no completó datos útiles.
      completionSummary.attempted_count += 1;
      completionSummary.failed_count += 1;
    } else {
      // skipped sin crédito: candidate_already_actionable / insufficient_input_for_match.
      completionSummary.skipped_count += 1;
    }
  }

  // 7c. Filtro accionable final: cada revisable (completado o no) debe quedar con
  //     nombre + cargo + al menos un canal (email/linkedin/phone). Sin canal → fuera.
  const actionableContacts: NormalizedApolloContact[] = [];
  for (const item of reviewableClassified) {
    const res = completionByContact.get(item.contact);
    const finalContact = res?.contact ?? item.contact;
    if (!isActionableContactCandidate(finalContact, item.relevance.relevanceStatus)) continue;

    actionableContacts.push({
      ...finalContact,
      enrichmentMetadata: {
        ...finalContact.enrichmentMetadata,
        relevance: relevanceMetadata(item.relevance),
        apollo_search_attempt: chosenAttempt,
        completion: buildCompletionMetadata(res, true),
      },
    });
  }
  completionSummary.actionable_after_completion_count = actionableContacts.length;
  completionSummary.rejected_missing_actionable_channel_count =
    reviewableClassified.length - actionableContacts.length;

  // 8. Deduplicar (solo accionables) contra snapshot + intra-run.
  const dedup = deduplicateContacts(actionableContacts, dedupSnapshot);

  // 9. Costo estimado: créditos de people_search + people/match (ya consumidos).
  const searchCredits = apollo.providerUsage?.creditsUsed ?? rawResultsCount;
  const totalCredits = searchCredits + completionCredits;
  const estimatedCostUsd = Number((totalCredits * unitCost).toFixed(6));

  // 10. Escribir candidatos accionables (no_match + possible_duplicate).
  const writeResult = await writeCandidates(runId, dedup.toInsert);

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
      estimated_cost_usd: estimatedCostUsd,
      search_attempts: toAttemptSummaries(apollo.attempts),
      relevance_filter: relevanceFilter,
      contact_completion: completionSummary,
      reason: `Error al escribir candidatos: ${writeResult.error}`,
    };
    await updateRun(runId, {
      status: 'failed',
      estimated_cost_usd: estimatedCostUsd,
      summary: buildSummary(prevSummary, 0, apolloBlock),
    });
    if (step) {
      await finishStep(step.id, {
        status: 'error',
        error_message: writeResult.error,
        duration_ms: Date.now() - startMs,
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
      normalized_count: normalized.length,
      evaluated_count: relevanceFilter.evaluated_count,
      inserted_candidates_count: insertedCount,
      rejected_by_relevance_count: rejectedByRelevance,
      exact_duplicates_count: dedup.exactDuplicateCount,
      possible_duplicates_count: dedup.possibleDuplicateCount,
      pricing_source: 'provider_pricing_config',
      pricing_basis: 'per_result_as_credit',
      unit_cost_usd: unitCost,
    },
  });

  if (completionCredits > 0) {
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
        eligible_count: completionSummary.eligible_count,
        attempted_count: completionSummary.attempted_count,
        completed_count: completionSummary.completed_count,
        failed_count: completionSummary.failed_count,
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
    estimated_cost_usd: estimatedCostUsd,
    search_attempts: toAttemptSummaries(apollo.attempts),
    relevance_filter: relevanceFilter,
    contact_completion: completionSummary,
  };

  const summaryFlags: Record<string, unknown> = {
    no_contacts_found: noContactsFound,
    no_reviewable_contacts_found: noReviewableContactsFound,
    no_actionable_contacts_found: noActionableContactsFound,
  };

  await updateRun(runId, {
    status: finalStatus,
    estimated_cost_usd: estimatedCostUsd,
    summary: buildSummary(prevSummary, insertedCount, apolloBlock, summaryFlags),
  });

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
    completionAttempted: completionSummary.attempted_count,
    completionCompleted: completionSummary.completed_count,
    actionableContactsCount: actionableContacts.length,
    noActionableContactsFound,
    providerStatus: 'success',
    estimatedCostUsd,
    totalCandidates: insertedCount,
  };
}
