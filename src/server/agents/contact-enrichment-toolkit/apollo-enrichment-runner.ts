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

const APOLLO_PROVIDER_KEY = 'apollo';
const APOLLO_OPERATION_KEY = 'people_search';

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
  reason?: string;
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
    logUsage = logProviderUsage,
    createStep = createAgentRunStep,
    finishStep = finishAgentRunStep,
  } = deps;

  const startMs = Date.now();

  // 1. Cargar run
  const run = await loadRun(runId);
  if (!run) {
    return {
      status: 'error',
      runStatus: 'failed',
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      possibleDuplicates: 0,
      exactDuplicates: 0,
      rawResultsCount: 0,
      normalizedCount: 0,
      evaluatedCount: 0,
      rejectedByRelevance: 0,
      noReviewableContactsFound: false,
      providerStatus: 'error',
      estimatedCostUsd: 0,
      totalCandidates: 0,
      error: 'Run de enriquecimiento no encontrado',
    };
  }

  // 2. Validar estado
  if (run.status !== 'ready_to_enrich') {
    return {
      status: 'error',
      runStatus: run.status,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      possibleDuplicates: 0,
      exactDuplicates: 0,
      rawResultsCount: 0,
      normalizedCount: 0,
      evaluatedCount: 0,
      rejectedByRelevance: 0,
      noReviewableContactsFound: false,
      providerStatus: 'error',
      estimatedCostUsd: 0,
      totalCandidates: 0,
      error: `El run no está en estado ready_to_enrich (actual: ${run.status})`,
    };
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
    return {
      status: 'error',
      runStatus: 'failed',
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      possibleDuplicates: 0,
      exactDuplicates: 0,
      rawResultsCount: 0,
      normalizedCount: 0,
      evaluatedCount: 0,
      rejectedByRelevance: 0,
      noReviewableContactsFound: false,
      providerStatus: 'error',
      estimatedCostUsd: 0,
      totalCandidates: 0,
      error: apollo.reason,
    };
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
    return {
      status: 'skipped',
      runStatus: 'ready_to_enrich',
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      possibleDuplicates: 0,
      exactDuplicates: 0,
      rawResultsCount: 0,
      normalizedCount: 0,
      evaluatedCount: 0,
      rejectedByRelevance: 0,
      noReviewableContactsFound: false,
      providerStatus: 'skipped',
      estimatedCostUsd: 0,
      totalCandidates: 0,
      error: apollo.reason,
    };
  }

  // 6. Normalizar
  const rawResultsCount = apollo.providerUsage?.rawResultsCount ?? apollo.people.length;
  const { normalized } = normalizeApolloPeople(apollo.people);

  // 7. Clasificar relevancia/calidad. Solo los revisables pasan a dedup/inserción;
  //    los demás se contabilizan (relevance_filter) sin guardar payload crudo.
  const classified: ClassifiedContact[] = normalized.map((contact) => ({
    contact,
    relevance: classifyNormalizedContact(contact),
  }));
  const relevanceFilter = buildRelevanceFilter(classified);
  const chosenAttempt = apollo.chosenAttempt ?? null;

  // Solo revisables, con su veredicto de relevancia + intento Apollo en metadata.
  const reviewable: NormalizedApolloContact[] = classified
    .filter(({ relevance }) => relevance.shouldInsertForReview)
    .map(({ contact, relevance }) => ({
      ...contact,
      enrichmentMetadata: {
        ...contact.enrichmentMetadata,
        relevance: relevanceMetadata(relevance),
        apollo_search_attempt: chosenAttempt,
      },
    }));
  const rejectedByRelevance = relevanceFilter.rejected_count;

  // 8. Deduplicar (solo revisables) contra snapshot + intra-run
  const dedup = deduplicateContacts(reviewable, dedupSnapshot);

  // 9. Escribir candidatos (no_match + possible_duplicate)
  const writeResult = await writeCandidates(runId, dedup.toInsert);

  // 9a. Error de escritura → failed controlado
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
      estimated_cost_usd: 0,
      search_attempts: toAttemptSummaries(apollo.attempts),
      relevance_filter: relevanceFilter,
      reason: `Error al escribir candidatos: ${writeResult.error}`,
    };
    await updateRun(runId, {
      status: 'failed',
      summary: buildSummary(prevSummary, 0, apolloBlock),
    });
    if (step) {
      await finishStep(step.id, {
        status: 'error',
        error_message: writeResult.error,
        duration_ms: Date.now() - startMs,
      });
    }
    return {
      status: 'error',
      runStatus: 'failed',
      candidatesCreated: 0,
      duplicatesSkipped: dedup.exactDuplicateCount,
      possibleDuplicates: dedup.possibleDuplicateCount,
      exactDuplicates: dedup.exactDuplicateCount,
      rawResultsCount,
      normalizedCount: normalized.length,
      evaluatedCount: relevanceFilter.evaluated_count,
      rejectedByRelevance,
      noReviewableContactsFound: false,
      providerStatus: 'success',
      estimatedCostUsd: 0,
      totalCandidates: 0,
      error: writeResult.error,
    };
  }

  const insertedCount = writeResult.inserted;

  // 9. Costo estimado + registro de uso del proveedor
  const unitCost = await loadApolloUnitCost();
  const creditsUsed = apollo.providerUsage?.creditsUsed ?? rawResultsCount;
  const estimatedCostUsd = Number((creditsUsed * unitCost).toFixed(6));

  await logUsage({
    agent_run_id: run.agent_run_id ?? undefined,
    agent_run_step_id: step?.id,
    provider_key: APOLLO_PROVIDER_KEY,
    operation_key: APOLLO_OPERATION_KEY,
    credits_used: creditsUsed,
    results_returned: rawResultsCount,
    estimated_cost_usd: estimatedCostUsd,
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

  // 10. Estado final + summary preservando snapshot.
  //  - rawResultsCount === 0           → Apollo no encontró a nadie.
  //  - rawResultsCount > 0, inserted 0 → encontró perfiles pero ninguno revisable.
  const noContactsFound = rawResultsCount === 0;
  const noReviewableContactsFound = !noContactsFound && insertedCount === 0;
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
  };

  const summaryFlags: Record<string, unknown> = {
    no_contacts_found: noContactsFound,
    no_reviewable_contacts_found: noReviewableContactsFound,
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
    providerStatus: 'success',
    estimatedCostUsd,
    totalCandidates: insertedCount,
  };
}
