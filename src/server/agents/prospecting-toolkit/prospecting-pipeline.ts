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
} from './types';
import { getCatalogContext } from './catalog-context-retriever';
import { runWebSearch, runMultiQueryWebSearch, buildCompanyDiscoveryQuery } from './web-search-tool';
import { verifyWebsite } from './website-verifier';
import { checkCompanyDuplicate } from './duplicate-checker';
import { scoreCandidate } from './candidate-scorer';
import { normalizeDomain } from './normalization';

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

/**
 * Extrae el nombre de empresa desde el título de un resultado web.
 * Preserva el título original — la normalización sucede en las tools individuales.
 */
function extractCandidateName(title: string): string {
  return title.trim() || 'Unknown';
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

  // ── Paso 2: Query de búsqueda ─────────────────────────────────────────────────
  const searchQuery = buildCompanyDiscoveryQuery({
    industry: input.industry,
    country: input.country,
    countryCode: input.countryCode,
    intent: 'general',
  });

  // ── Paso 3: Web search ────────────────────────────────────────────────────────
  let multiQueryMeta: Record<string, unknown> | null = null;

  const webSearch = input.mode === 'multi_query'
    ? await (async () => {
        const mq = await runMultiQueryWebSearch({
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          provider,
          searchDepth,
          targetCount,
          maxResultsPerQuery: input.maxResultsPerQuery,
        });
        multiQueryMeta = {
          search_mode: 'multi_query',
          query_version: 'multi_query_basic_es_v1',
          queries_executed: mq.queryResults.map((q) => q.query),
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

  // ── Paso 4: Enriquecer cada resultado ─────────────────────────────────────────
  const resultsToProcess = webSearch.results.slice(0, targetCount);

  const candidates: ProspectingPipelineCandidate[] = await Promise.all(
    resultsToProcess.map(async (result): Promise<ProspectingPipelineCandidate> => {
      const name = extractCandidateName(result.title);
      const website = result.url;
      const domain = normalizeDomain(result.url);

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
        websiteVerification,
        duplicateCheck,
        scoring,
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
