/**
 * Incremental Search Orchestrator (Hito 16T.1 / 16T.3)
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
import { writeProspectingCandidates } from './candidate-writer';
import { buildNoveltyIndex, evaluateCandidateNovelty } from './novelty-checker';
import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
} from './query-builder';
import type { ProspectingPipelineCandidate, ProspectingPipelineOutput, ProspectingPipelineSummary } from './types';
import type {
  IncrementalSearchInput,
  IncrementalSearchOutput,
  IncrementalSearchMetadata,
  IncrementalSearchRoundMeta,
  IncrementalSearchStoppedReason,
} from './incremental-search-types';
import type { TavilyUsageContext } from './tavily-usage-logging';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_USEFUL = 7;
const DEFAULT_TARGET_INTERNAL = 10;
const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_MAX_RAW = 50;
const DEFAULT_COOLDOWN_DAYS = 30;

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

  const allCandidates: ProspectingPipelineCandidate[] = [];
  const roundsMeta: IncrementalSearchRoundMeta[] = [];
  const warnings: string[] = [];
  const seenDomains = new Set<string>();

  let totalRawEvaluated = 0;
  let stoppedReason: IncrementalSearchStoppedReason = 'max_rounds_reached';
  let lastPipelineOutput: ProspectingPipelineOutput | null = null;
  let writerBatchId: string | null = null;
  let writerCandidatesCreated: number | undefined = undefined;

  const allQueryTraceSummaryEntries: Array<{
    query_text: string;
    query_type: string;
    query_source_key: string | null;
    round_number: number;
  }> = [];

  const writerFn = writerOverride ?? writeProspectingCandidates;
  const pipelineFn = pipelineOverride ?? runProspectingPipeline;

  // Admin client para novelty pre-check (solo cuando dryRun=false)
  const adminSupabase: SupabaseClient | null = dryRun ? null : tryGetAdminClient();
  if (!dryRun && !adminSupabase) {
    warnings.push('novelty_precheck_unavailable: Supabase env vars not set; falling back to pre-novelty useful count for round decision.');
  }

  // Acumula el último resultado de pre-check para metadata
  let lastNoveltyPrecheck: NoveltyPrecheckResult | null = null;

  for (let round = 1; round <= maxRounds; round++) {
    const subindustries = input.subindustries ?? [];
    const queryOverrides =
      round === 1
        ? (subindustries.length > 0
            ? buildCleanMultiQueryDiscoveryQueries(input.industry, input.country, subindustries)
            : undefined)
        : buildExpandedMultiQueryDiscoveryQueries(input.industry, input.country, subindustries);

    const roundUsageContext: TavilyUsageContext | null = input.usageInputContext
      ? { ...input.usageInputContext, roundNumber: round }
      : null;

    const pipelineOutput = await pipelineFn({
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      webSearchProvider: input.webSearchProvider ?? 'mock',
      mode: 'multi_query',
      targetCount: targetInternal,
      queryOverrides,
      usageContext: roundUsageContext,
    });

    const rawCount = pipelineOutput.webSearch.resultsCount;
    totalRawEvaluated += rawCount;

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

    // Anota round_number en searchTrace de cada candidato nuevo (Hito 16Z.3)
    const candidatesWithRound: ProspectingPipelineCandidate[] = newCandidates.map((c) => {
      if (!c.searchTrace) return c;
      return { ...c, searchTrace: { ...c.searchTrace, round_number: round } };
    });
    allCandidates.push(...candidatesWithRound);

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

    // ── Novelty pre-check (dryRun=false + Supabase disponible) ──────────────
    // Estima cuántos candidatos útiles sobrevivirían el novelty filter del
    // writer. Usa ese conteo para decidir si se necesita ronda 2, en lugar
    // del conteo pre-novelty que causaba el bug de 16T.2.
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
    // Si el pre-check está disponible: usa persistable post-novelty estimado.
    // Si no está disponible (dryRun=true o error): usa usefulSoFar (pre-novelty).
    const effectivePersistable =
      lastNoveltyPrecheck !== null
        ? lastNoveltyPrecheck.persistable_candidates_count
        : usefulSoFar;

    if (effectivePersistable >= minUsefulCandidates) {
      stoppedReason = 'min_useful_reached';
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

  const metadata: IncrementalSearchMetadata = {
    rounds_executed: roundsMeta.length,
    stopped_reason: stoppedReason,
    total_raw_evaluated: totalRawEvaluated,
    total_candidates_accumulated: allCandidates.length,
    useful_candidates_count: usefulCandidatesCount,
    useful_candidates_count_before_novelty: usefulCandidatesCount,
    estimated_persistable_after_novelty: lastNoveltyPrecheck?.persistable_candidates_count,
    estimated_novelty_skipped: lastNoveltyPrecheck?.novelty_skipped_estimated,
    novelty_precheck: lastNoveltyPrecheck
      ? {
          enabled: true,
          estimated_skipped_count: lastNoveltyPrecheck.novelty_skipped_estimated,
          estimated_persistable_count: lastNoveltyPrecheck.persistable_candidates_count,
        }
      : undefined,
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
          ...(consolidatedQueryTraceSummary ? { query_trace_summary: consolidatedQueryTraceSummary } : {}),
        },
      };

      const writerOutput = await writerFn({
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
        existingBatchId: input.existingBatchId ?? null,
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
