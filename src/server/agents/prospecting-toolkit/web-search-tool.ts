/**
 * Prospecting Toolkit — Web Search Tool (Hito 3A, actualizado 7C)
 *
 * Herramienta de búsqueda web configurable con abstracción de providers.
 * Provider default: mock (sin costo, sin llamadas externas).
 * Provider real inicial: tavily (requiere TAVILY_API_KEY en entorno).
 *
 * Hito 7C: integra filtro anti-ruido post-search y query builder mejorado.
 *
 * Reglas críticas:
 * - No llama a Apollo, Lusha ni HubSpot.
 * - No usa proveedor IA para generar resultados.
 * - No crea prospect_candidates.
 * - No falla el build si el API key de Tavily no está configurado.
 * - No imprime API keys en logs ni metadata.
 * - maxResults se limita a MAX_RESULTS_HARD_LIMIT.
 */

import type {
  WebSearchInput,
  WebSearchOutput,
  WebSearchProviderKey,
  MultiQuerySearchInput,
  MultiQueryWebSearchOutput,
  MultiQuerySearchResultEntry,
  MultiQueryQueryResult,
} from './types';
import { runMockWebSearch } from './web-search-providers/mock-web-search-provider';
import { runTavilyWebSearch } from './web-search-providers/tavily-web-search-provider';
import { runGoogleCseWebSearch } from './web-search-providers/google-cse-web-search-provider';
import { runApolloOrganizationsSearch } from './web-search-providers/apollo-organizations-search-provider';
import { filterNoiseResults } from './noise-filter';
import { buildCleanMultiQueryDiscoveryQueries } from './query-builder';
import {
  buildTavilyUsageKey,
  creditsForSearchDepth,
  validateTavilyPricing,
  computeAggregateStatus,
  realLogTavilyUsage,
  TavilyPricingUnavailableError,
  type TavilyUsageDeps,
} from './tavily-usage-logging';
import { loadActiveTavilyMultiQueryPricing } from '@/modules/usage-tracking/provider-pricing';

// Re-exportar desde query-builder para mantener la API pública estable
export {
  buildCompanyDiscoveryQuery,
  buildSectorSpecificSearchTerms,
  buildNoiseExclusionTerms,
  buildCleanMultiQueryDiscoveryQueries,
  buildSourceGuidedDiscoveryQueries,
  getSourceGuidedQueryMeta,
  classifyQuery,
} from './query-builder';
export type { CompanyDiscoveryQueryOptions, SourceGuidedQueryMeta } from './query-builder';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_PROVIDER: WebSearchProviderKey = 'mock';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_HARD_LIMIT = 20;
const DEFAULT_SEARCH_DEPTH = 'standard' as const;
const DEFAULT_MAX_RESULTS_PER_QUERY = 3;
const MAX_RESULTS_PER_QUERY_LIMIT = 5;
const MAX_QUERIES_LIMIT = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

function resolveMaxResults(requested: number | undefined): number {
  const n = requested ?? DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(1, n), MAX_RESULTS_HARD_LIMIT);
}

// ─── Enrutador de providers ───────────────────────────────────────────────────

async function dispatchToProvider(
  provider: WebSearchProviderKey,
  input: WebSearchInput,
  maxResults: number,
): Promise<WebSearchOutput> {
  switch (provider) {
    case 'mock':
      return runMockWebSearch(input, maxResults);
    case 'tavily':
      return runTavilyWebSearch(input, maxResults);
    case 'google_cse':
      return runGoogleCseWebSearch(input, maxResults);
    case 'apollo_organizations':
      return runApolloOrganizationsSearch(input, maxResults);
    default:
      return {
        provider,
        query: input.query,
        results: [],
        resultsCount: 0,
        skipped: true,
        skipReason: `provider_not_implemented_${provider}`,
        estimatedCostUsd: null,
        metadata: {},
      };
  }
}

// ─── Función pública ──────────────────────────────────────────────────────────

// ─── Helpers para multi-query ─────────────────────────────────────────────────

function extractDomainForDedup(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function pathPriorityScore(url: string): number {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === '/' || path === '') return 100;
    const high = ['/nosotros', '/servicios', '/soluciones', '/contacto', '/contactanos'];
    if (high.some((s) => path.startsWith(s))) return 90;
    const med = ['/about', '/empresa', '/company', '/quienes-somos'];
    if (med.some((s) => path.startsWith(s))) return 80;
    const low = ['/products', '/services', '/team', '/equipo'];
    if (low.some((s) => path.startsWith(s))) return 70;
    const noise = ['/blog', '/news', '/post', '/noticias', '/articulo', '/resources'];
    if (noise.some((s) => path.startsWith(s))) return 10;
    return 50;
  } catch {
    return 0;
  }
}

// Señales de título de artículo que penalizan el score prospectable (Hito 13B).
// Segunda línea de defensa tras el noise filter: penaliza resultados con títulos
// que parecen artículos de lista o contenido editorial, no nombres de empresa.
const ARTICLE_TITLE_SCORE_PENALTIES = [
  'claves del sector', 'top empresas', 'mejores empresas', 'cómo elegir',
  'software y servicios de', 'guía de empresas', 'directorio de empresas',
  'empresa de it en', 'empresas de tecnología en',
];

