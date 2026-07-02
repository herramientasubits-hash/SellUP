/**
 * Incremental Search Orchestrator (Hito 16T.1 / 16T.3 / 16AB.43.24)
 *
 * Ejecuta búsqueda incremental en hasta 2 rondas:
 *   Ronda 1: queries standard (buildCleanMultiQueryDiscoveryQueries)
 *   Ronda 2 (si persistable < minUsefulCandidates): expanded queries, filtrando seenDomains
 *
 * Hito 16T.3 — Novelty pre-check antes de decidir ronda 2.
 *   La decisión de ejecutar ronda 2 usa estimatePersistableAfterNovelty()
 *   en lugar de usefulSoFar (pre-novelty). Esto evita el bug donde el
 *   orquestador creía tener N útiles pero el writer descartaba la mayoría
 *   por novelty, resultando en muy pocos candidatos persistidos.
 *
 * Hito 16AB.43.24 — Discovery novelty-aware.
 *   - Carga memoria negativa de dominios ya sugeridos (agent_1, últimos 30 días).
 *   - Registra cuántos candidatos por ronda estaban en memoria negativa.
 *   - Detención temprana si R1 encontró 0 dominios nuevos Y no hay additionalCriteria
 *     que abra un ángulo distinto.
 *   - Persiste discovery_strategy en metadata del batch.
 *
 * REGLAS CRÍTICAS:
 * - No llama Tavily directamente (lo hace el pipeline con provider).
 * - No llama LLM ni Apollo ni Lusha.
 * - No escribe en Supabase ni HubSpot.
 * - estimatePersistableAfterNovelty hace solo un SELECT de lectura (no writes).
 * - El writer sigue aplicando novelty como guardia definitiva.
 * - dryRun=true (default) → no llama writeProspectingCandidates, no llama Supabase.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProspectingPipeline } from './prospecting-pipeline';
import { writeProspectingCandidates, type LinkedInSearchOverride } from './candidate-writer';
import type { LinkedInSearchConfig } from './linkedin-company-search';
import { createTavilyLinkedInSearchProvider } from './linkedin-company-search-tavily';
import { createLinkedInUsageLoggerFn } from './tavily-usage-logging';
import { loadActiveTavilyLinkedInCompanySearchPricing } from '@/modules/usage-tracking/provider-pricing';
import { isLinkedInCompanySearchEnabled } from '@/lib/feature-flags.server';
import { resolveApolloMaxQueriesPerRun } from './apollo-cost-guardrails';
import { parseAdditionalCriteriaTokens } from '@/modules/prospect-batches/chat-wizard-execution/wizard-context-normalizer';
import { buildNoveltyIndex, evaluateCandidateNovelty } from './novelty-checker';
import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
  classifyQuery,
} from './query-builder';
import { buildSearchStrategyFromCatalog } from './search-strategy-builder';
import {
  loadDiscoveryNegativeMemory,
  emptyNegativeMemory,
  countDomainsInNegativeMemory,
} from './discovery-negative-memory';
import { buildDiscoveryQueryPlan, hasDiversificationAvailable } from './query-planner';
import {
  buildSourceGuidedInvestigationQueries,
  getSourceGuidedQueriesForRound,
} from './source-guided-investigation';
import type { SourceGuidedInvestigationOutput } from './source-guided-investigation';
import type { ProspectingPipelineCandidate, ProspectingPipelineOutput, ProspectingPipelineSummary } from './types';
import type {
  IncrementalSearchInput,
  IncrementalSearchOutput,
  IncrementalSearchMetadata,
  IncrementalSearchRoundMeta,
  IncrementalSearchStoppedReason,
  DiscoveryStrategyMetadata,
  AdaptiveDiscoveryMetadata,
  IncrementalSearchPlanMeta,
  SearchStrategyRuntimeMetadata,
  BlockedQuerySample,
  SourceGuidedInvestigationMetadata,
} from './incremental-search-types';
import type { SearchStrategyV1 } from './types';
import type { TavilyUsageContext } from './tavily-usage-logging';
import { enrichBatchCandidatesWithTaxResolution } from '@/server/source-catalog/enrichment/tax-identifier-resolution/enrich-with-tax-resolution';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_USEFUL = 7;
const DEFAULT_TARGET_INTERNAL = 10;
const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_TARGET_PERSISTIBLE = 10;
const DEFAULT_MAX_RAW = 50;
const DEFAULT_COOLDOWN_DAYS = 30;
const DEFAULT_NEGATIVE_MEMORY_LOOKBACK_DAYS = 30;

// ─── LinkedIn company search (v1.16K-R) ──────────────────────────────────────
// Strictly-capped config used ONLY when ENABLE_LINKEDIN_COMPANY_SEARCH=true.
// Low caps keep credit exposure minimal for a controlled, opt-in trial:
//   - maxPerBatch 5 (v1.16K-R-I, was 3) → at most 5 candidates searched per batch (hard cap is 5).
//   - minConfidenceScore 65 (v1.16K-R-I, was 70) → admit mid-score candidates for wider coverage.
//   - maxQueriesPerCandidate 1             → 1 Tavily call/candidate.
//   - maxResultsPerQuery 3 (v1.16K-R-D.1) → scan up to 3 results per call to improve recall;
//     billing stays 1 credit/call (Tavily basic search pricing is per-call, not per-result).
// Max cost per batch: 5 credits = USD 0.040 (was USD 0.024 with maxPerBatch=3).
// When the flag is false (default), no override is built and the writer performs
// zero LinkedIn searches — preserving current behavior and cost exactly.
export const LINKEDIN_SEARCH_STRICT_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: 5,
  minConfidenceScore: 65,
  maxQueriesPerCandidate: 1,
  maxResultsPerQuery: 3,
};

/**
 * Builds the LinkedIn company search override for the writer, gated by the
 * ENABLE_LINKEDIN_COMPANY_SEARCH flag. Returns undefined when the flag is off,
 * so the writer runs with no LinkedIn search (DEFAULT_LINKEDIN_SEARCH_CONFIG,
 * disabled) and makes zero Tavily calls.
 *
 * usageContext is intentionally omitted: the writer injects its own internal
 * batchId (and dryRun/userId) so usage logs bind to the real batch. We DO pass
 * the resolved unitCostUsd, which the writer folds into that default context so
 * each LinkedIn usage log records estimated_cost_usd > 0 (v1.16K-R-B).
 *
 * Pricing (provider_pricing_config: tavily/linkedin_company_search/per_credit)
 * is resolved here. If it is missing, unitCostUsd stays null and a clear warning
 * is logged; the orchestrator then blocks real Tavily calls with
 * skipped_reason='missing_pricing' rather than silently logging $0.
 */
