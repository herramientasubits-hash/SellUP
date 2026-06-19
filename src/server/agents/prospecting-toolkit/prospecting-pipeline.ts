/**
 * Prospecting Toolkit — Pipeline Orquestador Mínimo (Hito 4)
 *
 * Conecta las tools del toolkit en un flujo mínimo server-side.
 * No escribe en base de datos. No llama APIs pagadas por defecto.
 * No crea prospect_candidates, prospect_batches ni accounts.
 * No llama Apollo, Lusha ni proveedor IA.
 * HubSpot: si no está conectado, el duplicate check retorna "unchecked"
 * y el scorer devuelve "needs_review" — nunca aprueba automáticamente.
 */

import type {
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
  ProspectingPipelineSummary,
  CandidateQualityLabel,
  NameInferenceSource,
  SearchTrace,
} from './types';
import { getCatalogContext } from './catalog-context-retriever';
import { runWebSearch, runMultiQueryWebSearch, buildCompanyDiscoveryQuery, getSourceGuidedQueryMeta, classifyQuery } from './web-search-tool';
import { verifyWebsite } from './website-verifier';
import { checkCompanyDuplicate } from './duplicate-checker';
import { scoreCandidate } from './candidate-scorer';
import { normalizeDomain } from './normalization';
import {
  normalizeProspectCompanyName,
  SEO_GENERIC_KEYWORDS,
} from './company-name-normalizer';
import {
  evaluateTavilyResultsWithLLM,
  buildLLMEvaluationMetadata,
} from './llm-evaluator';
import type { LLMEvaluatorRawInput, LLMEvaluatorOutput } from './llm-evaluator-types';
import {
  classifySearchResultForProspecting,
  type PreLLMFilterSummary,
} from './pre-llm-result-filter';
import { isSentenceOrPhraseName } from './noise-filter';
import { buildSearchPlan, getExecutableQueriesFromSearchPlan } from './search-planner';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_TARGET_COUNT = 10;
const MAX_TARGET_COUNT = 25;
const DEFAULT_PROVIDER = 'mock' as const;
const DEFAULT_SEARCH_DEPTH = 'standard' as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampTargetCount(requested: number | undefined): number {
  const n = requested ?? DEFAULT_TARGET_COUNT;
  return Math.min(Math.max(1, n), MAX_TARGET_COUNT);
}

// ─── Normalización determinística de nombre limpio (Hito 13F) ─────────────────
// Hito 16W.2: GENERIC_KEYWORDS movido a company-name-normalizer.ts como SEO_GENERIC_KEYWORDS.

/**
 * Marcas/vendors globales cuya presencia en un segmento de título indica
 * que el segmento describe una integración o partnership, no el nombre de la empresa.
 * Si el dominio no pertenece a la marca, el segmento se omite.
 * Hito 13H: evita que "Microsoft Dynamics Partner LATAM" sea el nombre inferido
 * cuando el dominio es de otra empresa (ej. kcpdynamics.com).
 */
const GLOBAL_VENDOR_NAMES = new Set([
  'microsoft', 'sap', 'ibm', 'oracle', 'salesforce',
  'google', 'aws', 'amazon', 'hubspot', 'adobe',
  'meta', 'cisco', 'dell', 'hp', 'apple',
  'zoom', 'slack', 'servicenow', 'workday', 'zendesk',
]);

// Sufijos legales colombianos / latinoamericanos
const LEGAL_SUFFIX_RE = /\b(S\.A\.S\.?|SAS|S\.A\.?|Ltda\.?|E\.U\.?|Corp\.?|Inc\.?|LLC|S\.R\.L\.?)\b/i;

// TLDs ordenados de más específico a más genérico (evita match parcial)
const KNOWN_TLDS = [
  '.com.co', '.net.co', '.org.co', '.edu.co', '.gov.co', '.mil.co',
  '.com', '.co', '.net', '.org', '.io', '.biz', '.info',
];