function prospectableScore(result: MultiQuerySearchResultEntry): number {
  const domain = extractDomainForDedup(result.url) ?? '';
  let score = 0;

  const resultType = result.metadata?.result_type as string | undefined;
  if (resultType === 'official_company_site') score += 60;
  else if (resultType === 'company_profile') score += 30;
  else score += 10;

  if (domain.endsWith('.com.co') || domain.endsWith('.co')) score += 20;
  else if (domain.endsWith('.com')) score += 15;

  score += pathPriorityScore(result.url) * 0.2;

  const text = `${result.title} ${result.snippet ?? ''}`.toLowerCase();
  const colombiaSignals = ['colombia', 'bogotá', 'bogota', 'medellín', 'medellin', 'cali', 'barranquilla'];
  if (colombiaSignals.some((s) => text.includes(s))) score += 15;

  // Penalizar títulos que parecen artículos o listados, no nombres de empresa (Hito 13B)
  const titleLower = (result.title ?? '').toLowerCase();
  if (ARTICLE_TITLE_SCORE_PENALTIES.some((s) => titleLower.includes(s))) score -= 30;

  return score;
}

// ─── runMultiQueryWebSearch ───────────────────────────────────────────────────

/**
 * Hito 12B: Ejecuta múltiples queries especializadas, combina resultados,
 * deduplica por dominio y aplica el noise filter para maximizar yield prospectable.
 *
 * Hito 16AB.43.10: cuando input.usageContext está presente, instrumenta el consumo
 * económico: carga tarifa, valida antes de ejecutar, calcula créditos y registra un log
 * por ronda. El parámetro usageDeps permite inyectar dependencias en tests.
 *
 * Reglas críticas:
 * - No persiste en base de datos (salvo el log de uso cuando usageContext está presente).
 * - No llama Apollo, Lusha, HubSpot ni proveedor IA.
 * - Provider default: mock. Tavily solo cuando se especifica explícitamente.
 * - Máximo MAX_QUERIES_LIMIT queries por invocación.
 * - TAVILY_API_KEY nunca se imprime en logs.
 */