async function buildLinkedInSearchOverride(
  triggeredByUserId: string | null,
): Promise<LinkedInSearchOverride | undefined> {
  if (!isLinkedInCompanySearchEnabled()) return undefined;

  const pricing = await loadActiveTavilyLinkedInCompanySearchPricing();
  const unitCostUsd = pricing?.unitCostUsd ?? null;
  if (unitCostUsd === null) {
    console.warn(
      '[linkedin_company_search] No active provider_pricing_config row for ' +
        'tavily/linkedin_company_search/per_credit. Real Tavily LinkedIn calls ' +
        'will be blocked (skipped_reason=missing_pricing) to avoid logging $0. ' +
        'Apply migration 069 before enabling ENABLE_LINKEDIN_COMPANY_SEARCH.',
    );
  }

  return {
    config: LINKEDIN_SEARCH_STRICT_CONFIG,
    providerFn: createTavilyLinkedInSearchProvider(
      LINKEDIN_SEARCH_STRICT_CONFIG.maxResultsPerQuery ?? 3,
    ),
    usageLoggerFn: createLinkedInUsageLoggerFn(triggeredByUserId),
    unitCostUsd,
  };
}

// ─── Query cap constants (Hito v1.3) ─────────────────────────────────────────
// Standard: máximo 16 queries totales, 4 por ronda. Deep: 36 totales.
// El cap se aplica solo cuando queryOverrides es definido (controlable desde aquí).
export const STANDARD_TOTAL_QUERY_CAP = 16;
export const STANDARD_PER_ROUND_CAP = 4;
export const DEEP_TOTAL_QUERY_CAP = 36;

// ─── Writer gate pass rate assumption (v1.16K-K) ─────────────────────────────
// Conservative factor applied to the novelty-only persistible estimate to get
// a writer-gate-adjusted estimate for stop criterion purposes.
// The novelty precheck does not account for canonical identity, content/intermediary,
// external platform, company ownership, source URL quality, or business-fit gates.
// Using the raw novelty-only count as the sole stop criterion causes false
// target_reached when the writer gates reject most candidates (audit batch
// 42c8d601: 22 novelty-passed → 0 persisted).
export const WRITER_GATE_PASS_RATE_ASSUMPTION = 0.30;

// ─── Tipos internos ───────────────────────────────────────────────────────────

type NoveltyPrecheckResult = {
  persistable_candidates_count: number;
  novelty_skipped_estimated: number;
  pending_recent_suggestion_count: number;
  confirmed_duplicate_count: number;
  rejected_recently_count: number;
};

// ─── Helper: candidato útil ───────────────────────────────────────────────────

function isUsefulCandidate(c: ProspectingPipelineCandidate): boolean {
  return (
    c.scoring.qualityLabel === 'high_quality_new' ||
    c.scoring.qualityLabel === 'needs_review'
  );
}

// ─── Helper: extraer queries ejecutadas desde metadata ───────────────────────

function extractQueriesFromMeta(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) return [];
  const qe = meta['queries_executed'];
  if (Array.isArray(qe) && qe.every((q) => typeof q === 'string')) return qe as string[];
  return [];
}

// ─── Helper: admin client (null si env no configurado) ───────────────────────

function tryGetAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

// ─── L2.8: Helper: agregar diagnostics Apollo por ronda al batch metadata ────

/**
 * Agrega los diagnósticos Apollo de todas las rondas para incluir en extraBatchMetadata.
 * Suma conteos numéricos, preserva la metadata del gate de la primera ronda significativa.
 * Solo se invoca cuando isApolloProvider=true y hay al menos una ronda ejecutada.
 */
function mergeApolloBatchDiagnostics(rounds: Array<Record<string, unknown>>): Record<string, unknown> {
  let rawResultsCount = 0;
  let normalizedResultsCount = 0;
  let postGateCount = 0;
  let rejectedCount = 0;
  let gateMeta: unknown = undefined;
  let diagnostics: unknown = undefined;

  for (const meta of rounds) {
    rawResultsCount += (typeof meta['apollo_raw_results_count'] === 'number' ? meta['apollo_raw_results_count'] : 0);
    normalizedResultsCount += (typeof meta['apollo_normalized_results_count'] === 'number' ? meta['apollo_normalized_results_count'] : 0);
    postGateCount += (typeof meta['apollo_post_gate_results_count'] === 'number' ? meta['apollo_post_gate_results_count'] : 0);
    rejectedCount += (typeof meta['apollo_sector_rejected_count'] === 'number' ? meta['apollo_sector_rejected_count'] : 0);
    // Tomar gate y diagnostics de la primera ronda que los tenga
    if (gateMeta === undefined && meta['apollo_sector_relevance_gate']) gateMeta = meta['apollo_sector_relevance_gate'];
    if (diagnostics === undefined && meta['apollo_result_diagnostics']) diagnostics = meta['apollo_result_diagnostics'];
  }

  return {
    apollo_raw_results_count: rawResultsCount,
    apollo_normalized_results_count: normalizedResultsCount,
    apollo_post_gate_results_count: postGateCount,
    apollo_sector_rejected_count: rejectedCount,
    ...(gateMeta !== undefined ? { apollo_sector_relevance_gate: gateMeta } : {}),
    ...(diagnostics !== undefined ? { apollo_result_diagnostics: diagnostics } : {}),
  };
}

// ─── estimatePersistableAfterNovelty ─────────────────────────────────────────

/**
 * Estima cuántos candidatos útiles sobrevivirían el novelty filter del writer.
 *
 * Usa la misma lógica (buildNoveltyIndex + evaluateCandidateNovelty) que el
 * writer, pero solo lee — no crea batch ni candidatos.
 *
 * Este es un pre-check estimado para tomar la decisión de ronda 2.
 * El writer SIEMPRE aplica novelty nuevamente como guardia definitiva.
 *
 * Solo se invoca cuando dryRun=false (requiere Supabase admin client).
 */
export async function estimatePersistableAfterNovelty(params: {
  supabase: SupabaseClient;
  candidates: ProspectingPipelineCandidate[];
  cooldownDays?: number;
}): Promise<NoveltyPrecheckResult> {
  const { supabase, candidates, cooldownDays = DEFAULT_COOLDOWN_DAYS } = params;

  if (candidates.length === 0) {
    return {
      persistable_candidates_count: 0,
      novelty_skipped_estimated: 0,
      pending_recent_suggestion_count: 0,
      confirmed_duplicate_count: 0,
      rejected_recently_count: 0,
    };
  }

  const domains = candidates.map((c) => c.domain ?? null);
  const index = await buildNoveltyIndex(supabase, domains);

  let persistable = 0;
  let noveltySkipped = 0;
  let pendingRecent = 0;
  let confirmedDuplicate = 0;
  let rejectedRecently = 0;

  for (const c of candidates) {
    const result = evaluateCandidateNovelty(
      { name: c.name, domain: c.domain, website: c.website },
      index,
      cooldownDays,
    );
    if (result.shouldSkip) {
      noveltySkipped++;
      if (result.status === 'pending_recent_suggestion') pendingRecent++;
      else if (result.status === 'confirmed_duplicate') confirmedDuplicate++;
      else if (result.status === 'rejected_recently') rejectedRecently++;
    } else {
      persistable++;
    }
  }

  return {
    persistable_candidates_count: persistable,
    novelty_skipped_estimated: noveltySkipped,
    pending_recent_suggestion_count: pendingRecent,
    confirmed_duplicate_count: confirmedDuplicate,
    rejected_recently_count: rejectedRecently,
  };
}