function normalizeForKeywords(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Determina si una parte del título es una frase genérica de SEO.
 * Retorna false (= no genérica) si contiene un sufijo legal.
 */
function isGenericPhrase(part: string): boolean {
  if (LEGAL_SUFFIX_RE.test(part)) return false;
  const words = normalizeForKeywords(part).split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  const genericCount = words.filter(w => SEO_GENERIC_KEYWORDS.has(w)).length;
  // Hito 13H: >= 0.5 (antes > 0.5) para capturar frases 50% genéricas como "Software a la medida"
  return genericCount / words.length >= 0.5;
}

/**
 * Retorna true si el segmento contiene una marca global vendor y el dominio
 * de la URL no corresponde a esa marca. Indica que el segmento describe una
 * integración o partnership, no el nombre real de la empresa.
 * Hito 13H: evita "Microsoft Dynamics Partner LATAM" cuando el dominio es kcpdynamics.com.
 */
function segmentContainsForeignBrand(segment: string, domain: string): boolean {
  const segLower = normalizeForKeywords(segment);
  for (const brand of GLOBAL_VENDOR_NAMES) {
    if (segLower.includes(brand) && !domain.includes(brand)) return true;
  }
  return false;
}

/**
 * Intenta extraer nombre limpio desde el título usando separadores fuertes.
 * Detecta también el patrón SIGLA, descriptor (ej. "TSI, Servicios de…").
 * Hito 13H: acepta dominio opcional para saltar segmentos con marcas globales ajenas.
 */
function inferNameFromTitle(title: string, domain?: string): string | null {
  // Patrón: SIGLA en mayúsculas antes de coma ("TSI, Servicios de…")
  const leadingAcronym = /^([A-Z]{2,6}),\s+/.exec(title);
  if (leadingAcronym) return leadingAcronym[1];

  // Separadores fuertes: |  —  –  :  ::  y guion con espacios
  const parts = title
    .split(/\s*[|—–]\s*|\s+-\s+|\s*::\s*|\s*:\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 1);

  for (const part of parts) {
    // Hito 13H: saltar segmentos con marca global ajena al dominio
    if (domain && segmentContainsForeignBrand(part, domain)) continue;
    if (isGenericPhrase(part)) continue;
    // Hito 16AB.43.20: saltar segmentos que son frases/oraciones, no nombres de empresa
    if (isSentenceOrPhraseName(part)) continue;
    return part;
  }
  return null;
}

/**
 * Infiere nombre limpio desde el dominio de la URL.
 * Elimina TLD, detecta sufijo "colombia", acrónimos cortos y guiones.
 */
function inferNameFromDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    let host = parsed.hostname.replace(/^www\./, '');

    for (const tld of KNOWN_TLDS) {
      if (host.endsWith(tld)) { host = host.slice(0, -tld.length); break; }
    }
    if (!host || host.length < 2) return null;

    // Guiones → palabras separadas
    if (host.includes('-')) {
      return host.split('-').map(toTitleCase).join(' ');
    }

    // Sufijo de país conocido ("solutekcolombia" → "Solutek Colombia")
    const countrySuffix = /^(.+?)(colombia|peru|mexico|argentina|chile|ecuador|venezuela)$/i.exec(host);
    if (countrySuffix) {
      const prefix = countrySuffix[1];
      const country = toTitleCase(countrySuffix[2]);
      const prefixName = prefix.length <= 4 ? prefix.toUpperCase() : toTitleCase(prefix);
      return `${prefixName} ${country}`;
    }

    // Dominio corto ≤ 4 chars → acrónimo en mayúsculas ("dyc" → "DYC")
    if (host.length <= 4) return host.toUpperCase();

    // Default: Title Case
    return toTitleCase(host);
  } catch {
    return null;
  }
}

/**
 * Infiere el nombre limpio de empresa desde título y URL de un resultado Tavily.
 * Prioridad: (1) prefijo no genérico del título, (2) dominio, (3) fallback al título.
 * Sin IA generativa. Sin llamadas externas.
 */
