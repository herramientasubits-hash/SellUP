/**
 * Incremental Search Orchestrator (Hito 16T.1)
 *
 * Ejecuta búsqueda incremental en hasta 2 rondas:
 *   Ronda 1: queries standard (buildCleanMultiQueryDiscoveryQueries)
 *   Ronda 2 (si < minUsefulCandidates): expanded queries, filtrando seenDomains
 *
 * REGLAS CRÍTICAS:
 * - No llama Tavily directamente (lo hace el pipeline con provider).
 * - No llama LLM ni Apollo ni Lusha.
 * - No escribe en Supabase ni HubSpot.
 * - No crea lotes ni candidatos reales (dryRun=true por defecto en validación).
 * - No activado en UI productiva (Hito 16T.2).
 *
 * dryRun:
 *   true  → no llama writeProspectingCandidates, solo retorna candidatos en memoria.
 *   false → [no implementado aún; activar en Hito 16T.2]
 */

import { runProspectingPipeline } from './prospecting-pipeline';
import { writeProspectingCandidates } from './candidate-writer';
import { buildExpandedMultiQueryDiscoveryQueries } from './query-builder';
import type { ProspectingPipelineCandidate, ProspectingPipelineOutput, ProspectingPipelineSummary } from './types';
import type {
  IncrementalSearchInput,
  IncrementalSearchOutput,
  IncrementalSearchMetadata,
  IncrementalSearchRoundMeta,
  IncrementalSearchStoppedReason,
} from './incremental-search-types';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_USEFUL = 7;
const DEFAULT_TARGET_INTERNAL = 10;
const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_MAX_RAW = 50;
const DEFAULT_MAX_COST_USD = 0.15;

// ─── Helper: candidato útil ───────────────────────────────────────────────────

/**
 * Un candidato es "útil" (persistable / prospectable) si su quality label
 * es high_quality_new o needs_review. Duplicates y discards no cuentan.
 */
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

// ─── Orquestador principal ────────────────────────────────────────────────────

/**
 * Ejecuta búsqueda incremental sin activar en UI productiva.
 *
 * @param input - Parámetros de búsqueda. dryRun=true es el default seguro.
 * @returns Output con candidatos, metadata de rondas y warnings.
 */
export async function runIncrementalProspectingSearch(
  input: IncrementalSearchInput,
): Promise<IncrementalSearchOutput> {
  const minUsefulCandidates = input.minUsefulCandidates ?? DEFAULT_MIN_USEFUL;
  const targetInternal = input.targetInternal ?? DEFAULT_TARGET_INTERNAL;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxTotalRawToEvaluate = input.maxTotalRawToEvaluate ?? DEFAULT_MAX_RAW;
  const dryRun = input.dryRun !== false; // default true — seguro para validación

  const allCandidates: ProspectingPipelineCandidate[] = [];
  const roundsMeta: IncrementalSearchRoundMeta[] = [];
  const warnings: string[] = [];
  const seenDomains = new Set<string>();

  let totalRawEvaluated = 0;
  let stoppedReason: IncrementalSearchStoppedReason = 'max_rounds_reached';
  let lastPipelineOutput: ProspectingPipelineOutput | null = null;
  let writerBatchId: string | null = null;
  let writerCandidatesCreated: number | undefined = undefined;

  for (let round = 1; round <= maxRounds; round++) {
    // Ronda 1 → queries standard (sin queryOverrides)
    // Ronda 2+ → expanded queries
    const queryOverrides =
      round === 1
        ? undefined
        : buildExpandedMultiQueryDiscoveryQueries(input.industry, input.country);

    const pipelineOutput = await runProspectingPipeline({
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      webSearchProvider: input.webSearchProvider ?? 'mock',
      mode: 'multi_query',
      targetCount: targetInternal,
      queryOverrides,
    });

    const rawCount = pipelineOutput.webSearch.resultsCount;
    totalRawEvaluated += rawCount;

    // ── Filtro cross-round por seenDomains ───────────────────────────────────
    const seenDomainsAtStart = seenDomains.size;
    const newCandidates: ProspectingPipelineCandidate[] = [];

    for (const c of pipelineOutput.candidates) {
      if (c.domain) {
        if (seenDomains.has(c.domain)) continue; // ya visto en ronda anterior
        seenDomains.add(c.domain);
      }
      newCandidates.push(c);
    }

    allCandidates.push(...newCandidates);

    const usefulSoFar = allCandidates.filter(isUsefulCandidate).length;

    roundsMeta.push({
      round,
      queriesUsed: extractQueriesFromMeta(pipelineOutput.metadata),
      rawResultsCount: rawCount,
      candidatesEvaluated: pipelineOutput.candidates.length,
      candidatesNewAfterDomainFilter: newCandidates.length,
      candidatesAccumulatedTotal: allCandidates.length,
      usefulCandidatesAccumulated: usefulSoFar,
      seenDomainsAtRoundStart: seenDomainsAtStart,
      newDomainsFoundThisRound: seenDomains.size - seenDomainsAtStart,
    });

    lastPipelineOutput = pipelineOutput;

    // ── Criterio de parada: 0 resultados en ronda 1 ─────────────────────────
    if (round === 1 && rawCount === 0) {
      stoppedReason = 'no_results_round_1';
      break;
    }

    // ── Criterio de parada: mínimo útiles alcanzado ──────────────────────────
    if (usefulSoFar >= minUsefulCandidates) {
      stoppedReason = 'min_useful_reached';
      break;
    }

    // ── Criterio de parada: raw máximo alcanzado ─────────────────────────────
    if (totalRawEvaluated >= maxTotalRawToEvaluate) {
      stoppedReason = 'max_raw_exceeded';
      break;
    }
  }

  const usefulCandidatesCount = allCandidates.filter(isUsefulCandidate).length;

  const metadata: IncrementalSearchMetadata = {
    rounds_executed: roundsMeta.length,
    stopped_reason: stoppedReason,
    total_raw_evaluated: totalRawEvaluated,
    total_candidates_accumulated: allCandidates.length,
    useful_candidates_count: usefulCandidatesCount,
    min_useful_candidates: minUsefulCandidates,
    target_internal: targetInternal,
    max_rounds: maxRounds,
    max_total_raw_to_evaluate: maxTotalRawToEvaluate,
    dry_run: dryRun,
    rounds: roundsMeta,
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
        },
      };

      const writerOutput = await writeProspectingCandidates({
        pipelineOutput: syntheticPipelineOutput,
        triggeredByUserId: input.triggeredByUserId ?? null,
        ownerId: input.ownerId ?? null,
        batchName: input.batchName ?? null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: {
          incremental_search: metadata as Record<string, unknown>,
          search_mode: 'incremental_multi_round',
        },
      });

      if (writerOutput.status === 'failed') {
        warnings.push(`Writer error: ${writerOutput.errors.join('; ')}`);
      } else {
        writerBatchId = writerOutput.batchId;
        writerCandidatesCreated = writerOutput.candidatesCreated;
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
  };
}