// ─── Enrichment post-discovery (Hito FIX-P0 + P1.1) ──────────────────────────

/**
 * Ejecuta enrichment post-discovery para candidatos del batch.
 * Solo para Colombia (CO). Non-blocking — nunca revienta el batch.
 *
 * Hito P1.1: resuelve NIT desde source_company_snapshots (SIIS) antes del
 * enrichment, para que fuentes que requieren tax_identifier puedan matchear.
 *
 * Lee candidatos desde la BD, resuelve tax_identifier si es posible,
 * persiste tax_identifier_resolution y tax_identifier, ejecuta enrichment
 * con el NIT resuelto, y persiste source_enrichment.
 */
export async function enrichBatchCandidates(
  supabase: SupabaseClient,
  batchId: string,
  countryCode: string,
): Promise<{ candidatesProcessed: number; sourcesApplied: string[]; warnings: string[]; errors: string[]; taxResolutionStatus?: import('@/server/source-catalog/enrichment/tax-identifier-resolution/types').TaxIdentifierResolutionBatchMetadata }> {
  if (countryCode !== 'CO' && countryCode !== 'MX' && countryCode !== 'CL') {
    return { candidatesProcessed: 0, sourcesApplied: [], warnings: [], errors: [] };
  }

  try {
    const result = await enrichBatchCandidatesWithTaxResolution(supabase, batchId, countryCode);

    return {
      candidatesProcessed: result.candidatesProcessed,
      sourcesApplied: result.sourcesApplied,
      warnings: result.warnings,
      errors: result.errors,
      taxResolutionStatus: result.taxResolutionStatus,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { candidatesProcessed: 0, sourcesApplied: [], warnings: [], errors: [msg] };
  }
}

// ─── Strategy query filter (Hito v1.8.1) ────────────────────────────────────

type StrategyFilterResult = {
  allowed: string[];
  blockedSamples: BlockedQuerySample[];
  sourceGuidedAllowed: number;
  sourceGuidedBlocked: number;
  fallbackAllowed: number;
};

/**
 * Filtra queries usando SearchStrategyV1.
 * Bloquea source-guided queries cuyo querySourceKey está en blockedSourceKeys.
 * Standard queries (querySourceKey=null) siempre pasan como fallback_web_query.
 */
function filterQueriesByStrategy(
  queries: string[],
  strategy: SearchStrategyV1,
  country: string,
  industry: string,
): StrategyFilterResult {
  const allowed: string[] = [];
  const blockedSamples: BlockedQuerySample[] = [];
  let sourceGuidedAllowed = 0;
  let sourceGuidedBlocked = 0;
  let fallbackAllowed = 0;

  for (const q of queries) {
    const { queryType, querySourceKey } = classifyQuery(q, country, industry);
    if (queryType === 'source_guided' && querySourceKey !== null) {
      if (strategy.queryStrategy.blockedSourceKeys.includes(querySourceKey)) {
        sourceGuidedBlocked++;
        if (blockedSamples.length < 3) {
          blockedSamples.push({
            query_text: q,
            query_source_key: querySourceKey,
            reason: `source_key_${querySourceKey}_blocked_by_search_strategy`,
          });
        }
      } else {
        sourceGuidedAllowed++;
        allowed.push(q);
      }
    } else {
      fallbackAllowed++;
      allowed.push(q);
    }
  }

  return { allowed, blockedSamples, sourceGuidedAllowed, sourceGuidedBlocked, fallbackAllowed };
}

// ─── Orquestador principal ────────────────────────────────────────────────────

export async function runIncrementalProspectingSearch(
  input: IncrementalSearchInput,
  // For testing only: inject a custom writer to verify existingBatchId forwarding.
  // Production callers always omit this parameter.
  writerOverride?: typeof writeProspectingCandidates,
  // For testing only: inject a custom pipeline to capture per-round usageContext.
  // Production callers always omit this parameter.
  pipelineOverride?: typeof runProspectingPipeline,
): Promise<IncrementalSearchOutput> {
  const minUsefulCandidates = input.minUsefulCandidates ?? DEFAULT_MIN_USEFUL;
  const targetInternal = input.targetInternal ?? DEFAULT_TARGET_INTERNAL;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxTotalRawToEvaluate = input.maxTotalRawToEvaluate ?? DEFAULT_MAX_RAW;
  const dryRun = input.dryRun !== false;
  const targetPersistibleCandidates = input.targetPersistibleCandidates ?? DEFAULT_TARGET_PERSISTIBLE;

  const allCandidates: ProspectingPipelineCandidate[] = [];
  const roundsMeta: IncrementalSearchRoundMeta[] = [];
  const warnings: string[] = [];
  const seenDomains = new Set<string>();
  const usedQueryTexts = new Set<string>();

  let totalRawEvaluated = 0;
  let stoppedReason: IncrementalSearchStoppedReason = 'max_rounds_reached';
  let lastPipelineOutput: ProspectingPipelineOutput | null = null;
  let writerBatchId: string | null = null;
  let writerCandidatesCreated: number | undefined = undefined;
  let totalExcludedByNegativeMemory = 0;

  // ─── Query cap tracking (Hito v1.3) ─────────────────────────────────────────
  let totalQueriesExecuted = 0;
  let totalQueriesGenerated = 0;
  let totalQueriesSkippedByCap = 0;

  // ─── Apollo global query budget (v1.16K-AC) ──────────────────────────────────
  // Cap que se acumula a lo largo de TODAS las rondas para provider apollo_organizations.
  // Resuelve la causa raíz del consumo excesivo (N rondas × cap_por_invocación).
  // Tavily y mock no se ven afectados.
  const isApolloProvider = input.webSearchProvider === 'apollo_organizations';
  const apolloGlobalCap = isApolloProvider ? resolveApolloMaxQueriesPerRun() : Infinity;
  let apolloQueriesExecutedTotal = 0;

  // ─── L2.8: diagnósticos Apollo por ronda ─────────────────────────────────────
  // Recolecta metadata de trazabilidad del web search output de cada ronda Apollo.
  // Se propaga a extraBatchMetadata para que el batch sea diagnosticable.
  // Tavily y mock no se ven afectados.
  const apolloRoundDiagnostics: Array<Record<string, unknown>> = [];

  const allQueryTraceSummaryEntries: Array<{
    query_text: string;
    query_type: string;
    query_source_key: string | null;
    round_number: number;
  }> = [];

  const writerFn = writerOverride ?? writeProspectingCandidates;
  const pipelineFn = pipelineOverride ?? runProspectingPipeline;

  // Admin client para novelty pre-check y negative memory (solo cuando dryRun=false)
  const adminSupabase: SupabaseClient | null = dryRun ? null : tryGetAdminClient();
  if (!dryRun && !adminSupabase) {
    warnings.push('novelty_precheck_unavailable: Supabase env vars not set; falling back to pre-novelty useful count for round decision.');
  }

  // ── Carga memoria negativa (Hito 16AB.43.24) ─────────────────────────────────
  // Dominios ya sugeridos en corridas previas de agent_1. Se usa para:
  //   a) Registrar cuántos resultados por ronda ya estaban vistos.
  //   b) Informar la decisión de early stop.
  const negativeMemoryScope = {
    countryCode: input.countryCode,
    industryName: input.industry,
    subindustryNames: input.subindustries ?? [],
    lookbackDays: DEFAULT_NEGATIVE_MEMORY_LOOKBACK_DAYS,
  };
  const negativeMemory = adminSupabase
    ? await loadDiscoveryNegativeMemory(adminSupabase, negativeMemoryScope).catch(() => {
        warnings.push('negative_memory_load_error: fallback to empty memory');
        return emptyNegativeMemory(negativeMemoryScope);
      })
    : emptyNegativeMemory(negativeMemoryScope);

  // ── Query planner (Hito 16AB.43.24) ──────────────────────────────────────────
  // Genera metadata de plan sin ejecutar queries. Se actualiza con el count de
  // persistables de R1 antes de planificar R2.
  const basePlan = buildDiscoveryQueryPlan({
    industry: input.industry,
    country: input.country,
    subindustries: input.subindustries ?? [],
    additionalCriteria: input.additionalCriteria ?? null,
  });

  // ── Search strategy (Hito v1.8.1) ───────────────────────────────────────────
  // Materializa SearchStrategyV1 para filtrar source-guided queries en runtime.
  const searchStrategy: SearchStrategyV1 = buildSearchStrategyFromCatalog({
    countryCode: input.countryCode,
    country: input.country,
    industry: input.industry,
    subindustries: input.subindustries ?? [],
    additionalCriteria: input.additionalCriteria ?? null,
  });

  // Runtime counters — acumulados a lo largo de todas las rondas
  let strategySourceGuidedAllowed = 0;
  let strategySourceGuidedBlocked = 0;
  let strategyFallbackAllowed = 0;
  const allBlockedSamples: BlockedQuerySample[] = [];

  // ── Source-Guided Investigation (Hito v1.12) ──────────────────────────────
  // Genera query packs de alta precisión antes del loop de rondas.
  // Los packs se integran al queryOverrides de cada ronda con prioridad alta.
  const sourceGuidedInvestigationOutput: SourceGuidedInvestigationOutput = buildSourceGuidedInvestigationQueries({
    countryCode: input.countryCode,
    country: input.country,
    industry: input.industry,
    subindustries: input.subindustries ?? [],
    searchStrategy,
    additionalCriteria: input.additionalCriteria ?? null,
  });

  let investigationSourceGuidedAdded = 0;
  let investigationSourceGuidedBlocked = 0;
  let investigationFallbackAdded = 0;

  // Acumula el último resultado de pre-check para metadata
  let lastNoveltyPrecheck: NoveltyPrecheckResult | null = null;
  let round1PersistableCount: number | undefined = undefined;

  for (let round = 1; round <= maxRounds; round++) {
    const subindustries = input.subindustries ?? [];

    let queryOverrides: string[] | undefined;
    if (round === 1) {
      queryOverrides = subindustries.length > 0
        ? buildCleanMultiQueryDiscoveryQueries(input.industry, input.country, subindustries)
        : undefined;
    } else if (round === 2) {
      // R2: usar planner para obtener queries con SECOP gating correcto
      const excludeSources = basePlan.secop_excluded ? ['co_secop2'] : [];
      queryOverrides = buildExpandedMultiQueryDiscoveryQueries(
        input.industry,
        input.country,
        subindustries,
        { excludeSources },
      );
    } else if (round === 3) {
      // R3: partner/implementation angle — queries de ángulo implementador
      // Hito 16AB.43.27: eliminadas "nosotros" y "contacto" para evitar páginas genéricas
      // Hito 16AB.43.28: eliminado "casos de éxito" para evitar páginas de content/artículo
      const r3Queries = [
        `implementador ${input.industry} ${input.country} clientes corporativos empresa oficial`,
        `partner ${input.industry} ${input.country} soluciones empresariales certificado`,
        `integrador ${input.industry} ${input.country} software empresa oficial corporativo`,
        // Hito v1.5: reemplaza "consultor {industry} {country} transformación digital empresas"
        // — demasiado genérica, atraía artículos de consultoría/medios.
        `consultor ERP CRM ${input.country} implementación empresas`,
        `proveedor ${input.industry} ${input.country} software empresarial clientes`,
      ];
      queryOverrides = r3Queries.filter(q => !usedQueryTexts.has(q));
      if (queryOverrides.length === 0) {
        stoppedReason = 'novelty_exhausted_no_diversification_available';
        break;
      }
    } else if (round === 4) {
      // R4: corporate buyer/ecosystem angle
      // Hito 16AB.43.27: eliminadas "nosotros" y "contacto" para evitar páginas genéricas
      // Hito 16AB.43.28: eliminado "caso de éxito" para evitar páginas de content/artículo
      const r4Queries = [
        `software empresarial ${input.industry} ${input.country} proveedor B2B corporativo`,
        // Hito v1.4: reemplaza "empresa sector corporativo ecosistema" — demasiado genérica,
        // atraía artículos/medios de contenido en lugar de empresas candidato.
        `implementador ERP CRM ${input.country} empresa oficial clientes corporativos`,
        // Hito v1.5: reemplaza "proveedor {industry} {country} transformación digital clientes"
        // — "transformación digital" atraía contenido/medios genéricos.
        `proveedor software ${input.industry} ${input.country} B2B clientes corporativos`,
        `${input.industry} empresa ${input.country} cartera clientes corporativo`,
        // Hito v1.5: reemplaza "{industry} {country} empresa solución tecnológica corporativa"
        // — demasiado genérica; esta versión ancla a productos concretos (ERP/SaaS).
        `${input.industry} ${input.country} empresa software ERP SaaS oficial`,
      ];
      queryOverrides = r4Queries.filter(q => !usedQueryTexts.has(q));
      if (queryOverrides.length === 0) {
        stoppedReason = 'novelty_exhausted_no_diversification_available';
        break;
      }
    }

    // ── Source-Guided Investigation injection (Hito v1.12) ───────────────────
    // Pre-pende queries de alta precisión del investigation pack antes del
    // strategy filter. Así las source-guided se priorizan sobre fallback.
    // Máximo 2 por ronda para no saturar el per-round cap (4) y dejar espacio
    // a queries de subindustria, fintech, y otras señales contextuales.
    if (queryOverrides !== undefined && sourceGuidedInvestigationOutput.enabled) {
      const MAX_INVESTIGATION_PER_ROUND = 2;
      const roundInvestigationQueries = getSourceGuidedQueriesForRound(
        sourceGuidedInvestigationOutput,
        round as 1 | 2,
      );
      const cappedInvestigation = roundInvestigationQueries.slice(0, MAX_INVESTIGATION_PER_ROUND);
      if (cappedInvestigation.length > 0) {
        const beforeLen = queryOverrides.length;
        queryOverrides = [...cappedInvestigation, ...queryOverrides];
        investigationSourceGuidedAdded += cappedInvestigation.length;
        const addedCount = queryOverrides.length - beforeLen;
        investigationFallbackAdded += beforeLen;
      }
    }

    // ── Strategy filter (Hito v1.8.1) ────────────────────────────────────────
    // Bloquea source-guided queries cuyos sourceKey están en blockedSourceKeys.
    // Se aplica antes del query cap para que el cap opere sobre el conjunto ya filtrado.
    if (queryOverrides !== undefined) {
      const filterResult = filterQueriesByStrategy(
        queryOverrides,
        searchStrategy,
        input.country,
        input.industry,
      );
      queryOverrides = filterResult.allowed;
      strategySourceGuidedBlocked += filterResult.sourceGuidedBlocked;
      if (filterResult.blockedSamples.length > 0 && allBlockedSamples.length < 3) {
        allBlockedSamples.push(...filterResult.blockedSamples.slice(0, 3 - allBlockedSamples.length));
      }
    }

    // ── Query cap application (Hito v1.3) ─────────────────────────────────────
    // Cap applies only to explicitly defined queryOverrides (controllable from here).
    // When queryOverrides is undefined, the pipeline uses its own defaults (uncontrolled).
    const hasExplicitOverrides = queryOverrides !== undefined;
    if (hasExplicitOverrides) {
      const rawLen = queryOverrides!.length;
      totalQueriesGenerated += rawLen;
      const remainingBudget = Math.max(0, STANDARD_TOTAL_QUERY_CAP - totalQueriesExecuted);
      const allowedThisRound = Math.min(STANDARD_PER_ROUND_CAP, remainingBudget);
      if (rawLen > allowedThisRound) {
        totalQueriesSkippedByCap += rawLen - allowedThisRound;
        queryOverrides = queryOverrides!.slice(0, allowedThisRound);
      }
      // If no budget remains, stop before calling the pipeline.
      if (allowedThisRound <= 0) {
        stoppedReason = 'max_rounds_reached';
        break;
      }
    }

    // ── Apollo global query budget cap (v1.16K-AC) ────────────────────────────
    // Aplica DESPUÉS del cap por ronda para que ambas restricciones sean respetadas.
    // Garantiza que el total de queries Apollo no supere apolloGlobalCap aunque
    // el orquestador ejecute múltiples rondas.
    if (isApolloProvider) {
      const apolloRemaining = apolloGlobalCap - apolloQueriesExecutedTotal;
      if (apolloRemaining <= 0) {
        stoppedReason = 'max_rounds_reached';
        break;
      }
      if (queryOverrides !== undefined && queryOverrides.length > apolloRemaining) {
        queryOverrides = queryOverrides.slice(0, apolloRemaining);
      } else if (queryOverrides === undefined) {
        // Fallback defensivo: el wizard siempre pasa subindustries, pero si no hay
        // queryOverrides, generamos queries básicas acotadas al presupuesto restante.
        queryOverrides = buildCleanMultiQueryDiscoveryQueries(input.industry, input.country)
          .slice(0, apolloRemaining);
      }
    }

    // ── Post-cap counting for runtime metadata ─────────────────────────────
    // Count only queries that survive the cap, so metadata reflects actual execution.
    if (queryOverrides !== undefined) {
      for (const q of queryOverrides) {
        const { queryType, querySourceKey } = classifyQuery(q, input.country, input.industry);
        if (queryType === 'source_guided' && querySourceKey !== null) {
          strategySourceGuidedAllowed++;
        } else {
          strategyFallbackAllowed++;
        }
      }
    }

    // Record query texts used this round for deduplication across rounds
    (queryOverrides ?? []).forEach(q => usedQueryTexts.add(q));

    const roundUsageContext: TavilyUsageContext | null = input.usageInputContext
      ? { ...input.usageInputContext, roundNumber: round }
      : null;

    // L2.7: tokens del criterio adicional para providers estructurados (Apollo).
    // Tavily los ignora — sigue usando el texto original del wizard.
    const additionalCriteriaTokens = parseAdditionalCriteriaTokens(input.additionalCriteria);

    const pipelineOutput = await pipelineFn({
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      webSearchProvider: input.webSearchProvider ?? 'mock',
      mode: 'multi_query',
      targetCount: targetInternal,
      queryOverrides,
      usageContext: roundUsageContext,
      // L2.7: subindustrias y tokens para Apollo. ProspectingPipelineInput los acepta
      // como campos opcionales y los propaga a runMultiQueryWebSearch.
      subindustries: input.subindustries,
      additionalCriteriaTokens: additionalCriteriaTokens.length > 0 ? additionalCriteriaTokens : undefined,
    });

    const rawCount = pipelineOutput.webSearch.resultsCount;
    totalRawEvaluated += rawCount;

    // L2.8: Recolectar diagnostics de Apollo por ronda para propagación al batch.
    // pipelineOutput.webSearch.metadata contiene apollo_raw_results_count,
    // apollo_result_diagnostics, apollo_sector_relevance_gate, etc.
    // rawCount = post-gate count (puede ser 0 aunque Apollo devolvió N orgs).
    if (isApolloProvider) {
      const wsMeta = pipelineOutput.webSearch.metadata as Record<string, unknown> | undefined;
      if (wsMeta && typeof wsMeta === 'object') apolloRoundDiagnostics.push(wsMeta);
    }

    // ── Track actual queries executed (Hito v1.3) ─────────────────────────────
    const executedQueriesThisRound = extractQueriesFromMeta(pipelineOutput.metadata);
    totalQueriesExecuted += executedQueriesThisRound.length;
    // For uncontrolled rounds (undefined overrides), generated equals executed.
    if (!hasExplicitOverrides) {
      totalQueriesGenerated += executedQueriesThisRound.length;
    }

    // ── Apollo global query budget: acumular ejecutadas (v1.16K-AC) ──────────
    if (isApolloProvider) {
      // Usar el conteo real si el pipeline lo reporta; si no, usar lo que enviamos.
      const roundExecuted = executedQueriesThisRound.length > 0
        ? executedQueriesThisRound.length
        : (queryOverrides?.length ?? 1);
      apolloQueriesExecutedTotal += roundExecuted;
    }

    // Acumula query_trace_summary de esta ronda anotado con round_number (Hito 16Z.3)
    const roundPipelineMeta = pipelineOutput.metadata ?? {};
    const roundQts = roundPipelineMeta['query_trace_summary'];
    if (roundQts && typeof roundQts === 'object' && 'queries_executed' in roundQts) {
      const qts = roundQts as { queries_executed: Array<{ query_text: string; query_type: string; query_source_key: string | null }> };
      for (const q of qts.queries_executed) {
        allQueryTraceSummaryEntries.push({ ...q, round_number: round });
      }
    }

    // ── Filtro cross-round por seenDomains ───────────────────────────────────
    const seenDomainsAtStart = seenDomains.size;
    const newCandidates: ProspectingPipelineCandidate[] = [];

    for (const c of pipelineOutput.candidates) {
      if (c.domain) {
        if (seenDomains.has(c.domain)) continue;
        seenDomains.add(c.domain);
      }
      newCandidates.push(c);
    }

    // ── Memoria negativa: contar cuántos candidatos nuevos ya estaban vistos ─
    const roundDomains = newCandidates.map((c) => c.domain ?? null);
    const excludedByNegMemCount = countDomainsInNegativeMemory(roundDomains, negativeMemory);
    const newAfterNegMemCount = newCandidates.length - excludedByNegMemCount;
    totalExcludedByNegativeMemory += excludedByNegMemCount;

    // Anota round_number en searchTrace de cada candidato nuevo (Hito 16Z.3)
    const candidatesWithRound: ProspectingPipelineCandidate[] = newCandidates.map((c) => {
      if (!c.searchTrace) return c;
      return { ...c, searchTrace: { ...c.searchTrace, round_number: round } };
    });
    allCandidates.push(...candidatesWithRound);

    const usefulSoFar = allCandidates.filter(isUsefulCandidate).length;

    roundsMeta.push({
      round,
      queriesUsed: executedQueriesThisRound,
      rawResultsCount: rawCount,
      candidatesEvaluated: pipelineOutput.candidates.length,
      candidatesNewAfterDomainFilter: newCandidates.length,
      candidatesAccumulatedTotal: allCandidates.length,
      usefulCandidatesAccumulated: usefulSoFar,
      seenDomainsAtRoundStart: seenDomainsAtStart,
      newDomainsFoundThisRound: seenDomains.size - seenDomainsAtStart,
      excludedByNegativeMemoryCount: excludedByNegMemCount,
      newAfterNegativeMemoryCount: newAfterNegMemCount,
    });

    lastPipelineOutput = pipelineOutput;

    // ── Criterio de parada: 0 resultados en ronda 1 ─────────────────────────
    if (round === 1 && rawCount === 0) {
      stoppedReason = 'no_results_round_1';
      break;
    }

    // ── Novelty pre-check (dryRun=false + Supabase disponible) ──────────────
    if (adminSupabase) {
      const usefulCandidates = allCandidates.filter(isUsefulCandidate);
      try {
        lastNoveltyPrecheck = await estimatePersistableAfterNovelty({
          supabase: adminSupabase,
          candidates: usefulCandidates,
        });
      } catch {
        warnings.push(`novelty_precheck_error_round_${round}: fallback to pre-novelty useful count`);
        lastNoveltyPrecheck = null;
      }
    }

    // ── Criterio de parada: mínimo útiles alcanzado ──────────────────────────
    // v1.16K-K: Distinguish novelty-only estimate (what estimatePersistableAfterNovelty
    // returns) from the writer-gate-adjusted estimate (applies conservative pass rate).
    // Only the adjusted estimate triggers target_reached to avoid false stops.
    const noveltyOnlyPersistibleEstimate =
      lastNoveltyPrecheck !== null
        ? lastNoveltyPrecheck.persistable_candidates_count
        : usefulSoFar;

    const writerGateAdjustedEstimate = lastNoveltyPrecheck !== null
      ? Math.floor(noveltyOnlyPersistibleEstimate * WRITER_GATE_PASS_RATE_ASSUMPTION)
      : noveltyOnlyPersistibleEstimate;

    if (round === 1) {
      round1PersistableCount = writerGateAdjustedEstimate;
    }

    if (writerGateAdjustedEstimate >= targetPersistibleCandidates) {
      stoppedReason = 'target_reached';
      break;
    }
    // Fallback: if target is 0, use raw novelty-only count (legacy behavior)
    if (targetPersistibleCandidates === 0 && noveltyOnlyPersistibleEstimate >= minUsefulCandidates) {
      stoppedReason = 'target_reached';
      break;
    }

    // ── Early stop (Hito 16AB.43.24): sin dominios nuevos Y sin diversificación
    // Condición: R1 produjo 0 dominios nuevos fuera de memoria negativa Y
    //   persistable = 0 Y no hay additionalCriteria que abra un ángulo nuevo.
    // Se evita la ronda 2 solo cuando hay evidencia fuerte de que produciría
    // los mismos resultados (ahorro de créditos Tavily).
    if (
      round < maxRounds &&
      newAfterNegMemCount === 0 &&
      rawCount > 0 &&
      writerGateAdjustedEstimate === 0 &&
      !input.additionalCriteria &&
      !hasDiversificationAvailable(basePlan)
    ) {
      stoppedReason = 'novelty_exhausted_no_diversification_available';
      break;
    }

    // ── Criterio de parada: raw máximo alcanzado ─────────────────────────────
    if (totalRawEvaluated >= maxTotalRawToEvaluate) {
      stoppedReason = 'max_raw_exceeded';
      break;
    }
  }

  const consolidatedQueryTraceSummary = allQueryTraceSummaryEntries.length > 0
    ? { enabled: true, queries_executed: allQueryTraceSummaryEntries }
    : undefined;

  const usefulCandidatesCount = allCandidates.filter(isUsefulCandidate).length;

  const persistableAfterNovelty = lastNoveltyPrecheck?.persistable_candidates_count;
  const noveltyExhausted =
    lastNoveltyPrecheck !== null &&
    usefulCandidatesCount > 0 &&
    persistableAfterNovelty === 0;

  const targetReached = !dryRun && (writerCandidatesCreated ?? 0) >= targetPersistibleCandidates;

  // ── Construir discovery_strategy metadata (Hito 16AB.43.24) ────────────────
  const allFamiliesUsed = [
    ...(roundsMeta.length >= 1 ? basePlan.families_r1 : []),
    ...(roundsMeta.length >= 2 ? basePlan.families_r2 : []),
  ];

  const discoveryStrategy: DiscoveryStrategyMetadata = {
    version: 'novelty_aware_v1',
    negative_memory_enabled: negativeMemory.excludedDomains.size > 0 || adminSupabase !== null,
    excluded_domains_count: totalExcludedByNegativeMemory,
    excluded_domains_sample: negativeMemory.excludedDomainsSample.slice(0, 10),
    query_families_used: [...new Set(allFamiliesUsed)],
    source_gating_applied: basePlan.secop_excluded || !basePlan.source_gating_decisions.find((d) => d.source_key === 'co_colombia_fintech')?.allowed,
    source_gating_decisions: basePlan.source_gating_decisions,
    secop_excluded: basePlan.secop_excluded,
    ...(roundsMeta.length >= 2 ? { round2_strategy: basePlan.round2_strategy } : {}),
    ...(stoppedReason === 'novelty_exhausted_no_diversification_available'
      ? {
          early_stop_reason: stoppedReason,
          credits_saved_estimate: targetInternal > 0 ? Math.round(targetInternal / 5) : 5,
        }
      : {}),
  };

  // ── Incremental search plan (Hito v1.3) ──────────────────────────────────────
  // Persisted as top-level search_plan in extraBatchMetadata so it lands in
  // prospect_batches.metadata->'search_plan' for SQL querying.
  const queryCapApplied = totalQueriesSkippedByCap > 0;
  const incrementalSearchPlan: IncrementalSearchPlanMeta = {
    version: 'search_planner_v1_3',
    usedForExecution: true,
    fallbackUsed: false,
    querySelectionReason: 'incremental_multi_round',
    queryCap: {
      searchDepth: 'standard',
      totalQueryCap: STANDARD_TOTAL_QUERY_CAP,
      perRoundCap: STANDARD_PER_ROUND_CAP,
      queryCapApplied,
      queriesGeneratedBeforeCap: totalQueriesGenerated,
      queriesExecutedAfterCap: totalQueriesExecuted,
      skippedByQueryCap: totalQueriesSkippedByCap,
    },
    queryFamilies: [...new Set([...basePlan.families_r1, ...basePlan.families_r2])],
    sourceStrategy: basePlan.source_gating_decisions,
  };

  // ── Adaptive discovery — helper + placeholder (Hito 16AB.43.27) ─────────────
  // persisted_count starts at 0 and is reconciled post-writer with actual count.

  const adaptiveStopReason: AdaptiveDiscoveryMetadata['stop_reason'] =
    stoppedReason === 'target_reached'
      ? 'target_reached'
      : stoppedReason === 'novelty_exhausted_no_diversification_available'
      ? 'novelty_exhausted_no_diversification_available'
      : stoppedReason === 'max_rounds_reached'
      ? 'max_rounds_reached'
      : 'budget_cap_reached';

  const buildAdaptiveDiscovery = (persistedCount: number): AdaptiveDiscoveryMetadata => {
    const remainingToTarget = Math.max(0, targetPersistibleCandidates - persistedCount);
    const resultStatus: AdaptiveDiscoveryMetadata['result_status'] =
      persistedCount >= targetPersistibleCandidates
        ? 'success_target_reached'
        : persistedCount > 0
        ? 'success_partial'
        : 'no_new_candidates';
    return {
      enabled: true,
      target_persistible_candidates: targetPersistibleCandidates,
      persisted_count: persistedCount,
      persistible_estimate: lastNoveltyPrecheck?.persistable_candidates_count ?? 0,
      remaining_to_target: remainingToTarget,
      max_rounds: maxRounds,
      rounds_executed: roundsMeta.length,
      stop_reason: adaptiveStopReason,
      result_status: resultStatus,
    };
  };

  const adaptiveDiscovery = buildAdaptiveDiscovery(0); // reconciled after writer

  const metadata: IncrementalSearchMetadata = {
    rounds_executed: roundsMeta.length,
    stopped_reason: stoppedReason,
    total_raw_evaluated: totalRawEvaluated,
    total_candidates_accumulated: allCandidates.length,
    useful_candidates_count: usefulCandidatesCount,
    useful_candidates_count_before_novelty: usefulCandidatesCount,
    estimated_persistable_after_novelty: persistableAfterNovelty,
    estimated_novelty_skipped: lastNoveltyPrecheck?.novelty_skipped_estimated,
    novelty_precheck: lastNoveltyPrecheck
      ? {
          enabled: true,
          estimated_skipped_count: lastNoveltyPrecheck.novelty_skipped_estimated,
          estimated_persistable_count: lastNoveltyPrecheck.persistable_candidates_count,
          novelty_only_persistible_estimate: lastNoveltyPrecheck.persistable_candidates_count,
          writer_gate_adjusted_persistible_estimate: Math.floor(
            lastNoveltyPrecheck.persistable_candidates_count * WRITER_GATE_PASS_RATE_ASSUMPTION,
          ),
          writer_gate_pass_rate_assumption: WRITER_GATE_PASS_RATE_ASSUMPTION,
          stop_criterion_version: 'v2_writer_gate_adjusted',
          stop_criterion_basis: 'writer_gate_adjusted' as const,
        }
      : undefined,
    novelty_exhausted: noveltyExhausted || undefined,
    excluded_by_negative_memory_total: totalExcludedByNegativeMemory > 0
      ? totalExcludedByNegativeMemory
      : undefined,
    discovery_strategy: discoveryStrategy,
    adaptive_discovery: adaptiveDiscovery,
    source_guided_investigation: sourceGuidedInvestigationOutput.enabled
      ? {
          enabled: true,
          version: 'source_guided_investigation_v1_12' as const,
          generated_query_count: sourceGuidedInvestigationOutput.generated_query_count,
          selected_query_count: sourceGuidedInvestigationOutput.selected_query_count,
          source_guided_selected_count: sourceGuidedInvestigationOutput.source_guided_selected_count,
          fallback_selected_count: sourceGuidedInvestigationOutput.fallback_selected_count,
          query_packs: sourceGuidedInvestigationOutput.query_packs.map((q) => ({
            source_key: q.query_source_key,
            intent: q.intent,
            query_text: q.query_text,
            priority: q.priority,
          })),
          blocked_source_query_count: sourceGuidedInvestigationOutput.blocked_source_query_count,
          blocked_sources: sourceGuidedInvestigationOutput.blocked_sources,
        }
      : undefined,
    min_useful_candidates: minUsefulCandidates,
    target_internal: targetInternal,
    max_rounds: maxRounds,
    max_total_raw_to_evaluate: maxTotalRawToEvaluate,
    dry_run: dryRun,
    rounds: roundsMeta,
  };

  // ── Search strategy runtime metadata (Hito v1.8.1) ──────────────────────────
  // Built outside dryRun so tests can verify it without needing a real writer.
  const searchStrategyRuntime: SearchStrategyRuntimeMetadata = {
    enabled: true,
    source_guided_queries_allowed: strategySourceGuidedAllowed,
    source_guided_queries_blocked: strategySourceGuidedBlocked,
    fallback_queries_allowed: strategyFallbackAllowed,
    blocked_samples: allBlockedSamples,
  };

  // ── Writer (Hito 16T.2) ──────────────────────────────────────────────────────
  if (!dryRun) {
    if (!lastPipelineOutput) {
      warnings.push('dryRun=false: no hay resultados del pipeline para persistir.');
    } else {
      const summary: ProspectingPipelineSummary = {
        requested: targetInternal,
        searched: totalRawEvaluated,
        returned: allCandidates.length,
        highQualityNew: allCandidates.filter((c) => c.scoring.qualityLabel === 'high_quality_new').length,
        needsReview: allCandidates.filter((c) => c.scoring.qualityLabel === 'needs_review').length,
        duplicates: allCandidates.filter((c) => c.scoring.qualityLabel === 'duplicate').length,
        insufficientData: allCandidates.filter((c) => c.scoring.qualityLabel === 'insufficient_data').length,
        discarded: allCandidates.filter((c) => c.scoring.qualityLabel === 'discard').length,
        unchecked: 0,
      };

      const syntheticPipelineOutput: ProspectingPipelineOutput = {
        input: {
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          webSearchProvider: input.webSearchProvider ?? 'tavily',
          mode: 'multi_query',
        },
        catalogContext: lastPipelineOutput.catalogContext,
        searchQuery: `incremental_search:${roundsMeta.length}_rounds`,
        webSearch: {
          provider: input.webSearchProvider ?? 'tavily',
          query: `incremental_search:${roundsMeta.length}_rounds`,
          results: [],
          resultsCount: totalRawEvaluated,
          skipped: false,
          estimatedCostUsd: null,
          metadata: {},
        },
        candidates: allCandidates,
        summary,
        warnings,
        metadata: {
          provider: input.webSearchProvider ?? 'tavily',
          search_mode: 'incremental_multi_query',
          pipelineVersion: 'incremental_v1',
          executedAt: new Date().toISOString(),
          generation_mode: 'incremental_search',
          ...(consolidatedQueryTraceSummary ? { query_trace_summary: consolidatedQueryTraceSummary } : {}),
        },
      };

      // Strip adaptive_discovery from the nested incremental_search object (Hito v1.3).
      // Top-level adaptive_discovery (reconciled post-writer) is the source of truth.
      // The placeholder with persisted_count=0 inside incremental_search contradicted it.
      const { adaptive_discovery: _adNested, ...metadataForNestedStorage } = metadata;

      const writerOutput = await writerFn({
        pipelineOutput: syntheticPipelineOutput,
        triggeredByUserId: input.triggeredByUserId ?? null,
        ownerId: input.ownerId ?? null,
        batchName: input.batchName ?? null,
        source: 'agent_1',
        dryRun: false,
        targetPersistibleCandidates: targetPersistibleCandidates,
        extraBatchMetadata: {
          incremental_search: metadataForNestedStorage as Record<string, unknown>,
          search_plan: incrementalSearchPlan as Record<string, unknown>,
          search_mode: 'incremental_multi_round',
          discovery_strategy: discoveryStrategy as Record<string, unknown>,
          adaptive_discovery: adaptiveDiscovery as Record<string, unknown>,
          search_strategy: searchStrategy as Record<string, unknown>,
          search_strategy_runtime: searchStrategyRuntime as Record<string, unknown>,
          source_guided_investigation: metadata.source_guided_investigation as Record<string, unknown> | undefined,
          ...(input.additionalCriteria != null
            ? { additional_criteria: input.additionalCriteria }
            : {}),
          // Hito 16AB.43.29: subindustrias pasadas al writer para el business-fit gate.
          ...(input.subindustries != null && input.subindustries.length > 0
            ? { subindustries: input.subindustries }
            : {}),
          // L2.8: Apollo result diagnostics — permite diagnosticar en el batch
          // por qué apollo_raw_results_count > 0 pero candidatesEvaluated = 0.
          ...(isApolloProvider && apolloRoundDiagnostics.length > 0
            ? mergeApolloBatchDiagnostics(apolloRoundDiagnostics)
            : {}),
        },
        existingBatchId: input.existingBatchId ?? null,
      },
      // v1.16K-R: positional args 2-3 of writeProspectingCandidates.
      // adminClientOverride stays undefined (writer reads env).
      // v1.16K-AC: LinkedIn enrichment is skipped when Apollo is the provider —
      // Apollo already provides structured company data and adding Tavily LinkedIn
      // searches would add cost without proportional benefit during QA runs.
      undefined,
      isApolloProvider
        ? undefined
        : await buildLinkedInSearchOverride(input.triggeredByUserId ?? null),
      );

      if (writerOutput.status === 'failed') {
        warnings.push(`Writer error: ${writerOutput.errors.join('; ')}`);
      } else {
        writerBatchId = writerOutput.batchId;
        writerCandidatesCreated = writerOutput.candidatesCreated;

        // Reconcile adaptive_discovery with actual persisted count (Hito 16AB.43.27)
        const reconciledAdaptive = buildAdaptiveDiscovery(writerCandidatesCreated ?? 0);
        metadata.adaptive_discovery = reconciledAdaptive;

        // ── Post-writer enrichment (Hito FIX-P0 / v1.16K-M) ─────────────────
        // CO, MX, CL: enrichment supported. PE, EC and others: skip explicitly.
        const POST_WRITER_ENRICHMENT_COUNTRIES = new Set(['CO', 'MX', 'CL']);
        if (
          writerBatchId &&
          (writerCandidatesCreated ?? 0) > 0 &&
          POST_WRITER_ENRICHMENT_COUNTRIES.has(input.countryCode ?? '') &&
          adminSupabase
        ) {
          const enrichmentResult = await enrichBatchCandidates(
            adminSupabase,
            writerBatchId,
            input.countryCode,
          );

          // Update batch metadata with enrichment status and tax resolution status
          try {
            const { data: currentBatch } = await adminSupabase
              .from('prospect_batches')
              .select('metadata')
              .eq('id', writerBatchId)
              .single();

            if (currentBatch) {
              const batchMeta = (currentBatch.metadata as Record<string, unknown>) ?? {};
              const enrichmentStatus = enrichmentResult.candidatesProcessed > 0
                ? {
                    attempted: true,
                    candidates_processed: enrichmentResult.candidatesProcessed,
                    sources_applied: enrichmentResult.sourcesApplied,
                    warnings: enrichmentResult.warnings.length > 0 ? enrichmentResult.warnings : undefined,
                    errors: enrichmentResult.errors.length > 0 ? enrichmentResult.errors : undefined,
                  }
                : {
                    attempted: false,
                    reason: enrichmentResult.errors.length > 0 ? 'enrichment_error' : 'no_match',
                  };

              const updatedBatchMeta: Record<string, unknown> = {
                ...batchMeta,
                source_enrichment_status: enrichmentStatus,
              };

              if (enrichmentResult.taxResolutionStatus) {
                updatedBatchMeta['tax_identifier_resolution_status'] = enrichmentResult.taxResolutionStatus;
              }

              await adminSupabase
                .from('prospect_batches')
                .update({ metadata: updatedBatchMeta })
                .eq('id', writerBatchId);
            }
          } catch (batchUpdateErr: unknown) {
            console.warn('[incremental-search] batch enrichment status update failed:', batchUpdateErr instanceof Error ? batchUpdateErr.message : batchUpdateErr);
          }
        } else if (
          writerBatchId &&
          (writerCandidatesCreated ?? 0) > 0 &&
          !POST_WRITER_ENRICHMENT_COUNTRIES.has(input.countryCode ?? '') &&
          adminSupabase
        ) {
          // Record that enrichment was explicitly skipped for unsupported country
          try {
            const { data: currentBatch } = await adminSupabase
              .from('prospect_batches')
              .select('metadata')
              .eq('id', writerBatchId)
              .single();

            if (currentBatch) {
              const batchMeta = (currentBatch.metadata as Record<string, unknown>) ?? {};
              await adminSupabase
                .from('prospect_batches')
                .update({
                  metadata: {
                    ...batchMeta,
                    source_enrichment_status: {
                      attempted: false,
                      reason: 'country_not_supported',
                      country_code: input.countryCode,
                    },
                  },
                })
                .eq('id', writerBatchId);
            }
          } catch (batchUpdateErr: unknown) {
            console.warn('[incremental-search] batch enrichment skip metadata update failed:', batchUpdateErr instanceof Error ? batchUpdateErr.message : batchUpdateErr);
          }
        }
      }
    }
  }

  return {
    input,
    candidates: allCandidates,
    candidatesCount: allCandidates.length,
    usefulCandidatesCount,
    candidatesCreated: writerCandidatesCreated,
    metadata,
    warnings,
    batchId: writerBatchId,
    targetReached: dryRun ? undefined : targetReached,
    targetPersistibleCandidates,
    searchStrategyRuntime,
  };
}