function inferCompanyNameFromSearchResult(
  title: string,
  url: string
): { name: string; source: NameInferenceSource } {
  const trimmed = title.trim();
  // Hito 13H: pasar dominio para que inferNameFromTitle omita segmentos con marcas globales
  const domainForBrand = (() => {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  })();

  const fromTitle = inferNameFromTitle(trimmed, domainForBrand);
  if (fromTitle) return { name: fromTitle, source: 'title_prefix' };

  const fromDomain = inferNameFromDomain(url);
  if (fromDomain) return { name: fromDomain, source: 'domain' };

  return { name: trimmed || 'Unknown', source: 'title_fallback' };
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline de prospección mínimo.
 *
 * Flujo:
 *   1. getCatalogContext — fuentes relevantes por país/sector
 *   2. buildCompanyDiscoveryQuery — construye query de búsqueda
 *   3. runWebSearch — resultados web (mock por defecto)
 *   4. Por cada resultado: verifyWebsite → checkCompanyDuplicate → scoreCandidate
 *   5. Retorna output consolidado sin guardar en DB
 *
 * @example
 * const result = await runProspectingPipeline({
 *   country: 'Colombia',
 *   countryCode: 'CO',
 *   industry: 'Tecnología',
 *   targetCount: 5,
 *   webSearchProvider: 'mock',
 * });
 */
export async function runProspectingPipeline(
  input: ProspectingPipelineInput
): Promise<ProspectingPipelineOutput> {
  const warnings: string[] = [];

  const targetCount = clampTargetCount(input.targetCount);
  const provider = input.webSearchProvider ?? DEFAULT_PROVIDER;
  const searchDepth = input.searchDepth ?? DEFAULT_SEARCH_DEPTH;

  if (input.targetCount !== undefined && input.targetCount > MAX_TARGET_COUNT) {
    warnings.push(
      `targetCount=${input.targetCount} superó el límite de ${MAX_TARGET_COUNT}. Se usará ${MAX_TARGET_COUNT}.`
    );
  }

  // ── Paso 1: Contexto de catálogo ─────────────────────────────────────────────
  const catalogContext = getCatalogContext({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    searchDepth,
  });

  // ── Paso 1b: Search Plan v0 + Executable Queries v1 ─────────────────────────
  // buildSearchPlan produce el plan estructurado (determinístico).
  // getExecutableQueriesFromSearchPlan deriva queries ordenadas por prioridad del plan.
  const searchPlan = buildSearchPlan({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    subindustries: (input as { subindustries?: string[] }).subindustries ?? [],
    additionalCriteria: (input as { additionalCriteria?: string | null }).additionalCriteria ?? null,
    targetCount,
    searchDepth,
  });
  const executableQueries = getExecutableQueriesFromSearchPlan(searchPlan);
  let plannerQueriesUsed = false;
  let plannerFallbackReason = 'single_query_mode';

  // ── Paso 2: Query de búsqueda ─────────────────────────────────────────────────
  const searchQuery = buildCompanyDiscoveryQuery({
    industry: input.industry,
    country: input.country,
    countryCode: input.countryCode,
    intent: 'general',
  });

  // ── Paso 3: Web search ────────────────────────────────────────────────────────
  let multiQueryMeta: Record<string, unknown> | null = null;

  const useMultiQuery =
    input.mode === 'multi_query' || input.mode === 'tavily_llm_evaluator';

  const webSearch = useMultiQuery
    ? await (async () => {
        const hasQueryOverrides = !!(input.queryOverrides && input.queryOverrides.length > 0);
        const usesPlannerQueries = !hasQueryOverrides && executableQueries.length > 0;
        plannerQueriesUsed = usesPlannerQueries;
        if (!usesPlannerQueries) {
          plannerFallbackReason = hasQueryOverrides ? 'query_overrides_provided' : 'planner_produced_no_queries';
        }

        const queriesForSearch = hasQueryOverrides
          ? input.queryOverrides
          : usesPlannerQueries
            ? executableQueries.map(q => q.queryText)
            : undefined;

        const mq = await runMultiQueryWebSearch({
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          provider,
          searchDepth,
          targetCount,
          maxResultsPerQuery: input.maxResultsPerQuery ?? 5,
          queries: queriesForSearch,
          usageContext: input.usageContext ?? null,
        });
        const sgMeta = hasQueryOverrides || usesPlannerQueries
          ? { enabled: false, sources_used: [] as string[] }
          : getSourceGuidedQueryMeta(input.country, input.industry, 1);
        multiQueryMeta = {
          search_mode: 'multi_query',
          query_version: hasQueryOverrides
            ? 'query_overrides'
            : usesPlannerQueries
              ? 'search_planner_v1'
              : 'multi_query_basic_es_v1',
          queries_source: hasQueryOverrides
            ? 'overrides'
            : usesPlannerQueries
              ? 'search_planner_v1'
              : sgMeta.enabled
                ? 'source_guided_mix'
                : 'standard',
          source_guided_queries_enabled: sgMeta.enabled,
          source_guided_sources_used: sgMeta.sources_used,
          queries_executed: mq.queryResults.map((q) => q.query),
          query_trace_summary: {
            enabled: true,
            queries_executed: mq.queryResults.map((q) => {
              const { queryType, querySourceKey } = classifyQuery(q.query, input.country, input.industry);
              return { query_text: q.query, query_type: queryType, query_source_key: querySourceKey };
            }),
          },
          raw_results_count: mq.rawResultsCount,
          deduped_results_count: mq.dedupedResultsCount,
          filtered_out_count: mq.filteredOutCount,
          kept_count: mq.keptCount,
          max_results_per_query: input.maxResultsPerQuery ?? 5,
        };
        return {
          provider,
          query: searchQuery,
          results: mq.results,
          resultsCount: mq.keptCount,
          skipped: false,
          skipReason: null,
          estimatedCostUsd: null as null,
          metadata: {
            raw_results_count: mq.rawResultsCount,
            deduped_results_count: mq.dedupedResultsCount,
            filtered_out_count: mq.filteredOutCount,
          },
        };
      })()
    : await runWebSearch({
        query: searchQuery,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        maxResults: targetCount,
        provider,
        searchDepth,
        intent: 'company_discovery',
      });

  if (webSearch.skipped) {
    warnings.push(`Web search fue omitida: ${webSearch.skipReason ?? 'razón desconocida'}`);
  }

  // ── Search Plan v1 metadata ───────────────────────────────────────────────────
  const searchPlanMeta = {
    version: 'search_planner_v1',
    queryFamilies: searchPlan.queryFamilies,
    executableQueries,
    usedForExecution: plannerQueriesUsed,
    fallbackUsed: !plannerQueriesUsed,
    executedQueryCount: plannerQueriesUsed ? executableQueries.length : 0,
    querySelectionReason: plannerQueriesUsed
      ? 'search_planner_v1_queries_available'
      : plannerFallbackReason,
  };

  // ── Paso 4: Enriquecer cada resultado ─────────────────────────────────────────

  const useLLMEvaluator =
    input.useLLMEvaluator === true || input.mode === 'tavily_llm_evaluator';

  let llmEvaluation: LLMEvaluatorOutput | null = null;
  let llmEvaluatorWarnings: string[] = [];

  if (useLLMEvaluator) {
    // ── LLM evaluator branch ─────────────────────────────────────────────────
    // Pasa todos los resultados raw al evaluador (hasta maxRaw=30).
    // Los candidatos se construyen solo con los topCandidates del evaluador.

    // ── Pre-LLM filter: descarta resultados claramente no candidatos (Hito 16W.1) ──
    // Complementa el noise-filter: detecta señales de contenido editorial en títulos
    // y snippets que escapan al filtro de URL/dominio.
    // IMPORTANTE: rawInputs.idx referencia el índice original en webSearch.results
    // para que buildCandidateFromEvaluated pueda recuperar el resultado correctamente.
    const preLLMSampleFiltered: PreLLMFilterSummary['sample_filtered'] = [];
    const preLLMBySourceType: PreLLMFilterSummary['by_source_type'] = {};
    const rawInputs: LLMEvaluatorRawInput[] = [];

    for (let idx = 0; idx < webSearch.results.length; idx++) {
      const r = webSearch.results[idx];
      const classification = classifySearchResultForProspecting({
        title: r.title,
        url: r.url,
        snippet: r.snippet ?? null,
      });

      if (!classification.shouldPassToLLM) {
        const st = classification.sourceType;
        preLLMBySourceType[st] = (preLLMBySourceType[st] ?? 0) + 1;
        if (preLLMSampleFiltered.length < 10) {
          preLLMSampleFiltered.push({
            title: r.title,
            domain: normalizeDomain(r.url) ?? r.url,
            source_type: st,
            reasons: classification.reasons,
          });
        }
        continue;
      }

      rawInputs.push({
        idx,
        title: r.title,
        url: r.url,
        domain: normalizeDomain(r.url),
        snippet: r.snippet ?? null,
        query: ('originQuery' in r && typeof r.originQuery === 'string')
          ? r.originQuery
          : searchQuery,
      });
    }

    const preLLMFilterSummary: PreLLMFilterSummary = {
      enabled: true,
      total_input_results: webSearch.results.length,
      passed_to_llm: rawInputs.length,
      filtered_out: webSearch.results.length - rawInputs.length,
      by_source_type: preLLMBySourceType,
      sample_filtered: preLLMSampleFiltered,
    };

    llmEvaluation = await evaluateTavilyResultsWithLLM({
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      rawResults: rawInputs,
      targetCount,
    });

    llmEvaluatorWarnings = llmEvaluation.warnings;
    warnings.push(...llmEvaluatorWarnings);

    // ── Helper: build one pipeline candidate from an LLM evaluated result ────
    const buildCandidateFromEvaluated = async (
      evaluated: LLMEvaluatorOutput['topCandidates'][number],
      addReviewFlag = false,
    ): Promise<ProspectingPipelineCandidate> => {
      const rawResult = webSearch.results[evaluated.idx];
      const titleFallback = rawResult
        ? inferCompanyNameFromSearchResult(rawResult.title, rawResult.url)
        : null;

      const website = evaluated.website ?? rawResult?.url ?? null;
      const domain = evaluated.domain
        ? (normalizeDomain(evaluated.domain) ?? normalizeDomain(website ?? ''))
        : normalizeDomain(website ?? '');

      const rawName =
        evaluated.clean_company_name?.trim() ||
        titleFallback?.name ||
        'Unknown';

      // Hito 16W.2: strip SEO phrases and legal suffixes from proposed name
      const normResult = normalizeProspectCompanyName(rawName, domain ?? undefined);
      const name = normResult.name;

      const inferredNameSource: NameInferenceSource =
        evaluated.clean_company_name ? 'title_prefix' : (titleFallback?.source ?? 'title_fallback');

      const websiteVerification = await verifyWebsite({
        candidateName: name,
        websiteOrDomain: website ?? undefined,
        country: input.country,
        countryCode: input.countryCode,
      });

      const duplicateCheck = await checkCompanyDuplicate({
        name,
        website: website ?? undefined,
        domain: domain ?? undefined,
        country: input.country,
        countryCode: input.countryCode,
      });

      const scoring = scoreCandidate({
        name,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        website,
        domain,
        websiteVerification,
        duplicateCheck,
        catalogContext,
        sourcePrimary: rawResult?.source ?? provider,
        sourcePriority:
          catalogContext.recommendedSources.length > 0
            ? catalogContext.recommendedSources[0].priority
            : null,
      });

      // Review candidates get an explicit flag so humans can distinguish them
      const evaluatedForMeta = addReviewFlag
        ? {
            ...evaluated,
            risk_flags: evaluated.risk_flags.includes('llm_review_required')
              ? evaluated.risk_flags
              : [...evaluated.risk_flags, 'llm_review_required'],
          }
        : evaluated;

      const llmEvalMeta = buildLLMEvaluationMetadata(evaluatedForMeta, {
        provider: llmEvaluation!.usage.provider,
        model: llmEvaluation!.usage.model,
      });

      // Trazabilidad query→candidato (Hito 16Z.2)
      const matchingRawInput = rawInputs.find((ri) => ri.idx === evaluated.idx);
      const originQueryText = matchingRawInput?.query ?? searchQuery;
      const { queryType, querySourceKey } = classifyQuery(originQueryText, input.country, input.industry);
      const searchTrace: SearchTrace = {
        query_text: originQueryText,
        query_type: queryType,
        query_source_key: querySourceKey,
        provider_rank: rawResult?.rank,
      };

      return {
        name,
        originalName: normResult.wasNormalized ? normResult.originalName : null,
        website,
        domain,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        sourceUrl: website,
        sourceTitle: rawResult?.title ?? null,
        sourceSnippet: rawResult?.snippet ?? null,
        inferredNameSource,
        websiteVerification,
        duplicateCheck,
        scoring,
        llmEvaluation: llmEvalMeta,
        searchTrace,
      };
    };

    // ── Build kept candidates (topCandidates from LLM) ────────────────────────
    const keptCandidates: ProspectingPipelineCandidate[] = await Promise.all(
      llmEvaluation.topCandidates.map((evaluated) => buildCandidateFromEvaluated(evaluated, false))
    );

    // ── Build review candidates (fill remaining slots up to targetCount) ──────
    const reviewSlotsAvailable = Math.max(0, targetCount - keptCandidates.length);
    const reviewToProcess = llmEvaluation.reviewResults.slice(0, reviewSlotsAvailable);
    const reviewCandidates: ProspectingPipelineCandidate[] = await Promise.all(
      reviewToProcess.map((evaluated) => buildCandidateFromEvaluated(evaluated, true))
    );

    const allCandidates = [...keptCandidates, ...reviewCandidates];

    const summary = buildSummary(targetCount, webSearch.resultsCount, allCandidates);

    return {
      input,
      catalogContext,
      searchQuery,
      webSearch,
      candidates: allCandidates,
      summary,
      warnings,
      metadata: {
        pipelineVersion: '0.4.0',
        executedAt: new Date().toISOString(),
        provider,
        searchDepth,
        search_mode: 'tavily_llm_evaluator',
        ...(multiQueryMeta ?? {}),
        llm_evaluator: {
          model: llmEvaluation.usage.model,
          provider: llmEvaluation.usage.provider,
          evaluated_count: llmEvaluation.usage.evaluatedCount,
          kept_count: llmEvaluation.keptResults.length,
          review_count: llmEvaluation.reviewResults.length,
          discarded_count: llmEvaluation.discardedResults.length,
          deduplicated_count: llmEvaluation.deduplicatedCount,
          top_candidates_count: llmEvaluation.topCandidates.length,
          persisted_keep_count: keptCandidates.length,
          persisted_review_count: reviewCandidates.length,
          input_tokens: llmEvaluation.usage.inputTokens,
          output_tokens: llmEvaluation.usage.outputTokens,
          estimated_cost_usd: llmEvaluation.usage.estimatedCostUsd,
          cost_per_kept_candidate: llmEvaluation.usage.costPerKeptCandidate,
        },
        pre_llm_filter: preLLMFilterSummary,
        search_plan: searchPlanMeta,
      },
    };
  }

  // ── Standard branch (single_query / multi_query) ──────────────────────────
  const resultsToProcess = webSearch.results.slice(0, targetCount);

  // Hito 16AB.43.20: track names rejected for quality (sentence/phrase names)
  let nameQualityFilteredCount = 0;

  const candidates: ProspectingPipelineCandidate[] = await Promise.all(
    resultsToProcess.map(async (result): Promise<ProspectingPipelineCandidate> => {
      const inferred = inferCompanyNameFromSearchResult(result.title, result.url);
      let name = inferred.name;
      const inferredNameSource = inferred.source;

      // Hito 16AB.43.20: if title_fallback returned a sentence, the title has no
      // extractable company name. Use domain inference as last resort, or if that
      // also fails, force the candidate to discard so it is never persisted.
      if (inferredNameSource === 'title_fallback' && isSentenceOrPhraseName(name)) {
        const fromDomain = inferNameFromDomain(result.url);
        if (fromDomain && !isSentenceOrPhraseName(fromDomain)) {
          name = fromDomain;
        } else {
          nameQualityFilteredCount++;
          // Build a minimal discard candidate — no I/O, scoring will mark as discard
          name = 'Unknown';
        }
      }
      const website = result.url;
      const domain = normalizeDomain(result.url);

      // Trazabilidad query→candidato (Hito 16Z.2)
      const originQueryText = ('originQuery' in result && typeof result.originQuery === 'string')
        ? result.originQuery
        : searchQuery;
      const { queryType, querySourceKey } = classifyQuery(originQueryText, input.country, input.industry);
      const searchTrace: SearchTrace = {
        query_text: originQueryText,
        query_type: queryType,
        query_source_key: querySourceKey,
        provider_rank: result.rank,
      };

      // Paso 4a: Verificar website
      const websiteVerification = await verifyWebsite({
        candidateName: name,
        websiteOrDomain: website,
        country: input.country,
        countryCode: input.countryCode,
      });

      // Paso 4b: Deduplicación (SellUp + HubSpot si está conectado)
      const duplicateCheck = await checkCompanyDuplicate({
        name,
        website,
        domain,
        country: input.country,
        countryCode: input.countryCode,
      });

      // Paso 4c: Scoring (determinístico, sin APIs externas)
      const scoring = scoreCandidate({
        name,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        website,
        domain,
        websiteVerification,
        duplicateCheck,
        catalogContext,
        sourcePrimary: result.source ?? provider,
        sourcePriority:
          catalogContext.recommendedSources.length > 0
            ? catalogContext.recommendedSources[0].priority
            : null,
      });

      return {
        name,
        website,
        domain,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        sourceUrl: result.url,
        sourceTitle: result.title,
        sourceSnippet: result.snippet ?? null,
        inferredNameSource,
        websiteVerification,
        duplicateCheck,
        scoring,
        searchTrace,
      };
    })
  );

  // ── Paso 5: Summary ───────────────────────────────────────────────────────────
  const summary = buildSummary(targetCount, webSearch.resultsCount, candidates);

  return {
    input,
    catalogContext,
    searchQuery,
    webSearch,
    candidates,
    summary,
    warnings,
    metadata: {
      pipelineVersion: '0.4.0',
      executedAt: new Date().toISOString(),
      provider,
      searchDepth,
      search_mode: input.mode ?? 'single_query',
      ...(multiQueryMeta ?? {}),
      name_quality_filtered_count: nameQualityFilteredCount,
      search_plan: searchPlanMeta,
    },
  };
}

// ─── Builder de summary ───────────────────────────────────────────────────────

function buildSummary(
  requested: number,
  searched: number,
  candidates: ProspectingPipelineCandidate[]
): ProspectingPipelineSummary {
  const labelCounts: Record<CandidateQualityLabel, number> = {
    high_quality_new: 0,
    needs_review: 0,
    duplicate: 0,
    insufficient_data: 0,
    discard: 0,
  };

  let unchecked = 0;

  for (const c of candidates) {
    labelCounts[c.scoring.qualityLabel]++;
    if (c.duplicateCheck?.status === 'unchecked') {
      unchecked++;
    }
  }

  return {
    requested,
    searched,
    returned: candidates.length,
    highQualityNew: labelCounts.high_quality_new,
    needsReview: labelCounts.needs_review,
    duplicates: labelCounts.duplicate,
    insufficientData: labelCounts.insufficient_data,
    discarded: labelCounts.discard,
    unchecked,
  };
}