export async function runMultiQueryWebSearch(
  input: MultiQuerySearchInput,
  usageDeps?: TavilyUsageDeps,
): Promise<MultiQueryWebSearchOutput> {
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const maxResultsPerQuery = Math.min(
    Math.max(1, input.maxResultsPerQuery ?? DEFAULT_MAX_RESULTS_PER_QUERY),
    MAX_RESULTS_PER_QUERY_LIMIT,
  );
  const targetCount = Math.min(
    Math.max(1, input.targetCount ?? DEFAULT_MAX_RESULTS),
    MAX_RESULTS_HARD_LIMIT,
  );
  const searchDepth = input.searchDepth ?? DEFAULT_SEARCH_DEPTH;

  const queries =
    input.queries && input.queries.length > 0
      ? input.queries.slice(0, MAX_QUERIES_LIMIT)
      : buildCleanMultiQueryDiscoveryQueries(input.industry, input.country);

  // ── Paso 0: Validar pricing antes de ejecutar queries (solo ruta instrumentada) ─
  const usageContext = input.usageContext ?? null;
  let activePricing = null;

  if (usageContext) {
    const pricingLoader = usageDeps?.loadPricing ?? loadActiveTavilyMultiQueryPricing;
    activePricing = await pricingLoader();
    validateTavilyPricing(activePricing); // lanza TavilyPricingUnavailableError si inválido
  }

  // ── Paso 1: Ejecutar todas las queries secuencialmente ────────────────────
  const roundStartMs = Date.now();
  const queryResults: MultiQueryQueryResult[] = [];
  const allRaw: MultiQuerySearchResultEntry[] = [];
  const dispatch = usageDeps?.dispatchQuery ?? dispatchToProvider;

  for (const query of queries) {
    const searchInput: WebSearchInput = {
      query: sanitizeQuery(query),
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      maxResults: maxResultsPerQuery,
      provider,
      searchDepth,
      intent: 'company_discovery',
    };

    const raw = await dispatch(provider, searchInput, maxResultsPerQuery);

    const validRaw = raw.results.filter((r) => {
      try { new URL(r.url); return true; } catch { return false; }
    });

    const withOrigin: MultiQuerySearchResultEntry[] = validRaw.map((r) => ({
      ...r,
      originQuery: query,
    }));

    allRaw.push(...withOrigin);
    queryResults.push({
      query,
      rawResultsCount: raw.results.length,
      keptCount: 0,
      filteredOutCount: 0,
      skipped: raw.skipped,
      skipReason: raw.skipReason ?? null,
    });
  }

  const roundDurationMs = Date.now() - roundStartMs;
  const rawResultsCount = allRaw.length;

  // ── Paso 2: Deduplicar por dominio normalizado ────────────────────────────
  const domainMap = new Map<string, MultiQuerySearchResultEntry>();

  for (const result of allRaw) {
    const domain = extractDomainForDedup(result.url);
    if (!domain) continue;

    const existing = domainMap.get(domain);
    if (!existing || pathPriorityScore(result.url) > pathPriorityScore(existing.url)) {
      domainMap.set(domain, result);
    }
  }

  const dedupedResults = Array.from(domainMap.values());
  const dedupedResultsCount = dedupedResults.length;

  // ── Paso 3: Aplicar noise filter ──────────────────────────────────────────
  const { kept, filteredCount } = filterNoiseResults(dedupedResults);
  const keptWithOrigin = kept as MultiQuerySearchResultEntry[];

  // ── Paso 4: Ordenar por señales prospectables ─────────────────────────────
  const sorted = [...keptWithOrigin].sort(
    (a, b) => prospectableScore(b) - prospectableScore(a),
  );

  const finalResults = sorted.slice(0, targetCount).map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  const estimatedCreditCount = queryResults.filter((q) => !q.skipped).length;

  const baseMetadata: Record<string, unknown> = {
    provider,
    queriesExecuted: queries.length,
    queriesSkipped: queryResults.filter((q) => q.skipped).length,
    executedAt: new Date().toISOString(),
  };

  // ── Paso 5: Registrar consumo económico (solo ruta instrumentada) ─────────
  if (usageContext && activePricing) {
    const creditsPerQuery = creditsForSearchDepth(String(searchDepth));
    const successfulCount = queryResults.filter((q) => !q.skipped).length;
    const failedCount = queryResults.filter((q) => q.skipped).length;
    const creditsUsed = successfulCount * creditsPerQuery;
    const estimatedCostUsd = parseFloat((creditsUsed * activePricing.unitCostUsd).toFixed(6));
    const usageKey = buildTavilyUsageKey(usageContext.batchId, usageContext.roundNumber);
    const { status, errorCode } = computeAggregateStatus(queryResults);

    const usageMetadata: Record<string, unknown> = {
      round_number: usageContext.roundNumber,
      queries_planned: queries.length,
      queries_executed: queryResults.length,
      successful_query_count: successfulCount,
      failed_query_count: failedCount,
      credits_per_query: creditsPerQuery,
      search_depth: String(searchDepth),
      raw_results: rawResultsCount,
      deduped_results: dedupedResultsCount,
      filtered_out: filteredCount,
      final_results: finalResults.length,
      partial_failure: failedCount > 0 && successfulCount > 0,
      pricing_source: 'provider_pricing_config',
      pricing_unit: activePricing.unit,
      unit_cost_usd: activePricing.unitCostUsd,
      pipeline_mode: 'multi_query',
      agent_key: 'prospect_generation',
      request_source: 'prospect_chat_wizard',
    };

    const logger = usageDeps?.logUsage ?? realLogTavilyUsage;
    const logResult = await logger({
      provider_key: 'tavily',
      operation_key: 'multi_query_web_search',
      batch_id: usageContext.batchId,
      usage_key: usageKey,
      agent_run_id: usageContext.agentRunId ?? undefined,
      agent_run_step_id: usageContext.agentRunStepId ?? undefined,
      triggered_by: usageContext.triggeredByUserId,
      credits_used: creditsUsed,
      results_returned: rawResultsCount,
      estimated_cost_usd: estimatedCostUsd,
      status,
      error_code: errorCode ?? undefined,
      duration_ms: roundDurationMs,
      metadata: usageMetadata,
    });

    if (logResult.kind === 'failed') {
      console.error('[tavily-usage] usage_logging_failed after Tavily round', logResult.error);
      baseMetadata.usage_logging_failed = true;
      baseMetadata.usage_logging_error = logResult.error.slice(0, 200);
    } else if (logResult.kind === 'already_logged') {
      baseMetadata.usage_already_logged = true;
    }
  }

  return {
    queryResults,
    rawResultsCount,
    dedupedResultsCount,
    filteredOutCount: filteredCount,
    keptCount: finalResults.length,
    results: finalResults,
    estimatedCreditCount,
    metadata: baseMetadata,
  };
}

// ─── runWebSearch ─────────────────────────────────────────────────────────────

export async function runWebSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const query = sanitizeQuery(input.query);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const maxResults = resolveMaxResults(input.maxResults);

  const normalizedInput: WebSearchInput = { ...input, query };

  const raw = await dispatchToProvider(provider, normalizedInput, maxResults);

  // Post-filtro 1: eliminar resultados sin URL válida
  const validResults = raw.results.filter((r) => {
    try {
      new URL(r.url);
      return true;
    } catch {
      return false;
    }
  });

  // Post-filtro 2: clasificación anti-ruido (Hito 7C)
  const { kept, filtered, rawCount, keptCount, filteredCount } =
    filterNoiseResults(validResults);

  return {
    ...raw,
    query,
    results: kept,
    resultsCount: keptCount,
    metadata: {
      ...raw.metadata,
      noise_filter: {
        raw_results_count: rawCount,
        kept_count: keptCount,
        filtered_out_count: filteredCount,
        filtered_domains: filtered.map((f) => {
          try { return new URL(f.result.url).hostname; } catch { return f.result.url; }
        }),
      },
    },
  };
}
